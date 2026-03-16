import { getHmacSha256, aesDecryptGcm, pbkdf2, hexToUint8Array, uint8ArrayToHex } from './utils.js';

const HMAC_KEY_1 = "a7f3b9c2e8d4f1a6b5c9e2d7f4a8b3c6e1d9f7a4b2c8e5d3f9a6b4c1e7d2f8a5";
const HMAC_KEY_2 = "d3f8a5b2c9e6d1f7a4b8c5e2d9f3a6b1c7e4d8f2a9b5c3e7d4f1a8b6c2e9d5f3";
const ENCRYPTION_KEY = "a1b2c3d4e4f6477658455678901477567890abcdef1234567890abcdef123456";

async function getSignature(tmdbId, imdbId, season, episode) {
    let parts = [];
    if (tmdbId) parts.push(`tmdbId:${tmdbId}`);
    if (imdbId) parts.push(`imdbId:${imdbId}`);
    if (season) parts.push(`seasonId:${season}`);
    if (episode) parts.push(`episodeId:${episode}`);

    const input = parts.join("|");
    const hmac1 = await getHmacSha256(HMAC_KEY_1, input);
    return await getHmacSha256(HMAC_KEY_2, hmac1);
}

async function decryptPayload(data) {
    const { encrypted, cin, mao, salt } = data;
    const derivedKey = await pbkdf2(ENCRYPTION_KEY, salt, 100000, 32);
    const keyHex = uint8ArrayToHex(derivedKey);

    const decrypted = await aesDecryptGcm(encrypted, keyHex, cin, mao);
    return JSON.parse(decrypted);
}

function parseProxyUrl(str) {
    if (typeof str !== 'string') return null;
    try {
        const urlObj = new URL(str);
        if (str.includes('/mp4-proxy?url=')) {
            const mainUrl = urlObj.searchParams.get('url');
            const referer = urlObj.searchParams.get('referer');
            const origin = urlObj.searchParams.get('origin');

            if (mainUrl) {
                return {
                    url: decodeURIComponent(mainUrl),
                    headers: { "Referer": referer || "", "Origin": origin || "" }
                };
            }
        }
        else if (str.includes('/cors-m3u8-proxy?url=') || str.includes('/wil-proxy?url=')) {
            const mainUrl = urlObj.searchParams.get('url');
            const headersStr = urlObj.searchParams.get('headers');
            const refererParam = urlObj.searchParams.get('referer');
            let headers = {};

            if (headersStr) {
                try {
                    headers = JSON.parse(decodeURIComponent(headersStr));
                } catch (e) {
                    headers = { "Referer": decodeURIComponent(headersStr) };
                }
            } else if (refererParam) {
                headers = { "Referer": decodeURIComponent(refererParam) };
            }

            if (mainUrl) {
                return {
                    url: decodeURIComponent(mainUrl),
                    headers: headers
                };
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}

async function fetchTmdbMetadata(tmdbId, type, season = "", episode = "") {
    const isTV = type === "series" || type === "tv";
    const mediaType = isTV ? "tv" : "movie";

    let apiUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?append_to_response=external_ids&api_key=20bea604243a8f99322f925df8f3feab`;

    if (isTV && season && episode) {
        apiUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?append_to_response=external_ids&api_key=20bea604243a8f99322f925df8f3feab`;
    }

    const response = await fetch(apiUrl, {
        headers: { "accept": "application/json" }
    });
    if (!response.ok) throw new Error(`TMDB error: ${response.statusText}`);
    let data = await response.json();

    if (isTV && season && episode) {
        try {
            const showUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=20bea604243a8f99322f925df8f3feab`;
            const showRes = await fetch(showUrl);
            if (showRes.ok) {
                const showData = await showRes.json();
                data.show_name = showData.name || showData.original_name;
            }
        } catch (e) {}
    }

    return data;
}

function transformResponse(data) {
    if (!data || !data.sources) return data;

    const transformedSources = {};

    for (const [key, source] of Object.entries(data.sources)) {
        let transformed = { ...source };

        if (transformed.url) {
            const parsed = parseProxyUrl(transformed.url);
            if (parsed) {
                transformed.url = parsed.url;
                transformed.headers = { ...(transformed.headers || {}), ...parsed.headers };
            }
        }

        if (transformed.qualities) {
            for (const qKey of Object.keys(transformed.qualities)) {
                if (transformed.qualities[qKey].url) {
                    const parsedQ = parseProxyUrl(transformed.qualities[qKey].url);
                    if (parsedQ) {
                        transformed.qualities[qKey].url = parsedQ.url;
                        transformed.qualities[qKey].headers = { ...(transformed.qualities[qKey].headers || {}), ...parsedQ.headers };
                    }
                }
            }
        }

        transformedSources[key] = transformed;
    }

    data.sources = transformedSources;
    if (data.captions) delete data.captions;

    return data;
}

export async function getCinemaOSStream(tmdbId, type, season = "", episode = "") {
    try {
        const tmdbData = await fetchTmdbMetadata(tmdbId, type, season, episode);
        const imdbId = tmdbData.external_ids?.imdb_id || "";
        const title = tmdbData.show_name || tmdbData.title || tmdbData.name || "";
        const releaseDate = tmdbData.release_date || tmdbData.first_air_date || tmdbData.air_date || "";
        const releaseYear = releaseDate.split("-")[0];

        const secret = await getSignature(tmdbId, imdbId, season, episode);

        const cinemaType = (type === "series" || type === "tv") ? "tv" : "movie";
        const url = new URL(`https://cinemaos.live/api/providerv2`);
        url.searchParams.append('type', cinemaType);
        url.searchParams.append('tmdbId', tmdbId);
        url.searchParams.append('imdbId', imdbId);
        url.searchParams.append('t', title);
        url.searchParams.append('ry', releaseYear);
        url.searchParams.append('secret', secret);

        if (season) url.searchParams.append('seasonId', season);
        if (episode) url.searchParams.append('episodeId', episode);

        const response = await fetch(url.toString(), {
            headers: {
                'Referer': 'https://cinemaos.live/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const resData = await response.json();

        if (resData.encrypted && resData.data) {
            const decryptedJson = await decryptPayload(resData.data);
            const transformed = transformResponse(decryptedJson);

            const flattenedStreams = [];
            if (transformed.sources) {
                Object.keys(transformed.sources).forEach(key => {
                    const source = transformed.sources[key];
                    if (source.qualities) {
                        Object.keys(source.qualities).forEach(q => {
                            flattenedStreams.push({
                                server: `${source.server || key} (${q}p)`,
                                url: source.qualities[q].url,
                                type: source.qualities[q].type || "mp4",
                                quality: q,
                                headers: source.qualities[q].headers || source.headers,
                                provider: "CinemaOS"
                            });
                        });
                    } else {
                        flattenedStreams.push({
                            server: source.server || key,
                            url: source.url,
                            type: source.type || "m3u8",
                            quality: source.bitrate || "Auto",
                            headers: source.headers,
                            provider: "CinemaOS"
                        });
                    }
                });
            }

            return {
                success: true,
                tmdb: tmdbData,
                streams: flattenedStreams,
                skipTime: transformed.skipTime || null,
                cached: resData.cached || false
            };
        } else {
            return { error: "Server returned unencrypted or invalid data" };
        }

    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function getMovieBoxStream(tmdbId, type, season = "", episode = "") {
    try {
        const isTV = type === "series" || type === "tv";
        const cinemaType = isTV ? "tv" : "movie";
        let apiUrl = `https://cinemaos.live/api/moviebox?tmdbId=${tmdbId}&type=${cinemaType}`;

        if (isTV && season && episode) {
            apiUrl += `&season=${season}&episode=${episode}`;
        }

        const response = await fetch(apiUrl, {
            headers: {
                'Referer': 'https://cinemaos.live/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });
        const data = await response.json();

        if (data && data.streams) {
            return {
                success: true,
                streams: data.streams.map(s => ({
                    server: s.name,
                    url: s.url,
                    quality: s.quality,
                    headers: s.headers,
                    provider: "MovieBox"
                }))
            };
        }
        return { success: false, error: "No streams found" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function getFuckItStream(tmdbId, imdbId, title, year, type, season = "", episode = "") {
    try {
        const isTV = type === "series" || type === "tv";
        const mediaType = isTV ? "tv" : "movie";
        const apiUrl = new URL(`https://cinemaos.live/api/fuckit/scraper`);
        
        let formattedTitle = title;
        if (isTV && season && episode) {
            formattedTitle = `${title} S${season}:E${episode}`;
        }

        apiUrl.searchParams.append('sr', '1');
        apiUrl.searchParams.append('title', formattedTitle);
        apiUrl.searchParams.append('mediaType', mediaType);
        apiUrl.searchParams.append('year', year);
        apiUrl.searchParams.append('tmdbId', tmdbId);
        apiUrl.searchParams.append('imdbId', imdbId);
        apiUrl.searchParams.append('totalSeasons', season || '1');
        apiUrl.searchParams.append('titlePortuguese', formattedTitle);
        apiUrl.searchParams.append('titleSpanish', formattedTitle);

        if (isTV && season && episode) {
            apiUrl.searchParams.append('seasonId', season);
            apiUrl.searchParams.append('episodeId', episode);
        }

        const response = await fetch(apiUrl.toString(), {
            headers: {
                'Referer': 'https://cinemaos.live/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });
        const resData = await response.json();

        if (resData && resData.success && resData.decryptedData) {
            const data = resData.decryptedData;
            const streams = [];

            if (data.quality && Array.isArray(data.quality)) {
                data.quality.forEach(q => {
                    streams.push({
                        server: `FuckIt (${q.quality})`,
                        url: q.url,
                        quality: q.quality,
                        headers: { "Referer": "https://videasy.net" },
                        provider: "FuckIt"
                    });
                });
            } else if (data.url) {
                streams.push({
                    server: "FuckIt",
                    url: data.url,
                    quality: "Auto",
                    headers: { "Referer": "https://videasy.net" },
                    provider: "FuckIt"
                });
            }

            return { success: true, streams: streams };
        }
        return { success: false, error: "No streams found" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
