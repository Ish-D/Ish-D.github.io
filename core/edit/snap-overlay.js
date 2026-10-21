/**
 * The lines drawn while something is being moved: faint ones for the page's
 * structure (when guides are switched on), and the ones it has snapped to,
 * solid and labelled.
 */

const NS = 'http://www.w3.org/2000/svg';
const STRUCTURE = new Set(['text-left', 'text-center', 'text-right', 'page-center', 'seam', 'column', 'column-center']);

/**
 * @param {{ document: Document, window: Window, originX?: () => number }} deps   originX: page x of the layout's x = 0
 */
export function createSnapOverlay({ document, window, originX = () => 0 }) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'snap-guides');
    svg.setAttribute('aria-hidden', 'true');
    svg.hidden = true;
    document.body.appendChild(svg);

    const line = (x1, y1, x2, y2, className) => {
        const el = document.createElementNS(NS, 'line');
        el.setAttribute('x1', x1); el.setAttribute('y1', y1); el.setAttribute('x2', x2); el.setAttribute('y2', y2);
        el.setAttribute('class', className);
        svg.appendChild(el);
    };
    const label = (x, y, text) => {
        const el = document.createElementNS(NS, 'text');
        el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('class', 'snap-label');
        el.textContent = text;
        svg.appendChild(el);
    };

    return {
        /**
         * @param {{ hits: Array<{ guide: any, axis: 'x' | 'y' }>, structure: import('./snap.js').Guides | null }} state
         */
        draw({ hits, structure }) {
            svg.replaceChildren();
            const ox = originX();
            const top = window.scrollY;
            const bottom = window.scrollY + window.innerHeight;
            const left = ox;
            const right = ox + window.innerWidth;
            if (structure) {
                for (const g of structure.x) if (STRUCTURE.has(g.kind)) line(ox + g.value, top, ox + g.value, bottom, 'snap-faint');
            }
            for (const { guide, axis } of hits) {
                if (axis === 'x') {
                    const from = guide.from ?? top;
                    const to = guide.to ?? bottom;
                    line(ox + guide.value, Math.min(from, top), ox + guide.value, Math.max(to, bottom), 'snap-hit');
                    label(ox + guide.value + 6, top + 18, guide.label);
                } else {
                    line(left, guide.value, right, guide.value, 'snap-hit');
                    label(left + 8, guide.value - 5, guide.label);
                }
            }
            svg.hidden = hits.length === 0 && !structure;
        },
        hide() { svg.hidden = true; svg.replaceChildren(); },
        dispose() { svg.remove(); },
    };
}
