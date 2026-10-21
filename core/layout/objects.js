/**
 * Placement and text-wrap for objects (images, figures, drawings, widgets).
 *
 * `place` says where an object goes, `wrap` says what text does around it:
 *
 *   place: inline | block | left | right | center | gutter | span | full
 *        | margin-left | margin-right | margin-top | margin-bottom | at(x, y)
 *   wrap:  none | box | circle | ellipse | polygon(x y, ...) | contour
 */

import { parseValue, resolveLength, callName, listItems } from './values.js';
import * as geometry from './geometry.js';

/**
 * @typedef {Object} PlaceSpec
 * @property {'inline' | 'block' | 'left' | 'right' | 'center' | 'gutter' | 'span' | 'full' | 'margin' | 'at'} kind
 * @property {'left' | 'right' | 'top' | 'bottom'} [side]       margin placements
 * @property {import('./values.js').Value[]} [at]                 at(x, y) arguments
 */

/**
 * @typedef {Object} WrapSpec
 * @property {'none' | 'box' | 'circle' | 'ellipse' | 'polygon' | 'contour'} kind
 * @property {import('./values.js').Value[]} args
 */

const PLACE_KEYWORDS = new Set(['inline', 'block', 'left', 'right', 'center', 'gutter', 'span', 'full']);
const WRAP_KEYWORDS = new Set(['none', 'box', 'circle', 'ellipse', 'contour']);

/** @returns {PlaceSpec} unknown input falls back to a plain block */
export function parsePlace(text, fallback = 'block') {
    const value = parseValue(text);
    if (!value) return { kind: fallback };
    if (value.type === 'keyword') {
        if (PLACE_KEYWORDS.has(value.name)) return { kind: value.name };
        const m = /^margin-(left|right|top|bottom)$/.exec(value.name);
        if (m) return { kind: 'margin', side: m[1] };
        if (value.name === 'margin') return { kind: 'margin', side: 'right' };
    }
    if (callName(value) === 'at') return { kind: 'at', at: value.args };
    return { kind: fallback };
}

/** @returns {WrapSpec} */
export function parseWrap(text, fallback = 'none') {
    const value = parseValue(text);
    if (!value) return { kind: fallback, args: [] };
    if (value.type === 'keyword' && WRAP_KEYWORDS.has(value.name)) return { kind: value.name, args: [] };
    const name = callName(value);
    if (name === 'circle' || name === 'ellipse' || name === 'polygon') return { kind: name, args: value.args };
    return { kind: fallback, args: [] };
}

const SIZE_PRESETS = { small: 0.33, medium: 0.5, large: 0.75, full: 1 };

/**
 * Width and height in px.
 * @param {{ width?: string, height?: string, size?: string, aspect?: string }} params
 * @param {{ basis: number, em: number }} ctx           basis = width available to the object
 * @param {{ width: number, height: number } | null} natural   intrinsic size when known
 * @param {{ defaultWidth?: number }} [defaults]        fraction of basis used when nothing else decides
 */
export function resolveSize(params, { basis, em }, natural = null, defaults = {}) {
    const wv = parseValue(params.width);
    const hv = parseValue(params.height);
    const preset = SIZE_PRESETS[parseValue(params.size)?.name];
    const aspectValue = parseValue(params.aspect);
    let aspect = null;
    if (aspectValue?.type === 'number') aspect = aspectValue.value;
    else if (aspectValue?.type === 'list' && aspectValue.items.length === 2) aspect = aspectValue.items[0].value / aspectValue.items[1].value;
    else if (natural && natural.height > 0) aspect = natural.width / natural.height;

    let width = resolveLength(wv, { em, basis, fallback: null });
    let height = resolveLength(hv, { em, basis, fallback: null });
    if (width === null && preset) width = preset * basis;
    if (width === null && height !== null && aspect) width = height * aspect;
    if (width === null) {
        const fraction = defaults.defaultWidth ?? 1;
        width = natural ? Math.min(natural.width, basis * fraction) : basis * fraction;
    }
    width = Math.min(width, basis);
    if (height === null) height = aspect ? width / aspect : (natural ? natural.height * (width / natural.width) : width * 0.625);
    return { width, height };
}

/**
 * Rectangle for a float-like placement.
 * @param {PlaceSpec} place
 * @param {{ width: number, height: number }} size
 * @param {Object} geom
 * @param {import('./slots.js').Column[]} geom.columns
 * @param {number} geom.columnIndex
 * @param {number} geom.cursorY
 * @param {{ x: number, width: number }} geom.container
 * @param {{ x: number, width: number }} geom.page
 * @param {number} geom.em
 * @param {{ dx?: number, dy?: number }} [nudge]
 */
export function placeRect(place, size, geom, nudge = {}) {
    const { columns, columnIndex, cursorY, container, page, em } = geom;
    const col = columns[Math.min(columnIndex, columns.length - 1)];
    const { width, height } = size;
    const dx = nudge.dx ?? 0;
    const dy = nudge.dy ?? 0;
    let x;
    let y = cursorY + dy;
    let w = width;

    switch (place.kind) {
        case 'left': x = col.x + dx; break;
        case 'right': x = col.x + col.width - w - dx; break;
        case 'gutter': {
            const k = columns.length > 1 ? Math.min(columnIndex, columns.length - 2) : -1;
            if (k < 0) { x = col.x + (col.width - w) / 2 + dx; break; }
            const seam = (columns[k].x + columns[k].width + columns[k + 1].x) / 2;
            x = seam - w / 2 + dx;
            break;
        }
        case 'span': x = container.x + dx; w = container.width; break;
        case 'full': x = page.x + dx; w = page.width; break;
        case 'at': {
            const [ax, ay] = place.at ?? [];
            x = col.x + resolveLength(ax, { em, basis: col.width, fallback: 0 }) + dx;
            y = cursorY + resolveLength(ay, { em, basis: col.width, fallback: 0 }) + dy;
            break;
        }
        case 'center':
        case 'block':
        default:
            x = col.x + (col.width - w) / 2 + dx;
    }
    return { x, y, width: w, height };
}

/**
 * Shape that text must avoid, or null for `wrap: none`.
 * `extras.mask` supplies a contour as { rows, rowHeight } relative to the rect.
 * @param {WrapSpec} wrap
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {number} pad
 * @param {{ em?: number, mask?: { rows: Array<[number, number] | null>, rowHeight: number } | null }} [extras]
 */
export function wrapShape(wrap, rect, pad, extras = {}) {
    const { x, y, width: w, height: h } = rect;
    const em = extras.em ?? 16;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const basis = Math.min(w, h);

    switch (wrap.kind) {
        case 'none':
            return null;
        case 'circle': {
            const r = resolveLength(wrap.args[0], { em, basis, fallback: basis / 2 });
            return geometry.circle(cx, cy, r, pad);
        }
        case 'ellipse': {
            const rx = resolveLength(wrap.args[0], { em, basis: w, fallback: w / 2 });
            const ry = resolveLength(wrap.args[1], { em, basis: h, fallback: h / 2 });
            return geometry.ellipse(cx, cy, rx, ry, pad);
        }
        case 'polygon': {
            const points = wrap.args.map(arg => {
                const [px, py] = listItems(arg);
                return [x + resolveLength(px, { em, basis: w, fallback: 0 }), y + resolveLength(py, { em, basis: h, fallback: 0 })];
            });
            if (points.length >= 3) return geometry.polygon(points, pad);
            return geometry.rect(x, y, w, h, pad);
        }
        case 'contour':
            if (extras.mask && extras.mask.rows.length) return geometry.mask(x, y, extras.mask.rows, extras.mask.rowHeight, pad);
            return geometry.ellipse(cx, cy, w / 2, h / 2, pad);
        case 'box':
        default:
            return geometry.rect(x, y, w, h, pad);
    }
}
