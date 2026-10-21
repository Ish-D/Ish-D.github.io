/**
 * The vault: a small public file holding a random master key wrapped by a key
 * derived from the password, plus a box with the secrets (the GitHub token and
 * where the private content lives). Everything private is encrypted with the
 * master key, so changing the password never re-encrypts content.
 *
 * File shape:
 *   { v: 1, kdf: { name: 'scrypt', N, r, p, salt }, wrap: { iv, ct }, box: { iv, ct } }
 */

import { scrypt } from './scrypt.js';
import { b64u, importAesKey, open, randomBytes, seal, utf8, VaultError } from './crypto.js';

export { VaultError } from './crypto.js';

/** 64 MiB and about a third of a second on a laptop; raise N to make guessing dearer. */
export const DEFAULT_KDF = Object.freeze({ name: 'scrypt', N: 2 ** 16, r: 8, p: 1 });

const WRAP_CONTEXT = 'vault:wrap:v1';
const BOX_CONTEXT = 'vault:box:v1';

async function deriveWrapKey(password, kdf, onProgress) {
    if (kdf.name !== 'scrypt') throw new VaultError('unsupported', `Unknown key derivation: ${kdf.name}`);
    const bits = await scrypt(utf8.encode(password.normalize('NFKC')), b64u.decode(kdf.salt), {
        N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32, onProgress,
    });
    return importAesKey(bits);
}

/** What an unlocked vault offers: item encryption and the stored secrets. */
function makeSession(masterKey, secrets, file) {
    return {
        masterKey,
        secrets,
        /** Identifies the vault file this session belongs to. */
        vaultId: file.wrap.ct.slice(0, 16),
        sealText: (id, text) => seal(masterKey, utf8.encode(text), `item:${id}`).then(s => ({ v: 1, ...s })),
        openText: (id, sealed) => open(masterKey, sealed, `item:${id}`).then(utf8.decode),
        sealJson: (id, value) => seal(masterKey, utf8.encode(JSON.stringify(value)), `item:${id}`).then(s => ({ v: 1, ...s })),
        openJson: (id, sealed) => open(masterKey, sealed, `item:${id}`).then(b => JSON.parse(utf8.decode(b))),
    };
}

/**
 * @param {{ password: string, secrets: object, kdf?: object, onProgress?: (f: number) => void }} options
 * @returns {Promise<{ file: object, session: ReturnType<typeof makeSession> }>}
 */
export async function createVault({ password, secrets, kdf = DEFAULT_KDF, onProgress }) {
    if (!password || password.length < 8) throw new VaultError('corrupt', 'The password is too short');
    const params = { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p, salt: b64u.encode(randomBytes(16)) };
    const wrapKey = await deriveWrapKey(password, params, onProgress);
    const masterBytes = randomBytes(32);
    const masterKey = await importAesKey(masterBytes);
    const file = {
        v: 1,
        kdf: params,
        wrap: await seal(wrapKey, masterBytes, WRAP_CONTEXT),
        box: await seal(masterKey, utf8.encode(JSON.stringify(secrets)), BOX_CONTEXT),
    };
    masterBytes.fill(0);
    return { file, session: makeSession(masterKey, secrets, file) };
}

/** @throws {VaultError} 'wrong-password' */
export async function unlockVault(file, password, { onProgress } = {}) {
    if (file?.v !== 1) throw new VaultError('unsupported', 'Unsupported vault version');
    const wrapKey = await deriveWrapKey(password.normalize('NFKC'), file.kdf, onProgress);
    const masterBytes = await open(wrapKey, file.wrap, WRAP_CONTEXT);
    const masterKey = await importAesKey(masterBytes);
    masterBytes.fill(0);
    const secrets = JSON.parse(utf8.decode(await open(masterKey, file.box, BOX_CONTEXT)));
    return makeSession(masterKey, secrets, file);
}

/** Opens the vault with a master key kept on this device, without the password. */
export async function unlockWithKey(file, masterKey) {
    const secrets = JSON.parse(utf8.decode(await open(masterKey, file.box, BOX_CONTEXT)));
    return makeSession(masterKey, secrets, file);
}

/** New vault file for the same master key under a new password. Content stays valid. */
export async function changePassword(file, oldPassword, newPassword, { kdf = DEFAULT_KDF, onProgress } = {}) {
    const oldKey = await deriveWrapKey(oldPassword, file.kdf, onProgress);
    const masterBytes = await open(oldKey, file.wrap, WRAP_CONTEXT);
    const params = { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p, salt: b64u.encode(randomBytes(16)) };
    const newKey = await deriveWrapKey(newPassword, params, onProgress);
    const next = { ...file, kdf: params, wrap: await seal(newKey, masterBytes, WRAP_CONTEXT) };
    masterBytes.fill(0);
    return next;
}

/** Replaces the secrets box (for example a rotated GitHub token). */
export async function updateSecrets(file, session, secrets) {
    return { ...file, box: await seal(session.masterKey, utf8.encode(JSON.stringify(secrets)), BOX_CONTEXT) };
}
