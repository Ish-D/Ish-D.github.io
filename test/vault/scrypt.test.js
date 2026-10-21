import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { scrypt } from '../../core/vault/scrypt.js';

const enc = (s) => new TextEncoder().encode(s);
const hex = (u8) => Buffer.from(u8).toString('hex');

test('matches the RFC 7914 test vectors', async () => {
    // RFC 7914 section 12
    assert.equal(
        hex(await scrypt(enc(''), enc(''), { N: 16, r: 1, p: 1, dkLen: 64 })),
        '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    );
    assert.equal(
        hex(await scrypt(enc('password'), enc('NaCl'), { N: 1024, r: 8, p: 16, dkLen: 64 })),
        'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    );
});

test('agrees with the native implementation across parameters', async () => {
    for (const [pw, salt, N, r, p, dkLen] of [
        ['correct horse battery staple', 'salty salt', 2 ** 12, 8, 1, 32],
        ['pässwörd', 'ünicode', 2 ** 10, 4, 2, 48],
        ['x', 'y', 2 ** 14, 8, 1, 32],
    ]) {
        const ours = await scrypt(enc(pw), enc(salt), { N, r, p, dkLen });
        const theirs = scryptSync(pw, salt, dkLen, { N, r, p, maxmem: 256 * 1024 * 1024 });
        assert.equal(hex(ours), theirs.toString('hex'), `N=${N} r=${r} p=${p}`);
    }
});

test('a production-strength derivation finishes in reasonable time', async () => {
    const t0 = performance.now();
    const key = await scrypt(enc('a long passphrase for timing'), enc('0123456789abcdef'), { N: 2 ** 16, r: 8, p: 1, dkLen: 32 });
    const ms = performance.now() - t0;
    assert.equal(key.length, 32);
    assert.ok(ms < 8000, `took ${Math.round(ms)}ms`);
    console.log(`    scrypt N=2^16 r=8 p=1: ${Math.round(ms)} ms`);
});

test('rejects a non power-of-two N and reports progress', async () => {
    await assert.rejects(scrypt(enc('a'), enc('b'), { N: 1000, r: 8, p: 1, dkLen: 16 }), /power of two/);
    const seen = [];
    await scrypt(enc('a'), enc('b'), { N: 2 ** 10, r: 8, p: 1, dkLen: 16, onProgress: f => seen.push(f) });
    assert.ok(seen.length > 3 && seen.every((f, i) => i === 0 || f >= seen[i - 1]) && seen.at(-1) <= 1);
});
