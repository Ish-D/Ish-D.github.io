import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contours, rowsOfLines, toPath } from '../../core/layout/contour.js';

const row = (x0, x1, y0, h = 10) => ({ x0, x1, y0, y1: y0 + h });

test('lines of one length make a rectangle', () => {
    const [poly] = contours([row(0, 100, 0), row(0, 100, 10), row(0, 100, 20)]);
    assert.deepEqual(poly, [[0, 0], [0, 30], [100, 30], [100, 0]]);
});

test('a short last line leaves a step in the outline', () => {
    const [poly] = contours([row(0, 100, 0), row(0, 100, 10), row(0, 40, 20)]);
    assert.deepEqual(poly, [[0, 0], [0, 30], [40, 30], [40, 20], [100, 20], [100, 0]]);
});

test('lines pushed in by a figure follow it', () => {
    const polys = contours([row(60, 100, 0), row(60, 100, 10), row(0, 100, 20)]);
    assert.deepEqual(polys, [[[60, 0], [60, 20], [0, 20], [0, 30], [100, 30], [100, 0]]]);
});

test('edges that nearly agree count as one', () => {
    const [poly] = contours([row(0, 100, 0), row(0.5, 100.4, 10)]);
    assert.deepEqual(poly, [[0, 0], [0, 20], [100, 20], [100, 0]]);
});

test('text that moves to another column is a second outline', () => {
    const polys = contours([row(0, 100, 0), row(0, 100, 10), row(150, 250, 0), row(150, 250, 10)]);
    assert.equal(polys.length, 2);
    assert.deepEqual(polys[1], [[150, 0], [150, 20], [250, 20], [250, 0]]);
});

test('padding grows the outline on every side', () => {
    const [poly] = contours([row(10, 90, 10), row(10, 90, 20)], { pad: 4 });
    assert.deepEqual(poly, [[6, 6], [6, 34], [94, 34], [94, 6]]);
});

test('empty and zero-width rows are ignored', () => {
    assert.deepEqual(contours([row(5, 5, 0), { x0: 0, x1: 10, y0: 4, y1: 4 }]), []);
});

test('path data and rows from lines', () => {
    assert.equal(toPath([[[0, 0], [0, 10], [20, 10], [20, 0]]], 5, 5), 'M-5 -5L-5 5L15 5L15 -5Z');
    const rows = rowsOfLines([{ x: 3, y: 4, width: 20 }, { x: 0, y: 0, width: 5, overflow: true }], 12);
    assert.deepEqual(rows, [{ x0: 3, x1: 23, y0: 4, y1: 16 }]);
});
