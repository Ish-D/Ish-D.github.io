/**
 * Margin note placement.
 *
 * Each side of the page is a vertical strip. Notes keep their anchor order and
 * must not overlap; the arrangement minimizing the squared distance between
 * each note and its anchor is found exactly (isotonic regression after
 * removing the stacking offsets). Around that, the solver can
 *   - pick a smaller or wider variant of a note when crowding costs more than shrinking,
 *   - choose a side for notes that allow either,
 *   - route notes around obstacles (full-bleed objects, pinned figures),
 *   - hand back notes that cannot fit so the caller can set them inline.
 */

/**
 * @typedef {Object} Variant
 * @property {number} height
 * @property {number} [cost]     penalty for choosing this variant (e.g. smaller type, wider box)
 * @property {any} [tag]         opaque; returned untouched in the placement
 */

/**
 * @typedef {Object} MarginItem
 * @property {string | number} id
 * @property {number} anchorY    where the note wants its top edge
 * @property {'left' | 'right' | 'either'} side
 * @property {Variant[]} variants   first entry is the preferred one
 */

/**
 * @typedef {Object} Placement
 * @property {string | number} id
 * @property {'left' | 'right'} side
 * @property {number} y
 * @property {number} variant     index into the item's variants
 * @property {any} tag
 * @property {number} displacement   y - anchorY
 * @property {boolean} breakIn       true when the note did not fit within maxDisplacement or any free space
 */

/**
 * @param {MarginItem[]} items
 * @param {Object} options
 * @param {number} options.lo                 top of the usable strip
 * @param {number} options.hi                 bottom of the usable strip
 * @param {number} [options.gap]              minimum space between notes
 * @param {{ left?: Array<[number, number]>, right?: Array<[number, number]> }} [options.obstacles]
 * @param {number} [options.maxDisplacement]  farther than this and the note breaks in
 * @param {number} [options.rounds]           variant-improvement sweeps
 * @returns {{ placements: Placement[], cost: number }}
 */
export function solveMargins(items, options) {
    const gap = options.gap ?? 8;
    const obstacles = { left: [], right: [], ...options.obstacles };
    const maxDisplacement = options.maxDisplacement ?? Infinity;
    const rounds = options.rounds ?? 3;

    const order = items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => a.item.anchorY - b.item.anchorY || a.index - b.index);

    const sideOf = new Map();
    assignSides(order.map(o => o.item), sideOf, gap);

    const choice = new Map(items.map(it => [it.id, 0]));
    const strips = { left: [], right: [] };
    for (const { item } of order) strips[sideOf.get(item.id)].push(item);

    const result = new Map();
    let total = 0;
    for (const side of ['left', 'right']) {
        const strip = strips[side];
        if (strip.length === 0) continue;
        const solved = solveStrip(strip, choice, { lo: options.lo, hi: options.hi, gap, obstacles: obstacles[side], rounds });
        total += solved.cost;
        for (const p of solved.placements) result.set(p.id, { ...p, side });
    }

    const placements = items.map(item => {
        const p = result.get(item.id);
        const v = item.variants[p.variant];
        const displacement = p.y - item.anchorY;
        return {
            id: item.id,
            side: p.side,
            y: p.y,
            variant: p.variant,
            tag: v.tag,
            displacement,
            breakIn: p.breakIn || Math.abs(displacement) > maxDisplacement,
        };
    });
    return { placements, cost: total };
}

/** Greedy side choice for notes that allow either: take the side where the note would move least. */
function assignSides(sortedItems, sideOf, gap) {
    const bottom = { left: -Infinity, right: -Infinity };
    for (const item of sortedItems) {
        const h = item.variants[0].height;
        let side = item.side;
        if (side === 'either') {
            const costLeft = Math.max(item.anchorY, bottom.left) - item.anchorY;
            const costRight = Math.max(item.anchorY, bottom.right) - item.anchorY;
            side = costRight <= costLeft ? 'right' : 'left';
        }
        sideOf.set(item.id, side);
        bottom[side] = Math.max(item.anchorY, bottom[side]) + h + gap;
    }
}

function solveStrip(strip, choice, { lo, hi, gap, obstacles, rounds }) {
    const segments = freeSegments(lo, hi, obstacles);
    const evaluate = () => arrange(strip, choice, segments, gap);

    let best = evaluate();
    for (let round = 0; round < rounds; round++) {
        let improved = false;
        for (const item of strip) {
            if (item.variants.length < 2) continue;
            const current = choice.get(item.id);
            let bestVariant = current;
            let bestCost = best.cost;
            for (let v = 0; v < item.variants.length; v++) {
                if (v === current) continue;
                choice.set(item.id, v);
                const trial = evaluate();
                if (trial.cost < bestCost - 1e-9) { bestCost = trial.cost; bestVariant = v; }
            }
            choice.set(item.id, bestVariant);
            if (bestVariant !== current) { best = evaluate(); improved = true; }
        }
        if (!improved) break;
    }
    return best;
}

/** Positions for the strip with the current variant choices; notes that cannot fit are marked breakIn. */
function arrange(strip, choice, segments, gap) {
    let active = strip.slice();
    for (;;) {
        const entries = active.map(item => {
            const v = item.variants[choice.get(item.id)];
            return { item, anchor: item.anchorY, height: v.height, penalty: v.cost ?? 0 };
        });
        const solved = packIntoSegments(entries, segments, gap);
        if (solved) {
            const placements = [];
            let cost = solved.cost;
            for (const item of strip) {
                const k = active.indexOf(item);
                const v = choice.get(item.id);
                if (k === -1) {
                    placements.push({ id: item.id, y: item.anchorY, variant: v, breakIn: true });
                    cost += 1e6;
                } else {
                    placements.push({ id: item.id, y: solved.ys[k], variant: v, breakIn: false });
                }
            }
            return { placements, cost };
        }
        const worst = entries.reduce((a, b) => (b.height > a.height ? b : a));
        active = active.filter(it => it !== worst.item);
        if (active.length === 0) {
            return {
                placements: strip.map(item => ({ id: item.id, y: item.anchorY, variant: choice.get(item.id), breakIn: true })),
                cost: 1e6 * strip.length,
            };
        }
    }
}

function freeSegments(lo, hi, obstacles) {
    const merged = [...obstacles].sort((a, b) => a[0] - b[0]);
    const out = [];
    let cursor = lo;
    for (const [a, b] of merged) {
        if (b <= cursor) continue;
        if (a >= hi) break;
        if (a > cursor) out.push([cursor, a]);
        cursor = Math.max(cursor, b);
    }
    if (cursor < hi) out.push([cursor, hi]);
    return out;
}

/**
 * Splits the ordered entries across free segments (contiguous groups per
 * segment) minimizing total squared displacement plus variant penalties.
 */
function packIntoSegments(entries, segments, gap) {
    const n = entries.length;
    if (n === 0) return { ys: [], cost: 0 };
    if (segments.length === 0) return null;

    const groupMemo = new Map();
    const group = (i, j, s) => {
        const key = `${i}:${j}:${s}`;
        if (!groupMemo.has(key)) groupMemo.set(key, stack(entries.slice(i, j), segments[s][0], segments[s][1], gap));
        return groupMemo.get(key);
    };

    const m = segments.length;
    const INF = Infinity;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(INF));
    const from = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(-1));
    dp[0][0] = 0;
    for (let s = 1; s <= m; s++) {
        for (let i = 0; i <= n; i++) {
            if (dp[s - 1][i] < dp[s][i]) { dp[s][i] = dp[s - 1][i]; from[s][i] = i; }
            for (let j = 0; j < i; j++) {
                if (dp[s - 1][j] === INF) continue;
                const g = group(j, i, s - 1);
                if (!g) continue;
                const c = dp[s - 1][j] + g.cost;
                if (c < dp[s][i]) { dp[s][i] = c; from[s][i] = j; }
            }
        }
    }
    if (dp[m][n] === INF) return null;

    const ys = new Array(n);
    let i = n;
    for (let s = m; s >= 1 && i > 0; s--) {
        const j = from[s][i];
        if (j !== i) {
            const g = group(j, i, s - 1);
            for (let k = j; k < i; k++) ys[k] = g.ys[k - j];
            i = j;
        }
    }
    return { ys, cost: dp[m][n] };
}

/**
 * Optimal stacking of ordered entries inside [lo, hi]: minimizes the sum of
 * squared distances to the anchors with at least `gap` between neighbours.
 * Returns null when the notes cannot fit.
 */
function stack(entries, lo, hi, gap) {
    const n = entries.length;
    const offsets = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
        offsets[i] = acc;
        acc += entries[i].height + gap;
    }
    const used = acc - gap;
    if (used > hi - lo + 1e-9) return null;

    const targets = entries.map((e, i) => e.anchor - offsets[i]);
    const blocks = [];
    for (let i = 0; i < n; i++) {
        blocks.push({ sum: targets[i], count: 1 });
        while (blocks.length > 1) {
            const b = blocks[blocks.length - 1];
            const a = blocks[blocks.length - 2];
            if (a.sum / a.count <= b.sum / b.count) break;
            blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
        }
    }
    const zMin = lo;
    const zMax = hi - used;
    const ys = [];
    let k = 0;
    for (const b of blocks) {
        const z = Math.min(Math.max(b.sum / b.count, zMin), zMax);
        for (let c = 0; c < b.count; c++, k++) ys.push(z + offsets[k]);
    }
    let cost = 0;
    for (let i = 0; i < n; i++) cost += (ys[i] - entries[i].anchor) ** 2 + entries[i].penalty;
    return { ys, cost };
}
