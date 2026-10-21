import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeScores, softmax, entropy } from '../../core/figures/softmax-scale.js';
import { scale, seeded } from '../../core/runtime/svg.js';
import { pixelsPerStep } from '../../core/runtime/scrub.js';

test('softmax sums to one and is order preserving', () => {
    const p = softmax([1, 2, 3, 1000]);
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.ok(p[3] > 0.999);
    const q = softmax([0, 0, 0, 0]);
    assert.ok(q.every(v => Math.abs(v - 0.25) < 1e-12));
    assert.ok(Math.abs(entropy(q) - 2) < 1e-12);
});

test('without scaling the softmax collapses as d_k grows; scaling prevents it', () => {
    const tokens = 8;
    const stats = (dk, scaled) => {
        let maxSum = 0;
        const seeds = 40;
        for (let s = 1; s <= seeds; s++) {
            const raw = makeScores(dk, tokens, s);
            const p = softmax(scaled ? raw.map(v => v / Math.sqrt(dk)) : raw);
            maxSum += Math.max(...p);
        }
        return maxSum / seeds;
    };
    assert.ok(stats(512, false) > 0.85, 'raw scores saturate at large d_k');
    assert.ok(stats(512, true) < 0.55, 'scaled scores stay spread out');
    assert.ok(stats(4, false) < stats(512, false));
    assert.ok(Math.abs(stats(4, true) - stats(512, true)) < 0.15, 'scaled behaviour barely depends on d_k');
});

test('changing d_k adds components to a fixed pool, so figures move smoothly', () => {
    const a = makeScores(64, 6, 3);
    const b = makeScores(65, 6, 3);
    assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 6), 'one extra term changes a score by a few units at most');
    assert.deepEqual(makeScores(64, 6, 3), a, 'deterministic');
});

test('scale maps a domain to a range and back', () => {
    const f = scale([0, 10], [100, 200]);
    assert.equal(f(5), 150);
    assert.equal(f.invert(150), 5);
    assert.equal(scale([3, 3], [0, 1])(3), 0);
});

test('seeded generators repeat and look normal', () => {
    const a = seeded(5);
    const b = seeded(5);
    assert.equal(a(), b());
    const n = seeded(11);
    let sum = 0;
    let sq = 0;
    const count = 20000;
    for (let i = 0; i < count; i++) { const v = n.normal(); sum += v; sq += v * v; }
    assert.ok(Math.abs(sum / count) < 0.05);
    assert.ok(Math.abs(sq / count - 1) < 0.05);
});

test('pixelsPerStep keeps a full sweep to a few hundred pixels', () => {
    assert.ok(pixelsPerStep({ min: 0, max: 100, step: 1 }) * 100 <= 400);
    assert.equal(pixelsPerStep({ min: 0, max: 4, step: 1 }), 10);
    assert.equal(pixelsPerStep({ min: 0, max: 10000, step: 1 }), 2);
});
