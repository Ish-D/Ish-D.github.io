/**
 * Encoding helpers and AES-GCM sealing on top of WebCrypto.
 *
 * Every sealed value carries its own random 96-bit IV, and callers bind it to
 * a context string (additional authenticated data), so a ciphertext cannot be
 * moved to a different item or role without failing to open.
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class VaultError extends Error {
    /** @param {'wrong-password' | 'corrupt' | 'unsupported'} code */
    constructor(code, message) {
        super(message ?? code);
        this.code = code;
    }
}

export const utf8 = {
    encode: (text) => encoder.encode(text),
    decode: (bytes) => decoder.decode(bytes),
};

export const b64u = {
    encode(bytes) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(text) {
        const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    },
};

/** Random bytes; getRandomValues allows 65,536 at a time. */
export function randomBytes(length) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(length, i + 65536)));
    return out;
}

/** A short random identifier safe for file names. */
export const randomId = () => b64u.encode(randomBytes(12));

/** AES-GCM key from raw bytes; non-extractable unless asked otherwise. */
export function importAesKey(bytes, extractable = false) {
    return subtle.importKey('raw', bytes, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}

/**
 * @param {CryptoKey} key
 * @param {Uint8Array} plaintext
 * @param {string} context   bound to the ciphertext
 * @returns {Promise<{ iv: string, ct: string }>}
 */
export async function seal(key, plaintext, context) {
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(context) }, key, plaintext);
    return { iv: b64u.encode(iv), ct: b64u.encode(new Uint8Array(ct)) };
}

/** @throws {VaultError} 'wrong-password' when the key or context does not match */
export async function open(key, sealed, context) {
    try {
        const plain = await subtle.decrypt(
            { name: 'AES-GCM', iv: b64u.decode(sealed.iv), additionalData: utf8.encode(context) },
            key,
            b64u.decode(sealed.ct),
        );
        return new Uint8Array(plain);
    } catch {
        throw new VaultError('wrong-password', 'Could not decrypt: wrong key, or the data was changed');
    }
}
