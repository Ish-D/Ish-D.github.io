import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlotCursor, slotStream } from '../../core/layout/slots.js';
import { circle, rect } from '../../core/layout/geometry.js';

const drain = (cursor, max = 100) => {
    const out = [];
    for (let i = 0; i < max; i++) {
        const s = cursor.next();
        if (!s) break;
        out.push(s);
    }
    return out;
};

test('open column yields one full-width slot per band', () => {
    const cursor = createSlotCursor({
        columns: [{ x: 10, width: 300, top: 0, bottom: Infinity }],
        lineHeight: 20,
    });
    const slots = [cursor.next(), cursor.next(), cursor.next()];
    assert.deepEqual(slots.map(s => s.y), [0, 20, 40]);
    assert.ok(slots.every(s => s.x === 10 && s.width === 300 && s.column === 0));
});

test('a bounded column ends and reading continues in the next column', () => {
    const cursor = createSlotCursor({
        columns: [
            { x: 0, width: 100, top: 0, bottom: 60 },
            { x: 120, width: 100, top: 0, bottom: 60 },
        ],
        lineHeight: 20,
    });
    const slots = drain(cursor);
    assert.equal(slots.length, 6);
    assert.deepEqual(slots.map(s => s.column), [0, 0, 0, 1, 1, 1]);
    assert.deepEqual(slots.map(s => s.y), [0, 20, 40, 0, 20, 40]);
});

test('a circle in the middle splits bands into left and right slots', () => {
    const cursor = createSlotCursor({
        columns: [{ x: 0, width: 300, top: 0, bottom: Infinity }],
        lineHeight: 20,
        shapes: [circle(150, 60, 40)],
    });
    const slots = drain(cursor, 12);
    const middle = slots.filter(s => s.y >= 40 && s.y < 80);
    assert.ok(middle.length >= 4);
    for (const s of middle) assert.ok(s.x + s.width <= 150 || s.x >= 150);
    const rowAt = (y) => slots.filter(s => s.y === y);
    assert.equal(rowAt(0).length, 1);
    assert.equal(rowAt(60).length, 2);
    assert.equal(rowAt(60)[0].x, 0);
    assert.ok(rowAt(60)[0].width < 150);
});

test('slivers narrower than minSlot are skipped', () => {
    const cursor = createSlotCursor({
        columns: [{ x: 0, width: 200, top: 0, bottom: Infinity }],
        lineHeight: 20,
        shapes: [rect(30, 0, 160, 100)],
        minSlot: 50,
    });
    const slots = drain(cursor, 4);
    assert.ok(slots.every(s => s.y >= 100), 'bands beside the rect have only a 30px and 10px sliver');
});

test('shapes added after the cursor is created affect later bands', () => {
    const shapes = [];
    const cursor = createSlotCursor({
        columns: [{ x: 0, width: 200, top: 0, bottom: Infinity }],
        lineHeight: 20,
        shapes,
    });
    assert.equal(cursor.next().width, 200);
    shapes.push(rect(0, 20, 80, 40));
    const s = cursor.next();
    assert.equal(s.x, 80);
    assert.equal(s.width, 120);
});

test('seek snaps to the grid and save/restore round-trips', () => {
    const cursor = createSlotCursor({
        columns: [{ x: 0, width: 100, top: 10, bottom: Infinity }],
        lineHeight: 14,
        grid: 7,
    });
    cursor.seek(0, 32);
    assert.equal(cursor.next().y, 38);
    const saved = cursor.save();
    const a = cursor.next();
    cursor.restore(saved);
    assert.deepEqual(cursor.next(), a);
});

test('slotStream materializes lazily and repeats the last width past the end', () => {
    const cursor = createSlotCursor({
        columns: [{ x: 0, width: 100, top: 0, bottom: 40 }],
        lineHeight: 20,
    });
    const stream = slotStream(cursor);
    assert.equal(stream.slots.length, 0);
    assert.equal(stream.width(1), 100);
    assert.equal(stream.slots.length, 2);
    assert.equal(stream.get(5), null);
    assert.equal(stream.width(5), 100);
    assert.equal(stream.exhausted, true);
});
