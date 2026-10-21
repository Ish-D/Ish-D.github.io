import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOpenType } from '../../core/text/otf.js';
import { createOtfMeasurer } from '../../core/text/otf-measurer.js';

const modernBytes = readFileSync(new URL('../../fonts/MonotypeModern.otf', import.meta.url));
const imprintBytes = readFileSync(new URL('../../fonts/imprint-mt-shadow.ttf', import.meta.url));
const modern = parseOpenType(modernBytes);
const imprint = parseOpenType(imprintBytes);

// [text, glyph ids, x advances] from
// hb-shape --font-size=1000 --no-glyph-names --output-format=json fonts/MonotypeModern.otf TEXT (HarfBuzz 14.3.1)
const MODERN = [
    ['To AV fi Wa', [53, 80, 1, 34, 55, 1, 71, 74, 1, 56, 66], [587, 510, 110, 629, 729, 210, 363, 281, 150, 870, 510]],
    ['Typography', [53, 90, 81, 80, 72, 83, 66, 81, 73, 90], [657, 563, 563, 510, 510, 416, 510, 543, 513, 563]],
    ['AVATAR WAVY YAWN', [34, 55, 34, 53, 34, 51, 1, 56, 34, 55, 58, 1, 58, 34, 56, 47], [629, 609, 699, 647, 729, 792, 150, 890, 629, 729, 792, 60, 672, 629, 1010, 792]],
    ['The quick brown fox jumps over the lazy dog.', [53, 73, 70, 1, 82, 86, 74, 68, 76, 1, 67, 83, 80, 88, 79, 1, 71, 80, 89, 1, 75, 86, 78, 81, 84, 1, 80, 87, 70, 83, 1, 85, 73, 70, 1, 77, 66, 91, 90, 1, 69, 80, 72, 15], [667, 563, 448, 210, 563, 563, 281, 428, 563, 210, 563, 416, 480, 729, 563, 210, 333, 460, 563, 210, 333, 563, 844, 563, 396, 210, 470, 513, 448, 396, 210, 396, 563, 448, 210, 281, 510, 448, 563, 210, 563, 510, 460, 311]],
    ['Hyphenation, typesetting & layout.', [41, 90, 81, 73, 70, 79, 66, 85, 74, 80, 79, 13, 1, 85, 90, 81, 70, 84, 70, 85, 85, 74, 79, 72, 1, 7, 1, 77, 66, 90, 80, 86, 85, 15], [844, 563, 543, 563, 448, 563, 480, 396, 281, 510, 563, 161, 210, 396, 563, 563, 468, 396, 448, 396, 396, 281, 563, 510, 210, 729, 210, 281, 460, 543, 510, 563, 396, 311]],
    ['LT LV LW LY Ly', [45, 53, 1, 45, 55, 1, 45, 56, 1, 45, 58, 1, 45, 90], [627, 677, 210, 597, 729, 210, 607, 1010, 210, 577, 792, 210, 637, 563]],
    ['P. F. Vo Yo Wo Ta Te', [49, 15, 1, 39, 15, 1, 55, 80, 1, 58, 80, 1, 56, 80, 1, 53, 66, 1, 53, 70], [437, 191, 210, 477, 191, 130, 609, 510, 60, 632, 510, 150, 890, 510, 90, 587, 510, 90, 587, 448]],
    ['“Quoted,” she said.', [105, 50, 86, 80, 85, 70, 69, 13, 119, 1, 84, 73, 70, 1, 84, 66, 74, 69, 15], [510, 729, 563, 510, 396, 448, 563, 101, 310, 210, 396, 563, 448, 210, 396, 510, 281, 563, 311]],
    ['It’s a dog’s life, isn’t it?', [42, 85, 8, 84, 1, 66, 1, 69, 80, 72, 8, 84, 1, 77, 74, 71, 70, 13, 1, 74, 84, 79, 8, 85, 1, 74, 85, 32], [448, 396, 151, 396, 210, 510, 210, 563, 510, 510, 151, 396, 210, 281, 281, 333, 398, 161, 210, 281, 396, 563, 211, 396, 210, 281, 396, 448]],
    ['Kerning: Ky Ko Ku Ke', [44, 70, 83, 79, 74, 79, 72, 27, 1, 44, 90, 1, 44, 80, 1, 44, 86, 1, 44, 70], [784, 448, 396, 603, 281, 563, 510, 161, 210, 704, 563, 210, 784, 510, 210, 764, 563, 210, 784, 448]],
    ['1990–2024 — 3.14159', [18, 26, 26, 17, 111, 19, 17, 19, 21, 1, 137, 1, 20, 15, 18, 21, 18, 22, 26], [510, 510, 510, 510, 500, 510, 510, 510, 510, 210, 1000, 210, 510, 311, 510, 510, 510, 510, 510]],
    ['résumé café naïve', [83, 207, 84, 86, 78, 207, 1, 68, 66, 71, 207, 1, 79, 66, 213, 87, 70], [396, 448, 396, 563, 844, 448, 210, 448, 510, 333, 448, 210, 563, 510, 281, 513, 448]],
    ['Mr. Smith—T. S. Eliot', [46, 83, 15, 1, 52, 78, 74, 85, 73, 137, 53, 15, 1, 52, 15, 1, 38, 77, 74, 80, 85], [844, 296, 191, 210, 563, 844, 281, 396, 563, 1000, 537, 191, 210, 513, 191, 210, 729, 281, 281, 510, 396]],
    ['office affluent flyer', [80, 71, 71, 74, 68, 70, 1, 66, 71, 71, 77, 86, 70, 79, 85, 1, 71, 77, 90, 70, 83], [510, 333, 363, 281, 448, 448, 210, 510, 333, 373, 281, 563, 448, 563, 396, 210, 373, 251, 543, 448, 396]],
    ['Æsop’s fables: Œuvre', [138, 84, 80, 81, 8, 84, 1, 71, 66, 67, 77, 70, 84, 27, 1, 142, 86, 87, 83, 70], [1010, 396, 510, 563, 151, 396, 210, 333, 490, 533, 281, 468, 396, 161, 210, 1010, 563, 563, 396, 448]],
    ['Yellow Yarn, yearly yawns.', [58, 70, 77, 77, 80, 88, 1, 58, 66, 83, 79, 13, 1, 90, 70, 66, 83, 77, 90, 1, 90, 66, 88, 79, 84, 15], [632, 448, 281, 281, 480, 729, 60, 632, 510, 396, 563, 161, 210, 543, 448, 510, 416, 251, 563, 210, 533, 460, 729, 563, 366, 311]],
    ['D.C., U.S.A.', [37, 15, 36, 15, 13, 1, 54, 15, 52, 15, 34, 15], [672, 311, 555, 311, 161, 210, 642, 311, 513, 311, 729, 311]],
    ['Mr.\u00a0Ward', [46, 83, 15, 1, 56, 66, 83, 69], [844, 296, 191, 150, 870, 510, 396, 563]],
    ['hy\u00adphen\u00adation', [73, 90, 1, 81, 73, 70, 79, 1, 66, 85, 74, 80, 79], [513, 563, 0, 543, 563, 448, 563, 0, 480, 396, 281, 510, 563]],
    ['A\u2009V\u2003W', [34, 1, 55, 1, 56], [729, 120, 729, 940, 1010]],
    ['Yo\u0301 Vo\u0301', [58, 216, 1, 55, 216], [792, 510, 130, 729, 510]],
    ['x\u0301 \u4e2d', [89, 0, 1, 0], [563, 0, 210, 220]],
    ['WAVE’S “TEXT”', [56, 34, 55, 38, 8, 52, 1, 105, 53, 38, 57, 53, 119], [890, 629, 729, 729, 281, 563, -40, 510, 677, 729, 844, 677, 510]],
];

// Same, with --font-size=2048 (unitsPerEm) on fonts/imprint-mt-shadow.ttf.
const IMPRINT = [
    ['Imprint Shadow', [44, 80, 83, 85, 76, 81, 87, 3, 54, 75, 68, 71, 82, 90], [831, 1792, 1130, 768, 555, 1174, 662, 512, 1237, 1174, 918, 1130, 1024, 1556]],
    ['AVOID Typography', [36, 57, 50, 44, 39, 3, 55, 92, 83, 82, 74, 85, 68, 83, 75, 92], [1493, 1516, 1665, 831, 1749, 512, 1493, 1024, 1130, 1024, 1044, 768, 918, 1130, 1174, 1024]],
    ['Wa To', [58, 68, 3, 55, 82], [2134, 918, 512, 1493, 1024]],
];

const sum = values => values.reduce((a, b) => a + b, 0);
const glyph = (font, char) => font.glyphId(char.codePointAt(0));

test('reads head, hhea, OS/2 metrics', () => {
    const { unitsPerEm, ascender, descender, xHeight, capHeight } = modern;
    assert.deepEqual({ unitsPerEm, ascender, descender, xHeight, capHeight }, { unitsPerEm: 1000, ascender: 946, descender: -250, xHeight: 419, capHeight: 676 });
});

test('derives x-height and cap height from glyf when OS/2 lacks them', () => {
    // OS/2 v1: top of 'x', and yMin + yMax of 'O' (HarfBuzz reports the same 874 / 1411).
    const { unitsPerEm, ascender, descender, xHeight, capHeight } = imprint;
    assert.deepEqual({ unitsPerEm, ascender, descender, xHeight, capHeight }, { unitsPerEm: 2048, ascender: 1903, descender: -510, xHeight: 874, capHeight: 1411 });
});

test('maps code points through cmap and reads advances from hmtx', () => {
    assert.equal(glyph(modern, 'T'), 53);
    assert.equal(glyph(modern, 'ﬁ'), 109);
    assert.equal(modern.advance(53), 677);
    assert.equal(modern.advance(glyph(modern, ' ')), 210);
    assert.equal(glyph(modern, '中'), 0);
    assert.equal(modern.glyphId(0x1f600), 0);
    assert.equal(modern.advance(99999), 0);
    assert.equal(glyph(imprint, 'A'), 36);
    assert.equal(imprint.advance(36), 1493);
});

test('kern() returns GPOS pair adjustments', () => {
    const kern = (a, b) => modern.kern(glyph(modern, a), glyph(modern, b));
    assert.equal(kern('T', 'o'), -90);
    assert.equal(kern('A', 'V'), -100);
    assert.equal(kern(' ', 'A'), -100);
    assert.equal(kern('f', 'i'), 30);
    assert.equal(kern('A', 'A'), 0);
    assert.equal(imprint.kern(glyph(imprint, 'T'), glyph(imprint, 'o')), 0);
});

test('shape() matches HarfBuzz glyph by glyph', () => {
    for (const [font, fixtures] of [[modern, MODERN], [imprint, IMPRINT]]) {
        for (const [text, glyphs, advances] of fixtures) {
            const shaped = font.shape(text);
            assert.deepEqual(shaped.glyphs, glyphs, text);
            shaped.advances.forEach((advance, k) => assert.ok(Math.abs(advance - advances[k]) <= 0.5, `${text} glyph ${k}`));
        }
    }
});

test('measurer widths match HarfBuzz within 0.5/1000 em per string', () => {
    const measurer = createOtfMeasurer({ MonotypeModern: modern, ImprintMTShadow: imprint });
    for (const [text, , advances] of MODERN) {
        const width = measurer.width(text, { family: 'MonotypeModern', size: 1000 });
        assert.ok(Math.abs(width - sum(advances)) <= 0.5, `${text}: ${width} vs ${sum(advances)}`);
    }
    for (const [text, , advances] of IMPRINT) {
        const width = measurer.width(text, { family: 'ImprintMTShadow', size: 1000 });
        assert.ok(Math.abs(width - (sum(advances) * 1000) / 2048) <= 0.5, text);
    }
    assert.equal(measurer.width('To', { family: 'MonotypeModern', size: 16 }), ((587 + 510) * 16) / 1000);
    assert.equal(measurer.width('', { family: 'MonotypeModern', size: 16 }), 0);
});

test('measurer ignores weight and style, and accepts a Map', () => {
    const measurer = createOtfMeasurer(new Map([['MonotypeModern', modern]]));
    const regular = measurer.width('Typography', { family: 'MonotypeModern', size: 20 });
    assert.equal(measurer.width('Typography', { family: 'MonotypeModern', size: 20, weight: 700, style: 'italic' }), regular);
    assert.throws(() => measurer.width('x', { family: 'Georgia', size: 20 }), /No OpenType font registered for family "Georgia"/);
});

test('measurer metrics are in px with a positive descent', () => {
    const measurer = createOtfMeasurer({ MonotypeModern: modern, ImprintMTShadow: imprint });
    const metrics = measurer.metrics({ family: 'MonotypeModern', size: 20 });
    const expected = { ascent: 18.92, descent: 5, xHeight: 8.38, capHeight: 13.52, spaceWidth: 4.2 };
    assert.deepEqual(Object.keys(metrics).sort(), Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(metrics[key] - value) < 1e-9, key);
    // At size == unitsPerEm, px equal font units.
    assert.deepEqual(measurer.metrics({ family: 'ImprintMTShadow', size: 2048 }), {
        ascent: 1903, descent: 510, xHeight: 874, capHeight: 1411, spaceWidth: 512,
    });
});

test('accepts ArrayBuffer, Uint8Array views at an offset, and DataView', () => {
    const padded = new Uint8Array(modernBytes.length + 7);
    padded.set(modernBytes, 7);
    const copy = modernBytes.buffer.slice(modernBytes.byteOffset, modernBytes.byteOffset + modernBytes.byteLength);
    for (const data of [copy, padded.subarray(7), new DataView(padded.buffer, 7)]) {
        assert.deepEqual(parseOpenType(data).shape('To AV').advances, modern.shape('To AV').advances);
    }
});

test('rejects data that is not a supported font', () => {
    assert.throws(() => parseOpenType(new Uint8Array(64)), /Not an OpenType font/);
    assert.throws(() => parseOpenType(Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0])), /WOFF/);
    assert.throws(() => parseOpenType(Uint8Array.from([0x74, 0x74, 0x63, 0x66, 0, 0, 0, 0])), /collections/);
    assert.throws(() => parseOpenType(modernBytes.subarray(0, 2000)), /runs past the end/);
});
