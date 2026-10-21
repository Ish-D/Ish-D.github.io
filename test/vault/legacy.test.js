import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardCrypto } from '../../Crypto.js';
import { decryptLegacyCard, isLegacyEncrypted } from '../../core/vault/legacy.js';

async function card(plain, password) {
    const enc = await new CardCrypto().encrypt(plain, password);
    return `---\nwidth: 900\nencrypted: true\nsalt: ${enc.salt}\niv: ${enc.iv}\n---\n${enc.ciphertext}\n`;
}

test('cards made by the old site decrypt', async () => {
    const source = await card('---\nname: Journal\n---\n\nDear diary ✓\n', 'old password');
    assert.equal(isLegacyEncrypted(source), true);
    assert.equal(await decryptLegacyCard(source, 'old password'), '---\nname: Journal\n---\n\nDear diary ✓\n');
});

test('a wrong password is reported as such', async () => {
    const source = await card('secret', 'right');
    await assert.rejects(() => decryptLegacyCard(source, 'wrong'), (e) => e.code === 'wrong-password');
});

test('plain cards are not treated as encrypted', async () => {
    assert.equal(isLegacyEncrypted('---\nname: X\n---\nbody'), false);
    await assert.rejects(() => decryptLegacyCard('---\nname: X\n---\nbody', 'p'));
});
