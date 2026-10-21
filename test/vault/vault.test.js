import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlockVault, unlockWithKey, changePassword, updateSecrets, VaultError } from '../../core/vault/vault.js';
import { b64u, randomId, seal, open, importAesKey, randomBytes } from '../../core/vault/crypto.js';

const FAST = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1 };
const secrets = { token: 'github_pat_SECRET_TOKEN_12345', owner: 'Ish-D', repo: 'Ish-D.github.io' };

test('base64url round trips arbitrary bytes, including empty and large', () => {
    for (const len of [0, 1, 2, 3, 100, 100000]) {
        const bytes = randomBytes(len);
        assert.deepEqual(b64u.decode(b64u.encode(bytes)), bytes);
    }
    assert.ok(!/[+/=]/.test(b64u.encode(new Uint8Array([251, 255, 254, 253]))));
    assert.equal(randomId().length, 16);
});

test('seal and open round trip; a different key, context, or edited byte fails', async () => {
    const key = await importAesKey(randomBytes(32));
    const other = await importAesKey(randomBytes(32));
    const sealed = await seal(key, new TextEncoder().encode('hello'), 'ctx');
    assert.equal(new TextDecoder().decode(await open(key, sealed, 'ctx')), 'hello');
    await assert.rejects(open(other, sealed, 'ctx'), VaultError);
    await assert.rejects(open(key, sealed, 'other ctx'), VaultError);
    const ct = b64u.decode(sealed.ct);
    ct[0] ^= 1;
    await assert.rejects(open(key, { ...sealed, ct: b64u.encode(ct) }, 'ctx'), VaultError);
    const again = await seal(key, new TextEncoder().encode('hello'), 'ctx');
    assert.notEqual(again.iv, sealed.iv, 'fresh IV every time');
});

test('a vault unlocks with its password and not with another', async () => {
    const { file, session } = await createVault({ password: 'correct horse battery', secrets, kdf: FAST });
    const again = await unlockVault(file, 'correct horse battery');
    assert.deepEqual(again.secrets, secrets);
    assert.equal(again.vaultId, session.vaultId);
    await assert.rejects(unlockVault(file, 'incorrect horse battery'), (e) => e instanceof VaultError && e.code === 'wrong-password');
});

test('the vault file reveals no secret', async () => {
    const { file } = await createVault({ password: 'a very long passphrase here', secrets, kdf: FAST });
    const text = JSON.stringify(file);
    assert.ok(!text.includes('SECRET_TOKEN'));
    assert.ok(!text.includes('Ish-D'));
    assert.deepEqual(Object.keys(file).sort(), ['box', 'kdf', 'v', 'wrap']);
});

test('items encrypt per id: tampering or moving a ciphertext fails', async () => {
    const { session } = await createVault({ password: 'pass phrase number one', secrets, kdf: FAST });
    const sealed = await session.sealText('page-a', '# Private\n\nthoughts');
    assert.equal(await session.openText('page-a', sealed), '# Private\n\nthoughts');
    await assert.rejects(session.openText('page-b', sealed), VaultError);
    const index = await session.sealJson('index', { items: [1, 2, 3] });
    assert.deepEqual(await session.openJson('index', index), { items: [1, 2, 3] });
    assert.ok(!JSON.stringify(sealed).includes('Private'));
});

test('changing the password keeps old content readable and retires the old password', async () => {
    const { file, session } = await createVault({ password: 'first passphrase 111', secrets, kdf: FAST });
    const sealed = await session.sealText('x', 'keep me');
    const next = await changePassword(file, 'first passphrase 111', 'second passphrase 222', { kdf: FAST });
    const reopened = await unlockVault(next, 'second passphrase 222');
    assert.equal(await reopened.openText('x', sealed), 'keep me');
    await assert.rejects(unlockVault(next, 'first passphrase 111'), VaultError);
    assert.notEqual(next.kdf.salt, file.kdf.salt);
});

test('a device-held master key opens the vault without the password; secrets can be rotated', async () => {
    const { file, session } = await createVault({ password: 'remember this device ok', secrets, kdf: FAST });
    const viaKey = await unlockWithKey(file, session.masterKey);
    assert.deepEqual(viaKey.secrets, secrets);
    const rotated = await updateSecrets(file, session, { ...secrets, token: 'github_pat_NEW' });
    const again = await unlockVault(rotated, 'remember this device ok', {});
    assert.equal(again.secrets.token, 'github_pat_NEW');
});

test('short passwords and unknown versions are refused', async () => {
    await assert.rejects(createVault({ password: 'short', secrets, kdf: FAST }), VaultError);
    await assert.rejects(unlockVault({ v: 2 }, 'whatever password'), (e) => e.code === 'unsupported');
});
