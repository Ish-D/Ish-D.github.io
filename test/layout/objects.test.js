import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlace, parseWrap, resolveSize, placeRect, wrapShape } from '../../core/layout/objects.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const twoColumns = [
    { x: 0, width: 280, top: 0, bottom: Infinity },
    { x: 320, width: 280, top: 0, bottom: Infinity },
];
const geom = (over = {}) => ({
    columns: twoColumns, columnIndex: 0, cursorY: 100,
    container: { x: 0, width: 600 }, page: { x: -100, width: 800 }, em: 20, ...over,
});

test('parsePlace understands every keyword, margins and at()', () => {
    assert.equal(parsePlace('gutter').kind, 'gutter');
    assert.equal(parsePlace(' Full ').kind, 'full');
    assert.deepEqual(parsePlace('margin-right'), { kind: 'margin', side: 'right' });
    assert.deepEqual(parsePlace('margin-top'), { kind: 'margin', side: 'top' });
    assert.equal(parsePlace('margin').side, 'right');
    const at = parsePlace('at(10%, 2em)');
    assert.equal(at.kind, 'at');
    assert.equal(at.at.length, 2);
    assert.equal(parsePlace('nonsense', 'inline').kind, 'inline');
    assert.equal(parsePlace(undefined).kind, 'block');
});

test('parseWrap understands keywords and shape calls', () => {
    assert.equal(parseWrap('ellipse').kind, 'ellipse');
    assert.equal(parseWrap('circle(40%)').args.length, 1);
    assert.equal(parseWrap('polygon(0 0, 100% 0, 50% 100%)').args.length, 3);
    assert.equal(parseWrap('weird', 'box').kind, 'box');
    assert.equal(parseWrap(undefined).kind, 'none');
});

test('resolveSize: explicit, preset, aspect and natural sizing', () => {
    const ctx = { basis: 600, em: 20 };
    assert.deepEqual(resolveSize({ width: '50%', height: '120' }, ctx), { width: 300, height: 120 });
    assert.deepEqual(resolveSize({ size: 'small' }, ctx, { width: 100, height: 50 }), { width: 198, height: 99 });
    assert.deepEqual(resolveSize({ width: '300', aspect: '2' }, ctx), { width: 300, height: 150 });
    assert.deepEqual(resolveSize({ height: '100' }, ctx, { width: 400, height: 200 }), { width: 200, height: 100 });
    assert.deepEqual(resolveSize({}, ctx, { width: 400, height: 200 }), { width: 400, height: 200 });
    assert.deepEqual(resolveSize({ width: '900' }, ctx, { width: 400, height: 200 }), { width: 600, height: 300 });
    assert.deepEqual(resolveSize({}, ctx, { width: 800, height: 400 }, { defaultWidth: 0.5 }), { width: 300, height: 150 });
});

test('placeRect: left, right and center inside a column', () => {
    const size = { width: 100, height: 60 };
    assert.deepEqual(placeRect({ kind: 'left' }, size, geom()), { x: 0, y: 100, width: 100, height: 60 });
    assert.deepEqual(placeRect({ kind: 'right' }, size, geom()), { x: 180, y: 100, width: 100, height: 60 });
    assert.deepEqual(placeRect({ kind: 'center' }, size, geom()), { x: 90, y: 100, width: 100, height: 60 });
    assert.deepEqual(placeRect({ kind: 'right' }, size, geom({ columnIndex: 1 })), { x: 500, y: 100, width: 100, height: 60 });
});

test('placeRect: gutter straddles the seam between columns', () => {
    const r = placeRect({ kind: 'gutter' }, { width: 120, height: 120 }, geom());
    assert.ok(near(r.x + r.width / 2, 300));
    const last = placeRect({ kind: 'gutter' }, { width: 120, height: 120 }, geom({ columnIndex: 1 }));
    assert.ok(near(last.x + last.width / 2, 300), 'last column uses the seam to its left');
    const single = placeRect({ kind: 'gutter' }, { width: 100, height: 10 }, geom({ columns: [twoColumns[0]] }));
    assert.ok(near(single.x, 90));
});

test('placeRect: span and full take the container and page widths', () => {
    const span = placeRect({ kind: 'span' }, { width: 10, height: 50 }, geom());
    assert.deepEqual([span.x, span.width], [0, 600]);
    const full = placeRect({ kind: 'full' }, { width: 10, height: 50 }, geom());
    assert.deepEqual([full.x, full.width], [-100, 800]);
});

test('placeRect: at() offsets from the column corner and the cursor; nudges add up', () => {
    const place = parsePlace('at(10%, 2em)');
    const r = placeRect(place, { width: 50, height: 50 }, geom(), { dx: 4, dy: -6 });
    assert.ok(near(r.x, 28 + 4));
    assert.ok(near(r.y, 100 + 40 - 6));
});

test('wrapShape: none, box with padding, and inscribed circle/ellipse', () => {
    const rect = { x: 100, y: 50, width: 120, height: 80 };
    assert.equal(wrapShape(parseWrap('none'), rect, 0), null);

    const box = wrapShape(parseWrap('box'), rect, 10);
    assert.deepEqual(box.blocked(60, 70), [90, 230]);

    const circle = wrapShape(parseWrap('circle'), rect, 0);
    const mid = circle.blocked(89, 91);
    assert.ok(near(mid[0], 160 - 40) && near(mid[1], 160 + 40));

    const ellipse = wrapShape(parseWrap('ellipse'), rect, 0);
    const em = ellipse.blocked(89, 91);
    assert.ok(near(em[0], 100) && near(em[1], 220));
});

test('wrapShape: polygon points are relative to the rect', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    const shape = wrapShape(parseWrap('polygon(0 0, 100% 0, 50% 100%)'), rect, 0);
    const top = shape.blocked(0, 5);
    assert.ok(near(top[0], 0) && near(top[1], 100));
    const low = shape.blocked(95, 100);
    assert.ok(low[1] - low[0] < 12);
});

test('wrapShape: contour uses the supplied mask, else falls back to an ellipse', () => {
    const rect = { x: 10, y: 0, width: 100, height: 40 };
    const mask = { rows: [[0, 20], [10, 80], null, [30, 60]], rowHeight: 10 };
    const shape = wrapShape(parseWrap('contour'), rect, 0, { mask });
    assert.deepEqual(shape.blocked(0, 5), [10, 30]);
    assert.equal(shape.blocked(20, 25), null);
    const fallback = wrapShape(parseWrap('contour'), rect, 0);
    assert.equal(fallback.type, 'ellipse');
});
