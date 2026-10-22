import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmoke, LIFE } from '../../core/figures/smoke.js';

/** The umbrella is a roof at y 200 from x 50 to 350, with its middle at 200; the pipe is at (120, 250). */
const roof = (x) => (x >= 50 && x <= 350 ? 200 : -Infinity);
const make = (over = {}) => createSmoke({ source: () => ({ x: 120, y: 250 }), ceiling: () => -Infinity, centre: 200, scale: 1, ...over });

test('smoke leaves the pipe and rises, and no point lives longer than its time', () => {
    const smoke = make();
    smoke.warm(1.5);
    assert.ok(smoke.points.length > 20);
    assert.ok(Math.min(...smoke.points.map(p => p.y)) < 225, 'it has risen');
    smoke.warm(LIFE * 2);
    assert.ok(smoke.points.every(p => p.age < LIFE));
    assert.ok(smoke.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('smoke that meets the umbrella stops under it and slides away from its middle', () => {
    const smoke = make({ ceiling: roof });
    smoke.warm(LIFE);
    const under = smoke.points.filter(p => p.under);
    assert.ok(under.length > 0, 'some smoke is against the roof');
    assert.ok(under.every(p => p.y === 200));
    assert.ok(Math.min(...under.map(p => p.x)) < 110, 'it slid to the left, away from the middle');
    assert.ok(smoke.points.every(p => p.y >= 200 || !roof(p.x) || p.x < 50), 'nothing passes through the roof');
});

test('smoke that slides out from under the umbrella rises again', () => {
    const smoke = make({ ceiling: roof, source: () => ({ x: 55, y: 250 }) });
    smoke.warm(LIFE * 1.5);
    assert.ok(smoke.points.some(p => p.x < 50 && p.y < 198), 'it rose past the rim, outside');
});

test('wind carries it sideways', () => {
    const calm = make();
    const gale = make();
    calm.warm(2, 0);
    gale.warm(2, 600);
    const mean = (smoke) => smoke.points.reduce((s, p) => s + p.x, 0) / smoke.points.length;
    assert.ok(mean(gale) > mean(calm) + 10);
});

test('the same seed gives the same smoke, and the list stays bounded', () => {
    const a = make();
    const b = make();
    a.warm(3);
    b.warm(3);
    assert.deepEqual(a.points.map(p => [p.x, p.y]), b.points.map(p => [p.x, p.y]));
    a.warm(60);
    assert.ok(a.points.length <= 160);
});
