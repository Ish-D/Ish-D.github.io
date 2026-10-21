import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    mergeIntervals, freeIntervals, rect, ellipse, circle, polygon, mask, blockedOver,
} from '../../core/layout/geometry.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('mergeIntervals joins overlapping and touching intervals', () => {
    assert.deepEqual(mergeIntervals([[5, 8], [0, 2], [1, 3], [8, 9]]), [[0, 3], [5, 9]]);
    assert.deepEqual(mergeIntervals([null, [2, 1]]), [[1, 2]]);
});

test('freeIntervals returns the gaps and drops slivers', () => {
    assert.deepEqual(freeIntervals(0, 100, [[40, 60]]), [[0, 40], [60, 100]]);
    assert.deepEqual(freeIntervals(0, 100, [[40, 60]], 45), [[0, 40], [60, 100]].filter(([a, b]) => b - a >= 45));
    assert.deepEqual(freeIntervals(0, 100, [[-10, 30], [90, 120]]), [[30, 90]]);
    assert.deepEqual(freeIntervals(0, 100, [[0, 100]]), []);
    assert.deepEqual(freeIntervals(0, 100, []), [[0, 100]]);
});

test('freeIntervals keeps an interval whose width equals minWidth despite float error', () => {
    const x = 370.1;
    const width = 60.3;
    assert.deepEqual(freeIntervals(x, x + width, [], width).length, 1);
});

test('rect blocks its padded x-range only for overlapping bands', () => {
    const r = rect(10, 20, 30, 40, 2);
    assert.deepEqual(r.blocked(30, 50), [8, 42]);
    assert.equal(r.blocked(0, 18), null);
    assert.equal(r.blocked(62, 80), null);
    assert.deepEqual(r.blocked(61, 80), [8, 42]);
});

test('ellipse blocks the widest chord inside the band', () => {
    const c = circle(100, 100, 50);
    const mid = c.blocked(95, 105);
    assert.ok(near(mid[0], 50) && near(mid[1], 150));
    const top = c.blocked(40, 50);
    // widest chord in the band is at y = 50, dy = 50 => width 0
    assert.equal(top, null);
    const off = c.blocked(60, 70);
    const half = Math.sqrt(50 ** 2 - 30 ** 2);
    assert.ok(near(off[0], 100 - half) && near(off[1], 100 + half));
});

test('ellipse padding grows both radii', () => {
    const e = ellipse(0, 0, 40, 20, 10);
    const mid = e.blocked(-1, 1);
    assert.ok(near(mid[0], -50) && near(mid[1], 50));
    assert.equal(e.blocked(30, 40), null);
});

test('polygon blocks the hull within the band', () => {
    const tri = polygon([[0, 0], [100, 0], [50, 100]]);
    const top = tri.blocked(0, 10);
    assert.ok(near(top[0], 0) && near(top[1], 100));
    const bottomBand = tri.blocked(90, 100);
    assert.ok(near(bottomBand[0], 45) && near(bottomBand[1], 55));
    assert.equal(tri.blocked(101, 120), null);
});

test('polygon padding widens the interval and the vertical reach', () => {
    const sq = polygon([[0, 0], [10, 0], [10, 10], [0, 10]], 5);
    assert.deepEqual(sq.blocked(-4, -1), [-5, 15]);
    assert.equal(sq.blocked(-20, -6), null);
});

test('mask blocks the union of the rows it covers', () => {
    const rows = [[0, 10], null, [5, 30], [8, 12]];
    const m = mask(100, 0, rows, 10);
    assert.deepEqual(m.blocked(0, 5), [100, 110]);
    assert.equal(m.blocked(10, 20), null);
    assert.deepEqual(m.blocked(5, 25), [100, 130]);
    assert.deepEqual(m.blocked(30, 40), [108, 112]);
});

test('blockedOver clips to the column and ignores shapes outside it', () => {
    const shapes = [rect(-50, 0, 80, 50), rect(500, 0, 10, 50), circle(200, 25, 20)];
    const out = blockedOver(shapes, 10, 30, 0, 300);
    assert.deepEqual(out, [[0, 30], [180, 220]]);
});
