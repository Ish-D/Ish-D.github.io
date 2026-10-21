/**
 * Turns styled inline content into Knuth-Plass items.
 *
 * Words are boxes, spaces are stretchable glue, hyphenation and dash
 * opportunities are penalties. Inline atoms (math, images, widgets) are boxes.
 * Markers (note anchors, jump targets) take no width; each remembers the index
 * of the item that follows so a placed line can report where they landed.
 */

import { box, glue, penalty, FILL } from './kp.js';

const INF = Infinity;
const NBSP = '\u00A0';
const NARROW_NBSP = '\u202F';
const ATOM_CHAR = '\uFFFC';

/** @typedef {import('../types.js').FontSpec} FontSpec */
/** @typedef {import('../types.js').Measurer} Measurer */
/** @typedef {import('../types.js').Item} Item */

/**
 * @typedef {Object} TextSpan
 * @property {'text'} kind
 * @property {string} text
 * @property {FontSpec} font
 * @property {boolean} [noHyphen]     no hyphenation or hyphen breaks inside (code, URLs)
 * @property {any} [ref]              opaque handle for the renderer (style, link, source node)
 */
/**
 * @typedef {Object} AtomSpan
 * @property {'atom'} kind
 * @property {number} width
 * @property {number} height
 * @property {any} [ref]
 */
/** @typedef {{ kind: 'marker', ref?: any }} MarkerSpan */
/** @typedef {{ kind: 'break' }} BreakSpan */
/** @typedef {TextSpan | AtomSpan | MarkerSpan | BreakSpan} Span */

export const defaultParams = Object.freeze({
    hyphenate: true,
    hyphenPenalty: 50,
    explicitHyphenPenalty: 50,
    dashPenalty: 50,
    /** Stretch and shrink of a space, as fractions of its width. */
    spaceStretch: 0.5,
    spaceShrink: 1 / 3,
    /** Spaces get no stretch or shrink when false (ragged text). */
    justify: true,
    /** Forbid a break before the last word so the final line is never a single word. */
    keepLastTwo: true,
    /** Shortest letter run the hyphenator is asked about. */
    minHyphenWord: 5,
});

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
const isTie = (ch) => ch === NBSP || ch === NARROW_NBSP;
const isAlnum = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

export const fontKey = (f) =>
    `${f.family}|${f.size}|${f.weight ?? ''}|${f.style ?? ''}|${f.smallCaps ? 1 : 0}`;

/**
 * @typedef {Object} ItemInfo
 * @property {'text' | 'atom' | 'space' | 'tie' | 'hyphen' | 'dash' | 'fill' | 'end'} role
 * @property {number} [span]
 * @property {number} [from]     range inside spans[span].text (boxes)
 * @property {number} [to]
 * @property {number} [at]       index of the space character (glue)
 */

/**
 * @param {Span[]} spans
 * @param {{ measurer: Measurer, hyphenator?: { points(word: string): number[] }, params?: Partial<typeof defaultParams> }} ctx
 * @returns {{ items: Item[], info: ItemInfo[], markers: { at: number, ref: any }[] }}
 */
export function buildItems(spans, ctx) {
    const p = { ...defaultParams, ...ctx.params };
    const { measurer, hyphenator } = ctx;
    const items = [];
    const info = [];
    const markers = [];

    const memo = (fn) => {
        const cache = new Map();
        return (font) => {
            const k = fontKey(font);
            let v = cache.get(k);
            if (v === undefined) { v = fn(font); cache.set(k, v); }
            return v;
        };
    };
    const spaceWidth = memo(font => measurer.width(' ', font));
    const hyphenWidth = memo(font => measurer.width('-', font));

    const push = (item, meta) => { items.push(item); info.push(meta); };
    const pushGlue = (font, meta) => {
        const w = spaceWidth(font);
        push(glue(w, p.justify ? w * p.spaceStretch : 0, p.justify ? w * p.spaceShrink : 0), meta);
    };

    let word = null;
    let pendingSpace = null;
    let lineHasContent = false;

    const flushWord = () => {
        if (!word) return;
        const w = word;
        word = null;
        if (w.frags.length === 0) {
            for (const m of w.markers) markers.push({ at: items.length, ref: m.ref });
            return;
        }
        if (pendingSpace && lineHasContent) {
            pushGlue(pendingSpace.font, { role: 'space', span: pendingSpace.span, at: pendingSpace.at });
        }
        pendingSpace = null;
        lineHasContent = true;
        emitWord(w);
    };

    const emitWord = (w) => {
        let text = '';
        const segs = [];
        for (const f of w.frags) {
            const t = f.type === 'text' ? spans[f.span].text.slice(f.from, f.to)
                : f.type === 'atom' ? ATOM_CHAR : NBSP;
            segs.push({ frag: f, start: text.length, end: text.length + t.length });
            text += t;
        }
        const textSegAt = (offset) => segs.find(s => s.frag.type === 'text' && offset >= s.start && offset < s.end);

        /** @type {Map<number, 'dash' | 'explicit' | 'soft'>} */
        const cuts = new Map();
        for (const s of segs) {
            if (s.frag.type !== 'text' || spans[s.frag.span].noHyphen) continue;
            for (let k = s.start; k < s.end; k++) {
                const ch = text[k];
                if (ch === '-' && isAlnum(text[k - 1]) && isAlnum(text[k + 1])) cuts.set(k + 1, 'explicit');
                else if ((ch === '\u2014' || ch === '\u2013') && k + 1 < text.length) cuts.set(k + 1, 'dash');
            }
        }
        if (p.hyphenate && hyphenator) {
            for (const m of text.matchAll(/\p{L}+/gu)) {
                if (m[0].length < p.minHyphenWord) continue;
                const seg = textSegAt(m.index);
                if (!seg || spans[seg.frag.span].noHyphen) continue;
                for (const pt of hyphenator.points(m[0])) {
                    if (!cuts.has(m.index + pt)) cuts.set(m.index + pt, 'soft');
                }
            }
        }

        const bounds = [0, ...[...cuts.keys()].filter(k => k > 0 && k < text.length).sort((a, b) => a - b), text.length];
        const pieceFirstItem = [];
        for (let k = 0; k < bounds.length - 1; k++) {
            const b0 = bounds[k];
            const b1 = bounds[k + 1];
            pieceFirstItem.push(items.length);
            for (const s of segs) {
                const lo = Math.max(b0, s.start);
                const hi = Math.min(b1, s.end);
                if (lo >= hi) continue;
                const f = s.frag;
                if (f.type === 'atom') {
                    push(box(f.width), { role: 'atom', span: f.span });
                } else if (f.type === 'tie') {
                    push(penalty(0, INF, false), { role: 'tie', span: f.span });
                    pushGlue(f.font, { role: 'tie', span: f.span });
                } else {
                    const full = spans[f.span].text;
                    const from = f.from + (lo - s.start);
                    const to = f.from + (hi - s.start);
                    const prefix = (n) => (n === f.from ? 0 : measurer.width(full.slice(f.from, n), f.font));
                    push(box(prefix(to) - prefix(from)), { role: 'text', span: f.span, from, to });
                }
            }
            if (k < bounds.length - 2) {
                const kind = cuts.get(b1);
                const seg = textSegAt(b1 - 1);
                if (kind === 'dash') push(penalty(0, p.dashPenalty, false), { role: 'dash' });
                else if (kind === 'explicit') push(penalty(0, p.explicitHyphenPenalty, true), { role: 'hyphen', span: seg.frag.span });
                else push(penalty(hyphenWidth(seg.frag.font), p.hyphenPenalty, true, true), { role: 'hyphen', span: seg.frag.span });
            }
        }

        for (const m of w.markers) {
            let piece = bounds.length - 2;
            for (let j = 0; j < bounds.length - 1; j++) {
                if (m.offset < bounds[j + 1]) { piece = j; break; }
            }
            markers.push({ at: m.offset >= text.length ? items.length : pieceFirstItem[piece], ref: m.ref });
        }
    };

    const wordLength = () => word.frags.reduce((n, f) => n + (f.type === 'text' ? f.to - f.from : 1), 0);

    for (let si = 0; si < spans.length; si++) {
        const span = spans[si];
        if (span.kind === 'text') {
            for (let i = 0; i < span.text.length; i++) {
                const ch = span.text[i];
                if (isSpace(ch)) {
                    flushWord();
                    pendingSpace ??= { span: si, at: i, font: span.font };
                    continue;
                }
                word ??= { frags: [], markers: [] };
                if (isTie(ch)) {
                    word.frags.push({ type: 'tie', span: si, font: span.font });
                    continue;
                }
                const last = word.frags[word.frags.length - 1];
                if (last && last.type === 'text' && last.span === si && last.to === i) last.to = i + 1;
                else word.frags.push({ type: 'text', span: si, from: i, to: i + 1, font: span.font });
            }
        } else if (span.kind === 'atom') {
            word ??= { frags: [], markers: [] };
            word.frags.push({ type: 'atom', span: si, width: span.width });
        } else if (span.kind === 'marker') {
            word ??= { frags: [], markers: [] };
            word.markers.push({ offset: wordLength(), ref: span.ref });
        } else if (span.kind === 'break') {
            flushWord();
            pendingSpace = null;
            push(glue(0, FILL, 0), { role: 'fill' });
            push(penalty(0, -INF, false), { role: 'end' });
            lineHasContent = false;
        }
    }
    flushWord();

    closeParagraph(items, info, markers, p.keepLastTwo);
    return { items, info, markers };
}

function closeParagraph(items, info, markers, keepLastTwo) {
    if (keepLastTwo) tieLastTwoWords(items, info, markers);
    const end = items[items.length - 1];
    if (!end || end.kind !== 'penalty' || end.penalty !== -INF) {
        items.push(glue(0, FILL, 0));
        info.push({ role: 'fill' });
        items.push(penalty(0, -INF, false));
        info.push({ role: 'end' });
    }
}

/** Forbids the break before the final word of the last line segment. */
function tieLastTwoWords(items, info, markers) {
    for (let i = items.length - 1; i > 0; i--) {
        const it = items[i];
        if (it.kind === 'penalty' && it.penalty === -INF) return;
        if (it.kind === 'glue' && info[i].role === 'space') {
            items.splice(i, 0, penalty(0, INF, false));
            info.splice(i, 0, { role: 'tie' });
            for (const m of markers) if (m.at > i) m.at++;
            return;
        }
    }
}
