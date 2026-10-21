/**
 * Drawing surface laid over a sketch figure. Pointer (mouse, touch, pen)
 * strokes become polylines in the figure's view-box coordinates; the result
 * is handed back as stroke text.
 */

import { serializeStrokes, simplify, strokesSvg } from '../runtime/strokes.js';

const WIDTHS = [1.5, 3, 5];
const ERASE_RADIUS = 8;
const SIMPLIFY = 0.6;

/**
 * @param {{ document: Document, figure: HTMLElement, strokes: Array<{ width: number, points: Array<[number, number]> }>,
 *           view: { width: number, height: number }, onDone: (text: string) => void }} options
 * @returns {{ close: () => void }}
 */
export function openSketchPad({ document, figure, strokes: initial, view, onDone }) {
    const strokes = initial.map(s => ({ width: s.width, points: s.points.map(p => [...p]) }));
    const undo = [];
    let width = WIDTHS[1];
    let erasing = false;
    let live = null;

    const pad = document.createElement('div');
    pad.className = 'sketch-pad';
    let svg = strokesSvg(document, strokes, view);
    pad.appendChild(svg);

    const bar = document.createElement('div');
    bar.className = 'sketch-bar';
    const button = (label, title, onclick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.onclick = onclick;
        bar.appendChild(b);
        return b;
    };
    const widthButtons = WIDTHS.map((w, i) => button(['·', '•', '●'][i], `Pen ${w}`, () => { width = w; erasing = false; sync(); }));
    const eraser = button('⌫', 'Eraser', () => { erasing = !erasing; sync(); });
    button('↶', 'Undo', () => { const prev = undo.pop(); if (prev) { strokes.splice(0, strokes.length, ...JSON.parse(prev)); redraw(); } });
    button('Clear', 'Clear', () => { remember(); strokes.length = 0; redraw(); });
    button('Done', 'Finish drawing', () => close());
    pad.appendChild(bar);
    figure.appendChild(pad);

    function sync() {
        widthButtons.forEach((b, i) => b.classList.toggle('on', !erasing && WIDTHS[i] === width));
        eraser.classList.toggle('on', erasing);
    }
    sync();

    function remember() {
        undo.push(JSON.stringify(strokes));
        if (undo.length > 100) undo.shift();
    }

    function redraw() {
        const next = strokesSvg(document, strokes, view);
        svg.replaceWith(next);
        svg = next;
        bind();
    }

    function point(e) {
        const m = svg.getScreenCTM?.();
        if (!m) return [e.clientX, e.clientY];
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
    }

    function erase(at) {
        const before = strokes.length;
        const hit = (s) => s.points.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) <= ERASE_RADIUS + s.width / 2);
        const kept = strokes.filter(s => !hit(s));
        if (kept.length === before) return;
        remember();
        strokes.splice(0, strokes.length, ...kept);
        redraw();
    }

    function bind() {
        svg.style.touchAction = 'none';
        svg.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            e.preventDefault();
            svg.setPointerCapture?.(e.pointerId);
            const at = point(e);
            if (erasing) { live = { erase: true }; erase(at); return; }
            live = { width, points: [at], el: strokesSvg(document, [{ width, points: [at] }], view).firstChild };
            svg.appendChild(live.el);
        });
        svg.addEventListener('pointermove', (e) => {
            if (!live) return;
            const events = e.getCoalescedEvents?.() ?? [e];
            for (const ev of events.length ? events : [e]) {
                const at = point(ev);
                if (live.erase) { erase(at); continue; }
                live.points.push(at);
            }
            if (!live.erase) live.el.setAttribute('d', strokesSvg(document, [{ width, points: live.points }], view).firstChild.getAttribute('d'));
        });
        const end = () => {
            if (!live) return;
            if (!live.erase) {
                remember();
                strokes.push({ width: live.width, points: simplify(live.points, SIMPLIFY) });
                redraw();
            }
            live = null;
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
    }
    bind();

    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey);

    function close() {
        document.removeEventListener('keydown', onKey);
        pad.remove();
        onDone(serializeStrokes(strokes));
    }
    return { close };
}
