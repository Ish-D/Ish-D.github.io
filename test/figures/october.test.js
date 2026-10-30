import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlock, roofInk, roofPaper, BODY, ROOM } from '../../core/figures/october.js';
import { VIEW, ROOFS, ROOF_INK, ROOF_PAPER, LIT, MOON, PERCHED, WINGBEAT, FLIERS } from '../../core/figures/october-drawing.js';
import { figureSpot, figureCover } from '../../core/runtime/figures.js';

const pairs = (d) => {
    const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const out = [];
    for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
    return out;
};
const box = (pts) => pts.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

const run = (flock, seconds, each) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
        flock.advance(1 / 60);
        each?.();
    }
};

test('the drawing has its roofs, its moon, a crow on the moon in three poses and a wingbeat in six', () => {
    assert.ok(ROOFS.length > 1000 && MOON.length > 100);
    const lit = box(pairs(LIT));
    assert.ok(lit.y0 > box(pairs(MOON)).y1 && lit.y1 <= VIEW.y + VIEW.height, 'the street\'s lights are down in the street');
    assert.equal(PERCHED.length, 3);
    assert.equal(WINGBEAT.length, 6);
    assert.equal(FLIERS.length, 6);
    for (const f of FLIERS) {
        assert.ok(f.x > VIEW.x && f.x < VIEW.x + VIEW.width && f.y > VIEW.y && f.y < VIEW.y + VIEW.height, 'every flier is inside the view');
    }
});

test('the lines of the street are pen strokes inside the drawing, each running down or left to right', () => {
    assert.ok(roofInk().length >= 6 && roofPaper().length >= 6);
    for (const { pts } of [...ROOF_INK, ...ROOF_PAPER]) {
        for (const [x, y] of pts) assert.ok(x >= VIEW.x && x <= VIEW.x + VIEW.width && y >= VIEW.y && y <= VIEW.y + VIEW.height);
        const [dx, dy] = [pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]];
        assert.ok(Math.abs(dx) >= Math.abs(dy) ? dx >= 0 : dy >= 0);
    }
});

test('every flier beats through all six poses within a few seconds', () => {
    const flock = createFlock();
    const seen = flock.crows.map(() => new Set());
    run(flock, 4, () => flock.crows.forEach((c, i) => seen[i].add(flock.pose(c))));
    for (const s of seen) assert.equal(s.size, 6);
});

test('the fliers stay near their places, and each glides now and then', () => {
    const flock = createFlock();
    let farthest = 0;
    const glided = flock.crows.map(() => false);
    run(flock, 60, () => flock.crows.forEach((c, i) => {
        const { x, y } = flock.place(c);
        farthest = Math.max(farthest, Math.hypot(x - c.x, y - c.y) / (BODY * c.size));
        if (c.gliding > 0) glided[i] = true;
    }));
    assert.ok(farthest < 0.2, `a crow strays ${farthest.toFixed(2)} of its length`);
    assert.ok(glided.every(Boolean));
});

test('the crow on the moon mostly sits still, looks round, and caws', () => {
    const flock = createFlock();
    const time = [0, 0, 0];
    run(flock, 120, () => { time[flock.perched.pose] += 1 / 60; });
    assert.ok(time[0] > 0.6 * 120, 'mostly still');
    assert.ok(time[1] > 2, 'it looks round');
    assert.ok(time[2] > 0.4 && time[2] < 0.1 * 120, 'it caws, briefly');
});

test('the same flock moves the same way every time', () => {
    const a = createFlock();
    const b = createFlock();
    run(a, 7.3);
    run(b, 7.3);
    assert.deepEqual(a.crows.map(c => [a.pose(c), a.place(c)]), b.crows.map(c => [b.pose(c), b.place(c)]));
});

test('october carries a spot colour of its own', () => {
    assert.equal(figureSpot('october'), true);
});

test('the corner it leaves for a cover\'s type stays empty: no crow ever reaches into it, and the roofs are below it', () => {
    const right = VIEW.x + ROOM[0] * VIEW.width;
    const bottom = VIEW.y + ROOM[1] * VIEW.height;
    const poses = WINGBEAT.map(p => box(pairs(p.shape)));
    const flock = createFlock();
    run(flock, 120, () => flock.crows.forEach((c) => {
        const at = flock.place(c);
        const b = poses[flock.pose(c)];
        assert.ok(at.x + b.x0 * c.size >= right || at.y + b.y0 * c.size >= bottom, 'a crow flies into the corner');
    }));
    for (const [x, y] of [...pairs(ROOFS), ...ROOF_INK.flatMap(l => l.pts)]) assert.ok(x >= right || y >= bottom, `the roofs reach into the corner at ${x}, ${y}`);
    for (const d of [MOON, ...PERCHED.map(p => p.shape)]) assert.ok(box(pairs(d)).x0 >= right);
    assert.deepEqual(figureCover('october'), { room: ROOM, aspect: VIEW.width / VIEW.height });
});
