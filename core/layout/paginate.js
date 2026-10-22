/**
 * Cuts a laid-out page into sheets of paper.
 *
 * A page is a list of items placed by y. This finds where each sheet ends so that nothing is cut
 * through: text breaks between lines, never leaves one line of a paragraph alone at the top or bottom
 * of a sheet, and keeps a heading with the lines after it; figures, display math and table rows move
 * whole. Each sheet comes back as the same kind of items, moved up so the sheet starts at y = 0.
 */

const EPS = 0.5;

/**
 * A thing that takes room on the page.
 * @typedef {Object} Row
 * @property {number} top
 * @property {number} bottom
 * @property {number} order      index of the item in the page
 * @property {any} item
 * @property {number} [line]     for text and code, the index of the line among the item's lines
 * @property {boolean} keep      stays on the same sheet as the row after it
 * @property {boolean} [rule]    a divider, which is dropped at the edge of a sheet
 */

/**
 * @param {any[]} blocks   `layout.blocks`
 * @param {{ height: number }} options   `height` is the room on a sheet, in px
 * @returns {Array<{ items: any[], height: number, top: number, bottom: number }>}   `top` and `bottom` are where the sheet was on the page
 */
export function paginate(blocks, { height }) {
    /** @type {Row[]} */
    const rows = [];
    const marks = [];
    const dropcaps = blocks.filter(b => b.type === 'dropcap');

    blocks.forEach((item, order) => {
        switch (item.type) {
            case 'paragraph':
            case 'heading': {
                const lines = item.lines.filter(l => !l.overflow);
                // the lines beside a drop cap stay together
                const cap = dropcaps.find(c => lines[0] && Math.abs(c.y - lines[0].y) < 1);
                const together = item.type === 'heading' ? lines.length : cap ? Math.round(cap.height / item.lineHeight) : 0;
                lines.forEach((line, i) => {
                    rows.push({ top: line.y, bottom: line.y + item.lineHeight, order, item, line: i, keep: keepWithNext(item.type, i, lines.length, together) });
                });
                break;
            }
            case 'code': {
                const n = item.lines.length;
                item.lines.forEach((_, i) => {
                    const top = i === 0 ? item.y : item.y + item.pad + i * item.lineHeight;
                    const bottom = i === n - 1 ? item.y + item.height : item.y + item.pad + (i + 1) * item.lineHeight;
                    rows.push({ top, bottom, order, item, line: i, keep: keepWithNext('code', i, n, 0) });
                });
                break;
            }
            case 'math':
                rows.push({ top: item.y, bottom: item.y + item.height, order, item, keep: false });
                break;
            case 'object': {
                const caption = item.caption ? item.caption.y + item.caption.height : 0;
                rows.push({ top: item.rect.y, bottom: Math.max(item.rect.y + item.rect.height, caption), order, item, keep: false });
                break;
            }
            case 'rule':
                rows.push({ top: item.y, bottom: item.y + (item.thickness ?? 1), order, item, keep: false, rule: true });
                break;
            case 'bullet':
            case 'dropcap':
            case 'quote-rule':
                marks.push({ item, order });
                break;
            default:
                break;
        }
    });

    rows.sort((a, b) => a.top - b.top || a.order - b.order);
    return fill(bandsOf(rows), height).map(sheet => build(sheet, marks));
}

/** Whether row `i` of `n` stays on the sheet with the row after it. */
function keepWithNext(kind, i, n, together) {
    if (kind === 'heading') return true;
    if (i < together - 1) return true;
    if (n <= 3) return i < n - 1;
    return i === 0 || i === n - 2;
}

/** Rows that share any height, such as the cells of a table row, are one band: they go on a sheet together. */
function bandsOf(rows) {
    const bands = [];
    for (const row of rows) {
        const band = bands[bands.length - 1];
        if (band && row.top < band.bottom - EPS) {
            band.rows.push(row);
            band.bottom = Math.max(band.bottom, row.bottom);
            band.keep = band.keep || row.keep;
            band.rule = false;
        } else {
            bands.push({ top: row.top, bottom: row.bottom, rows: [row], keep: row.keep, rule: !!row.rule });
        }
    }
    return bands;
}

/** Fills sheets with bands, breaking where the keeps allow. Dividers are dropped at the top and bottom of a sheet. */
function fill(bands, height) {
    const sheets = [];
    let i = 0;
    while (i < bands.length) {
        const start = i;
        let last = i;
        while (last + 1 < bands.length && bands[last + 1].bottom - bands[start].top <= height + EPS) last++;
        if (last + 1 < bands.length) {
            let k = last;
            while (k >= start && bands[k].keep) k--;
            // a run of keeps longer than a sheet gives up and breaks where the sheet ends
            if (k >= start) last = k;
        }
        sheets.push(bands.slice(start, last + 1));
        i = last + 1;
    }
    return sheets
        .map(sheet => {
            let from = 0;
            let to = sheet.length;
            while (from < to && sheet[from].rule) from++;
            while (to > from && sheet[to - 1].rule) to--;
            return sheet.slice(from, to);
        })
        .filter(sheet => sheet.length > 0);
}

/** One sheet: its items, moved so the sheet starts at y = 0. */
function build(sheet, marks) {
    const top = sheet[0].top;
    const bottom = sheet[sheet.length - 1].bottom;
    const placed = [];

    const groups = new Map();
    for (const row of sheet.flatMap(b => b.rows)) {
        if (!groups.has(row.item)) groups.set(row.item, []);
        groups.get(row.item).push(row);
    }
    for (const [item, own] of groups) placed.push({ order: own[0].order, item: cut(item, own, top) });

    for (const { item, order } of marks) {
        if (item.type === 'quote-rule') {
            const from = Math.max(item.y, top);
            const to = Math.min(item.y + item.height, bottom);
            if (to - from > 1) placed.push({ order, item: { ...item, y: from - top, height: to - from } });
        } else if (item.y >= top - EPS && item.y < bottom - EPS) {
            placed.push({ order, item: moved(item, top) });
        }
    }
    placed.sort((a, b) => a.order - b.order);
    return { items: placed.map(p => p.item), height: bottom - top, top, bottom };
}

/** `item` with only the rows that are on this sheet, moved up by `top`. */
function cut(item, own, top) {
    switch (item.type) {
        case 'paragraph':
        case 'heading': {
            const all = item.lines.filter(l => !l.overflow);
            const lines = own.map(r => ({ ...all[r.line], y: all[r.line].y - top }));
            return { ...item, id: undefined, lines, top: lines[0].y, bottom: lines[lines.length - 1].y + item.lineHeight };
        }
        case 'code': {
            const first = own[0].line;
            const last = own[own.length - 1].line;
            const cutTop = first > 0;
            const cutBottom = last < item.lines.length - 1;
            const lines = item.lines.slice(first, last + 1);
            return {
                ...item, lines, cutTop, cutBottom,
                y: own[0].top - top,
                height: lines.length * item.lineHeight + (cutTop ? 0 : item.pad) + (cutBottom ? 0 : item.pad),
            };
        }
        default:
            return moved(item, top);
    }
}

/** An item that is placed by itself, moved up by `top`. */
function moved(item, top) {
    switch (item.type) {
        case 'object': {
            const caption = item.caption && {
                ...item.caption, y: item.caption.y - top,
                lines: item.caption.lines.map(l => ({ ...l, y: l.y - top })),
            };
            return { ...item, rect: { ...item.rect, y: item.rect.y - top }, caption };
        }
        case 'dropcap':
            return { ...item, y: item.y - top, baseline: item.baseline - top };
        default:
            return { ...item, y: item.y - top };
    }
}
