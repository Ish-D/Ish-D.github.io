/**
 * A thread of pipe smoke: it rises from the bowl, sways, is pushed by the wind, and when it
 * meets the underside of the umbrella it spreads along it and drifts out from under it.
 *
 * State and arithmetic only; the figure draws the points as one line that thins as the smoke
 * ages. Units are px and seconds in the figure's own coordinates, y down.
 */

import { seeded } from '../runtime/svg.js';

/** How long a point of smoke lasts, in seconds. */
export const LIFE = 2.8;
const EMIT_PER_SECOND = 36;
const MAX_POINTS = 160;

/**
 * @param {Object} options
 * @param {() => { x: number, y: number }} options.source   where smoke leaves the pipe now
 * @param {(x: number) => number} options.ceiling   y of the underside of the umbrella at x, or -Infinity when nothing is above
 * @param {number} options.centre                    x the smoke slides away from when it meets the umbrella
 * @param {number} [options.scale]                   size of the figure; speeds and sway scale with it
 * @param {number} [options.seed]
 */
export function createSmoke({ source, ceiling, centre, scale = 1, seed = 17 }) {
    const rand = seeded(seed);
    const points = [];
    let size = scale;
    let middle = centre;
    let clock = 0;
    let owed = 0;
    let puffEnds = 0;
    let nextPuff = 2 + rand() * 2;

    function emit() {
        const at = source();
        points.push({
            x: at.x + (rand() - 0.5) * 0.6,
            y: at.y,
            age: 0,
            phase: clock * 0.9,
            thick: clock < puffEnds ? 1.9 : 1,
            under: false,
        });
        if (points.length > MAX_POINTS) points.shift();
    }

    return {
        points,

        /** Moves the smoke on by `dt` seconds with the wind pushing sideways at `wind` px/s. */
        step(dt, wind = 0) {
            clock += dt;
            if (clock >= nextPuff) {
                puffEnds = clock + 0.7;
                nextPuff = clock + 4 + rand() * 3;
            }
            owed += EMIT_PER_SECOND * dt;
            while (owed >= 1) { owed -= 1; emit(); }

            for (let i = points.length - 1; i >= 0; i--) {
                const p = points[i];
                p.age += dt;
                if (p.age >= LIFE) {
                    points.splice(i, 1);
                    continue;
                }
                const sway = Math.cos(2.6 * p.age + p.phase) * 12 * size * Math.min(1, p.age * 1.2);
                p.x += (sway + wind * 0.08) * dt;
                if (p.under) p.x += (p.x < middle ? -1 : 1) * 14 * size * dt;
                p.y -= (30 - 10 * (p.age / LIFE)) * size * dt;

                const roof = ceiling(p.x);
                if (p.y < roof) {
                    p.y = roof;
                    p.under = true;
                } else if (p.under) {
                    p.under = false;
                }
            }
        },

        /** Runs the smoke ahead without drawing, so a figure starts with a plume already rising. */
        warm(seconds, wind = 0, dt = 1 / 60) {
            for (let t = 0; t < seconds; t += dt) this.step(dt, wind);
        },

        /** The figure changed size: new scale, and the umbrella's middle has moved. Smoke in the air carries on. */
        resize(scale, centre) {
            size = scale;
            middle = centre;
        },
    };
}
