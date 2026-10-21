/**
 * Edit-mode tools on figures: a grip to drag the figure, buttons for where it
 * sits and how text wraps it, and a corner handle to resize. Every change is
 * an edit to the directive's arguments in the source.
 */

import { argValue, directiveAt, updateArgs } from './args.js';
import { makeDraggable } from './drag.js';
import { figureArgs, figureMoveChanges } from './move.js';

const PLACES = [['left', '◧', 'Float left'], ['block', '▭', 'Own line'], ['right', '◨', 'Float right'], ['full', '⟷', 'Full width']];
const WRAPS = [['none', '□', 'No wrap'], ['box', '▣', 'Wrap around the box'], ['circle', '○', 'Wrap around a circle'], ['ellipse', '⬭', 'Wrap around an ellipse']];

const px = (v) => `${Math.round(v)}px`;

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
    let busy = false;
    let hideTimer = 0;

    const directive = () => {
        const session = getSession();
        return session && figure ? directiveAt(session, Number(figure.dataset.start)) : null;
    };

    function hide() {
        if (busy) return;
        bar.hidden = handle.hidden = true;
        figure = null;
    }

    const change = (changes) => {
        const node = directive();
        if (node && updateArgs(getSession(), node.start, changes)) onEdited();
        hide();
    };

    const button = (label, title, onclick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        if (onclick) b.onclick = onclick;
        return b;
    };
    const sep = () => Object.assign(document.createElement('span'), { className: 'sep' });

    const grip = button('⠿', 'Drag to move the figure');
    grip.classList.add('grip');
    bar.append(
        grip,
        sep(),
        ...PLACES.map(([value, label, title]) => button(label, title, () => change([{ key: 'place', value }]))),
        sep(),
        ...WRAPS.map(([value, label, title]) => button(label, title, () => change([{ key: 'wrap', value: value === 'none' ? null : value }]))),
    );

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
        if (!document.body.classList.contains('editing') || busy) return;
        const el = e.target.closest?.('.obj[data-start]');
        if (el && !el.querySelector('.sketch-pad') && el !== figure) show(el);
        else if (el) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 3000); }
    });
    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));

    // drag the whole figure; the text re-flows around its new place on release
    makeDraggable(grip, {
        onStart() { busy = true; clearTimeout(hideTimer); },
        onMove(dx, dy) { figure.style.transform = `translate(${dx}px, ${dy}px)`; },
        onDrop(dx, dy) {
            const node = directive();
            const el = figure;
            busy = false;
            if (node) {
                el.style.transform = '';
                change(figureMoveChanges(figureArgs(node), { dx, dy }));
            }
        },
        onCancel() { busy = false; if (figure) figure.style.transform = ''; },
    });

    // corner drag: new width; a height in pixels follows the width
    let resize = null;
    handle.addEventListener('pointerdown', (e) => {
        const node = directive();
        if (!node) return;
        e.preventDefault();
        try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        busy = true;
        const rect = figure.getBoundingClientRect();
        resize = { node, startX: e.clientX, width: rect.width, height: rect.height, el: figure };
    });
    handle.addEventListener('pointermove', (e) => {
        if (!resize) return;
        const width = Math.max(40, resize.width + e.clientX - resize.startX);
        resize.next = width;
        resize.el.style.width = px(width);
        resize.el.style.height = px(width * resize.height / resize.width);
    });
    handle.addEventListener('pointerup', () => {
        if (!resize) return;
        const { node, next, height, width, el } = resize;
        resize = null;
        busy = false;
        el.style.width = el.style.height = '';
        if (next === undefined) return hide();
        const percent = /%$/.test(argValue(node, 'width') ?? '');
        const h = argValue(node, 'height');
        change([
            { key: 'width', value: percent ? `${Math.round(next / textWidth() * 100)}%` : px(next) },
            ...(h && /^\d+(\.\d+)?(px)?$/.test(h) ? [{ key: 'height', value: px(next * height / width) }] : []),
        ]);
    });

    return { dispose() { bar.remove(); handle.remove(); clearTimeout(hideTimer); } };
}
