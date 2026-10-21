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

import { expandToLines, closeRange } from './ranges.js';
import { createEditorBox, typographyOf } from './editor-box.js';

const MAX_SETTLE_PASSES = 4;
const INPUT_DEBOUNCE_MS = 100;

/**
 * @param {Object} deps
 * @param {Document} deps.document
 * @param {ReturnType<import('./session.js').createSession>} deps.session
 * @param {() => any} deps.getLayout            current layout
 * @param {(editing: { start: number, end: number, height: number, x?: number, width?: number } | null) => void} deps.setEditing   tells the app which region to reserve, then relayouts
 * @param {() => void} deps.onSourceChange      called after the session text changed
 */
export function createEditor({ document, session, getLayout, setEditing, onSourceChange }) {
    let enabled = false;
    let active = null;
    let timer = 0;
    let passes = 0;
    let burst = 0;

    const overlay = document.createElement('div');
    overlay.className = 'editor-overlay';
    document.body.appendChild(overlay);

    const slotOf = (layout) => {
        const find = (items) => items.find(i => i.type === 'editor');
        return find(layout.blocks) ?? layout.notes.map(n => find(n.items)).find(Boolean) ?? null;
    };

    const fit = () => {
        const ta = active.textarea;
        ta.style.height = 'auto';
        const needed = Math.ceil(ta.scrollHeight);
        ta.style.height = `${needed}px`;
        return needed;
    };

    const place = () => {
        const layout = getLayout();
        if (!active || !layout) return;
        const slot = slotOf(layout);
        if (slot) {
            const box = active.box;
            box.style.left = `${slot.x}px`;
            box.style.top = `${slot.y}px`;
            box.style.width = `${slot.width}px`;
            active.slot = slot;
        }
    };

    /** The region to reserve in the layout: where the block was drawn, so it keeps clear of floats. */
    const request = (height) => ({ start: active.range.start, end: active.range.end, height, x: active.x, width: active.width });

    const reserve = () => {
        const height = fit();
        active.height = height;
        setEditing(request(height));
    };

    const commitText = () => {
        if (!active) return;
        const { range, textarea } = active;
        const text = textarea.value;
        session.apply({ start: range.start, end: range.end, text }, { group: `edit-${active.burst}` });
        range.end = range.start + text.length;
        const closed = closeRange(session.doc, range);
        if (closed.start !== range.start || closed.end !== range.end) {
            const caret = textarea.selectionStart + (range.start - closed.start);
            range.start = closed.start;
            range.end = closed.end;
            textarea.value = session.source.slice(range.start, range.end);
            textarea.setSelectionRange(caret, caret);
            active.repaint();
        }
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
            if (active && document.activeElement !== active.textarea) api.close();
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
            const range = expandToLines(session.source, start, end);
            const closed = closeRange(session.doc, range);
            const rendered = from ?? document.querySelector(`[data-start="${closed.start}"]`);
            const { box, textarea, repaint } = createEditorBox({
                document,
                text: session.source.slice(closed.start, closed.end),
                typography: typographyOf(rendered, document.defaultView),
            });
            textarea.addEventListener('input', onInput);
            textarea.addEventListener('keydown', onKey);
            textarea.addEventListener('blur', onBlur);
            overlay.appendChild(box);
            const drawn = measureDrawn(getLayout(), rendered);
            active = { range: { ...closed }, x: drawn.x, width: drawn.width, box, textarea, repaint, burst: ++burst, height: 0, slot: null };
            passes = 0;
            reserve();
            textarea.focus({ preventScroll: true });
            const caret = caretFromHint(textarea.value, hint);
            textarea.setSelectionRange(caret, caret);
        },

        /**
         * Handles a click in edit mode; returns true when it opened an editor.
         * `point` is the clicked position in the page, used to place the caret.
         */
        handleClick(target, point = null) {
            if (!enabled) return false;
            const el = target.closest?.('[data-start]');
            if (!el || el.closest?.('.editor-overlay')) return false;
            api.open(Number(el.dataset.start), Number(el.dataset.end), hintAt(document, point), el);
            return true;
        },

        close() {
            if (!active) return;
            clearTimeout(timer);
            commitText();
            active.textarea.removeEventListener('blur', onBlur);
            active.box.remove();
            active = null;
            setEditing(null);
        },

        dispose() {
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

/**
 * Where a text block's lines were drawn, so the editor can sit in the same
 * place beside a float: the left edge and width most of its lines share (a
 * drop cap shortens the first few). Centered and right-aligned text uses the whole measure.
 */
function measureDrawn(layout, rendered) {
    const start = Number(rendered?.dataset?.start);
    const block = layout?.blocks.find(b => b.node?.start === start && b.lines);
    if (!block || (block.align && block.align !== 'left' && block.align !== 'justify')) return {};
    const counts = new Map();
    for (const l of block.lines) {
        if (l.overflow) continue;
        const key = `${Math.round(l.x)}:${Math.round(l.width)}`;
        const entry = counts.get(key) ?? { x: l.x, width: l.width, n: 0 };
        entry.n++;
        counts.set(key, entry);
    }
    const common = [...counts.values()].sort((a, b) => b.n - a.n || b.width - a.width)[0];
    return common ? { x: common.x, width: common.width } : {};
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
