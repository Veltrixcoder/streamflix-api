const crypto = require('crypto');

const KEY = "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9";
const IV = KEY.substring(0, 16);
const API_BASE = "https://vidrock.net/api";

/**
 * Replicates the DL function from vid.js
 * Encrypts TMDB ID (or TV ID format) using AES-256-CBC
 */
function encodeTmdbId(id, type, season, episode) {
    const rawData = type === "tv" ? `${id}_${season}_${episode}` : id;

    // In vid.js, it uses CryptoJS.AES.encrypt which defaults to CBC with PKCS7 padding
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY), Buffer.from(IV));
    let encrypted = cipher.update(rawData, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Replicate the base64 tweak from vid.js: .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    return encrypted
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function fetchSources(tmdbId, type = 'movie', season = '1', episode = '1') {
    const encryptedId = encodeTmdbId(tmdbId, type, season, episode);
    const endpoint = type === 'tv' ? 'tv' : 'movie';
    const url = `${API_BASE}/${endpoint}/${encodeURIComponent(encryptedId)}`;

    console.log(`[+] Encrypted ID: ${encryptedId}`);
    console.log(`[+] Requesting URL: ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                'Referer': 'https://vidrock.net/',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        console.log("\n[+] Sources Found:");
        console.log(JSON.stringify(data, null, 2));

        return data;
    } catch (error) {
        console.error(`[-] Error: ${error.message}`);
    }
}

// CLI handle
const args = process.argv.slice(2);
const id = args[0] || "550";
const type = args[1] || "movie";
const season = args[2] || "1";
const episode = args[3] || "1";

if (!args[0]) {
    console.log("Usage: node vidrock_scraper.js <tmdb_id> [movie|tv] [season] [episode]");
    console.log("Example: node vidrock_scraper.js 1399 tv 1 1\n");
}

fetchSources(id, type, season, episode);
