/**
 * Sets one paragraph into line slots: builds items, breaks them optimally for
 * the widths of the slots they will occupy, and returns positioned lines
 * with the runs a renderer needs. The paragraph is set with typographic
 * punctuation; the spans it was set from come back with the result.
 * Punctuation at the edge of a column may hang in the margin.
 */

import { breakLines, splitLines, displayRatio } from '../text/kp.js';
import { buildItems } from '../text/items.js';
import { typographicSpans } from '../text/punctuation.js';
import { leftHang, rightHang } from '../text/protrusion.js';

/** @typedef {import('../text/items.js').Span} Span */

const NBSP = '\u00A0';

/** Justified text needs a measure of about 60 characters to keep its spaces even; a narrower column is set ragged. */
const JUSTIFY_FROM = 30;
/** Even in a wide column, a slot this narrow beside a figure is set ragged. */
const NARROW_SLOT = 22;

/**
 * @typedef {Object} Run
 * @property {'text' | 'atom' | 'hyphen'} kind
 * @property {number} span          index into the spans passed to layoutParagraph
 * @property {string} [text]
 * @property {number} wordSpacing   px added to each space character in the run
 * @property {number} width         natural width plus spacing adjustments
 */

/**
 * @typedef {Object} PlacedLine
 * @property {number} x
 * @property {number} y
 * @property {number} width         width of the slot
 * @property {number} column
 * @property {Run[]} runs
 * @property {{ ref: any, x: number }[]} markers    x is relative to the line's left edge
 * @property {boolean} hyphenated
 * @property {'space' | 'hyphen' | 'none' | 'end'} join   what the break after this line stands for: a space between words, a hyphen
 *   inside a word, an existing hyphen or an address, or the end of the text
 * @property {boolean} last
 * @property {boolean} overflow     placed beyond the last available slot
 * @property {{ left: number, right: number }} hung   px of the line that stand outside its slot; `x` and `width` include them
 * @property {number} ratio         glue adjustment applied (<0 shrink, >0 stretch)
 * @property {number} natural       content width before adjustment
 */

/**
 * @typedef {Object} ParagraphOptions
 * @property {'justify' | 'left' | 'right' | 'center'} [align]
 * @property {number} [indent]        first-line indent in px
 * @property {boolean} [uniform]      all slot widths are equal; lets the optimizer merge states
 * @property {number} [raggedStretch] slack a ragged line may have before it is penalized, in px
 * @property {number} [raggedBelow]   justified text sets lines in slots narrower than this ragged; by default all of it when the column is under 30 em, else slots under 22 em
 * @property {'both' | 'left' | 'none'} [hang]   which edges of a column punctuation may hang past; default none
 * @property {object} [kp]            overrides for the line breaker
 */

/**
 * @param {Span[]} source   the paragraph as written; `result.spans` is the same with typographic punctuation
 * @param {{ measurer: import('../types.js').Measurer, hyphenator?: any, params?: object, kp?: object }} ctx
 * @param {ReturnType<import('./slots.js').slotStream>} stream
 * @param {ParagraphOptions} [opts]
 */
export function layoutParagraph(source, ctx, stream, opts = {}) {
    const spans = typographicSpans(source);
    const align = opts.align ?? 'justify';
    const justify = align === 'justify';
    const params = { ...(justify ? {} : { hyphenPenalty: 200 }), ...ctx.params, justify };
    const { items, info, markers } = buildItems(spans, { ...ctx, params });
    const indent = opts.indent ?? 0;

    if (!items.some(it => it.kind === 'box')) {
        return { lines: [], spans, items, info, result: null, overflow: 0 };
    }

    const fontSize = spans.find(s => s.kind === 'text')?.font.size ?? 16;
    const widthOf = (j) => Math.max(1, stream.width(j) - (j === 0 ? indent : 0));
    const raggedStretch = opts.raggedStretch ?? 2 * fontSize;
    const measure = stream.measure ?? stream.width(0);
    const raggedBelow = !justify ? 0 : opts.raggedBelow ?? (measure < JUSTIFY_FROM * fontSize ? Infinity : NARROW_SLOT * fontSize);
    const isRagged = (j) => !justify || widthOf(j) < raggedBelow;
    const protrusion = opts.hang && opts.hang !== 'none'
        ? hangingPunctuation({ items, info, spans, measurer: ctx.measurer, stream, edges: opts.hang, indent })
        : null;
    const result = breakLines(items, widthOf, {
        lineStretch: justify && raggedBelow === 0 ? 0 : (j) => (isRagged(j) ? raggedStretch : 0),
        uniformFromLine: opts.uniform ? 1 : Infinity,
        protrusion,
        ...ctx.kp,
        ...opts.kp,
    });

    const ranges = splitLines(items, result.breaks);
    const lines = ranges.map((range, j) => {
        const slot = stream.get(j);
        const brk = range.brk;
        const narrow = justify && j < Infinity && raggedBelow > 0 && isRagged(j);
        const ratio = narrow ? Math.min(displayRatio(brk), 0) : displayRatio(brk);
        const slack = justify ? 0 : Math.max(0, brk.width - brk.natural);
        const shift = align === 'center' ? slack / 2 : align === 'right' ? slack : 0;
        const { runs, hyphenated } = lineRuns(items, info, spans, range, ratio);
        const lead = j === 0 ? indent : 0;
        const hung = { left: brk.lead ?? 0, right: brk.trail ?? 0 };
        return {
            x: (slot ? slot.x : 0) + lead + shift - hung.left,
            y: slot ? slot.y : NaN,
            width: slot ? slot.width - lead - shift + hung.left + hung.right : brk.width,
            hung,
            column: slot ? slot.column : -1,
            runs,
            markers: [],
            hyphenated,
            join: joinAfter(items[range.end]),
            last: j === ranges.length - 1,
            overflow: !slot,
            ratio,
            natural: brk.natural,
        };
    });

    assignMarkers(lines, ranges, markers, items, info);
    return { lines, spans, items, info, result, overflow: lines.filter(l => l.overflow).length };
}

/**
 * What each line may hang past the edges of its slot. Only slots that reach the edge of their column
 * hang, so text beside a drop cap or a figure keeps its edge; `edges` is 'left' for text set ragged.
 */
function hangingPunctuation({ items, info, spans, measurer, stream, edges, indent }) {
    const edgesOf = (line) => stream.edges?.(line) ?? { left: true, right: true };
    const piece = (index) => {
        const meta = info[index];
        if (items[index].kind !== 'box' || meta.role !== 'text') return null;
        const span = spans[meta.span];
        // code and addresses keep their edges
        return span && !span.noHyphen ? { text: span.text.slice(meta.from, meta.to), font: span.font } : null;
    };
    return {
        lead(line, first) {
            if ((line === 0 && indent > 0) || !edgesOf(line).left) return 0;
            const p = piece(first);
            const fraction = p ? leftHang(p.text) : 0;
            return fraction ? fraction * measurer.width(p.text[0], p.font) : 0;
        },
        trail(line, index) {
            if (edges !== 'both' || !edgesOf(line).right) return 0;
            const item = items[index];
            if (item.kind === 'penalty' && item.width > 0) return item.width * rightHang('-');
            let j = index - 1;
            while (j >= 0 && items[j].kind !== 'box') j--;
            const p = j >= 0 ? piece(j) : null;
            const fraction = p ? rightHang(p.text) : 0;
            return fraction ? fraction * measurer.width(p.text[p.text.length - 1], p.font) : 0;
        },
    };
}

/** What a line break at `item` stands for. */
function joinAfter(item) {
    if (item.kind === 'glue') return 'space';
    if (item.penalty === -Infinity) return 'end';
    return item.width > 0 ? 'hyphen' : 'none';
}

const spaceAdjust = (item, ratio) => (ratio >= 0 ? ratio * item.stretch : ratio * item.shrink);

function lineRuns(items, info, spans, range, ratio) {
    const runs = [];
    let current = null;

    const flush = () => { if (current) runs.push(current); current = null; };
    const addText = (spanIndex, text, width, spacing) => {
        if (current && current.span === spanIndex) {
            current.text += text;
            current.width += width;
            if (spacing) current.wordSpacing = spacing;
        } else {
            flush();
            current = { kind: 'text', span: spanIndex, text, wordSpacing: spacing, width };
        }
    };

    for (let i = range.start; i < range.end; i++) {
        const item = items[i];
        const meta = info[i];
        if (item.kind === 'box') {
            if (meta.role === 'atom') {
                flush();
                runs.push({ kind: 'atom', span: meta.span, wordSpacing: 0, width: item.width });
            } else {
                addText(meta.span, spans[meta.span].text.slice(meta.from, meta.to), item.width, 0);
            }
        } else if (item.kind === 'glue' && (meta.role === 'space' || meta.role === 'tie')) {
            const adjust = spaceAdjust(item, ratio);
            addText(meta.span, meta.role === 'tie' ? NBSP : ' ', item.width + adjust, adjust);
        }
    }

    let hyphenated = false;
    const brkItem = items[range.end];
    if (brkItem.kind === 'penalty' && brkItem.width > 0) {
        hyphenated = true;
        flush();
        runs.push({ kind: 'hyphen', span: info[range.end].span, text: '-', wordSpacing: 0, width: brkItem.width });
    }
    flush();
    return { runs, hyphenated };
}

function assignMarkers(lines, ranges, markers, items, info) {
    for (const m of markers) {
        let target = ranges.length - 1;
        for (let j = 0; j < ranges.length; j++) {
            if (m.at <= ranges[j].end) { target = j; break; }
        }
        const range = ranges[target];
        const ratio = lines[target].ratio;
        let x = 0;
        for (let i = range.start; i < Math.min(m.at, range.end); i++) {
            const item = items[i];
            if (item.kind === 'box') x += item.width;
            else if (item.kind === 'glue' && (info[i].role === 'space' || info[i].role === 'tie')) {
                x += item.width + spaceAdjust(item, ratio);
            }
        }
        lines[target].markers.push({ ref: m.ref, x: x + lines[target].hung.left });
    }
}
