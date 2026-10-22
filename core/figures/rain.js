/**
 * Rain falling on a man with an umbrella: drops, the splashes they make, the ripples
 * where they land, and the water that gathers on the umbrella and drips off its rim.
 *
 * State and arithmetic only; the figure draws it. Units are px and seconds in the
 * figure's own coordinates, y down.
 */

import { seeded } from '../runtime/svg.js';

const GRAVITY = 1500;
/** Ripples on the ground are capped so a downpour stays cheap to draw. */
const MAX_RIPPLES = 220;
const MAX_SPLASHES = 220;

/**
 * @typedef {Object} Shapes
 * @property {number} ground                                    y of the ground the man stands on
 * @property {(x: number, y: number) => 'canopy' | 'body' | null} hit   what the point is inside, if anything
 * @property {{ x: number, y: number }[]} tips                  where water drips from the umbrella
 */

/**
 * @param {Object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {Shapes} options.shapes
 * @param {number} [options.density]   drops per second for each px of width
 * @param {number} [options.speed]     1 is a fall of about 800 px/s; smaller figures fall slower
 * @param {number} [options.seed]
 */
export function createRain({ width, height, shapes, density = 0.4, speed = 1, seed = 11 }) {
    const rand = seeded(seed);
    const between = (a, b) => a + (b - a) * rand();

    const drops = [];
    const splashes = [];
    const ripples = [];
    const drips = [];
    let tips = [];
    let spawnDebt = 0;
    let w = width;
    let h = height;
    let shape = shapes;
    let pace = speed;

    const makeTips = (points) => points.map(p => ({ x: p.x, y: p.y, water: 0, limit: between(3, 7) }));
    tips = makeTips(shape.tips);

    /** How far in front of and behind the man's feet a drop can land, which is what gives the ground depth. */
    const landDepth = () => Math.min(90, h * 0.12);

    function spawnDrop() {
        const fall = between(760, 1120) * pace;
        drops.push({
            x: between(-0.15 * w, 1.15 * w),
            y: -30,
            vy: fall,
            len: fall * between(0.04, 0.066),
            drift: between(0.8, 1.2),
            land: shape.ground + between(-0.6, 0.4) * landDepth(),
            alpha: between(0.35, 1),
        });
    }

    function splash(x, y, count, power) {
        for (let i = 0; i < count && splashes.length < MAX_SPLASHES; i++) {
            splashes.push({
                x, y,
                vx: between(-90, 90) * power,
                vy: -between(70, 190) * power,
                age: 0,
                life: between(0.22, 0.42),
            });
        }
    }

    function ripple(x, y) {
        if (ripples.length < MAX_RIPPLES) ripples.push({ x, y, age: 0, life: between(0.45, 0.75) });
    }

    /** Water that lands on the umbrella runs to the nearest point of the rim. */
    function feed(x) {
        let best = null;
        for (const t of tips) if (!best || Math.abs(t.x - x) < Math.abs(best.x - x)) best = t;
        if (!best) return;
        best.water += 1;
        if (best.water >= best.limit) {
            drips.push({ x: best.x, y: best.y + 2, vy: 30 });
            best.water = 0;
            best.limit = between(3, 7);
        }
    }

    const remove = (list, i) => { list[i] = list[list.length - 1]; list.pop(); };

    return {
        drops, splashes, ripples, drips,
        get tips() { return tips; },

        /** Moves everything on by `dt` seconds with the wind pushing sideways at `wind` px/s. */
        step(dt, wind = 0) {
            spawnDebt += density * w * dt;
            while (spawnDebt >= 1) { spawnDebt -= 1; spawnDrop(); }

            for (let i = drops.length - 1; i >= 0; i--) {
                const d = drops[i];
                const px = d.x;
                const py = d.y;
                d.x += wind * d.drift * dt;
                d.y += d.vy * dt;
                const hit = shape.hit(d.x, d.y) ?? shape.hit((px + d.x) / 2, (py + d.y) / 2);
                if (hit === 'canopy') {
                    if (rand() < 0.6) splash(d.x, d.y, 1, 0.7);
                    feed(d.x);
                    remove(drops, i);
                } else if (hit === 'body') {
                    splash(d.x, d.y, 2, 0.5);
                    remove(drops, i);
                } else if (d.y >= d.land) {
                    if (rand() < 0.4) ripple(d.x, d.land);
                    remove(drops, i);
                }
            }

            for (let i = drips.length - 1; i >= 0; i--) {
                const d = drips[i];
                d.vy += GRAVITY * dt;
                d.y += d.vy * dt;
                if (d.y >= shape.ground + between(-4, 14)) {
                    ripple(d.x, shape.ground + between(0, 8));
                    splash(d.x, shape.ground, 2, 0.45);
                    remove(drips, i);
                }
            }

            for (let i = splashes.length - 1; i >= 0; i--) {
                const s = splashes[i];
                s.age += dt;
                s.vy += 900 * dt;
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                if (s.age >= s.life) remove(splashes, i);
            }

            for (let i = ripples.length - 1; i >= 0; i--) {
                ripples[i].age += dt;
                if (ripples[i].age >= ripples[i].life) remove(ripples, i);
            }
        },

        /** Runs the rain ahead without drawing, so a figure starts in the middle of a shower. */
        warm(seconds, wind = 0, dt = 1 / 60) {
            for (let t = 0; t < seconds; t += dt) this.step(dt, wind);
        },

        /** The figure changed size or the man moved: new bounds and new shapes. Drops in flight carry on. */
        resize(width, height, shapes, speed = pace) {
            w = width;
            h = height;
            shape = shapes;
            pace = speed;
            tips = makeTips(shape.tips);
            for (const d of drops) d.land = shape.ground + between(-0.6, 0.4) * landDepth();
        },
    };
}

/**
 * Wind in px/s: a steady lean, a slow sway, and now and then a gust strong enough to blow
 * rain in under the umbrella. Call `step` once per frame.
 */
export function createWind(seed = 5) {
    const rand = seeded(seed);
    let time = 0;
    let gust = null;
    let next = 2.5 + rand() * 3;
    return {
        step(dt) {
            time += dt;
            if (!gust && time >= next) {
                gust = { start: time, length: 1.1 + rand() * 0.6, power: (rand() < 0.5 ? -1 : 1) * (260 + rand() * 120) };
            }
            let wind = -160 + 55 * Math.sin(time * 0.6) + 40 * Math.sin(time * 1.7 + 1.3);
            if (gust) {
                const u = (time - gust.start) / gust.length;
                if (u >= 1) {
                    gust = null;
                    next = time + 3 + rand() * 4;
                } else {
                    wind += gust.power * Math.sin(Math.PI * u) ** 2;
                }
            }
            return wind;
        },
    };
}
