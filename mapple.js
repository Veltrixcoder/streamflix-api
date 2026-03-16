import { sha256Sync } from './utils.js';

const CONFIG = {
    BASE_URL: 'https://mapple.uk',
    API_KEY: 'mptv_sk_a8f29c4e7b3d1f',
    UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
};

function generateFingerprint() {
    return Math.random().toString(36).substring(2) + "_" + Date.now();
}

function solvePoW(challenge, difficulty) {
    let nonce = 0;
    const target = '0'.repeat(Math.ceil(difficulty / 4));

    while (true) {
        const input = challenge + nonce.toString();
        const hash = sha256Sync(input);

        if (hash.startsWith(target)) {
            return nonce.toString();
        }
        nonce++;
        if (nonce > 1000000) return null; // Safety break
    }
}

export async function getMappleStream(tmdbId, type, season = "", episode = "") {
    const fingerprint = generateFingerprint();
    const mediaType = (type === "series" || type === "tv") ? "tv" : "movie";

    const watchUrl = mediaType === "movie"
        ? `${CONFIG.BASE_URL}/watch/movie/${tmdbId}`
        : `${CONFIG.BASE_URL}/watch/tv/${tmdbId}-${season}-${episode}`;

    try {
        const pageRes = await fetch(watchUrl, {
            headers: { 'User-Agent': CONFIG.UA }
        });
        const html = await pageRes.text();
        const requestToken = html.match(/window\.__REQUEST_TOKEN__\s*=\s*"([^"]+)"/)?.[1];

        if (!requestToken) throw new Error("Request Token not found.");

        const challengeRes = await fetch(`${CONFIG.BASE_URL}/api/stream-token`, {
            method: 'POST',
            body: JSON.stringify({
                mediaId: parseInt(tmdbId),
                mediaType: mediaType,
                requestToken
            }),
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': CONFIG.UA,
                'x-wasm-fingerprint': fingerprint,
                'referer': watchUrl
            }
        });

        const challengeJson = await challengeRes.json();
        if (!challengeJson || !challengeJson.pow) throw new Error("Server did not provide a PoW challenge.");

        const nonce = await solvePoW(challengeJson.pow.challenge, challengeJson.pow.difficulty);

        const verifyRes = await fetch(`${CONFIG.BASE_URL}/api/stream-token`, {
            method: 'POST',
            body: JSON.stringify({
                mediaId: parseInt(tmdbId),
                mediaType: mediaType,
                requestToken,
                pow: {
                    challengeId: challengeJson.pow.challengeId,
                    nonce: nonce
                }
            }),
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': CONFIG.UA,
                'x-wasm-fingerprint': fingerprint
            }
        });

        const verifyJson = await verifyRes.json();
        if (!verifyJson.success) throw new Error("PoW Verification Failed.");

        const streamUrlObj = new URL(`${CONFIG.BASE_URL}/api/stream`);
        streamUrlObj.searchParams.append('mediaId', tmdbId);
        streamUrlObj.searchParams.append('mediaType', mediaType);
        
        if (mediaType === "tv") {
            streamUrlObj.searchParams.append('tv_slug', `${season}-${episode}`);
            streamUrlObj.searchParams.append('source', 'english3_1080p');
        } else {
            streamUrlObj.searchParams.append('source', 'mapple');
        }

        streamUrlObj.searchParams.append('apikey', CONFIG.API_KEY);
        streamUrlObj.searchParams.append('requestToken', requestToken);
        streamUrlObj.searchParams.append('token', verifyJson.token);

        const finalRes = await fetch(streamUrlObj.toString(), {
            headers: { 'User-Agent': CONFIG.UA, 'referer': CONFIG.BASE_URL }
        });

        const result = await finalRes.json();

        if (result.success && result.data) {
            const origin = "https://mapple.uk";
            const referer = "https://mapple.uk";
            
            // Check for multiple possible URL field names
            const urlKey = result.data.url ? 'url' : (result.data.file ? 'file' : (result.data.link ? 'link' : null));
            
            if (urlKey && result.data[urlKey]) {
                const encodedUrl = encodeURIComponent(result.data[urlKey]);
                result.data[urlKey] = `https://veltrixcode-pycomp.hf.space/proxy?url=${encodedUrl}&origin=${encodeURIComponent(origin)}&referer=${encodeURIComponent(referer)}`;
            }
            
            result.data.headers = {
                "Referer": referer,
                "Origin": origin
            };
        }

        return result;

    } catch (e) {
        return { success: false, error: e.message };
    }
}
