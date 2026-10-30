/**
 * The man under the umbrella: a clear-line drawing in flat ink and flat paper that looks where he is told to, smokes a pipe,
 * and gives the rain and the smoke the shapes they need. The man is drawn from umbrella-man-drawing.js with the pen in
 * pen.js, in a black coat with its seams, folds and buttons cut in paper; the umbrella is built here.
 *
 * Drawn in his own units: the ground at his feet is y = 0, up is negative, he stands 200 tall and the umbrella tops out
 * near 245. `place` sets where he stands and how big.
 */

import { el } from '../runtime/svg.js';
import { through, shapePath, strokePath } from './pen.js';
import DRAWING from './umbrella-man-drawing.js';

const deg = (d) => (d * Math.PI) / 180;
const num = (n) => Math.round(n * 10) / 10;
const point = ([x, y]) => ({ x, y });

const NECK = point(DRAWING.neck);
/** The middle of the pipe bowl's open top, before his head turns. */
const BOWL = point(DRAWING.bowl);
/** Where his fist holds the shaft. */
const HAND = point(DRAWING.hand);
const EYES = DRAWING.parts.face.eyes.map(point);
const [EYE_RX, EYE_RY] = DRAWING.eye;
const LINE = DRAWING.line;

/**
 * The umbrella is a dome seen from a little below its rim, so its underside shows under the near rim. It leans over his
 * head from where he holds it. It is built in three dimensions and projected, so the shaft runs to the middle of the dome
 * and the rim, ribs and stretchers have the depth a flat shape would not.
 */
const DOME = { radius: 64, height: 32, ribs: 12, scallop: 0.1, pitch: -4, roll: 9, reach: 62, below: 34, runner: 0.18, stretch: 0.55 };

function buildUmbrella() {
    const { radius: R, height: H, ribs, scallop } = DOME;
    const cb = Math.cos(deg(DOME.pitch));
    const sb = Math.sin(deg(DOME.pitch));
    const cg = Math.cos(deg(DOME.roll));
    const sg = Math.sin(deg(DOME.roll));
    // local x is across, y toward the viewer, z up the shaft from the middle of the rim
    const project = (x, y, z) => {
        const up = z * cb - y * sb;
        return { x: x * cg - up * sg, y: -(x * sg + up * cg) };
    };
    const axis = project(0, 0, 1);
    const centre = { x: HAND.x + DOME.reach * axis.x, y: HAND.y + DOME.reach * axis.y };
    const at = (x, y, z) => { const p = project(x, y, z); return { x: centre.x + p.x, y: centre.y + p.y }; };

    const edge = (theta) => R * (1 - (scallop * (1 - Math.cos(ribs * theta))) / 2);
    const lift = (r) => H * (1 - (r / R) ** 2.2);
    const surface = (r, theta) => at(r * Math.cos(theta), r * Math.sin(theta), lift(r));
    /** How much the outside of the dome at (r, theta) faces the viewer; negative is turned away. */
    const facing = (r, theta) => {
        const slope = ((H * 2.2) / R) * (r / R) ** 1.2;
        return sb + slope * Math.sin(theta) * cb;
    };
    const rim = (from, to) => {
        const out = [];
        for (let a = from; from < to ? a <= to : a >= to; a += from < to ? 2 : -2) out.push(surface(edge(deg(a)), deg(a)));
        return out;
    };

    // the near half of the rim, left to right, and the far half, which is the lower edge seen from below
    const nearRim = rim(180, 0);
    const farRim = rim(360, 180);
    const samples = [];
    for (const f of [0, 0.15, 0.3, 0.5, 0.7, 0.85]) for (let a = 0; a < 360; a += 6) samples.push(surface(R * f, deg(a)));
    for (let a = 0; a < 360; a += 2) samples.push(surface(edge(deg(a)), deg(a)));
    const top = upperChain(samples);
    const outline = [...top, ...farRim];
    // the rim without its scallops, which is what smoke under it slides along
    const smoothNear = [];
    for (let a = 180; a >= 0; a -= 4) smoothNear.push(at(R * (1 - scallop / 2) * Math.cos(deg(a)), R * (1 - scallop / 2) * Math.sin(deg(a)), 0));
    const outside = [...top, ...[...nearRim].reverse()];
    const underside = [...nearRim, ...farRim.slice().reverse()].reverse();

    /** The height of a line of points at x, as seen; undefined outside it. */
    const heightOn = (line) => (x) => {
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1];
            const b = line[i];
            if ((x - a.x) * (x - b.x) <= 0 && a.x !== b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
        }
        return undefined;
    };
    const nearAt = heightOn(nearRim);
    /** Only the stretch of a run that is seen under the near rim, as separate pieces. */
    const underNear = (run) => {
        const pieces = [];
        let cur = [];
        for (const p of run) {
            const y = nearAt(p.x);
            if (y !== undefined && p.y > y + 0.4) cur.push(p);
            else if (cur.length) { pieces.push(cur); cur = []; }
        }
        if (cur.length) pieces.push(cur);
        return pieces.filter(piece => piece.length > 1);
    };

    // seams on the outside, where it faces us; ribs and stretchers on the far inside, where they show under the near rim
    const seams = [];
    const ribsInside = [];
    const stretchers = [];
    const runner = at(0, 0, -DOME.runner * R);
    for (let k = 0; k < ribs; k++) {
        const theta = (k * 2 * Math.PI) / ribs;
        let run = [];
        for (let i = 0; i <= 16; i++) {
            const r = (edge(theta) * i) / 16;
            if (facing(r, theta) > 0.03) run.push(surface(r, theta));
            else if (run.length) { seams.push(run); run = []; }
        }
        if (run.length > 1) seams.push(run);
        if (Math.sin(theta) < -0.05) {
            ribsInside.push(...underNear(Array.from({ length: 17 }, (_, i) => surface((edge(theta) * i) / 16, theta))));
            const joint = surface(R * DOME.stretch, theta);
            stretchers.push(...underNear(Array.from({ length: 9 }, (_, i) => ({
                x: runner.x + ((joint.x - runner.x) * i) / 8, y: runner.y + ((joint.y - runner.y) * i) / 8,
            }))));
        }
    }

    const tipAt = (deg_) => surface(edge(deg(deg_)), deg(deg_));
    const nearTips = [];
    const farTips = [];
    for (let k = 0; k < ribs; k++) {
        const a = (360 * k) / ribs;
        if (a > 0 && a < 180) nearTips.push(tipAt(a));
        if (a > 180) farTips.push(tipAt(a));
    }
    // water runs off at the two ends of the rim and from the near rim between them
    const runoff = [tipAt(180), tipAt(120), tipAt(90), tipAt(60), tipAt(0)].sort((a, b) => a.x - b.x);
    const apex = at(0, 0, H);
    const ferrule = at(0, 0, H + 8);
    const end = { x: HAND.x - DOME.below * axis.x, y: HAND.y - DOME.below * axis.y };

    return {
        outline, outside, underside, top, nearRim, farRim, seams, ribsInside, stretchers, runner, nearTips, farTips, runoff,
        apex, ferrule, end, centre, axis, nearAt, roofAt: heightOn(smoothNear),
        left: Math.min(...outline.map(p => p.x)),
        right: Math.max(...outline.map(p => p.x)),
        topmost: Math.min(...outline.map(p => p.y), ferrule.y),
    };
}

/** The upper edge of the convex hull of `points`, left to right. */
function upperChain(points) {
    const pts = points.map(p => ({ x: p.x, y: -p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const hull = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], pts[i]) <= 0) hull.pop();
        hull.push(pts[i]);
    }
    return hull.reverse().map(p => ({ x: p.x, y: -p.y }));
}

const UMBRELLA = buildUmbrella();
const SILHOUETTE = DRAWING.silhouette;

/** What he and his umbrella take up, in his own units: where it reaches left and right, how high, and the middle of the picture. */
export const EXTENT = Object.freeze({
    left: UMBRELLA.left,
    right: UMBRELLA.right,
    top: UMBRELLA.topmost,
    centre: (UMBRELLA.left + UMBRELLA.right) / 2,
});

/** The points of the umbrella's rim where water runs off, left to right. */
export function rimTips() {
    return UMBRELLA.runoff.map(t => ({ ...t }));
}

function inside(polygon, x, y) {
    let odd = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x ?? polygon[i][0];
        const yi = polygon[i].y ?? polygon[i][1];
        const xj = polygon[j].x ?? polygon[j][0];
        const yj = polygon[j].y ?? polygon[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
}

/** What a point, in the man's units, is inside: his umbrella, himself, or nothing. */
export function hitTest(x, y) {
    if (inside(UMBRELLA.outline, x, y)) return 'canopy';
    if (inside(SILHOUETTE, x, y)) return 'body';
    return null;
}

/**
 * Where to look, from where the head is and where the pointer is. Each axis is in [-1, 1].
 * A pointer on top of the head gives no turn; one `reach` px away or more gives the full turn.
 */
export function gazeToward(head, pointer, reach = 160) {
    const dx = pointer.x - head.x;
    const dy = pointer.y - head.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) return { x: 0, y: 0 };
    const strength = Math.min(1, distance / reach);
    return { x: (dx / distance) * strength, y: (dy / distance) * strength };
}

const pathOf = (points, close = false) => `M${points.map(p => `${num(p.x)} ${num(p.y)}`).join(' L')}${close ? ' Z' : ''}`;

/** A curve through drawn points as a chain of cubic Béziers. */
const curve = (pts, closed) => through(pts, closed);

/** A line along `points` ({x, y}) drawn by the pen, as path data. */
const penLine = (points, { kind = 'detail', ends = 'ff', w, wp } = {}) => strokePath({ c: curve(points.map(p => [p.x, p.y])), kind, ends, w, wp }, LINE);

/** Lines drawn by the pen, merged into one path per tone. */
const penned = (strokes) => {
    const byTone = {};
    for (const s of strokes ?? []) {
        (byTone[s.tone ?? 'ink'] ??= []).push(strokePath({ c: curve(s.p, s.closed), kind: s.kind, ends: s.ends, closed: s.closed, w: s.w, wp: s.wp }, LINE));
    }
    return Object.entries(byTone).map(([tone, ds]) => ({ tone, d: ds.join('') }));
};

/** The man's parts as path data, built once: each part's under-lines, fills, blacks, lines by tone, and buttons. */
let PARTS = null;
function parts() {
    if (PARTS) return PARTS;
    PARTS = {};
    for (const name of DRAWING.order) {
        const part = DRAWING.parts[name];
        PARTS[name] = {
            under: penned(part.under),
            fills: (part.fills ?? []).map(([tone, pts]) => ({ tone, d: shapePath(curve(pts, true)) })),
            ink: (part.ink ?? []).map(pts => shapePath(curve(pts, true))).join(''),
            lines: penned(part.strokes),
            dots: part.dots ?? [],
        };
    }
    return PARTS;
}

/**
 * @param {Document} document
 * @param {Element} parent   the svg element to draw into
 */
export function createMan(document, parent) {
    const svg = (tag, attrs, ...kids) => el(document, tag, attrs, ...kids);
    const INK = 'currentColor';
    const PAPER = 'var(--color-card-background)';
    const toneOf = (tone) => (tone === 'paper' ? PAPER : INK);
    const shape = (d, color) => svg('path', { d, style: `fill: ${color}` });

    /** One drawn part: its paper edge, fills, blacks, lines, and its buttons, which are paper dots on the black coat. */
    const drawn = (name) => {
        const p = parts()[name];
        return [
            ...p.under.map(l => shape(l.d, toneOf(l.tone))),
            ...p.fills.map(f => shape(f.d, toneOf(f.tone))),
            p.ink && shape(p.ink, INK),
            ...p.lines.map(l => shape(l.d, toneOf(l.tone))),
            ...p.dots.map(([x, y, r]) => svg('circle', { cx: x, cy: y, r, style: `fill: ${PAPER}` })),
        ];
    };

    const u = UMBRELLA;

    // ---- the far inside of the umbrella, seen under its near rim: paper, with its ribs and the stretchers to the runner
    const underside = svg('g', {},
        shape(pathOf(u.underside, true), PAPER),
        ...u.stretchers.map(run => shape(penLine(run, { w: 0.6 }), INK)),
        ...u.ribsInside.map(run => shape(penLine(run, { w: 0.8 }), INK)),
        shape(penLine(u.farRim, { kind: 'contour', ends: 'jj' }), INK));

    // ---- his neck goes behind the collar and his head in front of it, so the jaw stays whole as he turns; the face's marks and
    // the pipe go over the head and turn with it
    const neck = svg('g', {}, ...drawn('neck'));
    const head = svg('g', {}, ...drawn('head'));
    const eyes = EYES.map(e => svg('ellipse', { class: 'eye', cx: e.x, cy: e.y, rx: EYE_RX, ry: EYE_RY, style: `fill: ${INK}` }));
    const face = svg('g', {}, ...drawn('face'), ...eyes);
    const mouth = svg('g', {}, ...drawn('pipe'));
    const front = svg('g', {}, face, mouth);

    // ---- the shaft from the crook to the middle of the dome, in front of the inside and behind the outside
    const axis = u.axis;
    const right = { x: -axis.y, y: axis.x };
    const along = (base, a, r) => ({ x: base.x + a * axis.x + r * right.x, y: base.y + a * axis.y + r * right.y });
    const shaft = [u.end, u.centre];
    const crook = [u.end, along(u.end, -6, 0.2), along(u.end, -11.5, 2.4), along(u.end, -13, 6.5), along(u.end, -11, 10.2), along(u.end, -6.5, 11.4)];
    const collar = [along(u.runner, 1.4, -1.1), along(u.runner, 1.4, 1.1), along(u.runner, -1.4, 1.1), along(u.runner, -1.4, -1.1)];
    const handle = svg('g', {},
        shape(penLine(shaft, { kind: 'contour', ends: 'ff', wp: [4, 4] }), PAPER),
        shape(penLine(crook, { kind: 'contour', ends: 'jf', wp: [5.4, 5.4, 5.4, 5.4, 5.2, 4.8] }), PAPER),
        shape(penLine(shaft, { kind: 'contour', ends: 'ff', wp: [1.9, 1.9] }), INK),
        shape(penLine(crook, { kind: 'contour', ends: 'jf', wp: [3, 3.1, 3.2, 3.2, 3, 2.6] }), INK),
        shape(pathOf(collar, true), INK));

    // ---- the outside of the dome, in front of everything under it: black, its seams cut in paper, the tips and the ferrule
    const canopy = svg('g', {},
        shape(pathOf(u.outside, true), INK),
        ...u.seams.map(run => shape(penLine(run, { w: 0.75 }), PAPER)),
        shape(penLine(u.nearRim, { ends: 'jj', w: 0.75 }), PAPER),
        ...u.nearTips.map(t => svg('ellipse', { cx: num(t.x), cy: num(t.y + 0.9), rx: 1, ry: 1.5, style: `fill: ${INK}` })),
        ...[...u.farTips, u.runoff[0], u.runoff[u.runoff.length - 1]].map(t => svg('circle', { cx: num(t.x), cy: num(t.y + 0.5), r: 1.15, style: `fill: ${INK}` })),
        shape(penLine([u.apex, u.ferrule], { kind: 'contour', ends: 'jf', wp: [2.6, 1.4] }), INK));

    const man = svg('g', { style: 'color: var(--color-text-primary)' },
        underside,
        neck,
        svg('g', {}, ...drawn('body')),
        head,
        front,
        handle,
        svg('g', {}, ...drawn('hand')),
        canopy);

    const root = svg('g', {}, man);
    parent.appendChild(root);

    let placement = { x: 0, y: 0, scale: 1 };
    let turn = { x: 0, y: 0 };

    /** A point in his own units to the figure's coordinates. */
    const toFigure = (x, y) => ({ x: placement.x + x * placement.scale, y: placement.y + y * placement.scale });

    return {
        root,

        /** Stand with the feet at (x, y) in the figure, `scale` times the drawn size. */
        place(next) {
            placement = { ...placement, ...next };
            root.setAttribute('transform', `translate(${num(placement.x)} ${num(placement.y)}) scale(${Math.round(placement.scale * 1000) / 1000})`);
        },

        /** Where his head is, in the figure's coordinates. */
        headCenter() {
            return toFigure((EYES[0].x + EYES[1].x) / 2, EYES[0].y);
        },

        /** What a point in the figure's coordinates is inside. */
        hit(x, y) {
            return hitTest((x - placement.x) / placement.scale, (y - placement.y) / placement.scale);
        },

        /** The points of the rim where water runs off, in the figure's coordinates. */
        tips() {
            return u.runoff.map(t => toFigure(t.x, t.y));
        },

        /** The inside of the umbrella, a little below its near rim: where smoke stops, in the figure's coordinates. */
        underside() {
            const gap = 2.5;
            return {
                left: toFigure(u.left, 0).x,
                right: toFigure(u.right, 0).x,
                centre: toFigure(u.centre.x, 0).x,
                at: (x) => {
                    const local = u.roofAt((x - placement.x) / placement.scale);
                    return local === undefined ? -Infinity : toFigure(0, local).y + gap * placement.scale;
                },
            };
        },

        /** His outline and the umbrella's, in the figure's coordinates: what a puddle at his feet mirrors. */
        outlines() {
            const shaft = [along(u.end, 0, -0.7), along(u.end, 0, 0.7), along(u.centre, 0, 0.7), along(u.centre, 0, -0.7)];
            return [SILHOUETTE.map(([x, y]) => toFigure(x, y)), u.outline.map(p => toFigure(p.x, p.y)), shaft.map(p => toFigure(p.x, p.y))];
        },

        /** The top of the pipe bowl as his head is turned now, in the figure's coordinates. */
        bowl() {
            const angle = deg(turn.x * 4);
            const bx = BOWL.x + turn.x * 1.4;
            const by = BOWL.y + turn.y * 1;
            const dx = bx - NECK.x;
            const dy = by - NECK.y;
            return toFigure(NECK.x + dx * Math.cos(angle) - dy * Math.sin(angle), NECK.y + dx * Math.sin(angle) + dy * Math.cos(angle));
        },

        /**
         * Turn the head and eyes. `gaze` is where to look, each axis in [-1, 1];
         * `blink` is 0 for open and 1 for shut.
         */
        look(gaze, blink = 0) {
            const gx = Math.max(-1, Math.min(1, gaze.x));
            const gy = Math.max(-1, Math.min(1, gaze.y));
            const shut = Math.max(0, Math.min(1, blink));
            turn = { x: gx, y: gy };
            const tilt = `rotate(${num(gx * 4)} ${NECK.x} ${NECK.y})`;
            neck.setAttribute('transform', tilt);
            head.setAttribute('transform', tilt);
            front.setAttribute('transform', tilt);
            face.setAttribute('transform', `translate(${num(gx * 2)} ${num(gy * 1.3)})`);
            mouth.setAttribute('transform', `translate(${num(gx * 1.4)} ${num(gy * 1)})`);
            eyes.forEach((eye, i) => {
                eye.setAttribute('cx', num(EYES[i].x + gx * 0.9));
                eye.setAttribute('cy', num(EYES[i].y + gy * 0.5));
                eye.setAttribute('ry', num(EYE_RY * (1 - 0.88 * shut) * 100) / 100);
            });
        },
    };
}
