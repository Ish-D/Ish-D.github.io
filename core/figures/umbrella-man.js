/**
 * The old man under the umbrella: a clear-line drawing in flat ink and flat paper that looks
 * where he is told to, smokes a pipe, and gives the rain and the smoke the shapes they need.
 *
 * Drawn in his own units: the ground at his feet is y = 0, up is negative, he stands about
 * 200 tall and the umbrella tops out near 270. `place` sets where he stands and how big.
 */

import { el } from '../runtime/svg.js';

const HEAD_SCALE = 0.92;
const NECK = { x: 0, y: -156 };
const EYE = { dx: 6, y: -178.4, r: 1.65 };
/** The middle of the pipe bowl's open top, before his face turns. */
const BOWL = { x: -21, y: -167.6 };
/** Where the umbrella is held. */
const HAND = { x: 44, y: -96 };

const deg = (d) => (d * Math.PI) / 180;
const num = (n) => Math.round(n * 10) / 10;

/** A point in the head's own units to the man's units: the head is scaled about the neck. */
const grow = ([x, y]) => [x * HEAD_SCALE, NECK.y + (y - NECK.y) * HEAD_SCALE];

const COAT = [[-12, -154], [-20, -153.4], [-25, -149], [-27.6, -138], [-27.8, -100], [-29, -56], [29, -56], [27.8, -100], [27.6, -138], [25, -149], [20, -153.4], [12, -154]];
const BEARD = [[-12.5, -174], [-15.2, -170], [-14.9, -165.6], [-14.8, -160], [-13.8, -156.8], [-12, -153], [-6, -151.6], [6, -151.6], [12, -153], [13.8, -156.8], [14.8, -160], [14.9, -165.6], [15.2, -170], [12.5, -174]].map(grow);
const LEGS = [[-21, -58, -2.5, -9], [2.5, -58, 21, -9]];

/** Each arm is a tube of width ARM along a quadratic curve from the shoulder to the cuff. */
const ARM = 11;
const ARMS = {
    left: { from: [-22, -144], via: [-35, -122], to: [-33, -82] },
    right: { from: [22, -144], via: [29, -116], to: [42, -99] },
};
const ARM_SPINES = Object.values(ARMS).map(({ from, via, to }) => Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    const u = 1 - t;
    return [u * u * from[0] + 2 * u * t * via[0] + t * t * to[0], u * u * from[1] + 2 * u * t * via[1] + t * t * to[1]];
}));

/**
 * The umbrella is a dome seen from a little above its rim and leaning toward his head. It is
 * built in three dimensions and projected, so its rim, seams and silhouette have the depth
 * a flat shape would not.
 */
const DOME = { radius: 80, height: 33, ribs: 8, scallop: 0.07, pitch: 10, roll: 11, reach: 134 };

function buildUmbrella() {
    const { radius: R, height: H, ribs, scallop } = DOME;
    const cb = Math.cos(deg(DOME.pitch));
    const sb = Math.sin(deg(DOME.pitch));
    const cg = Math.cos(deg(DOME.roll));
    const sg = Math.sin(deg(DOME.roll));
    // local x is across, y toward the viewer, z up the shaft
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
    /** How much the surface at (r, theta) faces the viewer; negative is turned away. */
    const facing = (r, theta) => {
        const slope = ((H * 2.2) / R) * (r / R) ** 1.2;
        return sb + slope * Math.sin(theta) * cb;
    };

    const nearRim = [];
    for (let a = 0; a <= 180; a += 3) nearRim.push(surface(edge(deg(a)), deg(a)));

    const samples = [];
    for (const f of [0, 0.3, 0.6, 0.85]) for (let a = 0; a < 360; a += 10) samples.push(surface(R * f, deg(a)));
    for (let a = 0; a < 360; a += 3) samples.push(surface(edge(deg(a)), deg(a)));
    const top = upperChain(samples);
    const outline = [...top, ...nearRim];

    const seams = [];
    for (let k = 0; k < ribs; k++) {
        const theta = (k * 2 * Math.PI) / ribs;
        let run = [];
        for (let i = 0; i <= 10; i++) {
            const r = (R * i) / 10;
            if (facing(r, theta) > 0.02) run.push(surface(r, theta));
            else if (run.length) { seams.push(run); run = []; }
        }
        if (run.length) seams.push(run);
    }

    const hem = [];
    for (let a = 0; a <= 180; a += 3) hem.push(surface(edge(deg(a)) - 3.4, deg(a)));

    const tips = [180, 135, 90, 45, 0].map(a => surface(edge(deg(a)), deg(a)));
    const apex = at(0, 0, H);
    const ferrule = at(0, 0, H + 9);
    const end = { x: HAND.x - 44 * axis.x, y: HAND.y - 44 * axis.y };

    /** The underside of the near rim, as a function of x; undefined outside the umbrella. */
    const rimAt = (x) => {
        for (let i = nearRim.length - 1; i > 0; i--) {
            const a = nearRim[i];
            const b = nearRim[i - 1];
            if (x >= a.x && x <= b.x && b.x > a.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
        }
        return undefined;
    };

    return {
        outline, tips, apex, ferrule, end, centre, seams, hem, rimAt,
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

/** What he and his umbrella take up, in his own units: where it reaches left and right, how high, and the middle of the picture. */
export const EXTENT = Object.freeze({
    left: UMBRELLA.left,
    right: UMBRELLA.right,
    top: UMBRELLA.topmost,
    centre: (UMBRELLA.left + UMBRELLA.right) / 2,
});

/** The points of the umbrella's near rim where water runs off, left to right. */
export function rimTips() {
    return UMBRELLA.tips.map(t => ({ ...t }));
}

/** Whether (x, y) is within `radius` of the line through `points`. */
function nearLine(points, x, y, radius) {
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= radius) return true;
    }
    return false;
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
    if ((x / 16) ** 2 + ((y + 176) / 25) ** 2 <= 1) return 'body';
    if (inside(COAT, x, y) || inside(BEARD, x, y) || ARM_SPINES.some(spine => nearLine(spine, x, y, ARM / 2 + 1.5))) return 'body';
    for (const [x0, y0, x1, y1] of LEGS) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return 'body';
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

/** Short vertical lines across `count` columns between two edges that sag by `sag` in the middle; the stitches of a ribbed band. */
function ribs(x0, x1, count, top, bottom, sag) {
    const parts = [];
    for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const x = num(x0 + (x1 - x0) * t);
        const bow = 4 * sag * t * (1 - t);
        parts.push(`M${x} ${num(top + bow + 1)} L${x} ${num(bottom + bow - 1)}`);
    }
    return parts.join(' ');
}

/** How far to turn something drawn pointing down so it points along the end of a curve that arrives at `to` from `via`. */
const turnOf = (via, to) => (Math.atan2(via[0] - to[0], to[1] - via[1]) * 180) / Math.PI;

/**
 * @param {Document} document
 * @param {Element} parent   the svg element to draw into
 */
export function createMan(document, parent) {
    const svg = (tag, attrs, ...kids) => el(document, tag, attrs, ...kids);
    const ink = { style: 'fill: currentColor' };
    const paper = 'var(--color-card-background)';
    const cut = (width = 1.3) => ({ style: `fill: none; stroke: ${paper}; stroke-width: ${width}` });
    const line = (width) => ({ style: `fill: none; stroke-width: ${width}` });

    // ---- face: a dot for each eye under a heavy brow, and a long nose
    const eyes = [-1, 1].map(side => svg('ellipse', { class: 'eye', cx: side * EYE.dx, cy: EYE.y, rx: EYE.r, ry: EYE.r, ...ink }));
    const brows = [-1, 1].map(side => svg('path', {
        d: `M${num(side * 10)} ${EYE.y - 4.2} Q${num(side * 6.4)} ${EYE.y - 5.8} ${num(side * 2.4)} ${EYE.y - 3.2}`, ...line(2.6),
    }));
    const nose = svg('g', {},
        svg('path', { d: 'M-1.7 -180 Q-2.5 -177.6 -3.9 -175.6 Q-5.6 -173 -4.4 -170.4 Q-3.1 -168.2 0 -168 Q3.1 -168.2 4.4 -170.4 Q5.6 -173 3.9 -175.6 Q2.5 -177.6 1.7 -180', style: 'stroke-width: 1.3' }),
        svg('path', { d: 'M-3.2 -171.4 Q-2.6 -169.8 -1 -169.8', ...line(0.9) }));
    const face = svg('g', {}, ...eyes, ...brows, nose);

    // ---- the pipe, which turns a little less than the eyes
    const stem = 'M-4.6 -164.8 Q-11 -164.6 -19 -160.6';
    const mouth = svg('g', {},
        svg('path', { d: 'M-4.6 -164.8 Q-1 -163.4 3 -164.6', ...cut(1) }),
        svg('path', { d: stem, style: `fill: none; stroke: ${paper}; stroke-width: 3.8` }),
        svg('path', { d: stem, ...line(2.1) }),
        svg('path', { d: 'M-25 -167.4 L-24.2 -159.4 Q-23.6 -156.8 -21 -156.8 Q-18.4 -156.8 -17.8 -159.4 L-17 -167.4 Z', ...ink }),
        svg('ellipse', { cx: BOWL.x, cy: BOWL.y + 0.4, rx: 4, ry: 1.4 }));

    // ---- beard: squared off, from the ears down the jaw to a flat chin; the moustache is part of it
    const beard = 'M-12.5 -174 Q-15.6 -171 -14.9 -165.6 Q-14.8 -160 -13.8 -156.8 Q-12 -152.4 -6 -151.6 L6 -151.6 Q12 -152.4 13.8 -156.8 Q14.8 -160 14.9 -165.6 Q15.6 -171 12.5 -174 '
        + 'Q11.8 -169.4 9.4 -167.8 Q6.6 -169.8 3.8 -169.2 L-3.8 -169.2 Q-6.6 -169.8 -9.4 -167.8 Q-11.8 -169.4 -12.5 -174 Z';
    const strands = 'M-10.8 -164 L-10.8 -159.8 Q-10.6 -156.6 -8.4 -154.8 M10.8 -164 L10.8 -159.8 Q10.6 -156.6 8.4 -154.8';

    // ---- knit cap: a rounded crown and a folded, ribbed cuff, pulled down to his brow
    const cap = svg('g', {},
        svg('path', { d: 'M-14 -189 L-14.6 -194.6 Q-15 -203.6 0 -203.8 Q15 -203.6 14.6 -194.6 L14 -189 Z', ...ink }),
        svg('path', { d: 'M-15 -192.6 Q0 -190.6 15 -192.6 L14.6 -187.2 Q0 -185.4 -14.6 -187.2 Z', ...ink }),
        svg('path', { d: 'M-14.8 -192.8 Q0 -190.8 14.8 -192.8', ...cut(0.9) }),
        svg('path', { d: ribs(-12.4, 12.4, 7, -192.4, -187.2, 1), ...cut(0.8) }));

    const head = svg('g', {},
        svg('ellipse', { cx: -12.5, cy: -176.6, rx: 2.3, ry: 3.4 }),
        svg('ellipse', { cx: 12.5, cy: -176.6, rx: 2.3, ry: 3.4 }),
        svg('rect', { x: -12.5, y: -192, width: 25, height: 34, rx: 6.5, style: 'stroke-width: 1.3' }),
        svg('path', { d: beard, ...ink }),
        svg('path', { d: strands, ...cut(0.9) }),
        mouth,
        face,
        cap);

    // ---- the umbrella, from the projected dome
    const u = UMBRELLA;
    const seams = u.seams.map(run => svg('path', { d: pathOf(run), ...cut(1.3) }));
    const canopy = svg('g', {},
        svg('path', { d: pathOf(u.outline, true), ...ink }),
        ...seams,
        svg('path', { d: pathOf(u.hem), ...cut(1) }),
        ...u.tips.map(t => svg('circle', { cx: num(t.x), cy: num(t.y), r: 1.5, ...ink })));
    const crook = `Q${num(u.end.x + 1)} ${num(u.end.y + 8)} ${num(u.end.x - 7)} ${num(u.end.y + 8)} Q${num(u.end.x - 13)} ${num(u.end.y + 8)} ${num(u.end.x - 13)} ${num(u.end.y)}`;
    const shaft = `M${num(u.centre.x)} ${num(u.centre.y)} L${num(u.end.x)} ${num(u.end.y)} ${crook}`;

    // ---- a long heavy coat, a knit scarf and boots
    const sleeve = ({ from, via, to }) => svg('path', { d: `M${from[0]} ${from[1]} Q${via[0]} ${via[1]} ${to[0]} ${to[1]}`, style: `fill: none; stroke-width: ${ARM}; stroke-linecap: butt` });
    /** The line where a sleeve lies against the coat, from the armpit to the cuff: the inner edge of the sleeve. */
    const seam = ({ from, via, to }, inward) => {
        const points = [];
        for (let t = 0.3; t <= 1.001; t += 0.1) {
            const u = 1 - t;
            const dx = 2 * u * (via[0] - from[0]) + 2 * t * (to[0] - via[0]);
            const dy = 2 * u * (via[1] - from[1]) + 2 * t * (to[1] - via[1]);
            const long = Math.hypot(dx, dy);
            points.push({
                x: u * u * from[0] + 2 * u * t * via[0] + t * t * to[0] + (inward * dy * ARM) / (2 * long),
                y: u * u * from[1] + 2 * u * t * via[1] + t * t * to[1] - (inward * dx * ARM) / (2 * long),
            });
        }
        return svg('path', { d: pathOf(points), ...cut(1.1) });
    };
    /** The hand continues the arm from the cuff. */
    const hand = ({ via, to }) => {
        const long = Math.hypot(to[0] - via[0], to[1] - via[1]);
        const x = num(to[0] + (4.2 * (to[0] - via[0])) / long);
        const y = num(to[1] + (4.2 * (to[1] - via[1])) / long);
        return svg('ellipse', { cx: x, cy: y, rx: 4.3, ry: 5.6, transform: `rotate(${num(turnOf(via, to))} ${x} ${y})` });
    };
    const cuff = ({ via, to }) => svg('g', { transform: `translate(${to[0]} ${to[1]}) rotate(${num(turnOf(via, to))})` },
        svg('path', { d: `M${-ARM / 2} -4.4 L${ARM / 2} -4.4`, ...cut(1) }));

    const buttons = [-116, -103, -90, -77, -64].map(y => svg('circle', { cx: 4, cy: y, r: 1.5, style: `fill: ${paper}; stroke: none` }));
    const coat = [
        svg('path', { d: 'M-12 -154 Q-20 -153.4 -25 -149 Q-27.6 -146 -27.6 -138 L-27.8 -100 L-29 -56 Q0 -52.8 29 -56 L27.8 -100 L27.6 -138 Q27.6 -146 25 -149 Q20 -153.4 12 -154 Q0 -151 -12 -154 Z', ...ink }),
        svg('path', { d: 'M-1 -146 L-1 -57.6 M-23.4 -88 L-12.6 -86.6 M23.4 -88 L12.6 -86.6 M-28.2 -61 Q0 -57.4 28.2 -61', ...cut(1) }),
        ...buttons,
    ];
    const scarf = [
        svg('path', { d: 'M-13.2 -160.4 Q0 -157.6 13.2 -160.4 L15.6 -150.6 Q0 -146.6 -15.6 -150.6 Z' }),
        svg('path', { d: ribs(-13.6, 13.6, 9, -160.4, -150.6, 1.6), ...line(0.9) }),
        svg('path', { d: 'M-11.4 -149 L-1.8 -148.4 Q-2.2 -134 -2.6 -122 L-11 -122.6 Q-11.2 -136 -11.4 -149 Z' }),
        svg('path', { d: 'M-11.1 -130 L-2.4 -129.4 M-11 -126.6 L-2.5 -126', ...line(0.9) }),
        svg('path', { d: 'M-10 -122.4 L-10.2 -117.8 M-8.1 -122.4 L-8.3 -117.8 M-6.2 -122.2 L-6.4 -117.6 M-4.3 -122.2 L-4.5 -117.6', ...cut(1.2) }),
    ];
    const patch = [
        svg('rect', { x: -36.4, y: -117, width: 6.6, height: 7.6, rx: 0.8, style: 'stroke: none' }),
        svg('rect', { x: -35.4, y: -116, width: 4.6, height: 5.6, style: 'fill: none; stroke-width: 0.7; stroke-dasharray: 1.2 1' }),
    ];

    const man = svg('g', {
        style: 'color: var(--color-text-primary); fill: var(--color-card-background); stroke: currentColor; '
            + 'stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round',
    },
    svg('path', { d: 'M-34 2 L34 2', ...line(1.2) }),
    svg('path', { d: 'M-21 -58 L-2.5 -58 L-4 -9 L-18.6 -9 Z M21 -58 L2.5 -58 L4 -9 L18.6 -9 Z', ...ink }),
    svg('rect', { x: -27.4, y: -9.4, width: 24.6, height: 9.8, rx: 4.6, ...ink }),
    svg('rect', { x: 2.8, y: -9.4, width: 24.6, height: 9.8, rx: 4.6, ...ink }),
    svg('path', { d: 'M-25.6 -2.6 L-4.6 -2.6 M4.6 -2.6 L25.6 -2.6 M-19.6 -30 L-3.4 -30 M19.6 -30 L3.4 -30', ...cut(0.9) }),
    ...coat,
    hand(ARMS.left),
    hand(ARMS.right),
    sleeve(ARMS.left),
    sleeve(ARMS.right),
    seam(ARMS.left, 1),
    seam(ARMS.right, -1),
    ...patch,
    cuff(ARMS.left),
    cuff(ARMS.right),
    svg('path', { d: shaft, style: `fill: none; stroke: ${paper}; stroke-width: 4.6` }),
    svg('path', { d: shaft, ...line(2.2) }),
    ...scarf,
    svg('g', { transform: `translate(0 ${NECK.y}) scale(${HEAD_SCALE}) translate(0 ${-NECK.y})` }, head),
    svg('path', { d: `M${num(u.apex.x)} ${num(u.apex.y)} L${num(u.ferrule.x)} ${num(u.ferrule.y)}`, ...line(2.2) }),
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
            const [x, y] = grow([0, -176]);
            return toFigure(x, y);
        },

        /** What a point in the figure's coordinates is inside. */
        hit(x, y) {
            return hitTest((x - placement.x) / placement.scale, (y - placement.y) / placement.scale);
        },

        /** The points of the near rim where water runs off, in the figure's coordinates. */
        tips() {
            return u.tips.map(t => toFigure(t.x, t.y));
        },

        /** The underside of the umbrella, a little below its near rim: where smoke stops, in the figure's coordinates. */
        underside() {
            const gap = 8;
            return {
                left: toFigure(u.left, 0).x,
                right: toFigure(u.right, 0).x,
                centre: toFigure(u.centre.x, 0).x,
                at: (x) => {
                    const local = u.rimAt((x - placement.x) / placement.scale);
                    return local === undefined ? -Infinity : toFigure(0, local).y + gap * placement.scale;
                },
            };
        },

        /** The top of the pipe bowl as his head is turned now, in the figure's coordinates. */
        bowl() {
            const angle = deg(turn.x * 4);
            const [bx, by] = grow([BOWL.x + turn.x * 1.6, BOWL.y + turn.y * 1.1]);
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
            head.setAttribute('transform', `rotate(${num(gx * 4)} ${NECK.x} ${NECK.y})`);
            face.setAttribute('transform', `translate(${num(gx * 2.2)} ${num(gy * 1.5)})`);
            mouth.setAttribute('transform', `translate(${num(gx * 1.6)} ${num(gy * 1.1)})`);
            eyes.forEach((eye, i) => {
                eye.setAttribute('cx', num((i === 0 ? -EYE.dx : EYE.dx) + gx * 1.1));
                eye.setAttribute('cy', num(EYE.y + gy * 0.8));
                eye.setAttribute('ry', num(EYE.r * (1 - 0.88 * shut) * 100) / 100);
            });
        },
    };
}
