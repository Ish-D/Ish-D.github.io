/**
 * Shapes that text must avoid, reduced to what line layout needs: for a
 * horizontal band [y0, y1], the x-interval the shape blocks.
 *
 * Concave shapes block their hull within each band. `pad` grows a shape on
 * every side (ellipses grow their radii; the rest use a square dilation).
 */

/** @typedef {[number, number]} Interval */

/** Slack for comparing computed widths, which carry float error. */
const EPSILON = 1e-6;

/**
 * @typedef {Object} Shape
 * @property {string} type
 * @property {{ x0: number, y0: number, x1: number, y1: number }} bounds   includes padding
 * @property {(y0: number, y1: number) => Interval | null} blocked
 */

export function mergeIntervals(list) {
    const sorted = list.filter(Boolean).map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
        .sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const iv of sorted) {
        const last = out[out.length - 1];
        if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
        else out.push([iv[0], iv[1]]);
    }
    return out;
}

/** Parts of [lo, hi] not covered by `blocked`, dropping parts narrower than `minWidth`. */
export function freeIntervals(lo, hi, blocked, minWidth = 0) {
    const free = [];
    let cursor = lo;
    for (const [a, b] of mergeIntervals(blocked)) {
        if (b <= cursor) continue;
        if (a >= hi) break;
        if (a > cursor) free.push([cursor, Math.min(a, hi)]);
        cursor = Math.max(cursor, b);
        if (cursor >= hi) break;
    }
    if (cursor < hi) free.push([cursor, hi]);
    return free.filter(([a, b]) => b - a >= minWidth - EPSILON && b - a > EPSILON);
}

export function rect(x, y, w, h, pad = 0) {
    const bounds = { x0: x - pad, y0: y - pad, x1: x + w + pad, y1: y + h + pad };
    return {
        type: 'rect',
        bounds,
        blocked: (y0, y1) => (y1 <= bounds.y0 || y0 >= bounds.y1 ? null : [bounds.x0, bounds.x1]),
    };
}

export function ellipse(cx, cy, rx, ry, pad = 0) {
    const ax = rx + pad;
    const ay = ry + pad;
    const bounds = { x0: cx - ax, y0: cy - ay, x1: cx + ax, y1: cy + ay };
    return {
        type: 'ellipse',
        bounds,
        blocked(y0, y1) {
            if (y1 <= bounds.y0 || y0 >= bounds.y1) return null;
            const dy = cy >= y0 && cy <= y1 ? 0 : Math.min(Math.abs(y0 - cy), Math.abs(y1 - cy));
            if (dy >= ay) return null;
            const half = ax * Math.sqrt(1 - (dy / ay) ** 2);
            return [cx - half, cx + half];
        },
    };
}

export const circle = (cx, cy, r, pad = 0) => ellipse(cx, cy, r, r, pad);

/** @param {Array<[number, number]>} points */
export function polygon(points, pad = 0) {
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const bounds = {
        x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad,
        x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad,
    };
    return {
        type: 'polygon',
        bounds,
        blocked(y0, y1) {
            if (y1 <= bounds.y0 || y0 >= bounds.y1) return null;
            const clipped = clipToBand(points, y0 - pad, y1 + pad);
            if (clipped.length === 0) return null;
            let lo = Infinity;
            let hi = -Infinity;
            for (const [x] of clipped) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
            return [lo - pad, hi + pad];
        },
    };
}

/**
 * Shape from a coverage mask: `rows[i]` is the covered [x0, x1] (relative to `x`) of the
 * row starting at y + i * rowHeight, or null when the row is empty.
 */
export function mask(x, y, rows, rowHeight, pad = 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) if (r) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); }
    const bounds = { x0: x + lo - pad, y0: y - pad, x1: x + hi + pad, y1: y + rows.length * rowHeight + pad };
    return {
        type: 'mask',
        bounds,
        blocked(y0, y1) {
            if (rows.length === 0 || y1 <= bounds.y0 || y0 >= bounds.y1) return null;
            const first = Math.max(0, Math.floor((y0 - pad - y) / rowHeight));
            const last = Math.min(rows.length - 1, Math.ceil((y1 + pad - y) / rowHeight) - 1);
            let a = Infinity;
            let b = -Infinity;
            for (let i = first; i <= last; i++) {
                const r = rows[i];
                if (!r) continue;
                a = Math.min(a, r[0]);
                b = Math.max(b, r[1]);
            }
            return a === Infinity ? null : [x + a - pad, x + b + pad];
        },
    };
}

/** Sutherland-Hodgman clip of a polygon to the strip y0 <= y <= y1. */
function clipToBand(points, y0, y1) {
    const clip = (poly, inside, cross) => {
        const out = [];
        for (let i = 0; i < poly.length; i++) {
            const cur = poly[i];
            const prev = poly[(i + poly.length - 1) % poly.length];
            const curIn = inside(cur);
            const prevIn = inside(prev);
            if (curIn !== prevIn) out.push(cross(prev, cur));
            if (curIn) out.push(cur);
        }
        return out;
    };
    const at = (y) => (p, q) => {
        const t = (y - p[1]) / (q[1] - p[1]);
        return [p[0] + t * (q[0] - p[0]), y];
    };
    let poly = clip(points, p => p[1] >= y0, at(y0));
    poly = clip(poly, p => p[1] <= y1, at(y1));
    return poly;
}

/**
 * Blocked intervals of all shapes over the band, clipped to [lo, hi].
 * @param {Shape[]} shapes
 */
export function blockedOver(shapes, y0, y1, lo, hi) {
    const out = [];
    for (const s of shapes) {
        const iv = s.blocked(y0, y1);
        if (iv && iv[1] > lo && iv[0] < hi) out.push([Math.max(iv[0], lo), Math.min(iv[1], hi)]);
    }
    return out;
}
