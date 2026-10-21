import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStrokes, serializeStrokes, strokePath, simplify, parseView } from '../../core/runtime/strokes.js';

test('strokes round trip through text', () => {
    const strokes = [{ width: 2.5, points: [[1, 2], [3.4, 5.6]] }, { width: 4, points: [[10, 10]] }];
    assert.deepEqual(parseStrokes(serializeStrokes(strokes)), strokes);
});

test('parsing skips malformed lines', () => {
    assert.deepEqual(parseStrokes('nope\n2 1,1 a,b 2,2\n\n3'), [{ width: 2, points: [[1, 1], [2, 2]] }]);
});

test('paths: dots, lines and smoothed curves', () => {
    assert.match(strokePath([[5, 5]]), /^M5 5h/);
    assert.equal(strokePath([[0, 0], [4, 4]]), 'M0 0L4 4');
    assert.equal(strokePath([[0, 0], [2, 4], [4, 0]]), 'M0 0Q2 4 3 2L4 0');
});

test('simplify keeps the corners of a polyline and drops collinear points', () => {
    const line = Array.from({ length: 20 }, (_, i) => [i, i]);
    assert.deepEqual(simplify(line, 0.5), [[0, 0], [19, 19]]);
    const corner = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
    assert.deepEqual(simplify(corner, 0.5), [[0, 0], [10, 0], [10, 10]]);
});

test('view sizes parse', () => {
    assert.deepEqual(parseView('600x340'), { width: 600, height: 340 });
    assert.equal(parseView('wide'), null);
});
