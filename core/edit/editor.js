/**
 * In-place editor: click a block and it turns into a text box holding that
 * block's source; everything around reflows while you type; click away and the
 * block renders again.
 *
 * The text box lives in an overlay layer outside the rendered document so
 * relayouts never rebuild it (which would drop focus). The layout reserves a
 * slot of the box's height (see `env.editing`) and this controller places the
 * box over that slot after every layout.
 */

import { expandToLines, closeRange, shiftRange } from './ranges.js';
import { bandInsets, createEditorBox, typographyOf } from './editor-box.js';

const MAX_SETTLE_PASSES = 4;
const INPUT_DEBOUNCE_MS = 100;

/**
 * @param {Object} deps
 * @param {Document} deps.document
 * @param {ReturnType<import('./session.js').createSession>} deps.session
 * @param {() => any} deps.getLayout            current layout
 * @param {(editing: { start: number, end: number, height: number, x?: number, width?: number } | null) => void} deps.setEditing   tells the app which region to reserve, then relayouts
 * @param {() => void} deps.onSourceChange      called after the session text changed
 * @param {() => number} [deps.originX]         page x of the layout's x = 0 (the page is centred when previewing a narrower screen)
 * @param {(text: string) => void} [deps.onLost]  called with typed text that could not be put back in the page
 */
export function createEditor({ document, session, getLayout, setEditing, onSourceChange, onLost = () => {}, originX = () => 0 }) {
    let enabled = false;
    let active = null;
    let timer = 0;
    let passes = 0;
    let burst = 0;
    let committing = false;

    const overlay = document.createElement('div');
    overlay.className = 'editor-overlay';
    document.body.appendChild(overlay);

    /** The editor slot in the layout and, when it sits in a margin note, that note. */
    const slotOf = (layout) => {
        const find = (items) => items.find(i => i.type === 'editor');
        const inPage = find(layout.blocks);
        if (inPage) return { slot: inPage, note: null };
        for (const note of layout.notes) {
            const slot = find(note.items);
            if (slot) return { slot, note };
        }
        return { slot: null, note: null };
    };

    const fit = () => {
        const needed = Math.ceil(active.field.height);
        active.box.style.height = `${needed}px`;
        active.field.refresh();
        return needed;
    };

    const place = () => {
        const layout = getLayout();
        if (!active || !layout) return;
        const { slot, note } = slotOf(layout);
        if (!slot) return;
        const box = active.box;
        // a note set on its side is edited on its side: the box turns with it
        const origin = note?.rotate ? note.box : { x: 0, y: 0 };
        box.style.left = `${originX() + origin.x + slot.x}px`;
        box.style.top = `${origin.y + slot.y}px`;
        box.style.width = `${slot.width}px`;
        box.style.transformOrigin = note?.rotate ? `${-slot.x}px ${-slot.y}px` : '';
        box.style.transform = note?.rotate ? `rotate(${note.rotate}deg)` : '';
        active.slot = slot;
        if (slot.bands) active.field.setBands(bandInsets(slot.bands, slot.x, slot.width), slot.lineHeight);
    };

    /** The region to reserve in the layout. */
    const request = (height) => ({ start: active.range.start, end: active.range.end, height });

    const reserve = () => {
        const height = fit();
        active.height = height;
        setEditing(request(height));
    };

    /** Takes the box away without writing it back. */
    const discard = () => {
        if (!active) return;
        clearTimeout(timer);
        const typed = active.field.value;
        const unsaved = typed !== active.base;
        active.field.input.removeEventListener('blur', onBlur);
        active.box.remove();
        active = null;
        setEditing(null);
        if (unsaved) onLost(typed);
    };

    /** After a reload or an undo: if the words being edited are still in the text exactly once, the box can follow them. */
    const relocate = () => {
        const at = session.source.indexOf(active.base);
        if (at === -1 || at !== session.source.lastIndexOf(active.base)) return false;
        active.range.start = at;
        active.range.end = at + active.base.length;
        return true;
    };

    // Something else changed the text (a drag, undo, a reload): keep the box
    // over the same words, or let it go if they were touched.
    const unsubscribe = session.subscribe((change) => {
        if (!active || committing) return;
        const moved = change.edit ? shiftRange(active.range, change.edit) : null;
        if (!moved) return relocate() || discard();
        active.range.start = moved.start;
        active.range.end = moved.end;
    });

    const commitText = () => {
        if (!active) return;
        const { range, field } = active;
        // the box must still be over the text it was opened on, or writing it back would land in the wrong place
        if (session.source.slice(range.start, range.end) !== active.base) return discard();
        const text = field.value;
        committing = true;
        try { session.apply({ start: range.start, end: range.end, text }, { group: `edit-${active.burst}` }); } finally { committing = false; }
        range.end = range.start + text.length;
        const closed = active.exact ? range : closeRange(session.doc, range);
        if (closed.start !== range.start || closed.end !== range.end) {
            const caret = field.selectionStart + (range.start - closed.start);
            range.start = closed.start;
            range.end = closed.end;
            field.value = session.source.slice(range.start, range.end);
            field.setSelectionRange(caret, caret);
        }
        active.base = session.source.slice(range.start, range.end);
        onSourceChange();
        passes = 0;
        reserve();
    };

    const onInput = () => {
        clearTimeout(timer);
        timer = setTimeout(commitText, INPUT_DEBOUNCE_MS);
    };

    const onKey = (e) => {
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault();
            api.close();
        }
    };

    const onBlur = () => {
        setTimeout(() => {
            if (active && !active.field.hasFocus) api.close();
        }, 120);
    };

    const api = {
        get enabled() { return enabled; },
        get active() { return active; },

        setEnabled(value) {
            enabled = value;
            document.body.classList.toggle('editing', value);
            if (!value) api.close();
        },

        /**
         * Opens the editor on a source range (widened to whole lines).
         * `hint` is the text around the click, used to put the caret there.
         */
        open(start, end, hint = '', from = null) {
            api.close();
            // a note's text is edited as it is, not widened to the paragraph that holds the note
            const exact = !!from?.matches?.('aside.note');
            const closed = exact ? { start, end } : closeRange(session.doc, expandToLines(session.source, start, end));
            const rendered = from ?? document.querySelector(`[data-start="${closed.start}"]`);
            const field = createEditorBox({
                document,
                text: session.source.slice(closed.start, closed.end),
                typography: typographyOf(rendered, document.defaultView),
            });
            for (const type of ['input', 'keydown', 'blur']) field.input.addEventListener(type, { input: onInput, keydown: onKey, blur: onBlur }[type]);
            overlay.appendChild(field.box);
            active = { range: { ...closed }, base: session.source.slice(closed.start, closed.end), exact, box: field.box, field, burst: ++burst, height: 0, slot: null };
            passes = 0;
            reserve();
            field.focus({ preventScroll: true });
            const caret = caretFromHint(field.value, hint);
            field.setSelectionRange(caret, caret);
        },

        /**
         * Handles a click in edit mode; returns true when it opened an editor.
         * `point` is the clicked position in the page, used to place the caret.
         */
        handleClick(target, point = null) {
            if (!enabled) return false;
            const el = target.closest?.('aside.note[data-start]') ?? target.closest?.('[data-start]');
            if (!el || el.closest?.('.editor-overlay')) return false;
            api.open(Number(el.dataset.start), Number(el.dataset.end), hintAt(document, point), el);
            return true;
        },

        close() {
            if (!active) return;
            clearTimeout(timer);
            commitText();
            if (!active) return;
            active.field.input.removeEventListener('blur', onBlur);
            active.box.remove();
            active = null;
            setEditing(null);
        },

        dispose() {
            unsubscribe();
            api.setEnabled(false);
            overlay.remove();
        },

        /** Call after every layout: positions the box and re-reserves if its height changed. */
        afterLayout() {
            if (!active) return;
            place();
            const needed = fit();
            if (Math.abs(needed - active.height) > 1 && passes < MAX_SETTLE_PASSES) {
                passes++;
                active.height = needed;
                setEditing(request(needed));
            }
        },
    };
    return api;
}

/** Text around a point: the clicked text node's words near the offset. */
function hintAt(document, point) {
    if (!point || !document.caretRangeFromPoint) return '';
    const range = document.caretRangeFromPoint(point.x, point.y);
    const node = range?.startContainer;
    if (!node || node.nodeType !== 3) return '';
    const text = node.textContent;
    const at = range.startOffset;
    const before = text.slice(Math.max(0, at - 18), at);
    const after = text.slice(at, at + 18);
    return `${before}\u0000${after}`;
}

/** Caret offset in `source` for a hint made by hintAt (before and after text joined by NUL). */
export function caretFromHint(source, hint) {
    const split = hint.indexOf('\u0000');
    if (split === -1) return source.length;
    const before = hint.slice(0, split).trim();
    const after = hint.slice(split + 1).trim();
    const probes = [`${before} ${after}`.trim(), before, after].filter(p => p.length >= 4);
    for (const probe of probes) {
        const at = source.indexOf(probe);
        if (at !== -1) return probe === after ? at : at + (probe === before ? before.length : before.length + (before ? 1 : 0));
    }
    return source.length;
}
