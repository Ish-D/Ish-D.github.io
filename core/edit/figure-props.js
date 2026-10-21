/**
 * What can be adjusted on a figure, as data: the choices for each argument,
 * which controls apply to which kind of figure, and how lengths are written.
 * The inspector builds its controls from this.
 */

/** Directives that draw a figure. */
export const FIGURES = ['image', 'viz', 'drawing', 'figure', 'gallery', 'embed'];

export const PLACE_CHOICES = [
    ['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['gutter', 'Seam'],
    ['block', 'Own line'], ['span', 'Span'], ['full', 'Full width'],
];
export const WRAP_CHOICES = [['none', 'None'], ['box', 'Box'], ['circle', 'Circle'], ['ellipse', 'Ellipse']];
export const FIT_CHOICES = [['cover', 'Fill'], ['contain', 'Fit'], ['fill', 'Stretch']];
export const LAYER_CHOICES = [['over', 'Over text'], ['under', 'Under text']];

const CONTROLS = {
    image: ['source', 'place', 'wrap', 'pad', 'size', 'offset', 'fit', 'layer', 'caption'],
    drawing: ['place', 'wrap', 'pad', 'size', 'offset', 'layer', 'caption'],
    viz: ['place', 'wrap', 'pad', 'size', 'offset', 'caption'],
    figure: ['place', 'wrap', 'pad', 'size', 'offset', 'caption'],
    gallery: ['place', 'size', 'offset'],
    embed: ['place', 'wrap', 'pad', 'size', 'offset'],
};

/** Control ids that apply to a directive name. */
export const controlsFor = (name) => CONTROLS[name] ?? [];

/** `220` → 220 px, `50%` → 50 %, `12em` → 12 em; anything else has no number. */
export function splitLength(text) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(px|%|em|rem|pt)?\s*$/.exec(text ?? '');
    return m ? { value: Number(m[1]), unit: m[2] ?? 'px' } : { value: null, unit: 'px' };
}

/** The other way: pixels are written bare, as in the rest of the source. */
export const joinLength = (value, unit) => `${Math.round(value * 100) / 100}${unit === 'px' ? '' : unit}`;

/**
 * Edit that removes a directive and the line break after it.
 * @param {string} source
 * @param {{ start: number, end: number }} node
 */
export function removalOf(source, node) {
    let end = node.end;
    if (source[end] === '\n') end++;
    return { start: node.start, end, text: '' };
}
