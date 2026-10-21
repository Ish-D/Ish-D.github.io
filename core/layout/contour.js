/**
 * The outline of a run of text: stacked lines of different lengths make a
 * stepped shape, and that shape (not the rectangle around it) is what a block
 * of text occupies. Everything that needs to hug text, such as the outline
 * shown on hover, the click area and the box drawn while editing, uses this.
 */

/**
 * @typedef {{ x0: number, x1: number, y0: number, y1: number }} Row   one line's extent
 * @typedef {Array<[number, number]>} Polygon
 */

const SAME = 1.5;

/**
 * Outlines of stacked rows. Rows are in reading order; when the next row starts
 * above the end of the previous one (the text moved to another column) or lies
 * beside it, it begins a separate outline.
 * @param {Row[]} rows
 * @param {{ pad?: number }} [options]  space added around the text
 * @returns {Polygon[]}
 */
export function contours(rows, { pad = 0 } = {}) {
    const groups = [];
    let group = null;
    for (const row of rows) {
        if (!(row.x1 > row.x0) || !(row.y1 > row.y0)) continue;
        const last = group?.[group.length - 1];
        if (!last || row.y0 < last.y1 - SAME || row.x0 > last.x1 || row.x1 < last.x0) groups.push(group = []);
        group.push(row);
    }
    return groups.map(g => outline(g, pad));
}

function outline(source, pad) {
    // the shape's top and bottom move out by the padding along with its sides
    const rows = source.map((r, i) => ({ ...r, y0: i === 0 ? r.y0 - pad : r.y0, y1: i === source.length - 1 ? r.y1 + pad : r.y1 }));
    // lines whose edges nearly agree are one straight edge
    const left = [];
    const right = [];
    for (const r of rows) {
        const pl = left[left.length - 1];
        const pr = right[right.length - 1];
        left.push({ x: pl && Math.abs(pl.x - r.x0) < SAME ? pl.x : r.x0, y0: r.y0, y1: r.y1 });
        right.push({ x: pr && Math.abs(pr.x - r.x1) < SAME ? pr.x : r.x1, y0: r.y0, y1: r.y1 });
    }
    const points = [];
    const walk = (edge, sign, reverse) => {
        const order = reverse ? [...edge].reverse() : edge;
        for (const e of order) {
            const x = e.x + sign * pad;
            const [a, b] = reverse ? [e.y1, e.y0] : [e.y0, e.y1];
            points.push([x, a], [x, b]);
        }
    };
    walk(left, -1, false);
    walk(right, 1, true);
    return simplify(points);
}

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points) {
    const out = [];
    for (const p of points) {
        const prev = out[out.length - 1];
        if (prev && Math.abs(prev[0] - p[0]) < 1e-6 && Math.abs(prev[1] - p[1]) < 1e-6) continue;
        out.push(p);
    }
    for (let i = 1; i < out.length - 1;) {
        const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
        const straight = (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);
        if (straight) out.splice(i, 1); else i++;
    }
    return out;
}

/** SVG / CSS path data for outlines, moved by (ox, oy). */
export function toPath(polygons, ox = 0, oy = 0) {
    const n = (v) => Math.round(v * 100) / 100;
    return polygons.map(poly => `M${poly.map(([x, y]) => `${n(x - ox)} ${n(y - oy)}`).join('L')}Z`).join('');
}

/** Rows for the lines of a laid-out text block. */
export function rowsOfLines(lines, lineHeight) {
    return lines
        .filter(l => !l.overflow)
        .map(l => ({ x0: l.x, x1: l.x + l.width, y0: l.y, y1: l.y + lineHeight }));
}
