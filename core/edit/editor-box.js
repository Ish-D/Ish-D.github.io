/**
 * The box used for editing a block's source. It is set in the block's own
 * typeface, size, line height and alignment, and its lines wrap around the same
 * figures, contents box and drop cap that the page wraps around, so editing
 * looks like the page. The markup (directives, braces, heading marks, emphasis)
 * is dimmed behind the prose: an editable layer with transparent text sits over
 * a mirror that carries the colors.
 */

import { contours, toPath } from '../layout/contour.js';

const SYNTAX = /\[\[[^\]\n]*\]\]|^#{1,6}[ \t]|\*{1,3}|[{}]|\$\$?|`+/gm;

/**
 * Splits source into prose and markup runs; joining the texts gives the source back.
 * @returns {Array<{ text: string, syntax: boolean }>}
 */
export function highlightSource(source) {
    const out = [];
    let last = 0;
    for (const m of source.matchAll(SYNTAX)) {
        if (m.index > last) out.push({ text: source.slice(last, m.index), syntax: false });
        out.push({ text: m[0], syntax: true });
        last = m.index + m[0].length;
    }
    if (last < source.length) out.push({ text: source.slice(last), syntax: false });
    return out;
}

/**
 * How far each line band is blocked from the left and from the right.
 * `bands` lists, per band, the blocked [from, to] stretches in page coordinates;
 * the box spans [x, x + width]. A stretch in the middle leaves the text on
 * whichever side has more room.
 * @returns {Array<{ left: number, right: number }>}
 */
export function bandInsets(bands, x, width) {
    const end = x + width;
    return bands.map((stretches) => {
        let left = 0;
        let right = 0;
        for (const [from, to] of stretches) {
            const a = Math.max(from, x);
            const b = Math.min(to, end);
            if (b <= a) continue;
            const touchesLeft = a <= x + 0.5;
            const touchesRight = b >= end - 0.5;
            if (touchesLeft && touchesRight) { left = width; continue; }
            if (touchesLeft) left = Math.max(left, b - x);
            else if (touchesRight) right = Math.max(right, end - a);
            else if (a - x >= end - b) right = Math.max(right, end - a);
            else left = Math.max(left, b - x);
        }
        return { left, right };
    });
}

const BODY_FALLBACK = { fontFamily: 'inherit', fontSize: '16px', fontWeight: 'normal', fontStyle: 'normal', lineHeight: '1.5', textAlign: 'left' };

/**
 * Typography of the rendered block `el` (or of the page's body text when the
 * element is not a text block).
 * @param {Element | null} el
 * @param {Window} view
 */
export function typographyOf(el, view) {
    const block = el?.closest?.('.blk, .codeblock, aside.note') ?? null;
    // a note's type is that of the lines inside it
    const source = block?.querySelector?.('.blk') ?? block ?? el?.ownerDocument?.querySelector('.blk-paragraph') ?? null;
    if (!source) return BODY_FALLBACK;
    const cs = view.getComputedStyle(source);
    const align = source?.dataset?.align;
    return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        lineHeight: cs.lineHeight,
        textAlign: align === 'center' ? 'center' : align === 'right' ? 'right' : source?.classList?.contains('blk-paragraph') && !block?.matches?.('aside.note') ? 'justify' : 'left',
    };
}

/** The text of an editable element, with line breaks as newlines. */
function readText(node) {
    let out = '';
    for (const child of node.childNodes) {
        if (child.nodeType === 3) out += child.data;
        else if (child.nodeName === 'BR') out += '\n';
        else {
            // a block the browser made for a line break starts a new line
            if (child.nodeName === 'DIV' || child.nodeName === 'P') out += out && !out.endsWith('\n') ? '\n' : '';
            out += readText(child);
        }
    }
    return out;
}

/** The text node and offset where character `offset` of the element's text sits. */
function locate(root, offset) {
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    let remaining = offset;
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        last = node;
        if (remaining <= node.data.length) return { node, offset: remaining };
        remaining -= node.data.length;
    }
    return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 };
}

/**
 * @param {{ document: Document, text: string, typography: ReturnType<typeof typographyOf> }} options
 */
export function createEditorBox({ document, text, typography }) {
    const box = document.createElement('div');
    box.className = 'editor-box';
    const mirror = document.createElement('div');
    mirror.className = 'editor-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    const mirrorText = document.createElement('div');
    mirror.appendChild(mirrorText);
    const input = document.createElement('div');
    input.className = 'editor-input';
    input.spellcheck = true;
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-multiline', 'true');
    let plainOnly = true;
    try { input.contentEditable = 'plaintext-only'; } catch { plainOnly = false; }
    plainOnly = plainOnly && input.contentEditable === 'plaintext-only';
    if (!plainOnly) input.contentEditable = 'true';
    input.textContent = text;
    const NS = 'http://www.w3.org/2000/svg';
    const outline = document.createElementNS(NS, 'svg');
    outline.setAttribute('class', 'editor-outline');
    outline.setAttribute('aria-hidden', 'true');
    const outlinePath = document.createElementNS(NS, 'path');
    outline.appendChild(outlinePath);
    box.append(mirror, input, outline);
    Object.assign(box.style, typography);

    const offsetOf = (node, at) => {
        const range = document.createRange();
        range.selectNodeContents(input);
        range.setEnd(node, at);
        return range.toString().length;
    };
    /** Replaces the selection with plain `text` and puts the caret after it. */
    const insertPlain = (text) => {
        const sel = document.defaultView.getSelection();
        if (!sel || sel.rangeCount === 0 || !input.contains(sel.anchorNode)) return;
        const range = sel.getRangeAt(0);
        const from = offsetOf(range.startContainer, range.startOffset);
        const to = offsetOf(range.endContainer, range.endOffset);
        const current = readText(input);
        input.textContent = current.slice(0, from) + text + current.slice(to);
        const at = locate(input, from + text.length);
        const caret = document.createRange();
        caret.setStart(at.node, at.offset);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
    };
    input.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
            e.preventDefault();
            insertPlain('\n');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (e.inputType === 'insertFromPaste' && e.dataTransfer) {
            e.preventDefault();
            insertPlain(e.dataTransfer.getData('text/plain'));
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    const paint = () => {
        mirrorText.replaceChildren();
        for (const run of highlightSource(readText(input))) {
            if (run.syntax) {
                const span = document.createElement('span');
                span.className = 'ed-syntax';
                span.textContent = run.text;
                mirrorText.appendChild(span);
            } else {
                mirrorText.appendChild(document.createTextNode(run.text));
            }
        }
        // a final newline would otherwise collapse and shorten the mirror
        mirrorText.appendChild(document.createTextNode('\u200b'));
    };
    /** One row per line of text as it is laid out right now, measured from the box. */
    const rows = () => {
        const range = document.createRange();
        range.selectNodeContents(input);
        const base = input.getBoundingClientRect();
        const lineHeight = parseFloat(document.defaultView.getComputedStyle(input).lineHeight) || base.height || 1;
        const byLine = new Map();
        for (const r of range.getClientRects()) {
            if (r.width === 0 && r.height === 0) continue;
            const i = Math.max(0, Math.round((r.top - base.top) / lineHeight));
            const row = byLine.get(i) ?? { x0: Infinity, x1: -Infinity };
            row.x0 = Math.min(row.x0, r.left - base.left);
            row.x1 = Math.max(row.x1, r.right - base.left);
            byLine.set(i, row);
        }
        const last = Math.max(-1, ...byLine.keys());
        const out = [];
        for (let i = 0, prev = { x0: 0, x1: base.width }; i <= last; i++) {
            const row = byLine.get(i) ?? prev;   // a blank line keeps the shape of the one above
            out.push({ x0: row.x0, x1: row.x1, y0: i * lineHeight, y1: (i + 1) * lineHeight });
            prev = row;
        }
        return out.length ? out : [{ x0: 0, x1: base.width, y0: 0, y1: lineHeight }];
    };
    /** Redraws the outline and limits the clickable area to the text. */
    const refresh = () => {
        const shape = contours(rows(), { pad: 4 });
        outlinePath.setAttribute('d', toPath(shape));
        input.style.clipPath = `path('${toPath(shape)}')`;
    };
    paint();
    input.addEventListener('input', () => { paint(); refresh(); });

    let signature = '';
    /** Makes the lines wrap around what the page wraps around. Call after every layout. */
    const setBands = (insets, lineHeight) => {
        const key = `${lineHeight}|${insets.map(b => `${Math.round(b.left)},${Math.round(b.right)}`).join(';')}`;
        if (key === signature) return;
        signature = key;
        for (const parent of [box, mirror]) {
            for (const old of parent.querySelectorAll(':scope > .ex')) old.remove();
        }
        if (!insets.some(b => b.left > 0 || b.right > 0)) { refresh(); return; }
        // a float per band, stacked, gives the same ragged edge as the page's slots
        const make = (side, width) => {
            const el = document.createElement('i');
            el.className = 'ex';
            el.style.cssText = `float:${side};clear:${side};width:${width}px;height:${lineHeight}px`;
            return el;
        };
        for (const [parent, before] of [[box, mirror], [mirror, mirrorText]]) {
            for (const { left, right } of insets) {
                parent.insertBefore(make('left', left), before);
                parent.insertBefore(make('right', right), before);
            }
        }
        refresh();
    };

    return {
        box,
        repaint: paint,
        refresh,
        setBands,
        /** The editable element, for events. */
        input,
        get value() { return readText(input); },
        set value(next) { input.textContent = next; paint(); refresh(); },
        get selectionStart() {
            const sel = box.ownerDocument.defaultView.getSelection();
            if (!sel || sel.rangeCount === 0 || !input.contains(sel.anchorNode)) return 0;
            const range = box.ownerDocument.createRange();
            range.selectNodeContents(input);
            range.setEnd(sel.anchorNode, sel.anchorOffset);
            return range.toString().length;
        },
        setSelectionRange(start, end = start) {
            const sel = box.ownerDocument.defaultView.getSelection();
            const a = locate(input, start);
            const b = locate(input, end);
            const range = box.ownerDocument.createRange();
            range.setStart(a.node, a.offset);
            range.setEnd(b.node, b.offset);
            sel.removeAllRanges();
            sel.addRange(range);
        },
        focus(options) { input.focus(options); },
        get hasFocus() { return box.ownerDocument.activeElement === input; },
        /** Height of the text, in px. */
        get height() { return input.offsetHeight; },
    };
}
