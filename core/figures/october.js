/**
 * October: a street of old houses on Halloween night under a crescent moon, with crows over the roofs. The crows fly in
 * place, each at its own pace, now and then holding their wings out to glide, and one sits on the moon's lower tip,
 * looking about and now and then cawing. The drawing's one colour, a yellow, is the moon and what is lit in the street:
 * the jack-o'-lanterns by the doors, the street lamp, an open door; everything else is the ink of the page. Beside a
 * cover's type on a phone, where the type takes half the sky, three of the crows fly right of the moon instead, and one
 * more flies beside the type's short top lines.
 *
 *   [[viz(type: october, width: 450, height: 360)]]
 *   [[viz(type: october, place: cover)]]   beside the type of a cover page
 */

import { defineFigure } from '../runtime/figures.js';
import { createLoop } from '../runtime/loop.js';
import { el as svgEl, seeded } from '../runtime/svg.js';
import { strokePath, through } from './pen.js';
import { VIEW, ROOFS, ROOF_INK, ROOF_PAPER, LIT, MOON, PERCHED, WINGBEAT, FLIERS } from './october-drawing.js';

/** A wingbeat takes about this long, in seconds; each crow beats a little faster or slower. */
const BEAT = 1.2;
/** How long a crow of size 1 is, in the drawing's px, for scaling how far it bobs and drifts. */
export const BODY = 220;
/** The pen for the lines in the roofs, the moon's outline and the crow on the moon, in the drawing's px. */
const LINE = 2.1;
/** The pen in a flier's own px, which it is scaled from, so the lines between its feathers read on the largest crows. */
const FLIER_LINE = 4;
// every point of the roofs' paths counts, their curves' handles too, and the thin lines standing on them
const roofPoints = [
    ...(ROOFS.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).reduce((out, v, i, all) => (i % 2 ? out : [...out, [v, all[i + 1]]]), []),
    ...ROOF_INK.flatMap(l => l.pts),
];
/** A corner `x` wide at the drawing's top left, as shares of its width and height, down to just above the roofs there. */
const corner = (x) => Object.freeze([x, (Math.min(...roofPoints.filter(([px]) => px < VIEW.x + x * VIEW.width).map(p => p[1])) - 4 - VIEW.y) / VIEW.height]);
/**
 * The empty corners at the drawing's top left where a cover's type can stand, each in steps from the top down (so wide,
 * down to so far): a quarter of its width as drawn, left of the furthest any crow reaches; and for a phone, where the
 * type is wide against the drawing, half of it with three crows moved right of the moon, first narrower beside the
 * type's short top lines, where one more crow flies, then plain for type that doesn't fit that (`ARRANGEMENTS`). See the
 * test.
 */
export const ROOMS = Object.freeze([
    Object.freeze([corner(0.25)]),
    Object.freeze([Object.freeze([0.34, 0.28]), corner(0.5)]),
    Object.freeze([corner(0.5)]),
]);
/** The crow that flies only with the type in the phone's narrower corner: right of its short top lines, left of the moon. */
const EXTRA = Object.freeze({ x: 766, y: 179, size: 0.28 });
/** Where the six fliers and the extra crow are with the type in each of ROOMS: as drawn, or three above, beside and below the moon; null where one isn't. */
const MOVED = { 0: [944, -82], 2: [1210, -104], 4: [903, 418] };
const PHONE = FLIERS.map((f, i) => (MOVED[i] ? { ...f, x: MOVED[i][0], y: MOVED[i][1] } : f));
export const ARRANGEMENTS = Object.freeze([
    Object.freeze([...FLIERS, null]),
    Object.freeze([...PHONE, EXTRA]),
    Object.freeze([...PHONE, null]),
]);

/** Lines of the street for the pen, each drawn down or left to right and as heavy as klein drew it: the thin black ones and the white ones cut into the black. */
const strokes = (lines) => lines.map(({ pts, ends, w }) => ({ c: through(pts), kind: 'detail', ends, w }));
export const roofInk = () => strokes(ROOF_INK);
export const roofPaper = () => strokes(ROOF_PAPER);

/** A closed potrace path (M, C and L) as one chain of cubic Béziers for the pen. */
function chainOf(d) {
    const c = [];
    let at = null;
    for (const [, op, args] of d.matchAll(/([MCLZ])([^MCLZ]*)/g)) {
        const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (op === 'M') {
            if (at) break;
            at = [n[0], n[1]];
            c.push(...at);
        } else if (op === 'C') {
            c.push(...n);
            at = [n[4], n[5]];
        } else if (op === 'L') {
            const [x, y] = n;
            c.push(at[0] + (x - at[0]) / 3, at[1] + (y - at[1]) / 3, at[0] + (2 * (x - at[0])) / 3, at[1] + (2 * (y - at[1])) / 3, x, y);
            at = [x, y];
        }
    }
    return c;
}

/**
 * The crows' motion, apart from drawing. Fliers beat through the six poses of a wingbeat, bob as their wings come down,
 * drift slowly round their places and now and then glide; the perched crow mostly sits, looks round now and then, and
 * once in a while caws twice.
 */
export function createFlock(seed = 10) {
    const rand = seeded(seed);
    const crowAt = (f) => ({
        ...f,
        phase: rand(),
        period: BEAT * (0.8 + rand() * 0.45),
        drift: { ax: 0.05 + rand() * 0.05, ay: 0.03 + rand() * 0.03, px: 5 + rand() * 4, py: 4 + rand() * 4, ox: rand() * 6.3, oy: rand() * 6.3 },
        glideIn: 4 + rand() * 10,
        gliding: 0,
        away: false,
    });
    const crows = FLIERS.map(crowAt);
    const perched = { pose: 0, at: 0, next: 3 + rand() * 4, cawIn: 9 + rand() * 9, steps: [] };
    // the extra crow flies only with the type in the phone's narrower corner
    crows.push({ ...crowAt(EXTRA), away: true });
    let clock = 0;

    const pose = (c) => (c.gliding > 0 ? 2 : Math.floor(c.phase * 6) % 6);

    function stepCrow(c, dt) {
        if (c.gliding > 0) {
            c.gliding -= dt;
            return;
        }
        const before = pose(c);
        c.phase = (c.phase + dt / c.period) % 1;
        c.glideIn -= dt;
        // a glide starts as the wings come level, and holds them there
        if (c.glideIn <= 0 && before !== 2 && pose(c) === 2) {
            c.gliding = 0.7 + rand() * 0.9;
            c.glideIn = 6 + rand() * 10;
        }
    }

    function stepPerched(dt) {
        perched.at += dt;
        if (perched.steps.length) {
            if (perched.at >= perched.steps[0][1]) {
                perched.at = 0;
                perched.steps.shift();
                perched.pose = perched.steps.length ? perched.steps[0][0] : 0;
            }
            return;
        }
        perched.cawIn -= dt;
        if (perched.cawIn <= 0) {
            perched.cawIn = 12 + rand() * 14;
            perched.steps = [[2, 0.22], [0, 0.14], [2, 0.24], [0, 0.4]];
        } else if (perched.at >= perched.next) {
            perched.steps = [[1, 0.8 + rand() * 1.4], [0, 0.3]];
            perched.next = 3 + rand() * 6;
        } else {
            return;
        }
        perched.at = 0;
        perched.pose = perched.steps[0][0];
    }

    return {
        crows,
        perched,
        pose,
        /** Where a flier is now: its place in the drawing, bobbing with its wings and drifting slowly round. */
        place(c) {
            const length = BODY * c.size;
            const bob = c.gliding > 0 ? 0 : -0.045 * length * Math.sin(2 * Math.PI * (c.phase - 0.1));
            const d = c.drift;
            return {
                x: c.x + d.ax * length * Math.sin((2 * Math.PI * clock) / d.px + d.ox),
                y: c.y + bob + d.ay * length * Math.sin((2 * Math.PI * clock) / d.py + d.oy),
            };
        },
        advance(dt) {
            clock += dt;
            crows.forEach(c => stepCrow(c, dt));
            stepPerched(dt);
        },
        /** Moves each crow to its place in one of ARRANGEMENTS, where it is in its wingbeat kept; one with no place is away. */
        arrange(places) {
            crows.forEach((c, i) => {
                c.away = !places[i];
                if (places[i]) [c.x, c.y] = [places[i].x, places[i].y];
            });
        },
    };
}

defineFigure('october', (ctx) => {
    const { el: host, document, signal } = ctx;
    host.setAttribute('aria-hidden', 'true');
    const svg = svgEl(document, 'svg', {
        viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`, width: '100%', height: '100%',
        preserveAspectRatio: 'xMidYMax meet', class: 'october-svg',
    });
    const ink = { fill: 'currentColor', 'fill-rule': 'evenodd' };
    const spot = { fill: 'var(--color-figure-spot)', 'fill-rule': 'evenodd' };
    svg.append(
        // what is lit goes under the ink, so the pumpkins' faces and the lamp's frame are drawn over their light
        svgEl(document, 'path', { d: LIT, ...spot }),
        svgEl(document, 'path', { d: ROOFS, ...ink }),
        svgEl(document, 'path', { d: roofInk().map(s => strokePath(s, LINE)).join(''), ...ink }),
        // a line inside a black is cut in paper, a little lighter, since white on black reads heavier
        svgEl(document, 'path', { d: roofPaper().map(s => strokePath(s, LINE * 0.8)).join(''), fill: 'var(--color-card-background)' }),
        svgEl(document, 'path', { d: MOON, ...spot }),
        svgEl(document, 'path', { d: strokePath({ c: chainOf(MOON), kind: 'contour', ends: 'jj', closed: true }, LINE), ...ink }),
    );
    // a crow is its black shape with the white lines between its feathers cut in it with the pen
    const drawn = (poses, line) => poses.map(({ shape, lines }) => ({ shape, lines: strokes(lines).map(s => strokePath(s, line * 0.8)).join('') }));
    const wingbeat = drawn(WINGBEAT, FLIER_LINE);
    const perchPoses = drawn(PERCHED, LINE);
    const crow = (pose) => {
        const g = svgEl(document, 'g');
        g.append(svgEl(document, 'path', { d: pose.shape, ...ink }), svgEl(document, 'path', { d: pose.lines, fill: 'var(--color-card-background)' }));
        return g;
    };
    const show = (g, pose) => {
        g.firstChild.setAttribute('d', pose.shape);
        g.lastChild.setAttribute('d', pose.lines);
    };
    const flock = createFlock();
    // the crows keep out of the corner the cover's layout left for the type
    let arrangement = -1;
    const arrange = (room) => {
        const a = Number.isInteger(room) && ARRANGEMENTS[room] ? room : 0;
        if (a === arrangement) return false;
        arrangement = a;
        flock.arrange(ARRANGEMENTS[a]);
        return true;
    };
    arrange(ctx.room?.());
    const perch = crow(perchPoses[0]);
    const fliers = flock.crows.map(() => crow(wingbeat[0]));
    svg.append(perch, ...fliers);
    host.append(svg);
    const shown = fliers.map(() => -1);
    let perchShown = 0;

    function draw() {
        flock.crows.forEach((c, i) => {
            const g = fliers[i];
            if (c.away) {
                g.remove();
                return;
            }
            if (!g.parentNode) svg.append(g);
            const pose = flock.pose(c);
            if (pose !== shown[i]) {
                show(g, wingbeat[pose]);
                shown[i] = pose;
            }
            const { x, y } = flock.place(c);
            g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${c.size})`);
        });
        if (flock.perched.pose !== perchShown) {
            perchShown = flock.perched.pose;
            show(perch, perchPoses[perchShown]);
        }
    }

    createLoop({ el: host, document, signal, tick: (dt) => { flock.advance(dt); draw(); } });
    ctx.onRoom?.((room) => { if (arrange(room)) draw(); });
    draw();

    return {
        /** Runs the crows forward by `seconds` and draws; for stepping a still page by hand. */
        advance(seconds) {
            for (let t = 0; t < seconds; t += 1 / 60) flock.advance(1 / 60);
            draw();
        },
    };
}, { spot: true, cover: { rooms: ROOMS, aspect: VIEW.width / VIEW.height } });
