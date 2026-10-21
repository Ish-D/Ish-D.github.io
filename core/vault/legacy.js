/**
 * Reads cards encrypted by the old site (PBKDF2 100k, AES-GCM). The front
 * matter holds `salt` and `iv`; the body is the base64 ciphertext.
 */

import { VaultError, utf8 } from './crypto.js';
import { frontMatter } from './pages.js';

const unb64 = (text) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export const isLegacyEncrypted = (source) => frontMatter(source).encrypted === 'true';

/** @throws {VaultError} 'wrong-password' */
export async function decryptLegacyCard(source, password) {
    const entries = frontMatter(source);
    if (entries.encrypted !== 'true' || !entries.salt || !entries.iv) throw new VaultError('corrupt', 'Not an encrypted card');
    const body = source.replace(/^---[\s\S]*?\n---[ \t]*\r?\n/, '').replace(/\s+/g, '');
    const subtle = globalThis.crypto.subtle;
    const material = await subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey(
        { name: 'PBKDF2', salt: unb64(entries.salt), iterations: 100000, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    try {
        return utf8.decode(new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(entries.iv) }, key, unb64(body))));
    } catch {
        throw new VaultError('wrong-password', 'Wrong password for this card');
    }
}
