/**
 * Edit-mode tools on figures: a small bar to choose where the figure sits and
 * how text wraps it, and a corner handle to resize. Every change is an edit to
 * the directive's arguments in the source.
 */

import { setArg, removeArg } from '../doc/edit.js';
import { walk } from '../doc/walk.js';

const PLACES = [['left', '◧', 'Float left'], ['block', '▭', 'Own line'], ['right', '◨', 'Float right'], ['full', '⟷', 'Full width']];
const WRAPS = [['none', '□', 'No wrap'], ['box', '▣', 'Wrap around the box'], ['circle', '○', 'Wrap around a circle'], ['ellipse', '⬭', 'Wrap around an ellipse']];

const px = (v) => `${Math.round(v)}px`;

function directiveAt(session, start) {
    let found = null;
    walk(session.doc, (n) => { if (n.type === 'directive' && n.start === start) { found = n; return false; } return undefined; });
    return found;
}

/**
 * @param {{ document: Document, root: HTMLElement, getSession: () => any, textWidth: () => number, onEdited: () => void }} deps
 */
export function createFigureTools({ document, root, getSession, textWidth, onEdited }) {
    const bar = document.createElement('div');
    bar.className = 'figure-bar';
    bar.hidden = true;
    const handle = document.createElement('div');
    handle.className = 'figure-handle';
    handle.hidden = true;
    document.body.append(bar, handle);

    let figure = null;
    let hideTimer = 0;

    const directive = () => {
        const session = getSession();
        return session && figure ? directiveAt(session, Number(figure.dataset.start)) : null;
    };

    const apply = (build) => {
        const node = directive();
        if (!node) return;
        const edit = build(node);
        if (!edit) return;
        getSession().apply(edit, { group: `figure-${Date.now()}` });
        hide();
        onEdited();
    };

    const button = (label, title, onclick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.onclick = onclick;
        return b;
    };
    const divider = () => Object.assign(document.createElement('span'), { className: 'sep' });
    bar.append(
        ...PLACES.map(([value, label, title]) => button(label, title, () => apply(n => setArg(n, 'place', value)))),
        divider(),
        ...WRAPS.map(([value, label, title]) => button(label, title, () => apply(n => (value === 'none' ? removeArg(n, 'wrap') : setArg(n, 'wrap', value))))),
    );

    function hide() {
        bar.hidden = handle.hidden = true;
        figure = null;
    }

    function show(el) {
        clearTimeout(hideTimer);
        figure = el;
        const r = el.getBoundingClientRect();
        bar.hidden = handle.hidden = false;
        bar.style.left = `${r.left + scrollX}px`;
        bar.style.top = `${Math.max(0, r.top + scrollY - 34)}px`;
        handle.style.left = `${r.right + scrollX - 9}px`;
        handle.style.top = `${r.bottom + scrollY - 9}px`;
        hideTimer = setTimeout(hide, 3000);
    }

    root.addEventListener('mousemove', (e) => {
        if (!document.body.classList.contains('editing') || drag) return;
        const el = e.target.closest?.('.obj[data-start]');
        if (el && !el.querySelector('.sketch-pad') && el !== figure) show(el);
        else if (el) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 3000); }
    });
    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));

    // corner drag: new width, height follows when it is a fixed size
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
        const node = directive();
        if (!node) return;
        e.preventDefault();
        try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        const rect = figure.getBoundingClientRect();
        drag = { node, startX: e.clientX, width: rect.width, height: rect.height, el: figure };
    });
    handle.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const width = Math.max(40, drag.width + e.clientX - drag.startX);
        drag.next = width;
        drag.el.style.width = px(width);
        drag.el.style.height = px(width * drag.height / drag.width);
    });
    handle.addEventListener('pointerup', () => {
        if (!drag) return;
        const { node, next, height, width, el } = drag;
        drag = null;
        el.style.width = el.style.height = '';
        if (next === undefined) return;
        const session = getSession();
        const arg = (key) => node.args?.items.find(a => a.key === key)?.value;
        const percent = /%$/.test(arg('width') ?? '');
        const group = `figure-${Date.now()}`;
        session.apply(setArg(node, 'width', percent ? `${Math.round(next / textWidth() * 100)}%` : px(next)), { group });
        // a height in pixels scales with the width
        const h = arg('height');
        if (h && /^\d+(\.\d+)?(px)?$/.test(h)) {
            const fresh = directiveAt(session, node.start);
            if (fresh) session.apply(setArg(fresh, 'height', px(next * height / width)), { group });
        }
        hide();
        onEdited();
    });

    return { dispose() { bar.remove(); handle.remove(); clearTimeout(hideTimer); } };
}
