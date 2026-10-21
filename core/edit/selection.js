/**
 * Selecting a figure while editing. Clicking a figure selects it and leaves it
 * looking as it will on the page: it gets a frame, a grip to drag it, a corner
 * handle to resize it, a short bar of placement buttons, and the inspector for
 * everything else. Nothing turns into source text unless asked to.
 *
 * Every change is an edit to the figure's arguments. Dragging and sliders
 * apply it live so the page re-flows as you move, as one undo step.
 */

import { argValue, createPreview, directiveAt, updateArgs } from './args.js';
import { makeDraggable } from './drag.js';
import { FIGURES, removalOf } from './figure-props.js';
import { figureArgs, figureMoveChanges } from './move.js';
import { columnOf } from './guides.js';
import { createInspector } from './inspector.js';
import { shiftRange } from './ranges.js';

const BAR_PLACES = [['left', '◧', 'Float left'], ['block', '▭', 'Own line'], ['right', '◨', 'Float right'], ['full', '⟷', 'Full width']];
const BAR_WRAPS = [['none', '□', 'No wrap'], ['box', '▣', 'Wrap around the box'], ['circle', '○', 'Wrap around a circle'], ['ellipse', '⬭', 'Wrap around an ellipse']];

const px = (v) => `${Math.round(v)}px`;
const isPixels = (text) => !!text && /^\d+(\.\d+)?(px)?$/.test(text);

/**
 * @param {{ document: Document, root: HTMLElement, snapper: ReturnType<typeof import('./snapper.js').createSnapper>, getSession: () => any, getLayout: () => any,
 *           textWidth: () => number, onEdited: () => void, openSource: (start: number, end: number) => void }} deps
 */
export function createSelection({ document, root, snapper, getSession, getLayout, textWidth, onEdited, openSource }) {
    const make = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className }, props);
    const frame = make('div', 'fig-frame', { hidden: true });
    const bar = make('div', 'figure-bar', { hidden: true });
    const handle = make('div', 'figure-handle', { hidden: true });
    const ring = make('div', 'pad-ring', { hidden: true });
    document.body.append(frame, bar, handle, ring);

    /** @type {{ start: number, session: any } | null} */
    let current = null;
    let unsubscribe = null;
    let drag = null;

    const node = () => (current && getSession() === current.session ? directiveAt(current.session, current.start, FIGURES) : null);
    const element = () => (current ? root.querySelector(`.obj[data-start="${current.start}"]`) : null);

    // ----- what an edit means -----

    /** Starts a live change; further `show` calls re-flow the page, `finish` ends it as one undo step. */
    function begin(kind) {
        const target = node();
        if (!target) return null;
        const el = element();
        const box = (el?.querySelector('.obj-body') ?? el)?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
        const rect = { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height };
        const layout = getLayout();
        const column = columnOf(layout, rect);
        return {
            kind, start: target.start, preview: createPreview(current.session, target.start, FIGURES),
            args: figureArgs(target), width: argValue(target, 'width'), height: argValue(target, 'height'),
            size: { width: rect.width, height: rect.height }, column,
            unit: { em: layout.styles.size, basis: column.width },
            snap: snapper.begin(rect, { ignoreObject: target.start }),
        };
    }

    function finish(next) {
        const op = drag;
        drag = null;
        bar.style.transform = '';
        if (!op) return;
        op.snap.end();
        if (next) op.preview.show(next);
        if (op.preview.changed) onEdited();
        reposition();
    }

    const host = {
        node,
        session: () => current.session,
        /** An edit made once, such as clicking a choice. */
        apply(changes) {
            const target = node();
            if (target && updateArgs(current.session, target.start, changes, undefined, FIGURES)) onEdited();
            reposition();
        },
        /** A change that is still going on, such as a slider being dragged. */
        live(changes) {
            drag ??= begin('live');
            drag?.preview.show(changes);
            reposition();
        },
        commit() { if (drag?.kind === 'live') finish(); },
        /** Replaces the text between a directive's braces (a caption). */
        setGroupText(text) {
            const target = node();
            const group = target?.groups?.[0];
            if (!group) return;
            const session = current.session;
            session.apply({ start: group.innerStart, end: group.innerEnd, text }, { group: `caption-${current.start}` });
            onEdited();
        },
        remove() {
            const target = node();
            if (!target) return;
            current.session.apply(removalOf(current.session.source, target), { group: `remove-${Date.now()}` });
            onEdited();
            clear();
        },
        openSource() {
            const target = node();
            if (target) { const { start, end } = target; clear(); openSource(start, end); }
        },
        defaultPad: () => Math.round(0.6 * (getLayout()?.styles.size ?? 16)),
        textWidth,
    };
    const inspector = createInspector({ document, host });

    // ----- quick placement buttons -----

    const button = (label, title, onclick) => make('button', '', { type: 'button', textContent: label, title, onclick });
    const sep = () => make('span', 'sep');
    const grip = button('⠿', 'Drag to move the figure');
    grip.classList.add('grip');
    bar.append(
        grip, sep(),
        ...BAR_PLACES.map(([value, label, title]) => button(label, title, () => host.apply([{ key: 'place', value }]))),
        sep(),
        ...BAR_WRAPS.map(([value, label, title]) => button(label, title, () => host.apply([{ key: 'wrap', value: value === 'none' ? null : value }]))),
        sep(),
        button('</>', 'Edit the source', () => host.openSource()),
    );

    // ----- placing the frame, bar and handle on the selected figure -----

    function reposition() {
        const el = element();
        const target = node();
        if (!el || !target) {
            frame.hidden = bar.hidden = handle.hidden = ring.hidden = true;
            return;
        }
        const r = el.getBoundingClientRect();
        const wrap = argValue(target, 'wrap');
        const round = wrap === 'circle' || wrap === 'ellipse' ? '50%' : '2px';
        const place = (node, left, top, width, height) => {
            node.hidden = false;
            node.style.left = `${left + scrollX}px`;
            node.style.top = `${top + scrollY}px`;
            if (width !== undefined) { node.style.width = `${width}px`; node.style.height = `${height}px`; }
        };
        place(frame, r.left, r.top, r.width, r.height);
        frame.style.borderRadius = round;
        place(bar, r.left, Math.max(0, r.top - 36));
        place(handle, r.right - 9, r.bottom - 9);
        const pad = Math.max(0, inspector.padOf(target));
        place(ring, r.left - pad, r.top - pad, r.width + 2 * pad, r.height + 2 * pad);
        ring.style.borderRadius = round;
        ring.hidden = !(pad > 0);
        inspector.sync(target);
    }

    // ----- selecting and clearing -----

    function clear() {
        drag = null;
        current = null;
        unsubscribe?.();
        unsubscribe = null;
        frame.hidden = bar.hidden = handle.hidden = ring.hidden = true;
        inspector.hide();
    }

    function selectAt(start) {
        const session = getSession();
        if (!session) return;
        if (current?.start === start && current.session === session) return;
        clear();
        current = { start, session };
        // edits elsewhere move the figure's place in the source
        unsubscribe = session.subscribe((change) => {
            if (!current || change.kind === 'reset') return clear();
            const moved = change.edit ? shiftRange({ start: current.start, end: current.start }, change.edit) : null;
            if (!moved) return clear();
            current.start = moved.start;
        });
        inspector.show();
        reposition();
    }

    const select = (el) => selectAt(Number(el.dataset.start));

    /** Units for offsets of the selected figure: its column and the type size. */
    function unitsOf() {
        const layout = getLayout();
        const body = (element()?.querySelector('.obj-body') ?? element())?.getBoundingClientRect();
        const rect = body ? { x: body.left + scrollX, y: body.top + scrollY, width: body.width, height: body.height } : { x: 0, y: 0, width: 0, height: 0 };
        return { em: layout.styles.size, basis: columnOf(layout, rect).width };
    }

    /** Moves the selected figure by a few pixels; a run of presses is one undo step. */
    function nudge(dx, dy) {
        const target = node();
        if (!target) return;
        const changes = figureMoveChanges(figureArgs(target), { dx, dy }, unitsOf());
        const group = `nudge-${target.start}-${Math.floor(Date.now() / 700)}`;
        if (updateArgs(current.session, target.start, changes, group, FIGURES)) onEdited();
    }

    /** Puts a copy just below and to the right of the selected figure and selects it. */
    function duplicate() {
        const target = node();
        if (!target) return;
        const session = current.session;
        const copyStart = target.end + 2;
        session.apply({ start: target.end, end: target.end, text: `\n\n${session.source.slice(target.start, target.end)}` }, { group: `duplicate-${Date.now()}` });
        const copy = directiveAt(session, copyStart, FIGURES);
        if (copy) updateArgs(session, copyStart, figureMoveChanges(figureArgs(copy), { dx: 24, dy: 24 }, unitsOf()), `duplicate-${copyStart}`, FIGURES);
        onEdited();
        clear();
        selectAt(copyStart);
    }

    // ----- dragging -----

    // the grip moves the figure; the page re-flows around it as it goes
    const moveChanges = (dx, dy, free) => {
        const snapped = drag.snap.move(dx, dy, free);
        return figureMoveChanges(drag.args, { dx: snapped.dx, dy: snapped.dy }, { ...drag.unit, placement: snapped.placement });
    };
    makeDraggable(grip, {
        onStart() { drag = begin('move'); },
        onMove(dx, dy, e) {
            if (!drag) return;
            bar.style.transform = `translate(${dx}px, ${dy}px)`;
            drag.preview.show(moveChanges(dx, dy, e.altKey));
        },
        onDrop(dx, dy, e) { if (drag) finish(moveChanges(dx, dy, e.altKey)); },
        onCancel() { if (drag) { drag.snap.end(); drag.preview.cancel(); drag = null; bar.style.transform = ''; reposition(); } },
    });

    // the corner: a new width, pulled to a guide or a simple share of the column; a height in pixels follows
    const resized = (dx, free) => {
        const { width, fraction } = drag.snap.resize(Math.max(40, drag.size.width + dx), free, drag.column);
        const percent = fraction !== null || /%$/.test(drag.width ?? '');
        return [
            { key: 'width', value: fraction !== null ? `${Math.round(fraction * 10000) / 100}%` : percent ? `${Math.round(width / drag.column.width * 10000) / 100}%` : px(width) },
            ...(isPixels(drag.height) ? [{ key: 'height', value: px(width * drag.size.height / drag.size.width) }] : []),
        ];
    };
    makeDraggable(handle, {
        onStart() { drag = begin('resize'); },
        onMove(dx, dy, e) { if (drag) { drag.preview.show(resized(dx, e.altKey)); reposition(); } },
        onDrop(dx, dy, e) { if (drag) finish(resized(dx, e.altKey)); },
        onCancel() { if (drag) { drag.snap.end(); drag.preview.cancel(); drag = null; reposition(); } },
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && current && !drag) clear();
    });

    return {
        select,
        selectAt,
        nudge,
        duplicate,
        remove: () => host.remove(),
        clear,
        /** Call after every layout: the figure may have moved. */
        refresh() {
            if (!current) return;
            if (getSession() !== current.session || !node()) return clear();
            reposition();
        },
        get selected() { return current?.start ?? null; },
        /** True for the elements this draws, so a click on them does not count as a click elsewhere. */
        owns: (target) => !!target.closest?.('.figure-bar, .figure-handle, .inspector'),
        dispose() { clear(); frame.remove(); bar.remove(); handle.remove(); ring.remove(); inspector.dispose(); },
    };
}

