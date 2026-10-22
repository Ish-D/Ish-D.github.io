/**
 * Sheets of paper in the page: each a box the size of the paper, with the text where pagination put it and the
 * notes beside it, the title along the top from the second sheet on, and the address and the number of the sheet along the bottom.
 */

import { renderLayout } from './dom.js';

const px = (n) => `${Math.round(n * 100) / 100}px`;

/**
 * @param {HTMLElement} root
 * @param {ReturnType<typeof import('../layout/print.js').layoutPrint>} printed
 * @param {import('./dom.js').RenderContext} ctx
 * @param {{ title?: string, address?: string }} [heading]
 */
export function renderSheets(root, printed, ctx, { title = '', address = '' } = {}) {
    const { document } = ctx;
    const { paper, sheets, room, margins, layout } = printed;
    const column = layout.geometry.text;
    const make = (tag, className, text) => {
        const el = document.createElement(tag);
        el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };

    root.replaceChildren();
    sheets.forEach((sheet, k) => {
        const el = make('section', 'sheet');
        el.style.width = px(paper.width);
        // a pixel short, so a sheet never pushes a blank one out after it
        el.style.height = px(paper.height - 1);

        if (k > 0 && title) {
            const head = make('header', 'sheet-head', title);
            head.style.left = px(column.x);
            head.style.width = px(column.width);
            el.appendChild(head);
        }

        const body = make('div', 'sheet-body');
        body.style.top = px(margins.top);
        body.style.width = px(paper.width);
        body.style.height = px(room);
        renderLayout(body, { width: paper.width, height: room, blocks: sheet.items, notes: sheet.notes }, ctx);
        el.appendChild(body);

        const foot = make('footer', 'sheet-foot');
        foot.style.left = px(column.x);
        foot.style.width = px(column.width);
        foot.append(make('span', 'sheet-address', address), make('span', 'sheet-folio', String(k + 1)));
        el.appendChild(foot);

        root.appendChild(el);
    });
}
