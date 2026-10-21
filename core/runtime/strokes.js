/**
 * Hand-drawn strokes stored as text, one stroke per line:
 *
 *   <width> x,y x,y x,y ...
 *
 * They live inside the page source, so a sketch saves, merges and undoes like
 * any other text. Strokes draw in the page's text color.
 */

const NS = 'http://www.w3.org/2000/svg';
const round = (n) => Math.round(n * 10) / 10;

/** @returns {{ width: number, points: Array<[number, number]> }[]} */
export function parseStrokes(text) {
    const out = [];
    for (const line of String(text ?? '').split('\n')) {
        const parts = line.trim().split(/\s+/);
        const width = Number(parts[0]);
        if (!Number.isFinite(width) || parts.length < 2) continue;
        const points = parts.slice(1).map(p => p.split(',').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
        if (points.length) out.push({ width, points });
    }
    return out;
}

export function serializeStrokes(strokes) {
    return strokes.map(s => `${s.width} ${s.points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}`).join('\n');
}

/** Smooth path through the points (quadratic curves between midpoints). */
export function strokePath(points) {
    if (points.length === 0) return '';
    const [x0, y0] = points[0];
    if (points.length === 1) return `M${x0} ${y0}h0.01`;
    if (points.length === 2) return `M${x0} ${y0}L${points[1][0]} ${points[1][1]}`;
    let d = `M${x0} ${y0}`;
    for (let i = 1; i < points.length - 1; i++) {
        const [x, y] = points[i];
        const [nx, ny] = points[i + 1];
        d += `Q${x} ${y} ${round((x + nx) / 2)} ${round((y + ny) / 2)}`;
    }
    const [lx, ly] = points[points.length - 1];
    return `${d}L${lx} ${ly}`;
}

/** Ramer-Douglas-Peucker: drops points within `tolerance` of the line between their neighbours. */
export function simplify(points, tolerance) {
    if (points.length < 3) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = points[a];
        const [bx, by] = points[b];
        const len = Math.hypot(bx - ax, by - ay) || 1e-9;
        let far = -1;
        let farDist = tolerance;
        for (let i = a + 1; i < b; i++) {
            const d = Math.abs((by - ay) * points[i][0] - (bx - ax) * points[i][1] + bx * ay - by * ax) / len;
            if (d > farDist) { far = i; farDist = d; }
        }
        if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    return points.filter((_, i) => keep[i]);
}

/** `600x340` → { width: 600, height: 340 }, else null. */
export function parseView(text) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[x×,]\s*(\d+(?:\.\d+)?)\s*$/.exec(text ?? '');
    return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

export const DEFAULT_VIEW = Object.freeze({ width: 640, height: 360 });

/** An <svg> element with the strokes drawn in currentColor. */
export function strokesSvg(document, strokes, view = DEFAULT_VIEW) {
    const svg = document.createElementNS ? document.createElementNS(NS, 'svg') : document.createElement('svg');
    svg.setAttribute('viewBox', `0 0 ${view.width} ${view.height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('class', 'sketch');
    for (const stroke of strokes) {
        const path = document.createElementNS ? document.createElementNS(NS, 'path') : document.createElement('path');
        path.setAttribute('d', strokePath(stroke.points));
        path.setAttribute('stroke-width', String(stroke.width));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
    }
    return svg;
}
