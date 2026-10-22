import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasMeasurer, createFixedMeasurer, fontToCss } from '../../core/text/measure.js';

/** Fake 2D context: widths are 0.5em per code point; records every measureText call. */
function fakeContext({ fontBoundingBox = true } = {}) {
    const calls = [];
    const sizeOf = font => Number(/([\d.]+)px/.exec(font)?.[1]);
    const inkAscent = { x: 0.5, H: 0.75, ' ': 0 };
    return {
        calls,
        font: '10px sans-serif',
        textBaseline: 'top',
        fontKerning: 'auto',
        measureText(text) {
            calls.push([this.font, text]);
            const size = sizeOf(this.font);
            const metrics = {
                width: [...text].length * size * 0.5,
                actualBoundingBoxAscent: (inkAscent[text] ?? 0.9375) * size,
                actualBoundingBoxDescent: (text === 'x' || text === 'H' ? 0 : 0.3125) * size,
            };
            if (fontBoundingBox) Object.assign(metrics, { fontBoundingBoxAscent: 0.875 * size, fontBoundingBoxDescent: 0.25 * size });
            return metrics;
        },
    };
}

const body = { family: 'MonotypeModern', size: 16 };

test('fontToCss builds the CSS font shorthand', () => {
    assert.equal(fontToCss(body), '16px "MonotypeModern"');
    assert.equal(fontToCss({ family: 'Monotype Modern', size: 12.5, weight: 700, style: 'italic', smallCaps: true }), 'italic small-caps 700 12.5px "Monotype Modern"');
    assert.equal(fontToCss({ family: 'X', size: 10, weight: 'bold', style: 'oblique' }), 'oblique bold 10px "X"');
    assert.equal(fontToCss({ family: 'X', size: 10, weight: 400, style: 'normal', smallCaps: false }), '10px "X"');
    assert.equal(fontToCss({ family: 'X', size: 10, weight: 'normal' }), '10px "X"');
    assert.equal(fontToCss({ family: 'serif', size: 10 }), '10px serif');
    assert.equal(fontToCss({ family: 'A "B" \\ C', size: 10 }), '10px "A \\"B\\" \\\\ C"');
});

test('canvas measurer forces kerning, sets the font, and caches widths per (font, text)', () => {
    const context = fakeContext();
    const measurer = createCanvasMeasurer({ context });
    assert.equal(context.fontKerning, 'normal');
    assert.equal(context.textBaseline, 'alphabetic');

    assert.equal(measurer.width('hello', body), 40);
    assert.equal(measurer.width('hello', body), 40);
    assert.equal(measurer.width('hello', { ...body, size: 32 }), 80);
    assert.equal(measurer.width('hello', { ...body, weight: 700 }), 40);
    assert.deepEqual(context.calls, [
        ['16px "MonotypeModern"', 'hello'],
        ['32px "MonotypeModern"', 'hello'],
        ['700 16px "MonotypeModern"', 'hello'],
    ]);
});

test('canvas width cache keeps recent entries and evicts old ones at its cap', () => {
    const context = fakeContext();
    const measurer = createCanvasMeasurer({ context, cacheSize: 4 });
    for (const word of ['a', 'b', 'c', 'd', 'e', 'f']) measurer.width(word, body);
    const before = context.calls.length;
    measurer.width('f', body);
    assert.equal(context.calls.length, before);
    measurer.width('a', body);
    assert.equal(context.calls.length, before + 1);
    for (let i = 0; i < 1000; i++) measurer.width(`w${i}`, body);
    assert.equal(context.calls.length, before + 1001);
});

test('canvas metrics use fontBoundingBox and ink tops of x and H, cached per font', () => {
    const context = fakeContext();
    const measurer = createCanvasMeasurer({ context });
    const expected = { ascent: 17.5, descent: 5, xHeight: 10, capHeight: 15, spaceWidth: 10 };
    assert.deepEqual(measurer.metrics({ family: 'X', size: 20 }), expected);
    const calls = context.calls.length;
    assert.deepEqual(measurer.metrics({ family: 'X', size: 20 }), expected);
    assert.equal(context.calls.length, calls);
});

test('canvas metrics fall back to ink extents without fontBoundingBox', () => {
    const measurer = createCanvasMeasurer({ context: fakeContext({ fontBoundingBox: false }) });
    assert.deepEqual(measurer.metrics({ family: 'X', size: 20 }), { ascent: 18.75, descent: 6.25, xHeight: 10, capHeight: 15, spaceWidth: 10 });
});

test('canvas measurer needs a canvas outside browsers', () => {
    assert.throws(() => createCanvasMeasurer(), /needs OffscreenCanvas or a DOM document/);
});

test('fixed measurer counts code points', () => {
    const measurer = createFixedMeasurer({ charWidth: 5 });
    assert.equal(measurer.width('hello', body), 25);
    assert.equal(measurer.width('a\u{1F600}b', body), 15);
    assert.equal(measurer.width('', body), 0);
    assert.deepEqual(measurer.metrics({ family: 'X', size: 10 }), { ascent: 8, descent: 2, xHeight: 5, capHeight: 7, spaceWidth: 5 });
    assert.throws(() => createFixedMeasurer({ charWidth: 0 }), RangeError);
});

test('canvas measurer measures capitals as capitals and adds tracking after every character', () => {
    const context = fakeContext();
    const measurer = createCanvasMeasurer({ context });
    assert.equal(measurer.width('ab', { ...body, caps: true }), 16);
    assert.deepEqual(context.calls.at(-1), ['16px "MonotypeModern"', 'AB']);
    // 16px * 0.1em = 1.6px for each of the two characters
    assert.ok(Math.abs(measurer.width('ab', { ...body, tracking: 0.1 }) - (16 + 3.2)) < 1e-9);
    assert.ok(Math.abs(measurer.width('a b', { ...body, caps: true, tracking: 0.1 }) - (24 + 4.8)) < 1e-9);
});

test('fixed measurer adds tracking to every code point', () => {
    const measurer = createFixedMeasurer({ charWidth: 5 });
    assert.equal(measurer.width('abc', { family: 'X', size: 10 }), 15);
    assert.equal(measurer.width('abc', { family: 'X', size: 10, tracking: 0.1 }), 18);
});
