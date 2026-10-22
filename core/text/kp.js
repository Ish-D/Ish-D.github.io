/**
 * Optimal line breaking after Knuth & Plass, "Breaking Paragraphs into Lines" (1981).
 *
 * Items are boxes, glue and penalties; the last item must be a forced break
 * (penalty -Infinity), usually preceded by fill glue (see `finishParagraph`).
 * Line widths may vary per line, which is how columns, drop caps and text
 * wrapped around shapes are expressed.
 */

/** @typedef {import('../types.js').Item} Item */

const INF = Infinity;

/** Badness of a line that cannot be stretched to fit (TeX's inf_bad). */
export const INF_BAD = 10000;

/** Demerits assigned to any line whose badness reaches INF_BAD. */
const AWFUL_DEMERITS = 1e8;

/** Stretch of the fill glue closing a paragraph. */
export const FILL = 1e9;

export const defaults = Object.freeze({
    /** Max badness in the first pass, which ignores soft (hyphenation) breaks. */
    pretolerance: 100,
    /** Max badness once soft breaks are allowed. */
    tolerance: 200,
    linePenalty: 10,
    adjDemerits: 10000,
    doubleHyphenDemerits: 10000,
    /** A hyphen on a third line in a row; far worse than a second, so it only happens when nothing else fits. */
    tripleHyphenDemerits: 100000,
    finalHyphenDemerits: 5000,
    /** Extra stretch per line, used in a third pass to rescue loose paragraphs. */
    emergencyStretch: 0,
    /** Extra stretch granted to a line (a number, or a function of the 0-based line index); makes ragged text breakable. */
    lineStretch: 0,
    /** First line index from which lineWidth is constant; lets equal states merge. */
    uniformFromLine: INF,
    /**
     * How far a line may hang past the edges of its slot (hanging punctuation): `lead(line, first)` on the left
     * of line `line`, which starts with the box at item `first`, and `trail(line, index)` on the right of the
     * line that ends at break `index`. Both give px, and a hung edge adds that much to the line's width.
     * @type {{ lead(line: number, first: number): number, trail(line: number, index: number): number } | null}
     */
    protrusion: null,
});

export const box = (width) => ({ kind: 'box', width });
export const glue = (width, stretch, shrink) => ({ kind: 'glue', width, stretch, shrink });
/**
 * A penalty of `value` (+Infinity forbids the break). `relaxedTo` makes a ban a preference: it holds in every pass
 * but the last ones, which allow the break at that cost when a paragraph cannot be set without it.
 */
export const penalty = (width, value, flagged = false, soft = false, relaxedTo = undefined) =>
    (relaxedTo === undefined ? { kind: 'penalty', width, penalty: value, flagged, soft } : { kind: 'penalty', width, penalty: value, flagged, soft, relaxedTo });

/** Returns a copy of `items` closed with fill glue and a forced break. */
export function finishParagraph(items) {
    return [...items, glue(0, FILL, 0), penalty(0, -INF)];
}

/**
 * @typedef {Object} LineBreak
 * @property {number} index        item index of the break (glue or penalty)
 * @property {number} line         0-based index of the line this break ends
 * @property {number} ratio        adjustment ratio the optimizer used (<0 shrink, >0 stretch)
 * @property {number} width        target width of the line, including what hangs past each edge
 * @property {number} lead         px of the line's first box that hang past the left edge of the slot
 * @property {number} trail        px of its last box that hang past the right edge
 * @property {number} natural      natural width, including a penalty's width
 * @property {number} stretch      total glue stretch on the line (excludes emergency/line stretch)
 * @property {number} shrink       total glue shrink on the line
 * @property {boolean} flagged
 * @property {number} fitness      0 very loose, 1 loose, 2 decent, 3 tight
 * @property {number} demerits     cumulative
 */

/**
 * @typedef {Object} BreakResult
 * @property {LineBreak[]} breaks
 * @property {boolean} feasible    false only for an empty paragraph
 * @property {'pretolerance' | 'tolerance' | 'emergency' | 'desperate' | 'relaxed' | 'overfull' | 'none'} pass
 *   which pass produced the result; `relaxed` allowed breaks that were forbidden only as a preference (an item's
 *   `relaxedTo`), and the last two mean the paragraph could not be set within tolerance
 * @property {{ threshold: number, extraStretch: number }} params   settings of the pass that succeeded
 */

/**
 * @param {Item[]} items
 * @param {number | ((line: number) => number)} lineWidth   width of line `line` (0-based)
 * @param {Partial<typeof defaults>} [options]
 * @returns {BreakResult}
 */
export function breakLines(items, lineWidth, options = {}) {
    const o = { ...defaults, ...options };
    const widthOf = typeof lineWidth === 'function' ? lineWidth : () => lineWidth;
    const n = items.length;
    if (n === 0) return { breaks: [], feasible: false, pass: 'none', params: { threshold: 0, extraStretch: 0 } };
    const last = items[n - 1];
    if (last.kind !== 'penalty' || last.penalty !== -INF) {
        throw new Error('breakLines: the last item must be a forced break (use finishParagraph)');
    }

    const hasSoft = items.some(it => it.kind === 'penalty' && it.soft);
    const hasPreference = items.some(it => it.kind === 'penalty' && it.relaxedTo !== undefined);
    const passes = [];
    if (hasSoft && o.pretolerance >= 0) {
        passes.push({ name: 'pretolerance', threshold: o.pretolerance, soft: false, extraStretch: 0, overfull: false, relaxed: false });
    }
    passes.push({ name: 'tolerance', threshold: o.tolerance, soft: true, extraStretch: 0, overfull: false, relaxed: false });
    if (o.emergencyStretch > 0) {
        passes.push({ name: 'emergency', threshold: o.tolerance, soft: true, extraStretch: o.emergencyStretch, overfull: false, relaxed: false });
    }
    passes.push({ name: 'desperate', threshold: INF_BAD, soft: true, extraStretch: o.emergencyStretch, overfull: false, relaxed: false });
    if (hasPreference) {
        passes.push({ name: 'relaxed', threshold: INF_BAD, soft: true, extraStretch: o.emergencyStretch, overfull: false, relaxed: true });
    }
    passes.push({ name: 'overfull', threshold: INF_BAD, soft: true, extraStretch: o.emergencyStretch, overfull: true, relaxed: hasPreference });

    for (const pass of passes) {
        const breaks = runPass(items, widthOf, o, pass);
        if (breaks) {
            return {
                breaks,
                feasible: true,
                pass: pass.name,
                params: { threshold: pass.threshold, extraStretch: pass.extraStretch },
            };
        }
    }
    return { breaks: [], feasible: false, pass: 'none', params: { threshold: INF_BAD, extraStretch: 0 } };
}

export function badness(ratio) {
    if (ratio === INF || ratio === -INF) return INF_BAD;
    const b = 100 * Math.abs(ratio) ** 3;
    return b > INF_BAD ? INF_BAD : b;
}

export function fitnessClass(ratio, bad) {
    if (ratio < 0) return bad > 12 ? 3 : 2;
    if (bad > 99) return 0;
    return bad > 12 ? 1 : 2;
}

/**
 * @typedef {Object} Node
 * @property {number} index
 * @property {number} line        lines completed before this node (clamped by uniformFromLine)
 * @property {number} fitness
 * @property {boolean} flagged
 * @property {number} run         hyphenated lines in a row ending here, at most 2
 * @property {number} demerits
 * @property {number} sw          running sums just after the break, discardables skipped
 * @property {number} sy
 * @property {number} sz
 * @property {number} first       item index of the first box of the line that starts here
 * @property {Node | null} prev
 * @property {Object | null} info   line ending at this node
 */

function runPass(items, widthOf, o, pass) {
    const n = items.length;
    /** @type {Node[]} */
    let active = [{
        index: -1, line: 0, fitness: 2, flagged: false, run: 0, demerits: 0,
        sw: 0, sy: 0, sz: 0, first: sumsAfterBreak(items, -1, 0, 0, 0).first, prev: null, info: null,
    }];
    let sw = 0, sy = 0, sz = 0;

    for (let i = 0; i < n; i++) {
        const it = items[i];
        if (it.kind === 'box') { sw += it.width; continue; }

        let legal = false;
        let pen = 0;
        let flagged = false;
        let extraWidth = 0;
        if (it.kind === 'glue') {
            legal = i > 0 && items[i - 1].kind === 'box';
        } else {
            const value = pass.relaxed && it.relaxedTo !== undefined ? it.relaxedTo : it.penalty;
            if (value < INF && (pass.soft || !it.soft)) {
                legal = true;
                pen = value;
                flagged = it.flagged;
                extraWidth = it.width;
            }
        }

        if (legal) {
            active = tryBreak(items, widthOf, o, pass, active, i, pen, flagged, extraWidth, sw, sy, sz);
            if (active.length === 0) return null;
        }

        if (it.kind === 'glue') { sw += it.width; sy += it.stretch; sz += it.shrink; }
    }

    let best = null;
    for (const node of active) {
        if (node.index === n - 1 && (best === null || node.demerits < best.demerits)) best = node;
    }
    if (!best) return null;

    const breaks = [];
    for (let node = best; node.prev; node = node.prev) breaks.push(node);
    breaks.reverse();
    return breaks.map((node, k) => ({
        index: node.index,
        line: k,
        ratio: node.info.ratio,
        width: node.info.width,
        lead: node.info.lead,
        trail: node.info.trail,
        natural: node.info.natural,
        stretch: node.info.stretch,
        shrink: node.info.shrink,
        flagged: node.flagged,
        fitness: node.fitness,
        demerits: node.demerits,
    }));
}

function tryBreak(items, widthOf, o, pass, active, i, pen, flagged, extraWidth, sw, sy, sz) {
    const n = items.length;
    const isFinal = i === n - 1;
    const forced = pen === -INF;
    const kept = [];
    const best = new Map();
    let lastDeactivated = null;
    let lastDeactivatedInfo = null;

    for (const a of active) {
        const lead = o.protrusion ? o.protrusion.lead(a.line, a.first) : 0;
        const trail = o.protrusion && !isFinal ? o.protrusion.trail(a.line, i) : 0;
        const width = widthOf(a.line) + lead + trail;
        const natural = sw - a.sw + extraWidth;
        const stretch = sy - a.sy;
        const shrink = sz - a.sz;
        const lineStretch = typeof o.lineStretch === 'function' ? o.lineStretch(a.line) : o.lineStretch;
        const effectiveStretch = stretch + pass.extraStretch + lineStretch;

        let ratio;
        if (natural < width) ratio = effectiveStretch > 0 ? (width - natural) / effectiveStretch : INF;
        else if (natural > width) ratio = shrink > 0 ? (width - natural) / shrink : -INF;
        else ratio = 0;

        if (ratio < -1 || forced) {
            if (ratio < -1 && (!lastDeactivated || a.demerits < lastDeactivated.demerits)) {
                lastDeactivated = a;
                lastDeactivatedInfo = { ratio, width, lead, trail, natural, stretch, shrink };
            }
        } else {
            kept.push(a);
        }
        if (ratio < -1) continue;

        const bad = badness(ratio);
        if (bad > pass.threshold) continue;

        let d = o.linePenalty + bad;
        d = d >= INF_BAD ? AWFUL_DEMERITS : d * d;
        if (pen > 0) d += pen * pen;
        else if (pen > -INF) d -= pen * pen;
        if (a.flagged && (isFinal ? true : flagged)) d += isFinal ? o.finalHyphenDemerits : o.doubleHyphenDemerits;
        if (flagged && a.run >= 2) d += o.tripleHyphenDemerits;
        const fit = fitnessClass(ratio, bad);
        if (Math.abs(fit - a.fitness) > 1) d += o.adjDemerits;

        const total = a.demerits + d;
        const line = Math.min(a.line + 1, o.uniformFromLine);
        const run = flagged ? Math.min(2, a.run + 1) : 0;
        const key = (line * 4 + fit) * 3 + run;
        const prior = best.get(key);
        if (!prior || total < prior.total) {
            best.set(key, { total, from: a, line, fit, run, info: { ratio, width, lead, trail, natural, stretch, shrink } });
        }
    }

    const created = [];
    if (best.size > 0) {
        const lineMin = new Map();
        for (const c of best.values()) {
            const m = lineMin.get(c.line);
            if (m === undefined || c.total < m) lineMin.set(c.line, c.total);
        }
        const after = sumsAfterBreak(items, i, sw, sy, sz);
        for (const c of best.values()) {
            if (c.total > lineMin.get(c.line) + o.adjDemerits) continue;
            created.push({
                index: i, line: c.line, fitness: c.fit, flagged, run: c.run, demerits: c.total,
                sw: after.sw, sy: after.sy, sz: after.sz, first: after.first, prev: c.from, info: c.info,
            });
        }
    } else if (pass.overfull && kept.length === 0 && lastDeactivated) {
        const after = sumsAfterBreak(items, i, sw, sy, sz);
        created.push({
            index: i, line: Math.min(lastDeactivated.line + 1, o.uniformFromLine), fitness: 3, flagged,
            run: flagged ? Math.min(2, lastDeactivated.run + 1) : 0, demerits: lastDeactivated.demerits, sw: after.sw, sy: after.sy, sz: after.sz, first: after.first,
            prev: lastDeactivated, info: lastDeactivatedInfo,
        });
    }
    return kept.concat(created);
}

/** Running sums once the glue at `i` and any discardables after it are dropped, and where the next line's first box is. */
function sumsAfterBreak(items, i, sw, sy, sz) {
    const n = items.length;
    let w = sw, y = sy, z = sz;
    if (i >= 0 && items[i].kind === 'glue') { w += items[i].width; y += items[i].stretch; z += items[i].shrink; }
    let j = i + 1;
    for (; j < n; j++) {
        const it = items[j];
        if (it.kind === 'box') break;
        if (it.kind === 'glue') { w += it.width; y += it.stretch; z += it.shrink; }
        else if (it.penalty === -INF) break;
    }
    return { sw: w, sy: y, sz: z, first: j };
}

/**
 * Item ranges per line: [start, end) where `end` is the break item itself.
 * @param {Item[]} items
 * @param {LineBreak[]} breaks
 */
export function splitLines(items, breaks) {
    const lines = [];
    let start = 0;
    for (const b of breaks) {
        lines.push({ start, end: b.index, brk: b });
        let next = b.index + 1;
        while (next < items.length && items[next].kind !== 'box') {
            if (items[next].kind === 'penalty' && items[next].penalty === -INF) break;
            next++;
        }
        start = next;
    }
    return lines;
}

/**
 * Glue stretch/shrink multiplier to apply on a rendered line, from the line's real
 * (non-emergency) stretch. Returns 0 for lines that need no adjustment and for
 * lines closed by fill glue, which absorbs the slack.
 * @param {LineBreak} brk
 * @param {number} [maxStretch]   cap for underfull lines
 */
export function displayRatio(brk, maxStretch = 3) {
    if (brk.natural < brk.width) {
        if (brk.stretch <= 0 || brk.stretch >= FILL / 2) return 0;
        return Math.min((brk.width - brk.natural) / brk.stretch, maxStretch);
    }
    if (brk.natural > brk.width) {
        if (brk.shrink <= 0) return 0;
        return Math.max((brk.width - brk.natural) / brk.shrink, -1);
    }
    return 0;
}
