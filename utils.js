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
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function sha256(data) {
    const encoder = new TextEncoder();
    const msgData = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgData);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function aesDecryptGcm(encryptedHex, keyHex, ivHex, tagHex) {
    const key = hexToUint8Array(keyHex);
    const iv = hexToUint8Array(ivHex);
    const tag = hexToUint8Array(tagHex);
    const ciphertext = hexToUint8Array(encryptedHex);

    // GCM in Web Crypto expects tag appended to ciphertext
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
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
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

// Manual PKCS7 padding for AES-CBC if needed (Web Crypto might handle it but being safe)
function padCbc(text) {
    const blockSize = 16;
    const padLen = blockSize - (text.length % blockSize);
    const padding = String.fromCharCode(padLen).repeat(padLen);
    return text + padding;
}
