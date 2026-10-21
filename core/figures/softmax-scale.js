/**
 * Why attention divides by sqrt(d_k): with unit-variance queries and keys the
 * raw dot products have variance d_k, so the softmax collapses onto one token
 * as d_k grows. Scaling by 1/sqrt(d_k) keeps the scores at unit variance.
 *
 * Reads the article variable named by `var` (default `dk`).
 *   [[viz(type: softmax-scale, var: dk, tokens: 8, height: 300)]]
 */

import { defineFigure } from '../runtime/figures.js';
import { canvas, scale, seeded } from '../runtime/svg.js';

const MAX_DK = 1024;

export function softmax(values) {
    const top = Math.max(...values);
    const exps = values.map(v => Math.exp(v - top));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
}

export function entropy(probs) {
    return -probs.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
}

/**
 * Raw scores q.k_i for one query and `tokens` keys. The random pool is fixed,
 * so changing d_k only adds or removes components and the figure moves smoothly.
 */
export function makeScores(dk, tokens, seed = 7) {
    const rand = seeded(seed);
    const q = Array.from({ length: MAX_DK }, () => rand.normal());
    const keys = Array.from({ length: tokens }, () => Array.from({ length: MAX_DK }, () => rand.normal()));
    return keys.map(k => {
        let dot = 0;
        for (let i = 0; i < dk; i++) dot += q[i] * k[i];
        return dot;
    });
}

defineFigure('softmax-scale', (ctx) => {
    const { document, store, el } = ctx;
    const name = ctx.params.var ?? 'dk';
    const tokens = Number(ctx.params.tokens ?? 8);
    const W = 360;
    const H = 300;
    el.style.display = 'block';
    const c = canvas(document, el, W, H);

    const draw = (colors, dk) => {
        c.clear();
        const raw = makeScores(dk, tokens);
        const rows = [
            { label: 'softmax(q·k)', probs: softmax(raw), color: colors.accent, top: 46 },
            { label: 'softmax(q·k / √d', suffix: 'k', probs: softmax(raw.map(s => s / Math.sqrt(dk))), color: colors.accent2, top: 186 },
        ];
        const bandHeight = 88;
        const x = scale([0, tokens], [34, W - 14]);
        const barW = (x(1) - x(0)) * 0.7;

        c.draw.text({ x: W - 14, y: 16, fill: colors.accent, 'font-size': 13, 'text-anchor': 'end' }, `d_k = ${dk}`);
        for (const row of rows) {
            const y = scale([0, 1], [row.top + bandHeight, row.top]);
            c.draw.line({ x1: 34, x2: W - 14, y1: row.top + bandHeight, y2: row.top + bandHeight, stroke: colors.rule, 'stroke-width': 1 });
            row.probs.forEach((p, i) => {
                c.draw.rect({
                    x: x(i) + (x(1) - x(0) - barW) / 2, y: y(p), width: barW, height: Math.max(0.5, row.top + bandHeight - y(p)),
                    fill: row.color, opacity: 0.9, rx: 1.5,
                });
            });
            const top = Math.max(...row.probs);
            c.draw.text({ x: 34, y: row.top - 8, fill: colors.ink, 'font-size': 12 }, row.suffix ? `${row.label}_${row.suffix})` : row.label);
            c.draw.text({ x: W - 14, y: row.top - 8, fill: colors.muted, 'font-size': 11, 'text-anchor': 'end' },
                `largest ${top.toFixed(2)}  ·  entropy ${entropy(row.probs).toFixed(2)} of ${Math.log2(tokens).toFixed(2)} bits`);
            [0, 0.5, 1].forEach(tick => {
                c.draw.text({ x: 28, y: y(tick) + 3.5, fill: colors.muted, 'font-size': 9, 'text-anchor': 'end' }, tick);
            });
        }
    };

    let colors = ctx.theme();
    const stop = store.subscribe(name, (dk) => draw(colors, Math.round(dk)));
    const offTheme = ctx.onTheme((next) => { colors = next; draw(colors, Math.round(store.peek(name))); });
    return { dispose() { stop(); offTheme(); } };
});
