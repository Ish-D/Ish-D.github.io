import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sniffImageSize } from '../../core/render/browser.js';

test('PNG size comes from the header chunk', () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../images/higuchi.png', import.meta.url))).slice(0, 64);
    const size = sniffImageSize(bytes);
    assert.ok(size && size.width > 0 && size.height > 0);
});

test('JPEG size comes from the first frame header', () => {
    const jpeg = new Uint8Array([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    assert.deepEqual(sniffImageSize(jpeg), { width: 600, height: 400 });
});

test('unknown or too-short data gives null', () => {
    assert.equal(sniffImageSize(new Uint8Array([1, 2, 3])), null);
    assert.equal(sniffImageSize(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0])), null);
});
