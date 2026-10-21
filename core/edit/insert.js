/**
 * Insert menu: in edit mode a "+" appears under the block the pointer is on.
 * Choosing an item adds its source after that block.
 */

import { followHover } from './hover.js';

export const SNIPPETS = [
    { label: 'Paragraph', text: 'New paragraph.' },
    { label: 'Heading', text: '## Heading' },
    { label: 'Margin note', text: 'A sentence with a note beside it.[[note(right)]]{}{The note.}' },
    { label: 'Image with text wrap', text: '[[image(images/photography/koi.jpg, place: right, width: 40%, wrap: circle, pad: 12, fit: cover)]]{Caption}\nText that wraps around the picture.' },
    { label: 'Two columns', text: '[[columns(2, gap: 40)]]\n{\nLeft column.\n\nMore of the left column.\n}' },
    { label: 'Equation', text: '$$\nE = mc^2\n$$' },
    { label: 'Code', text: '```js\nconsole.log("hi");\n```' },
    { label: 'Live number', text: 'Drag [[var(n, 5, min: 0, max: 10, step: 1)]] to change it.' },
    { label: 'Figure', text: '[[viz(type: softmax-scale, var: n, height: 300, width: 100%)]]' },
    { label: 'Sketch', text: '[[drawing(view: 600x300, width: 70%)]]{\n}' },
    { label: 'Gallery', text: '[[gallery(columns: 3)]]{\nimages/photography/koi.jpg | Koi\n}' },
];

/**
 * The edit that adds `snippet` after the block ending at `at`, and the range the new source occupies afterwards.
 * @returns {{ edit: { start: number, end: number, text: string }, range: { start: number, end: number } }}
 */
export function insertion(_source, at, snippet) {
    const text = `\n\n${snippet}`;
    return { edit: { start: at, end: at, text }, range: { start: at + 2, end: at + text.length } };
}

/**
 * @param {{ document: Document, hover: ReturnType<typeof import('./hover.js').createHover>, getSession: () => any, onInserted: (range: { start: number, end: number }) => void }} deps
 */
export function createInserter({ document, hover, getSession, onInserted }) {
    const plus = document.createElement('button');
    plus.className = 'insert-plus';
    plus.type = 'button';
    plus.textContent = '+';
    plus.title = 'Insert';
    plus.hidden = true;
    const menu = document.createElement('div');
    menu.className = 'insert-menu';
    menu.hidden = true;
    document.body.append(plus, menu);

    let target = null;

    const hide = () => { plus.hidden = true; menu.hidden = true; target = null; };

    followHover({
        hover,
        overlays: [plus, menu],
        pick: (el) => {
            if (!menu.hidden) return target;   // the menu is open: stay where it is
            const block = el.closest?.('[data-start][data-end]');
            return block && !block.closest('.editor-overlay') && !block.closest('aside.note') ? block : null;
        },
        show: (el) => {
            if (el === target) return;
            target = el;
            const r = el.getBoundingClientRect();
            plus.hidden = false;
            plus.style.left = `${Math.max(4, r.left - 34) + scrollX}px`;
            plus.style.top = `${r.bottom + scrollY - 12}px`;
        },
        hide: () => { if (menu.hidden) hide(); },
    });

    plus.addEventListener('click', () => {
        menu.replaceChildren(...SNIPPETS.map(({ label, text }) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.onclick = () => {
                const session = getSession();
                if (!session || !target) return hide();
                const { edit, range } = insertion(session.source, Number(target.dataset.end), text);
                hide();
                session.apply(edit, { group: `insert-${Date.now()}` });
                onInserted(range);
            };
            return b;
        }));
        menu.style.left = plus.style.left;
        menu.style.top = `${parseFloat(plus.style.top) + 26}px`;
        menu.hidden = false;
    });

    document.addEventListener('mousedown', (e) => {
        if (!menu.hidden && !menu.contains(e.target) && e.target !== plus) hide();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

    return { hide, dispose() { plus.remove(); menu.remove(); } };
}
