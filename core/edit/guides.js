/**
 * The lines worth snapping to on the current page, read off the layout. They
 * follow the layout, so on a phone they are the phone's column and on a wide
 * screen the wide one.
 */

import { PAGE } from '../layout/document.js';

/**
 * @param {any} layout
 * @param {{ ignoreObject?: number, ignoreNote?: any }} [skip]   what is being moved (the start of its source / its note)
 * @returns {import('./snap.js').Guides}
 */
export function collectGuides(layout, { ignoreObject = null, ignoreNote = null } = {}) {
    const x = [];
    const y = [];
    const g = layout.geometry;
    const text = g.text;

    x.push({ value: text.x, kind: 'text-left', label: 'Text edge' });
    x.push({ value: text.x + text.width / 2, kind: 'text-center', label: 'Centre' });
    x.push({ value: text.x + text.width, kind: 'text-right', label: 'Text edge' });
    x.push({ value: layout.width / 2, kind: 'page-center', label: 'Page centre' });
    if (!g.narrow) {
        x.push({ value: g.left.x, kind: 'margin', label: 'Margin' }, { value: g.left.x + g.left.width, kind: 'margin', label: 'Margin' });
        x.push({ value: g.right.x, kind: 'margin', label: 'Margin' }, { value: g.right.x + g.right.width, kind: 'margin', label: 'Margin' });
    }
    y.push({ value: PAGE.topPad, kind: 'page-top', label: 'Top' });

    for (const item of layout.blocks) {
        if (item.type === 'region' && item.kind === 'columns') {
            item.columns.forEach((c, i) => {
                x.push({ value: c.x, kind: 'column', label: 'Column edge', from: item.y, to: item.y + item.height });
                x.push({ value: c.x + c.width / 2, kind: 'column-center', label: 'Column centre', from: item.y, to: item.y + item.height });
                x.push({ value: c.x + c.width, kind: 'column', label: 'Column edge', from: item.y, to: item.y + item.height });
                const next = item.columns[i + 1];
                if (next) x.push({ value: (c.x + c.width + next.x) / 2, kind: 'seam', label: 'Seam', from: item.y, to: item.y + item.height });
            });
        } else if (item.type === 'object' && item.node?.start !== ignoreObject) {
            const r = item.rect;
            const span = { from: r.y, to: r.y + r.height };
            x.push({ value: r.x, kind: 'object', label: 'Figure', ...span }, { value: r.x + r.width / 2, kind: 'object-center', label: 'Figure centre', ...span }, { value: r.x + r.width, kind: 'object', label: 'Figure', ...span });
            const across = { from: r.x, to: r.x + r.width };
            y.push({ value: r.y, kind: 'object', label: 'Figure', ...across }, { value: r.y + r.height / 2, kind: 'object-center', label: 'Figure centre', ...across }, { value: r.y + r.height, kind: 'object', label: 'Figure', ...across });
        } else if ((item.type === 'paragraph' || item.type === 'heading') && item.lines?.length) {
            const across = { from: item.x, to: item.x + item.width };
            y.push({ value: item.top, kind: 'block', label: 'Text', ...across }, { value: item.bottom, kind: 'block', label: 'Text', ...across });
        }
    }
    for (const note of layout.notes) {
        if (note === ignoreNote) continue;
        const across = { from: note.x, to: note.x + note.width };
        y.push({ value: note.y, kind: 'note', label: 'Note', ...across }, { value: note.y + note.height, kind: 'note', label: 'Note', ...across });
    }
    return { x, y };
}

/** Widths worth snapping a figure to, as fractions of the text column. */
export const WIDTH_FRACTIONS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1];

/**
 * The column a box at `rect` sits in: the one of a columns block it overlaps most, else the text column.
 * Percentages in a figure's arguments are shares of this.
 */
export function columnOf(layout, rect) {
    let best = null;
    for (const item of layout.blocks) {
        if (item.type !== 'region' || item.kind !== 'columns') continue;
        if (rect.y + rect.height < item.y || rect.y > item.y + item.height) continue;
        for (const c of item.columns) {
            const overlap = Math.min(rect.x + rect.width, c.x + c.width) - Math.max(rect.x, c.x);
            if (overlap > 0 && (!best || overlap > best.overlap)) best = { ...c, overlap };
        }
    }
    return best ? { x: best.x, width: best.width } : { x: layout.geometry.text.x, width: layout.geometry.text.width };
}
