/**
 * While editing, pointing at something outlines it. Text is outlined along its
 * lines (see layout/contour.js), so a paragraph beside a figure is outlined
 * without the figure; everything else gets its rectangle.
 */

import { contours, rowsOfLines, toPath } from '../layout/contour.js';
import { followHover } from './hover.js';

const SELECTABLE = '.blk[data-start], .codeblock[data-start], .mathblock[data-start], .obj[data-start], aside.note[data-start]';
const PAD = 4;

/** The layout item for a text block starting at `start`, in the page or in a margin note. */
function findBlock(layout, start) {
    const same = (b) => b.node?.start === start && b.lines;
    return layout.blocks.find(same) ?? layout.notes.flatMap(n => (n.rotate ? [] : n.items)).find(same) ?? null;
}

/**
 * @param {{ document: Document, getLayout: () => any, hover: ReturnType<typeof import('./hover.js').createHover> }} deps
 */
export function createHoverOutline({ document, getLayout, hover }) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'hover-outline');
    const path = document.createElementNS(NS, 'path');
    svg.appendChild(path);
    svg.hidden = true;
    document.body.appendChild(svg);

    const clear = () => { svg.hidden = true; };

    function outlineOf(el) {
        const layout = getLayout();
        if (el.matches('.blk') && layout) {
            const block = findBlock(layout, Number(el.dataset.start));
            if (block) return toPath(contours(rowsOfLines(block.lines, block.lineHeight), { pad: PAD }));
        }
        const r = el.getBoundingClientRect();
        const x = r.left + scrollX;
        const y = r.top + scrollY;
        return toPath([[[x - PAD, y - PAD], [x - PAD, y + r.height + PAD], [x + r.width + PAD, y + r.height + PAD], [x + r.width + PAD, y - PAD]]]);
    }

    followHover({
        hover,
        delay: 0,
        pick: (target) => {
            const el = target.closest?.(SELECTABLE);
            return el && !el.closest('.editor-overlay') ? el : null;
        },
        show: (el) => { path.setAttribute('d', outlineOf(el)); svg.hidden = false; },
        hide: clear,
    });

    return { clear, dispose() { svg.remove(); } };
}
