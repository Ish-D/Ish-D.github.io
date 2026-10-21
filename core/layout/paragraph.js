/**
 * Sets one paragraph into line slots: builds items, breaks them optimally for
 * the widths of the slots they will occupy, and returns positioned lines
 * with the runs a renderer needs.
 */

import { breakLines, splitLines, displayRatio } from '../text/kp.js';
import { buildItems } from '../text/items.js';

/** @typedef {import('../text/items.js').Span} Span */

const NBSP = '\u00A0';

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
 * @property {boolean} last
 * @property {boolean} overflow     placed beyond the last available slot
 * @property {number} ratio         glue adjustment applied (<0 shrink, >0 stretch)
 * @property {number} natural       content width before adjustment
 */

/**
 * @typedef {Object} ParagraphOptions
 * @property {'justify' | 'left' | 'right' | 'center'} [align]
 * @property {number} [indent]        first-line indent in px
 * @property {boolean} [uniform]      all slot widths are equal; lets the optimizer merge states
 * @property {number} [raggedStretch] slack a ragged line may have before it is penalized, in px
 * @property {number} [raggedBelow]   justified text sets lines in slots narrower than this ragged; default 10 em
 * @property {object} [kp]            overrides for the line breaker
 */

/**
 * @param {Span[]} spans
 * @param {{ measurer: import('../types.js').Measurer, hyphenator?: any, params?: object, kp?: object }} ctx
 * @param {ReturnType<import('./slots.js').slotStream>} stream
 * @param {ParagraphOptions} [opts]
 */
export function layoutParagraph(spans, ctx, stream, opts = {}) {
    const align = opts.align ?? 'justify';
    const justify = align === 'justify';
    const params = { ...(justify ? {} : { hyphenPenalty: 200 }), ...ctx.params, justify };
    const { items, info, markers } = buildItems(spans, { ...ctx, params });
    const indent = opts.indent ?? 0;

    if (!items.some(it => it.kind === 'box')) {
        return { lines: [], items, info, result: null, overflow: 0 };
    }

    const fontSize = spans.find(s => s.kind === 'text')?.font.size ?? 16;
    const widthOf = (j) => Math.max(1, stream.width(j) - (j === 0 ? indent : 0));
    const raggedStretch = opts.raggedStretch ?? 2 * fontSize;
    const raggedBelow = justify && !opts.uniform ? (opts.raggedBelow ?? 10 * fontSize) : 0;
    const isRagged = (j) => !justify || widthOf(j) < raggedBelow;
    const result = breakLines(items, widthOf, {
        lineStretch: justify && raggedBelow === 0 ? 0 : (j) => (isRagged(j) ? raggedStretch : 0),
        uniformFromLine: opts.uniform ? 1 : Infinity,
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
        return {
            x: (slot ? slot.x : 0) + lead + shift,
            y: slot ? slot.y : NaN,
            width: slot ? slot.width - lead - shift : brk.width,
            column: slot ? slot.column : -1,
            runs,
            markers: [],
            hyphenated,
            last: j === ranges.length - 1,
            overflow: !slot,
            ratio,
            natural: brk.natural,
        };
    });

    assignMarkers(lines, ranges, markers, items, info);
    return { lines, items, info, result, overflow: lines.filter(l => l.overflow).length };
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
        lines[target].markers.push({ ref: m.ref, x });
    }
}
