export async function getWebstreamerRawResponse(imdbId, type, season = "", episode = "") {
    if (!imdbId || imdbId === "undefined") return { error: "Missing IMDB ID" };

    const normalizedType = (type === "series" || type === "tv") ? "series" : "movie";
    const isSeries = normalizedType === "series";

    const url = `https://webstreamr.hayd.uk/{"multi":"on","al":"on","de":"on","es":"on","fr":"on","hi":"on","it":"on","mx":"on","mediaFlowProxyUrl":"","mediaFlowProxyPassword":""}/stream/${normalizedType}/${imdbId}${isSeries ? `:${season}:${episode}` : ""
        }.json`;

    console.log(`[Webstreamer] Fetching: ${url}`);
    try {
        const res = await fetch(encodeURI(url));
        return await res.json();
    } catch (e) {
        return { error: e.message };
    }
}

export async function getWebstreamerStreams(imdbId, type, season = "", episode = "") {
    const data = await getWebstreamerRawResponse(imdbId, type, season, episode);
    if (!data?.streams) return [];

    return data.streams.map((source) => {
        const name = source?.name || "WebStreamer";
        const qualityMatch = name?.match(/(\d{3,4})p/);
        const quality = qualityMatch ? qualityMatch[1] : "Auto";

        return {
            server: name,
            url: source?.url,
            type: type,
            quality: quality,
        };
    });
}
