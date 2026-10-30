/**
 * A pen for clear-line drawings. A stroke is a centre line made of cubic Béziers; the pen gives it a width along the way
 * and returns it as one filled outline, so a line has the shape of ink from a pen rather than the even width of an SVG stroke.
 *
 * Stroke data: `{ c: [x0, y0, c1x, c1y, c2x, c2y, x1, y1, c1x, ...], kind: 'contour' | 'detail', ends: 'ff' | 'fj' | 'jf' | 'jj', w?, wp? }`.
 * `ends` says whether the start and the end stop in the open ('f') or run into another line ('j'); `w` scales one stroke's weight;
 * `wp` gives a stroke its own widths instead of the pen's, in base line widths, evenly spaced from start to end.
 */

/**
 * Widths are fractions of the drawing's base line width; lengths are in line widths. A stroke goes down broad and lifts off to a
 * point: its start stays full and round, its free end tapers over `ramp.end`, and the pen presses hardest early on (`press`) and
 * eases off along the way. Inner lines are nearly as heavy as outlines. `fit` is how far, in line widths, an outline may stray
 * from its exact edge so that straight runs need few points.
 */
export const PEN = Object.freeze({
    contour: 1,
    detail: 0.85,
    press: 0.16,
    lean: 0.1,
    tip: Object.freeze({ start: 0.92, end: 0.18 }),
    ramp: Object.freeze({ start: 1, end: 5 }),
    tuck: 0.5,
    fit: 0.06,
});

/** How hard the pen presses along a stroke, 0 to 1 from its start to its end: set down firmly, a little harder just after, then easing off. */
const pressure = (u) => (0.6 + 0.4 * smoothstep(u / 0.12)) * (1 - u) ** 0.7;

/** The direction a hand pulls a pen down: strokes running this way lean on the nib and come out heavier. */
const PULL = (() => { const x = -0.35; const y = 0.94; const n = Math.hypot(x, y); return [x / n, y / n]; })();

const round = (v) => Math.round(v * 100) / 100;
const smoothstep = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

/**
 * A smooth curve through points, as a chain of cubic Béziers (centripetal Catmull-Rom). A point written `[x, y, 'c']` is a corner:
 * the curve passes through it without turning smoothly there.
 */
export function through(points, closed = false) {
    const P = points.map(p => [p[0], p[1]]);
    const corner = points.map(p => p[2] === 'c');
    const n = P.length;
    if (n < 2) return [];
    const at = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
    const out = [P[0][0], P[0][1]];
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
        const p1 = at(i);
        const p2 = at(i + 1);
        // a corner or an open end uses the point itself as its neighbour, so the curve leaves it straight toward the next one
        const p0 = (corner[i] || (!closed && i === 0)) ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : at(i - 1);
        const p3 = (corner[(i + 1) % n] || (!closed && i + 1 === n - 1)) ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : at(i + 2);
        const d1 = Math.max(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) ** 0.5, 1e-6);
        const d2 = Math.max(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) ** 0.5, 1e-6);
        const d3 = Math.max(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) ** 0.5, 1e-6);
        const m1 = [0, 1].map(k => (p1[k] - p0[k]) / d1 - (p2[k] - p0[k]) / (d1 + d2) + (p2[k] - p1[k]) / d2);
        const m2 = [0, 1].map(k => (p2[k] - p1[k]) / d2 - (p3[k] - p1[k]) / (d2 + d3) + (p3[k] - p2[k]) / d3);
        out.push(p1[0] + (m1[0] * d2) / 3, p1[1] + (m1[1] * d2) / 3, p2[0] - (m2[0] * d2) / 3, p2[1] - (m2[1] * d2) / 3, p2[0], p2[1]);
    }
    return out;
}

/** SVG path data for a closed chain of cubic Béziers, as `through(points, true)` gives. */
export function shapePath(c) {
    if (c.length < 8) return '';
    let d = `M${round(c[0])} ${round(c[1])}`;
    for (let i = 2; i + 5 < c.length; i += 6) d += `C${round(c[i])} ${round(c[i + 1])} ${round(c[i + 2])} ${round(c[i + 3])} ${round(c[i + 4])} ${round(c[i + 5])}`;
    return `${d}Z`;
}

/** Points along a chain of cubic Béziers, about `step` apart. */
export function sampleCubics(c, step = 0.6) {
    const pts = [[c[0], c[1]]];
    for (let i = 0; i + 7 < c.length; i += 6) {
        const [x0, y0, x1, y1, x2, y2, x3, y3] = c.slice(i, i + 8);
        const rough = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
        const n = Math.max(2, Math.ceil(rough / step));
        for (let k = 1; k <= n; k++) {
            const t = k / n;
            const u = 1 - t;
            const a = u * u * u;
            const b = 3 * u * u * t;
            const d = 3 * u * t * t;
            const e = t * t * t;
            pts.push([a * x0 + b * x1 + d * x2 + e * x3, a * y0 + b * y1 + d * y2 + e * y3]);
        }
    }
    return pts;
}

function tangents(pts) {
    return pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const n = Math.hypot(dx, dy) || 1;
        return [dx / n, dy / n];
    });
}

function arclength(pts) {
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return s;
}

/** The width of a stroke at each of its points, for a drawing whose base line width is `base`. */
export function widths(pts, stroke, base, pen = PEN) {
    const s = arclength(pts);
    const total = s[s.length - 1] || 1;
    if (stroke.wp) {
        // a stroke drawn with its own weight: widths in base line widths, evenly spaced along it
        const k = stroke.wp.length - 1;
        return pts.map((_, i) => {
            const u = (s[i] / total) * k;
            const j = Math.min(k - 1, Math.floor(u));
            const f = u - j;
            return base * (stroke.wp[j] * (1 - f) + stroke.wp[j + 1] * f);
        });
    }
    const kind = stroke.kind === 'detail' ? 'detail' : 'contour';
    const full = base * pen[kind] * (stroke.w ?? 1);
    const rampStart = Math.min(0.2 * total, pen.ramp.start * full);
    const rampEnd = Math.min(0.6 * total, pen.ramp.end * full);
    const t = tangents(pts);
    const freeStart = (stroke.ends ?? 'ff')[0] === 'f';
    const freeEnd = (stroke.ends ?? 'ff')[1] === 'f';
    return pts.map((_, i) => {
        let w = full * (1 + pen.press * (pressure(s[i] / total) - 0.3)) * (1 + pen.lean * (t[i][0] * PULL[0] + t[i][1] * PULL[1]));
        if (freeStart) w *= pen.tip.start + (1 - pen.tip.start) * smoothstep(s[i] / rampStart);
        if (freeEnd) w *= pen.tip.end + (1 - pen.tip.end) * smoothstep((total - s[i]) / rampEnd);
        return w;
    });
}

/** A closed path through `pts` drawn as smooth quadratic arcs between the midpoints of its sides. */
function smoothLoop(pts) {
    const n = pts.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m0 = mid(pts[n - 1], pts[0]);
    let d = `M${round(m0[0])} ${round(m0[1])}`;
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const m = mid(p, pts[(i + 1) % n]);
        d += `Q${round(p[0])} ${round(p[1])} ${round(m[0])} ${round(m[1])}`;
    }
    return `${d}Z`;
}

/**
 * The points of a line that a smooth curve needs to stay within `tol` of it (Douglas-Peucker): straight and gently curved runs
 * keep few points, tight bends keep many. The ends are always kept.
 */
export function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        if (b <= a + 1) continue;
        const [ax, ay] = pts[a];
        const dx = pts[b][0] - ax;
        const dy = pts[b][1] - ay;
        const n = Math.hypot(dx, dy) || 1;
        let worst = -1;
        let far = 0;
        for (let i = a + 1; i < b; i++) {
            const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / n;
            if (d > far) { far = d; worst = i; }
        }
        if (far > tol) {
            keep[worst] = 1;
            stack.push([a, worst], [worst, b]);
        }
    }
    return pts.filter((_, i) => keep[i]);
}

/** The outline of one stroke as SVG path data. */
export function strokePath(stroke, base, pen = PEN) {
    let pts = sampleCubics(stroke.c, Math.max(0.25, base * 0.35));
    if (pts.length < 2) return '';
    const ends = stroke.ends ?? 'ff';
    const t0 = tangents(pts);
    const full = base * pen[stroke.kind === 'detail' ? 'detail' : 'contour'] * (stroke.w ?? 1);
    // a joined end runs on a little into the line it meets, so the two close without a gap
    if (!stroke.closed && ends[0] === 'j') pts = [[pts[0][0] - t0[0][0] * pen.tuck * full, pts[0][1] - t0[0][1] * pen.tuck * full], ...pts];
    if (!stroke.closed && ends[1] === 'j') {
        const k = pts.length - 1;
        const tk = t0[t0.length - 1];
        pts = [...pts, [pts[k][0] + tk[0] * pen.tuck * full, pts[k][1] + tk[1] * pen.tuck * full]];
    }
    const w = widths(pts, stroke, base, pen);
    const t = tangents(pts);
    const tol = (pen.fit ?? 0) * base;
    const left = simplify(pts.map((p, i) => [p[0] - t[i][1] * w[i] / 2, p[1] + t[i][0] * w[i] / 2]), tol);
    const right = simplify(pts.map((p, i) => [p[0] + t[i][1] * w[i] / 2, p[1] - t[i][0] * w[i] / 2]), tol);
    if (stroke.closed) return `${smoothLoop(left)}${smoothLoop(right.reverse())}`;
    /** A round end at `p` facing `dir`, from the left edge of the stroke to the right. */
    const cap = (p, dir, r, steps = 6) => {
        const out = [];
        for (let k = 1; k < steps; k++) {
            const a = (Math.PI * k) / steps;
            out.push([p[0] - dir[1] * Math.cos(a) * r + dir[0] * Math.sin(a) * r, p[1] + dir[0] * Math.cos(a) * r + dir[1] * Math.sin(a) * r]);
        }
        return out;
    };
    const n = pts.length - 1;
    const endCap = ends[1] === 'f' ? cap(pts[n], t[n], w[n] / 2) : [];
    const startCap = ends[0] === 'f' ? cap(pts[0], [-t[0][0], -t[0][1]], w[0] / 2) : [];
    return smoothLoop([...left, ...endCap, ...right.reverse(), ...startCap]);
}
