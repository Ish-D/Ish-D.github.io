import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlock, roofInk, roofPaper, BODY, ROOMS, ARRANGEMENTS } from '../../core/figures/october.js';
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

/** How far each crow reaches over two minutes, in the drawing's px, with the crows at `places`; null for one that is away. */
function reaches(places) {
    const poses = WINGBEAT.map(p => box(pairs(p.shape)));
    const flock = createFlock();
    flock.arrange(places);
    const out = flock.crows.map(() => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
    run(flock, 120, () => flock.crows.forEach((c, i) => {
        const at = flock.place(c);
        const b = poses[flock.pose(c)];
        const r = out[i];
        r.x0 = Math.min(r.x0, at.x + b.x0 * c.size); r.x1 = Math.max(r.x1, at.x + b.x1 * c.size);
        r.y0 = Math.min(r.y0, at.y + b.y0 * c.size); r.y1 = Math.max(r.y1, at.y + b.y1 * c.size);
    }));
    return out.map((r, i) => (places[i] ? r : null));
}

/** A room's steps as boxes in the drawing's px, each from the left edge. */
function stepsOf(room) {
    let from = VIEW.y;
    return room.map(([x, y]) => {
        const step = { x0: -Infinity, x1: VIEW.x + x * VIEW.width, y0: from, y1: VIEW.y + y * VIEW.height };
        from = step.y1;
        return step;
    });
}
const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

ROOMS.forEach((room, i) => {
    const steps = stepsOf(room);
    const name = room.map(([x, y]) => `${x.toFixed(2)} wide to ${y.toFixed(2)}`).join(', then ');
    test(`the corner it can leave for a cover's type, ${name}, stays empty: no crow reaches into it, and the roofs and the moon are clear of it`, () => {
        for (const r of reaches(ARRANGEMENTS[i])) if (r) assert.ok(!steps.some(s => meets(r, s)), 'a crow flies into the corner');
        for (const [x, y] of [...pairs(ROOFS), ...ROOF_INK.flatMap(l => l.pts)]) {
            assert.ok(!steps.some(s => x < s.x1 && y >= s.y0 && y < s.y1), `the roofs reach into the corner at ${x}, ${y}`);
        }
        for (const d of [MOON, ...PERCHED.map(p => p.shape)]) assert.ok(!steps.some(s => meets(box(pairs(d)), s)));
    });

    test(`with the type in the corner ${name}, every crow keeps clear of the others, the moon and the crow on it, inside the drawing`, () => {
        const things = [box(pairs(MOON)), box(PERCHED.flatMap(p => pairs(p.shape))), ...reaches(ARRANGEMENTS[i])];
        const apart = (a, b) => a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0;
        for (let a = 2; a < things.length; a++) {
            const t = things[a];
            if (!t) continue;
            assert.ok(t.x0 >= VIEW.x && t.x1 <= VIEW.x + VIEW.width && t.y0 >= VIEW.y, `crow ${a - 2} leaves the drawing`);
            for (let b = 0; b < a; b++) if (things[b]) assert.ok(apart(t, things[b]), `crow ${a - 2} touches ${b < 2 ? ['the moon', 'the crow on it'][b] : `crow ${b - 2}`}`);
        }
    });
});

test('a cover can stand the type in any of its corners, the drawing as drawn first, and one more crow flies in the phone\'s narrower corner only', () => {
    assert.deepEqual(figureCover('october'), { rooms: ROOMS, aspect: VIEW.width / VIEW.height });
    assert.equal(ARRANGEMENTS.length, ROOMS.length);
    assert.deepEqual(ARRANGEMENTS[0].slice(0, FLIERS.length), FLIERS);
    assert.deepEqual(ARRANGEMENTS.map(a => a.length), ROOMS.map(() => FLIERS.length + 1));
    assert.deepEqual(ARRANGEMENTS.map(a => !!a[FLIERS.length]), [false, true, false]);
    for (const room of ROOMS.slice(1)) assert.ok(room.at(-1)[0] >= 0.5 && room.at(-1)[1] > 0.55, 'a phone\'s corner is wide and tall enough for its type');
});
