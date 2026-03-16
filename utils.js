export async function getHmacSha256(key, data) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const msgData = encoder.encode(data);

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return uint8ArrayToHex(new Uint8Array(signature));
}

export async function sha256(data) {
    const hash = await sha256Bytes(data);
    return uint8ArrayToHex(hash);
}

export async function aesDecryptGcm(encryptedHex, keyHex, ivHex, tagHex) {
    const key = hexToUint8Array(keyHex);
    const iv = hexToUint8Array(ivHex);
    const tag = hexToUint8Array(tagHex);
    const ciphertext = hexToUint8Array(encryptedHex);

    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        'AES-GCM',
        false,
        ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        combined
    );

    return new TextDecoder().decode(decrypted);
}

export async function pbkdf2(password, saltHex, iterations, keyLen) {
    const passwordUint8 = new TextEncoder().encode(password);
    const saltUint8 = hexToUint8Array(saltHex);

    const baseKey = await crypto.subtle.importKey(
        'raw',
        passwordUint8,
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltUint8,
            iterations: iterations,
            hash: 'SHA-256'
        },
        baseKey,
        keyLen * 8
    );

    return new Uint8Array(derivedBits);
}

export function hexToUint8Array(hex) {
    const len = hex.length / 2;
    const array = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        array[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return array;
}

export function uint8ArrayToHex(arr) {
    let hex = '';
    for (let i = 0; i < arr.length; i++) {
        hex += arr[i].toString(16).padStart(2, '0');
    }
    return hex;
}

export async function sha256Bytes(data) {
    const encoder = new TextEncoder();
    const msgData = typeof data === 'string' ? encoder.encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgData);
    return new Uint8Array(hashBuffer);
}

export async function aesEncryptCbc(text, key, iv) {
    const encoder = new TextEncoder();
    const data = encoder.encode(padCbc(text));
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(key),
        'AES-CBC',
        false,
        ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: encoder.encode(iv) },
        cryptoKey,
        data
    );

    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

const K = new Uint32Array([0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070, 0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2]);
const W = new Uint32Array(64);

export function sha256Sync(data) {
    const msg = data;
    const l = msg.length * 8;
    const m = new Uint32Array(((l + 64 >> 9) << 4) + 16);
    for (let i = 0; i < msg.length; i++) {
        m[i >> 2] |= (msg.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    }
    m[l >> 5] |= 0x80 << (24 - l % 32);
    m[m.length - 1] = l;

    let a = 0x6A09E667, b = 0xBB67AE85, c = 0x3C6EF372, d = 0xA54FF53A;
    let e = 0x510E527F, f = 0x9B05688C, g = 0x1F83D9AB, h = 0x5BE0CD19;

    for (let i = 0; i < m.length; i += 16) {
        let _a = a, _b = b, _c = c, _d = d, _e = e, _f = f, _g = g, _h = h;

        for (let j = 0; j < 64; j++) {
            if (j < 16) W[j] = m[i + j];
            else {
                const x0 = W[j - 15], x1 = W[j - 2], x2 = W[j - 7], x3 = W[j - 16];
                const s0 = ((x0 >>> 7) | (x0 << 25)) ^ ((x0 >>> 18) | (x0 << 14)) ^ (x0 >>> 3);
                const s1 = ((x1 >>> 17) | (x1 << 15)) ^ ((x1 >>> 19) | (x1 << 13)) ^ (x1 >>> 10);
                W[j] = (W[j - 16] + s0 + W[j - 7] + s1) | 0;
            }

            const s1 = ((_e >>> 6) | (_e << 26)) ^ ((_e >>> 11) | (_e << 21)) ^ ((_e >>> 25) | (_e << 7));
            const ch = (_e & _f) ^ ((~_e) & _g);
            const t1 = (_h + s1 + ch + K[j] + W[j]) | 0;
            const s0 = ((_a >>> 2) | (_a << 30)) ^ ((_a >>> 13) | (_a << 19)) ^ ((_a >>> 22) | (_a << 10));
            const maj = (_a & _b) ^ (_a & _c) ^ (_b & _c);
            const t2 = (s0 + maj) | 0;

            _h = _g; _g = _f; _f = _e; _e = (_d + t1) | 0;
            _d = _c; _c = _b; _b = _a; _a = (t1 + t2) | 0;
        }

        a = (a + _a) | 0; b = (b + _b) | 0; c = (c + _c) | 0; d = (d + _d) | 0;
        e = (e + _e) | 0; f = (f + _f) | 0; g = (g + _g) | 0; h = (h + _h) | 0;
    }

    const res = new Uint32Array([a, b, c, d, e, f, g, h]);
    let hex = "";
    for (let i = 0; i < 8; i++) {
        hex += res[i].toString(16).padStart(8, '0');
    }
    return hex;
}
