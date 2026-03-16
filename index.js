import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getRiveStreams, getRiveRawResponse, processRiveResponse } from './rive.js';
import { getWebstreamerStreams, getWebstreamerRawResponse } from './webstreamer.js';
import { getMappleStream } from './mapple.js';
import { getCinemaOSStream, getMovieBoxStream, getFuckItStream } from './cinemaos.js';
import { getVidRockStreams, getVidRockRawResponse } from './vid.js';

const app = new Hono();

app.use('*', cors());

async function fetchTmdbMetadata(tmdbId, type, season = "", episode = "") {
    const isTV = type === "series" || type === "tv";
    const mediaType = isTV ? "tv" : "movie";

    let url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?append_to_response=external_ids&api_key=20bea604243a8f99322f925df8f3feab`;

    if (isTV && season && episode) {
        url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?append_to_response=external_ids&api_key=20bea604243a8f99322f925df8f3feab`;
    }

    console.log(`[TMDB] Fetching metadata: ${url}`);
    const res = await fetch(url, {
        headers: { "accept": "application/json" }
    });
    
    if (!res.ok) throw new Error(`Failed to fetch TMDB metadata: ${res.statusText}`);
    return await res.json();
}

const RIVE_SERVERS = ["flowcast", "asiacloud", "hindicast", "guru"];

app.get("/api/media/:index/:type", async (c) => {
    const index = c.req.param('index');
    const type = c.req.param('type');
    const tmdbId = c.req.query('id');
    const season = c.req.query('season') || "";
    const episode = c.req.query('episode') || "";

    if (!tmdbId) {
        return c.json({ error: "Missing tmdbId (id) query parameter" }, 400);
    }

    // Caching Strategy
    const cache = caches.default;
    const cacheKey = new URL(c.req.url);
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
        console.log(`[Cache] Hit: ${cacheKey}`);
        return cachedResponse;
    }

    try {
        let resultData;
        if (index === "all") {
            // ... (rest of the 'all' logic remains same)
            let tmdbData = {};
            try {
                tmdbData = await fetchTmdbMetadata(tmdbId, type, season, episode);
            } catch (e) {
                try {
                    tmdbData = await fetchTmdbMetadata(tmdbId, type);
                } catch (e2) {}
            }
            const imdbId = tmdbData.external_ids?.imdb_id || "";

            const [riveRes, webstreamerRes, mappleRes, cinemaOSRes, vidrockRes, movieboxRes, fuckitRes] = await Promise.allSettled([
                getRiveStreams(tmdbId, type, season, episode),
                getWebstreamerStreams(imdbId, type, season, episode),
                getMappleStream(tmdbId, type, season, episode),
                getCinemaOSStream(tmdbId, type, season, episode),
                getVidRockStreams(tmdbId, type, season, episode),
                getMovieBoxStream(tmdbId, type, season, episode),
                getFuckItStream(tmdbId, imdbId, tmdbData.title || tmdbData.name, tmdbData.release_date?.split("-")[0] || tmdbData.first_air_date?.split("-")[0], type, season, episode)
            ]);

            const streams = [];
            if (riveRes.status === "fulfilled" && Array.isArray(riveRes.value)) streams.push(...riveRes.value);
            if (webstreamerRes.status === "fulfilled") streams.push(...webstreamerRes.value);
            if (mappleRes.status === "fulfilled" && mappleRes.value.success && mappleRes.value.data) streams.push(mappleRes.value.data);
            if (cinemaOSRes.status === "fulfilled" && cinemaOSRes.value && !cinemaOSRes.value.error) {
                const cinemaOSData = cinemaOSRes.value;
                if (Array.isArray(cinemaOSData.streams)) streams.push(...cinemaOSData.streams.map(({ provider, ...rest }) => rest));
            }
            if (vidrockRes.status === "fulfilled" && Array.isArray(vidrockRes.value)) streams.push(...vidrockRes.value.map(({ provider, ...rest }) => rest));
            if (movieboxRes.status === "fulfilled" && movieboxRes.value.success) streams.push(...movieboxRes.value.streams.map(({ provider, ...rest }) => rest));
            if (fuckitRes.status === "fulfilled" && fuckitRes.value.success) streams.push(...fuckitRes.value.streams.map(({ provider, ...rest }) => rest));

            resultData = { tmdb: tmdbData, streams: streams };
        } else {
            const idx = parseInt(index);
            if (idx === 1 || idx === 3 || idx === 4) {
                const server = RIVE_SERVERS[idx - 1];
                let data = await getRiveRawResponse(tmdbId, type, server, season, episode);
                if (data?.data?.captions) delete data.data.captions;
                resultData = data;
            } else if (idx === 2) {
                resultData = await getMovieBoxStream(tmdbId, type, season, episode);
            } else if (idx === 5) {
                const tmdbData = await fetchTmdbMetadata(tmdbId, type);
                const imdbId = tmdbData.external_ids?.imdb_id || "";
                const data = await getWebstreamerRawResponse(imdbId, type, season, episode);
                if (data?.captions) delete data.captions;
                resultData = data;
            } else if (idx === 6) {
                resultData = await getMappleStream(tmdbId, type, season, episode);
                if (resultData?.data?.captions) delete resultData.data.captions;
            } else if (idx === 7) {
                resultData = await getCinemaOSStream(tmdbId, type, season, episode);
            } else if (idx === 8) {
                resultData = await getVidRockRawResponse(tmdbId, type, season, episode);
                if (resultData?.captions) delete resultData.captions;
            } else if (idx === 9) {
                const tmdbData = await fetchTmdbMetadata(tmdbId, type, season, episode);
                const imdbId = tmdbData.external_ids?.imdb_id || "";
                const title = tmdbData.title || tmdbData.name || "";
                const releaseYear = (tmdbData.release_date || tmdbData.first_air_date || "").split("-")[0];
                resultData = await getFuckItStream(tmdbId, imdbId, title, releaseYear, type, season, episode);
            } else {
                return c.json({ error: "Invalid index." }, 404);
            }
        }

        // Create response and cache it for 1 hour
        const response = c.json(resultData);
        response.headers.set("Cache-Control", "public, max-age=3600");
        c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
        
        return response;

    } catch (error) {
        console.error("API Error:", error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
