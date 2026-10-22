/**
 * A page laid out for paper: the same text, set at a measure and size for a printed sheet, one column,
 * with the margin notes in the margins, and cut into sheets.
 */

import { layoutDocument } from './document.js';
import { createStyles } from './style.js';
import { paginate } from './paginate.js';

/** Sheets of paper, in CSS px (96 to the inch). */
export const PAPER = Object.freeze({
    letter: Object.freeze({ name: 'letter', width: 816, height: 1056, css: '8.5in 11in' }),
    a4: Object.freeze({ name: 'a4', width: 793.7, height: 1122.5, css: '210mm 297mm' }),
});

/** Body size in px, measure in em (the longest a line gets; notes in the margins make it shorter), and the room above and below the text. */
export const SHEET = Object.freeze({ fontSize: 15, measure: 32, titleScale: 2.4, top: 96, bottom: 96 });

/** Setting the page again after notes that did not fit were moved into the text goes on until nothing moves, or this many times. */
const MAX_PASSES = 6;

/** Letter in the places that use it, A4 everywhere else. */
export function paperFor(locale = '') {
    const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
    return ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'CR', 'GT', 'PA', 'DO', 'PR'].includes(region) ? PAPER.letter : PAPER.a4;
}

/**
 * @param {any} doc
 * @param {import('./document.js').LayoutEnv} env   what the page is laid out with on screen
 * @param {typeof PAPER[keyof typeof PAPER]} paper
 */
export function layoutPrint(doc, env, paper) {
    const settings = { ...env.settings, fontSize: SHEET.fontSize, width: SHEET.measure, titleScale: SHEET.titleScale, titleAlign: 'left' };
    const onPaper = { ...env, print: { notes: hasMarginNotes(doc) }, width: paper.width, settings, expandedNotes: undefined, editing: null };
    // the room on a sheet is a whole number of lines, so every sheet's lines sit on the same grid
    const lineHeight = createStyles(settings).lineHeight;
    const room = Math.floor((paper.height - SHEET.top - SHEET.bottom) / lineHeight) * lineHeight;

    let inline = new Set();
    for (let pass = 0; ; pass++) {
        const layout = layoutDocument(doc, { ...onPaper, inlineNotes: inline });
        const cut = paginate(layout.blocks, { height: room });
        const final = pass >= MAX_PASSES;
        const placed = placeOnSheets(layout.sheetNotes, cut, room, final);
        const moved = [...placed.inline].filter(note => !inline.has(note));
        if (moved.length === 0 || final) {
            const sheets = cut.map((sheet, k) => ({ ...sheet, items: fitFigures(sheet.items, room), notes: placed.bySheet[k] }));
            return { paper, layout, room, margins: { top: SHEET.top, bottom: SHEET.bottom }, sheets };
        }
        inline = new Set([...inline, ...moved]);
    }
}

/** Whether the page has any note to put in a margin. */
function hasMarginNotes(node) {
    if (node.type === 'directive' && (node.name === 'note' || node.name === 'margin')) return true;
    return (node.children ?? []).some(hasMarginNotes) || (node.groups ?? []).some(g => (g.children ?? []).some(hasMarginNotes));
}

/**
 * Each note goes on the sheet its anchor is on, and is placed there with the sheet's own top and bottom. Notes that
 * do not fit come back in `inline`. On the last pass nothing is left out, whatever it costs in distance.
 */
function placeOnSheets({ candidates, place }, cut, room, loose) {
    const own = cut.map(() => []);
    for (const c of candidates) own[sheetAt(cut, c.anchor.y)].push(c);
    const inline = new Set();
    const bySheet = cut.map((sheet, k) => {
        const here = own[k].map(c => ({ ...c, anchor: { x: c.anchor.x, y: c.anchor.y - sheet.top } }));
        const done = place(here, { height: room, loose });
        for (const note of done.inline) inline.add(note);
        return done.placed;
    });
    return { bySheet, inline };
}

/** The sheet a line of the page ended up on. */
function sheetAt(cut, y) {
    const k = cut.findIndex(sheet => y < sheet.bottom - 0.5);
    return k === -1 ? cut.length - 1 : k;
}

/** A figure taller than a sheet is made smaller until it fits. */
function fitFigures(items, room) {
    return items.map(item => {
        if (item.type !== 'object') return item;
        const caption = item.caption ? item.caption.height + (item.caption.y - (item.rect.y + item.rect.height)) : 0;
        const k = (room - caption) / item.rect.height;
        if (k >= 1) return item;
        const width = item.rect.width * k;
        return { ...item, rect: { ...item.rect, x: item.rect.x + (item.rect.width - width) / 2, width, height: item.rect.height * k } };
    });
}
