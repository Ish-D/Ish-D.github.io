/**
 * An old man in the rain under an umbrella, smoking a pipe, in a rectangle with the
 * rain falling inside it. The rain runs off his umbrella and drips from its rim, the smoke
 * from his pipe gathers under it, and he looks at the pointer wherever it is on the page.
 *
 *   [[viz(type: umbrella, place: gutter, width: 200, height: 270, wrap: box)]]
 *
 * Optional: ground (how far down he stands, 0 to 1, default 0.93), size (1 fills the
 * rectangle), rain (1 is a steady shower).
 */

import { defineFigure } from '../runtime/figures.js';
import { createLoop } from '../runtime/loop.js';
import { el as svgEl, seeded } from '../runtime/svg.js';
import { createMan, gazeToward, EXTENT } from './umbrella-man.js';
import { createRain, createWind } from './rain.js';
import { createSmoke, LIFE as SMOKE_LIFE } from './smoke.js';

/** Where he looks when nobody is pointing at anything: now at the rain, now at the umbrella, now ahead. */
const GLANCES = [{ x: 0, y: 0.1 }, { x: -0.6, y: -0.5 }, { x: 0.7, y: -0.4 }, { x: 0.2, y: -0.9 }, { x: -0.8, y: 0.1 }];
const WARM_SECONDS = 2;

/** What he and his umbrella take up, in his own units, for fitting him into the rectangle. */
const FIGURE = { width: EXTENT.right - EXTENT.left, height: 10 - EXTENT.top, centre: EXTENT.centre };

defineFigure('umbrella', (ctx) => {
    const { el: host, document, signal } = ctx;
    const win = document.defaultView;
    const param = (name, fallback) => {
        const value = ctx.params[name] === undefined || ctx.params[name] === '' ? NaN : Number(ctx.params[name]);
        return Number.isFinite(value) ? value : fallback;
    };
    const groundAt = param('ground', 0.93);
    const size = param('size', 1);
    const strength = param('rain', 1);

    host.classList.add('umbrella');
    host.setAttribute('aria-hidden', 'true');
    const svg = svgEl(document, 'svg', { class: 'umbrella-svg' });
    const canvas = document.createElement('canvas');
    canvas.className = 'umbrella-rain';
    host.append(svg, canvas);
    const g = canvas.getContext('2d');

    const man = createMan(document, svg);
    const wind = createWind();
    const rand = seeded(3);
    let rain = null;
    let smoke = null;
    let roof = null;
    let colors = ctx.theme();
    let W = 0;
    let H = 0;
    let scale = 1;
    let dpr = 1;
    let windNow = 0;

    function shapes() {
        return { ground: H * groundAt, hit: (x, y) => man.hit(x, y), tips: man.tips() };
    }

    /** Fits the rectangle: the man stands near the bottom, as large as it allows, and the rain and smoke are sized to match. */
    function fit() {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (!w || !h) return false;
        const sized = w !== W || h !== H;
        W = w;
        H = h;
        scale = Math.min((W * 0.86) / FIGURE.width, (H * (groundAt - 0.04)) / FIGURE.height) * size;
        dpr = Math.min(2, win.devicePixelRatio || 1);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        if (sized) {
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
        }
        man.place({ x: W / 2 - FIGURE.centre * scale, y: H * groundAt, scale });
        const fall = Math.max(0.6, Math.min(1.4, H / 420));
        roof = man.underside();
        if (rain) {
            rain.resize(W, H, shapes(), fall);
            smoke.resize(scale, roof.centre);
        } else {
            rain = createRain({ width: W, height: H, shapes: shapes(), density: 2.6 * strength, speed: fall });
            smoke = createSmoke({
                source: () => man.bowl(),
                ceiling: (x) => roof.at(x),
                centre: roof.centre,
                scale,
            });
            rain.warm(WARM_SECONDS, windNow);
            smoke.warm(WARM_SECONDS + 1, windNow);
        }
        return true;
    }

    /** Everything is drawn in the ink of the page, at full strength; the weight of a mark is its width, not a paler colour. */
    function draw() {
        if (!rain || !g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        g.lineCap = 'round';
        g.strokeStyle = colors.ink;
        g.fillStyle = colors.ink;

        g.lineWidth = 0.8;
        for (const r of rain.ripples) {
            const u = r.age / r.life;
            const rx = (1.5 + u * 11) * scale;
            if (u > 0.8) continue;
            g.beginPath();
            g.ellipse(r.x, r.y, rx, rx * 0.28, 0, 0, Math.PI * 2);
            g.stroke();
        }

        for (const d of rain.drops) {
            const vx = windNow * d.drift;
            const speed = Math.hypot(vx, d.vy);
            g.lineWidth = d.alpha > 0.7 ? 1.15 : 0.6;
            g.beginPath();
            g.moveTo(d.x, d.y);
            g.lineTo(d.x - (vx / speed) * d.len, d.y - (d.vy / speed) * d.len);
            g.stroke();
        }

        for (const s of rain.splashes) {
            g.beginPath();
            g.arc(s.x, s.y, (0.9 * (1 - s.age / s.life) + 0.25) * Math.max(0.8, scale), 0, Math.PI * 2);
            g.fill();
        }

        g.lineJoin = 'round';
        for (let i = 1; i < smoke.points.length; i++) {
            const a = smoke.points[i - 1];
            const b = smoke.points[i];
            const left = Math.max(0, 1 - (a.age + b.age) / (2 * SMOKE_LIFE));
            g.lineWidth = (0.25 + 1.9 * left ** 0.8) * b.thick * Math.sqrt(Math.max(0.8, scale));
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.stroke();
        }

        g.lineWidth = 1.2;
        for (const d of rain.drips) {
            g.beginPath();
            g.moveTo(d.x, d.y - Math.min(10, d.vy * 0.012));
            g.lineTo(d.x, d.y);
            g.stroke();
        }
        for (const t of rain.tips) {
            if (t.water === 0) continue;
            g.beginPath();
            g.arc(t.x, t.y + 1.5 * scale, (0.7 + 1.8 * (t.water / t.limit)) * Math.max(0.8, scale), 0, Math.PI * 2);
            g.fill();
        }
    }

    // --- where he looks ---
    let pointer = null;
    const gaze = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };
    let clock = 0;
    let glanceAt = 0;
    let blinkAt = 2.5;
    let blinkAge = -1;

    function look(dt) {
        clock += dt;
        if (pointer && !loop.reduced) {
            const box = host.getBoundingClientRect();
            target = gazeToward(man.headCenter(), { x: pointer.x - box.left, y: pointer.y - box.top });
        } else if (!pointer && clock >= glanceAt) {
            target = GLANCES[Math.floor(rand() * GLANCES.length)];
            glanceAt = clock + 2 + rand() * 3;
        }
        const follow = 1 - Math.exp(-dt * 9);
        gaze.x += (target.x - gaze.x) * follow;
        gaze.y += (target.y - gaze.y) * follow;

        let blink = 0;
        if (blinkAge < 0 && clock >= blinkAt) blinkAge = 0;
        if (blinkAge >= 0) {
            blinkAge += dt;
            const u = blinkAge / 0.16;
            if (u >= 1) {
                blinkAge = -1;
                blinkAt = clock + 2.5 + rand() * 3.5;
            } else {
                blink = Math.sin(Math.PI * u);
            }
        }
        man.look(gaze, blink);
    }

    function advance(dt) {
        if (!rain) return;
        windNow = wind.step(dt);
        rain.step(dt, windNow);
        smoke.step(dt, windNow);
        look(dt);
    }

    const loop = createLoop({ el: host, document, signal, tick: (dt) => { advance(dt); draw(); } });

    if (fit()) {
        man.look(gaze, 0);
        draw();
    }
    win.addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true, signal });
    document.documentElement.addEventListener('pointerleave', () => { pointer = null; }, { signal });
    const offResize = ctx.onResize(() => { if (fit()) draw(); });
    const offTheme = ctx.onTheme((next) => { colors = next; draw(); });

    return {
        /** Runs the weather and his eyes forward by `seconds` and draws; for stepping a still page by hand. */
        advance(seconds) {
            for (let t = 0; t < seconds; t += 1 / 60) advance(1 / 60);
            draw();
        },
        dispose() { offResize(); offTheme(); },
    };
});
