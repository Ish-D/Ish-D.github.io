/**
 * Browser text measurement through a canvas 2D context, and a fixed-width measurer for tests.
 */

import { createBoundedCache } from './cache.js';

/** @typedef {import('../types.js').FontSpec} FontSpec */
/** @typedef {import('../types.js').FontMetrics} FontMetrics */
/** @typedef {import('../types.js').Measurer} Measurer */

/**
 * The parts of CanvasRenderingContext2D the measurer uses.
 * @typedef {Object} MeasureContext
 * @property {string} font
 * @property {string} [fontKerning]
 * @property {string} textBaseline
 * @property {(text: string) => TextMetrics} measureText
 */

const GENERIC_FAMILIES = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
    'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);

// Accented capitals and descenders, for ink-based ascent/descent.
const BOUNDS_SAMPLE = 'ÁÉÅgjpqy';

/**
 * CSS `font` shorthand for a FontSpec, e.g. `italic small-caps 700 16px "MonotypeModern"`.
 * Generic families stay unquoted.
 * @param {FontSpec} font
 */
export function fontToCss(font) {
    const parts = [];
    if (font.style && font.style !== 'normal') parts.push(font.style);
    if (font.smallCaps) parts.push('small-caps');
    const weight = String(font.weight ?? 400);
    if (weight !== '400' && weight !== 'normal') parts.push(weight);
    parts.push(`${font.size}px`);
    parts.push(GENERIC_FAMILIES.has(font.family) ? font.family : `"${font.family.replace(/["\\]/g, '\\$&')}"`);
    return parts.join(' ');
}

/**
 * Measurer over a canvas 2D context: an OffscreenCanvas when available, else a detached
 * <canvas>. Kerning is forced on. Widths are cached per (font, text), up to `cacheSize` entries.
 * Metrics use fontBoundingBox* for ascent/descent (without it, the ink extents of accented
 * capitals and descenders) and the ink tops of 'x' and 'H' for xHeight and capHeight.
 * @param {{ context?: MeasureContext, cacheSize?: number }} [options]  `context` replaces the canvas
 * @returns {Measurer}
 */
export function createCanvasMeasurer({ context = createContext(), cacheSize = 20_000 } = {}) {
    context.textBaseline = 'alphabetic';
    if ('fontKerning' in context) context.fontKerning = 'normal';
    const widths = createBoundedCache(cacheSize);
    const metricsByFont = createBoundedCache(512);

    return {
        width(text, font) {
            const css = fontToCss(font);
            const key = `${css}\n${text}`;
            let width = widths.get(key);
            if (width === undefined) {
                context.font = css;
                width = context.measureText(text).width;
                widths.set(key, width);
            }
            return width;
        },
        metrics(font) {
            const css = fontToCss(font);
            let metrics = metricsByFont.get(css);
            if (metrics === undefined) {
                context.font = css;
                metrics = measureMetrics(context);
                metricsByFont.set(css, metrics);
            }
            return metrics;
        },
    };
}

/**
 * Measurer where every code point is `charWidth` px wide. Metrics scale with font.size:
 * ascent 0.8em, descent 0.2em, xHeight 0.5em, capHeight 0.7em; spaceWidth is charWidth.
 * @param {{ charWidth: number }} options
 * @returns {Measurer}
 */
export function createFixedMeasurer({ charWidth }) {
    if (!(charWidth > 0)) throw new RangeError(`charWidth must be > 0, got ${charWidth}`);
    return {
        width(text) {
            let count = 0;
            for (const _ of text) count++;
            return count * charWidth;
        },
        metrics({ size }) {
            return { ascent: 0.8 * size, descent: 0.2 * size, xHeight: 0.5 * size, capHeight: 0.7 * size, spaceWidth: charWidth };
        },
    };
}

/** @returns {MeasureContext} */
function createContext() {
    let context = null;
    if (typeof OffscreenCanvas === 'function') context = new OffscreenCanvas(1, 1).getContext('2d');
    else if (typeof document === 'object') context = document.createElement('canvas').getContext('2d');
    else throw new Error('createCanvasMeasurer needs OffscreenCanvas or a DOM document; pass `context` instead');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    return context;
}

/** @param {MeasureContext} context @returns {FontMetrics} */
function measureMetrics(context) {
    const space = context.measureText(' ');
    let ascent = space.fontBoundingBoxAscent;
    let descent = space.fontBoundingBoxDescent;
    if (ascent === undefined || descent === undefined) {
        const sample = context.measureText(BOUNDS_SAMPLE);
        ascent = sample.actualBoundingBoxAscent;
        descent = sample.actualBoundingBoxDescent;
    }
    return {
        ascent,
        descent,
        xHeight: context.measureText('x').actualBoundingBoxAscent,
        capHeight: context.measureText('H').actualBoundingBoxAscent,
        spaceWidth: space.width,
    };
}
