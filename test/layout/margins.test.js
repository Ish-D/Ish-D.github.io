import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveMargins } from '../../core/layout/margins.js';

const note = (id, anchorY, height, side = 'right', extra = {}) => ({
    id, anchorY, side, variants: [{ height }], ...extra,
});
const byId = (res) => Object.fromEntries(res.placements.map(p => [p.id, p]));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('notes with room stay exactly at their anchors', () => {
    const res = solveMargins([note('a', 100, 40), note('b', 300, 40)], { lo: 0, hi: 1000, gap: 10 });
    const p = byId(res);
    assert.equal(p.a.y, 100);
    assert.equal(p.b.y, 300);
    assert.equal(res.cost, 0);
});

test('two colliding notes split the displacement evenly', () => {
    const p = byId(solveMargins([note('a', 100, 50), note('b', 110, 50)], { lo: 0, hi: 1000, gap: 10 }));
    assert.ok(near(p.a.y, 75));
    assert.ok(near(p.b.y, 135));
    assert.ok(near(p.a.displacement, -25) && near(p.b.displacement, 25));
});

test('a pile-up spreads around its centre of mass', () => {
    const items = [note('a', 100, 30), note('b', 100, 30), note('c', 100, 30)];
    const p = byId(solveMargins(items, { lo: 0, hi: 1000, gap: 10 }));
    assert.ok(near(p.b.y, 100), 'the middle note stays put');
    assert.ok(near(p.b.y - p.a.y, 40) && near(p.c.y - p.b.y, 40));
});

test('the strip bounds push notes inward', () => {
    const p = byId(solveMargins([note('a', 5, 40), note('b', 990, 40)], { lo: 20, hi: 1000, gap: 10 }));
    assert.equal(p.a.y, 20);
    assert.equal(p.b.y, 960);
});

test('notes keep their anchor order', () => {
    const items = [note('late', 400, 60), note('early', 380, 60), note('mid', 390, 60)];
    const p = byId(solveMargins(items, { lo: 0, hi: 2000, gap: 10 }));
    assert.ok(p.early.y < p.mid.y && p.mid.y < p.late.y);
});

test('obstacles are routed around, never overlapped', () => {
    const items = [note('a', 180, 40), note('b', 200, 40)];
    const res = solveMargins(items, {
        lo: 0, hi: 1000, gap: 10, obstacles: { right: [[150, 260]] },
    });
    const p = byId(res);
    for (const id of ['a', 'b']) {
        const top = p[id].y;
        const bottom = top + 40;
        assert.ok(bottom <= 150 + 1e-9 || top >= 260 - 1e-9, `${id} at ${top}`);
    }
    assert.ok(p.b.y >= p.a.y + 50 - 1e-9 || p.b.y >= 260);
});

test('sides are independent', () => {
    const items = [note('r', 100, 50, 'right'), note('l', 100, 50, 'left')];
    const p = byId(solveMargins(items, { lo: 0, hi: 1000, gap: 10 }));
    assert.equal(p.r.y, 100);
    assert.equal(p.l.y, 100);
    assert.equal(p.r.side, 'right');
    assert.equal(p.l.side, 'left');
});

test("'either' notes use the less crowded side", () => {
    const items = [
        note('a', 100, 80, 'right'),
        note('b', 110, 80, 'either'),
    ];
    const p = byId(solveMargins(items, { lo: 0, hi: 1000, gap: 10 }));
    assert.equal(p.b.side, 'left');
    assert.equal(p.b.displacement, 0);
});

test('a smaller variant is chosen when crowding costs more than shrinking', () => {
    const big = { height: 100, cost: 0, tag: 'big' };
    const small = { height: 40, cost: 50, tag: 'small' };
    const items = [
        note('a', 100, 100, 'right', { variants: [big, small] }),
        note('b', 130, 100, 'right', { variants: [big, small] }),
    ];
    const res = solveMargins(items, { lo: 0, hi: 1000, gap: 10 });
    const p = byId(res);
    assert.ok(p.a.variant === 1 || p.b.variant === 1);
    const fixed = solveMargins(
        items.map(i => ({ ...i, variants: [big] })), { lo: 0, hi: 1000, gap: 10 },
    );
    assert.ok(res.cost < fixed.cost);
});

test('shrinking is not chosen when there is room', () => {
    const items = [note('a', 100, 100, 'right', { variants: [{ height: 100 }, { height: 40, cost: 50 }] })];
    assert.equal(byId(solveMargins(items, { lo: 0, hi: 1000, gap: 10 })).a.variant, 0);
});

test('notes that cannot fit are returned as breakIn', () => {
    const items = [note('a', 10, 300), note('b', 20, 300), note('c', 30, 300)];
    const res = solveMargins(items, { lo: 0, hi: 500, gap: 10 });
    const p = byId(res);
    const inline = res.placements.filter(x => x.breakIn);
    assert.ok(inline.length >= 1);
    const placed = res.placements.filter(x => !x.breakIn).sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) assert.ok(placed[i].y >= placed[i - 1].y + 300 + 10 - 1e-9);
    assert.ok(placed.every(x => x.y >= 0 && x.y + 300 <= 500 + 1e-9), JSON.stringify(p));
});

test('maxDisplacement flags notes pushed too far', () => {
    const items = Array.from({ length: 6 }, (_, i) => note(i, 100, 60));
    const res = solveMargins(items, { lo: 0, hi: 5000, gap: 10, maxDisplacement: 100 });
    assert.ok(res.placements.some(p => p.breakIn));
    assert.ok(res.placements.some(p => !p.breakIn));
});

test('random inputs always produce non-overlapping, in-bounds, ordered notes', () => {
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let trial = 0; trial < 200; trial++) {
        const n = 1 + Math.floor(rand() * 10);
        const items = [];
        for (let i = 0; i < n; i++) {
            const h = 20 + Math.floor(rand() * 80);
            items.push({
                id: i,
                anchorY: Math.floor(rand() * 800),
                side: ['left', 'right', 'either'][Math.floor(rand() * 3)],
                variants: [{ height: h }, { height: h * 0.7, cost: 100 + rand() * 500 }],
            });
        }
        const obstacles = rand() < 0.4 ? { right: [[300, 380]], left: [[100, 160]] } : {};
        const lo = 0;
        const hi = 1400;
        const res = solveMargins(items, { lo, hi, gap: 8, obstacles });
        for (const side of ['left', 'right']) {
            const placed = res.placements
                .filter(p => p.side === side && !p.breakIn)
                .map(p => ({ ...p, h: items[p.id].variants[p.variant].height }))
                .sort((a, b) => a.y - b.y);
            for (let i = 0; i < placed.length; i++) {
                assert.ok(placed[i].y >= lo - 1e-6 && placed[i].y + placed[i].h <= hi + 1e-6, `bounds, trial ${trial}`);
                if (i > 0) assert.ok(placed[i].y >= placed[i - 1].y + placed[i - 1].h + 8 - 1e-6, `overlap, trial ${trial}`);
                for (const [a, b] of obstacles[side] ?? []) {
                    assert.ok(placed[i].y + placed[i].h <= a + 1e-6 || placed[i].y >= b - 1e-6, `obstacle, trial ${trial}`);
                }
            }
            const anchors = placed.map(p => items[p.id].anchorY);
            for (let i = 1; i < placed.length; i++) {
                if (anchors[i] > anchors[i - 1]) assert.ok(placed[i].y >= placed[i - 1].y, `order, trial ${trial}`);
            }
        }
    }
});

test('stacking matches a brute-force optimum on small cases', () => {
    for (const [a1, a2, a3, h] of [[100, 105, 108, 30], [50, 52, 400, 40], [10, 10, 10, 25]]) {
        const items = [note(1, a1, h), note(2, a2, h), note(3, a3, h)];
        const res = solveMargins(items, { lo: 0, hi: 2000, gap: 5 });
        let best = Infinity;
        for (let y1 = -200; y1 <= 600; y1 += 1) {
            for (let y2 = y1 + h + 5; y2 <= 700; y2 += 1) {
                const y3 = Math.max(y2 + h + 5, Math.round(a3));
                if (y1 < 0) continue;
                const c = (y1 - a1) ** 2 + (y2 - a2) ** 2 + (y3 - a3) ** 2;
                if (c < best) best = c;
            }
        }
        assert.ok(res.cost <= best + 1e-6, `solver ${res.cost} vs grid ${best}`);
        assert.ok(res.cost >= best - 2 * (h + 5) * 3, `solver ${res.cost} is far below the grid optimum ${best}`);
    }
});
