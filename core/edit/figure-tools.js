/**
 * Edit-mode tools on figures: a grip to drag the figure, buttons for where it
 * sits and how text wraps it, the space kept clear around it, and a corner
 * handle to resize. Every change is
 * an edit to the directive's arguments in the source; dragging and resizing
 * apply it live, so the text re-flows around the figure as it moves.
 */

import { argValue, createPreview, directiveAt, updateArgs } from './args.js';
import { parseValue } from '../layout/values.js';
import { makeDraggable } from './drag.js';
import { figureArgs, figureMoveChanges } from './move.js';

const PLACES = [['left', '◧', 'Float left'], ['block', '▭', 'Own line'], ['right', '◨', 'Float right'], ['full', '⟷', 'Full width']];
const WRAPS = [['none', '□', 'No wrap'], ['box', '▣', 'Wrap around the box'], ['circle', '○', 'Wrap around a circle'], ['ellipse', '⬭', 'Wrap around an ellipse']];

/** Directives that draw a figure. */
const FIGURES = ['image', 'viz', 'drawing', 'figure', 'gallery', 'embed'];

const PAD_MAX = 120;

const px = (v) => `${Math.round(v)}px`;
const isPixels = (text) => !!text && /^\d+(\.\d+)?(px)?$/.test(text);

/**
 * @param {{ document: Document, root: HTMLElement, getSession: () => any, getLayout: () => any, textWidth: () => number, onEdited: () => void }} deps
 */
export function createFigureTools({ document, root, getSession, getLayout, textWidth, onEdited }) {
    const bar = document.createElement('div');
    bar.className = 'figure-bar';
    bar.hidden = true;
    const handle = document.createElement('div');
    handle.className = 'figure-handle';
    handle.hidden = true;
    const ring = document.createElement('div');
    ring.className = 'pad-ring';
    ring.hidden = true;
    document.body.append(bar, handle, ring);

    let figure = null;     // the figure under the pointer
    let shownFor = null;   // the source the figure's offsets belong to
    let drag = null;       // a move or resize in progress
    let hideTimer = 0;

    const directive = () => {
        const session = getSession();
        // offsets read off the page are only good for the source they were read from
        return session && figure && session.source === shownFor ? directiveAt(session, Number(figure.dataset.start), FIGURES) : null;
    };

    function hide() {
        if (drag) return;
        bar.hidden = handle.hidden = ring.hidden = true;
        figure = null;
    }

    const apply = (changes) => {
        const node = directive();
        if (node && updateArgs(getSession(), node.start, changes, undefined, FIGURES)) onEdited();
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

    // the space the text keeps clear around the figure, in px
    const padLabel = Object.assign(document.createElement('span'), { className: 'pad-label' });
    const padSlider = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: PAD_MAX, step: 1, title: 'Space around the figure' });
    const padControl = Object.assign(document.createElement('label'), { className: 'pad-control' });
    padControl.append(padLabel, padSlider);

    const padOf = (node) => {
        const value = parseValue(argValue(node, 'pad'));
        if (value?.type === 'number') return value.value;
        return Math.round(0.6 * (getLayout()?.styles.size ?? 16));
    };
    const showPad = (pad) => { padSlider.value = String(pad); padLabel.textContent = `pad ${Math.round(pad)}`; };

    const grip = button('⠿', 'Drag to move the figure');
    grip.classList.add('grip');
    bar.append(
        grip,
        sep(),
        ...PLACES.map(([value, label, title]) => button(label, title, () => apply([{ key: 'place', value }]))),
        sep(),
        ...WRAPS.map(([value, label, title]) => button(label, title, () => apply([{ key: 'wrap', value: value === 'none' ? null : value }]))),
        sep(),
        padControl,
    );

    function show(el) {
        clearTimeout(hideTimer);
        figure = el;
        shownFor = getSession()?.source ?? null;
        const r = el.getBoundingClientRect();
        bar.hidden = handle.hidden = false;
        bar.style.left = `${r.left + scrollX}px`;
        bar.style.top = `${Math.max(0, r.top + scrollY - 34)}px`;
        handle.style.left = `${r.right + scrollX - 9}px`;
        handle.style.top = `${r.bottom + scrollY - 9}px`;
        const node = directive();
        if (node) { showPad(padOf(node)); drawRing(el, padOf(node), node); }
        hideTimer = setTimeout(hide, 3000);
    }

    /** Outlines the space the text keeps clear around the figure. */
    function drawRing(el, pad, node) {
        const r = el.getBoundingClientRect();
        const wrap = argValue(node, 'wrap');
        ring.hidden = false;
        ring.style.left = `${r.left + scrollX - pad}px`;
        ring.style.top = `${r.top + scrollY - pad}px`;
        ring.style.width = `${r.width + 2 * pad}px`;
        ring.style.height = `${r.height + 2 * pad}px`;
        ring.style.borderRadius = wrap === 'circle' || wrap === 'ellipse' ? '50%' : '3px';
    }

    root.addEventListener('mousemove', (e) => {
        if (!document.body.classList.contains('editing') || drag) return;
        const el = e.target.closest?.('.obj[data-start]');
        if (el && !el.querySelector('.sketch-pad') && el !== figure) show(el);
        else if (el) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 3000); }
    });
    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));

    /** Starts a live change to the figure under the pointer; null if it cannot be edited. */
    function begin(kind) {
        const node = directive();
        const session = getSession();
        if (!node || !session) return null;
        clearTimeout(hideTimer);
        const rect = figure.getBoundingClientRect();
        return {
            kind, start: node.start, preview: createPreview(session, node.start, FIGURES),
            args: figureArgs(node), width: argValue(node, 'width'), height: argValue(node, 'height'),
            size: { width: rect.width, height: rect.height },
        };
    }

    function finish(next) {
        const { preview } = drag;
        drag = null;
        bar.style.transform = '';
        if (next) preview.show(next);
        hide();
        if (preview.changed) onEdited();
    }

    // drag the figure itself
    makeDraggable(grip, {
        onStart() { drag = begin('move'); },
        onMove(dx, dy) {
            if (!drag) return;
            bar.style.transform = `translate(${dx}px, ${dy}px)`;
            drag.preview.show(figureMoveChanges(drag.args, { dx, dy }));
        },
        onDrop(dx, dy) { if (drag) finish(figureMoveChanges(drag.args, { dx, dy })); },
        onCancel() { if (drag) { drag.preview.cancel(); drag = null; bar.style.transform = ''; hide(); } },
    });

    // drag the corner to resize; a height in pixels follows the width
    const resized = (next) => {
        const percent = /%$/.test(drag.width ?? '');
        return [
            { key: 'width', value: percent ? `${Math.round(next / textWidth() * 100)}%` : px(next) },
            ...(isPixels(drag.height) ? [{ key: 'height', value: px(next * drag.size.height / drag.size.width) }] : []),
        ];
    };
    makeDraggable(handle, {
        onStart() { drag = begin('resize'); },
        onMove(dx) { if (drag) drag.preview.show(resized(Math.max(40, drag.size.width + dx))); },
        onDrop(dx) { if (drag) finish(resized(Math.max(40, drag.size.width + dx))); },
        onCancel() { if (drag) { drag.preview.cancel(); drag = null; hide(); } },
    });

    // the slider changes the space live; releasing it (or the last key press) is one undo step
    const followRing = (pad) => requestAnimationFrame(() => {
        const el = drag && root.querySelector(`.obj[data-start="${drag.start}"]`);
        const node = drag && directiveAt(getSession(), drag.start, FIGURES);
        if (el && node) drawRing(el, pad, node);
    });
    padSlider.addEventListener('input', () => {
        drag ??= begin('pad');
        if (!drag) return;
        const pad = Number(padSlider.value);
        padLabel.textContent = `pad ${pad}`;
        drag.preview.show([{ key: 'pad', value: String(pad) }]);
        followRing(pad);
    });
    padSlider.addEventListener('change', () => {
        if (drag?.kind === 'pad') finish([{ key: 'pad', value: padSlider.value }]);
    });
    // keep the toolbar up while the slider is in use
    padSlider.addEventListener('pointerdown', () => clearTimeout(hideTimer));

    return { dispose() { bar.remove(); handle.remove(); ring.remove(); clearTimeout(hideTimer); } };
}
