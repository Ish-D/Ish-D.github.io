import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokePath, widths, sampleCubics, through, shapePath, PEN } from '../../core/figures/pen.js';

const straight = { c: [0, 0, 3.3, 0, 6.7, 0, 10, 0], kind: 'contour', ends: 'ff' };

test('a curve through points passes through each of them', () => {
    const pts = [[0, 0], [10, 5], [20, -3], [30, 0]];
    const c = through(pts);
    assert.equal(c.length, 2 + 6 * (pts.length - 1));
    for (let i = 0; i < pts.length; i++) {
        assert.deepEqual([c[6 * i], c[6 * i + 1]], pts[i]);
    }
    const closed = through(pts, true);
    assert.equal(closed.length, 2 + 6 * pts.length, 'a closed curve comes back to its first point');
    assert.deepEqual(closed.slice(-2), pts[0]);
    assert.match(shapePath(closed), /^M0 0C.*Z$/);
});

test('a stroke goes down broad and lifts off to a point; a joined end keeps its width', () => {
    const pts = sampleCubics(straight.c, 0.1);
    const free = widths(pts, straight, 1);
    const mid = free[Math.floor(free.length / 2)];
    assert.ok(free[0] > mid * 0.85, 'its start stays broad');
    assert.ok(free[free.length - 1] < mid * 0.35, 'its end tapers');
    assert.ok(Math.abs(free[free.length - 1] - PEN.tip.end) < 0.1, 'to the pen\'s tip');
    const joined = widths(pts, { ...straight, ends: 'jj' }, 1);
    assert.ok(joined[0] > mid * 0.85 && joined[joined.length - 1] > mid * 0.7);
});

test('a detail line is lighter than a contour, and a stroke can carry its own widths', () => {
    const pts = sampleCubics(straight.c, 0.1);
    const contour = widths(pts, { ...straight, ends: 'jj' }, 1);
    const detail = widths(pts, { ...straight, kind: 'detail', ends: 'jj' }, 1);
    assert.ok(detail[10] < contour[10] && detail[10] > contour[10] * 0.7, 'a detail line is a little lighter, from the same pen');
    const own = widths(pts, { ...straight, wp: [1, 3, 1] }, 2);
    assert.ok(Math.abs(own[0] - 2) < 1e-9 && Math.abs(own[Math.floor(own.length / 2)] - 6) < 0.2);
});

test('a stroke becomes one closed outline with no gaps or bad numbers', () => {
    const d = strokePath(straight, 1);
    assert.match(d, /^M[-\d.]+ [-\d.]+(Q[-\d. ]+)+Z$/);
    assert.doesNotMatch(d, /NaN|Infinity/);
    const ring = strokePath({ c: through([[0, 0], [10, 0], [10, 10], [0, 10]], true), closed: true, kind: 'detail', ends: 'jj' }, 1);
    assert.equal((ring.match(/M/g) || []).length, 2, 'a closed stroke is a ring: an outer and an inner loop');
});
