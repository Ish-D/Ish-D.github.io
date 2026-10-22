/**
 * Parser for the site's markdown-ish DSL. Produces the document tree described
 * in core/types.js: every node carries its exact [start, end) source range.
 *
 * Block structure is line based. A paragraph ends at a blank line or at a line
 * that starts another block. Directive groups `{...}` are brace matched and may
 * span any number of lines. Directive heads stay on one line; code spans, math
 * and links stay inside their paragraph.
 *
 * Recovery rules for unterminated constructs:
 * - `{` group: a block-form group (`{` alone on the line after a standalone
 *   head) ends before the next blank line; any other group ends where its
 *   paragraph would end (blank line or a line that starts a block); inside
 *   headings and list items it ends at the line end.
 * - `[[`, `(`, `$`, `$$`, backticks: the opening characters become text.
 * - code fence: the block ends before the next blank line.
 * - front matter: without a closing `---` the lines are parsed as body.
 *
 * @typedef {import('../types.js').Doc} Doc
 * @typedef {import('../types.js').Block} Block
 * @typedef {import('../types.js').Inline} Inline
 * @typedef {import('../types.js').Directive} Directive
 * @typedef {import('../types.js').Diagnostic} Diagnostic
 * @typedef {import('./directives.js').DirectiveSpec} DirectiveSpec
 *
 * @typedef {Object} ParseOptions
 * @property {Record<string, DirectiveSpec>} [directives]   schema table; defaults to ./directives.js
 */

import { directives as defaultDirectives } from './directives.js';

const NL = 10, CR = 13, SP = 32, TAB = 9;
const BANG = 33, DQUOTE = 34, HASH = 35, DOLLAR = 36, SQUOTE = 39, LPAREN = 40, RPAREN = 41;
const STAR = 42, COMMA = 44, DASH = 45, DOT = 46, SLASH = 47, COLON = 58, GT = 62;
const LBRACKET = 91, BACKSLASH = 92, RBRACKET = 93, BACKTICK = 96, LBRACE = 123, PIPE = 124, RBRACE = 125;

/** Inline scanning modes. */
const PARA = 0, LINE = 1, FIXED = 2;

/** Token kinds produced by the inline scanner. */
const TEXT = 0, ESC = 1, CODE = 2, MATH = 3, DIR = 4, LINK = 5, IMAGE = 6, DELIM = 7;

/** Item kinds used while resolving emphasis. */
const ITEM_TEXT = 0, ITEM_DELIM = 1, ITEM_NODE = 2;

/** Nesting limit for groups, blockquotes, link text and emphasis. */
const MAX_DEPTH = 64;

const SPECIAL = new Uint8Array(128);
for (const c of [NL, BACKSLASH, BACKTICK, DOLLAR, LBRACKET, LBRACE, BANG, STAR]) SPECIAL[c] = 1;

const UNICODE_SPACE = /\s/u;
const UNICODE_PUNCT = /[\p{P}\p{S}]/u;

/**
 * Parse a document. Never throws: problems are reported in `doc.diagnostics`.
 * @param {string} source
 * @param {ParseOptions} [options]
 * @returns {Doc}
 */
export function parse(source, options = {}) {
    const text = typeof source === 'string' ? source : String(source ?? '');
    try {
        return new Parser(text, options ?? {}).parseDoc();
    } catch (err) {
        return {
            type: 'doc',
            start: 0,
            end: text.length,
            source: text,
            frontmatter: null,
            children: text ? [{ type: 'raw', start: 0, end: text.length, text }] : [],
            diagnostics: [internalError(err)],
        };
    }
}

/**
 * Parse `source.slice(start, end)` as inline content with ranges into `source`.
 * Used for argument values that hold markup, e.g. a quote's author.
 * @param {string} source
 * @param {number} [start]
 * @param {number} [end]
 * @param {ParseOptions} [options]
 * @returns {{ children: Inline[], diagnostics: Diagnostic[] }}
 */
export function parseInline(source, start = 0, end = source?.length ?? 0, options = {}) {
    const text = typeof source === 'string' ? source : String(source ?? '');
    const s = clamp(start, 0, text.length);
    const e = clamp(end, s, text.length);
    try {
        const parser = new Parser(text, options ?? {});
        const children = parser.inlineRange(new View(text), s, e);
        return { children, diagnostics: parser.sortedDiagnostics() };
    } catch (err) {
        return { children: [], diagnostics: [internalError(err)] };
    }
}

/** @returns {Diagnostic} */
function internalError(err) {
    const message = err instanceof Error ? err.message : String(err);
    return { severity: 'error', message: `internal parser error: ${message}`, start: 0, end: 0 };
}

/**
 * Text being parsed plus a map back to source offsets. The document itself is
 * an identity view; a blockquote's content is a derived view with the `>`
 * prefixes removed.
 */
class View {
    /**
     * @param {string} source
     * @param {string} [text]
     * @param {number[] | null} [segV]   virtual start of each segment
     * @param {number[] | null} [segS]   source start of each segment
     */
    constructor(source, text = source, segV = null, segS = null) {
        this.source = source;
        this.text = text;
        this.segV = segV;
        this.segS = segS;
        /** @type {Int32Array | null} */
        this.escapedBraces = null;
        /** @type {Int32Array | null} */
        this.rawBraces = null;
        /** @type {Int32Array | null} */
        this.brackets = null;
        /** @type {Int32Array | null} */
        this.parens = null;
        this.closeFrom = -1;
        this.closeAt = -1;
    }

    /** Source offset of the character at virtual offset `v`. */
    src(v) {
        if (this.segV === null) return v;
        const k = this.segment(v, false);
        return this.segS[k] + (v - this.segV[k]);
    }

    /** Source offset just past the character before virtual offset `v`. */
    srcEnd(v) {
        if (this.segV === null) return v;
        if (v <= 0) return this.segS[0];
        const k = this.segment(v, true);
        return this.segS[k] + (v - this.segV[k]);
    }

    /** Source end for the virtual range [s, e). */
    end(s, e) {
        return e > s ? this.srcEnd(e) : this.src(s);
    }

    /** Index of the last segment starting at or before `v` (strictly before when `strict`). */
    segment(v, strict) {
        const segV = this.segV;
        let lo = 0, hi = segV.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (strict ? segV[mid] < v : segV[mid] <= v) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    /** True when virtual offsets a and b (a === b) are also adjacent in the source. */
    contiguous(a, b) {
        return a === b && (this.segV === null || this.srcEnd(a) === this.src(b));
    }

    /** Calls fn for each part of [s, e) that is contiguous in the source. */
    pieces(s, e, fn) {
        if (this.segV === null) {
            fn(s, e);
            return;
        }
        let k = this.segment(s, false);
        let a = s;
        while (a < e) {
            const segEnd = k + 1 < this.segV.length ? this.segV[k + 1] : this.text.length;
            const b = Math.min(e, segEnd);
            if (b > a) fn(a, b);
            a = b;
            k++;
        }
    }

    /** Matching `}` for the `{` at `pos`, or -1. Raw matching ignores backslashes. */
    matchBrace(pos, raw) {
        if (raw) return (this.rawBraces ??= pairTable(this.text, LBRACE, RBRACE, false))[pos];
        return (this.escapedBraces ??= pairTable(this.text, LBRACE, RBRACE, true))[pos];
    }

    /** Matching `]` for the `[` at `pos`, or -1. */
    matchBracket(pos) {
        return (this.brackets ??= pairTable(this.text, LBRACKET, RBRACKET, true))[pos];
    }

    /** Matching `)` for the `(` at `pos`, or -1. */
    matchParen(pos) {
        return (this.parens ??= pairTable(this.text, LPAREN, RPAREN, true))[pos];
    }

    /** Index of the first `]]` at or after `pos`, or text.length. Cached for forward scans. */
    nextDoubleClose(pos) {
        if (pos < this.closeFrom || pos > this.closeAt) {
            const i = this.text.indexOf(']]', pos);
            this.closeFrom = pos;
            this.closeAt = i < 0 ? this.text.length : i;
        }
        return this.closeAt;
    }

    /**
     * View over the given lines of this view. Each line is { cs, le }: content
     * start and line end. Segments keep each line's newline except the last.
     */
    derive(lines) {
        let text = '';
        const segV = [], segS = [];
        for (let k = 0; k < lines.length; k++) {
            const { cs, le } = lines[k];
            const segEnd = k < lines.length - 1 ? le + 1 : le;
            segV.push(text.length);
            segS.push(this.src(cs));
            text += this.text.slice(cs, segEnd);
        }
        return new View(this.source, text, segV, segS);
    }
}

/**
 * For every `open` char the index of its matching `close` (or -1), matched
 * with a stack. With `escapes`, a backslash hides the next character.
 */
function pairTable(text, open, close, escapes) {
    const match = new Int32Array(text.length).fill(-1);
    const stack = [];
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === BACKSLASH && escapes) i++;
        else if (c === open) stack.push(i);
        else if (c === close && stack.length > 0) match[stack.pop()] = i;
    }
    return match;
}

/** A range of a view parsed as blocks, with per-line caches. */
class Region {
    constructor(view, start, end) {
        this.view = view;
        this.start = start;
        this.end = end;
        /** @type {Map<number, object | null>} line start -> block start descriptor */
        this.starts = new Map();
        /** @type {Map<number, boolean>} newline index -> paragraph stops there */
        this.stops = new Map();
    }
}

class Parser {
    /** @param {string} source @param {ParseOptions} options */
    constructor(source, options) {
        this.source = source;
        this.directives = options.directives ?? defaultDirectives;
        /** @type {Diagnostic[]} */
        this.diagnostics = [];
        this.slugCounts = new Map();
        this.depth = 0;
        this.deepReported = false;
    }

    diag(severity, message, start, end) {
        this.diagnostics.push({ severity, message, start, end });
    }

    sortedDiagnostics() {
        return this.diagnostics.sort((a, b) => a.start - b.start);
    }

    spec(name) {
        return Object.hasOwn(this.directives, name) ? this.directives[name] : undefined;
    }

    /** @returns {Doc} */
    parseDoc() {
        const source = this.source;
        const { frontmatter, bodyStart } = this.frontmatter();
        let children;
        if (frontmatter !== null && frontmatter.entries.encrypted?.value === 'true') {
            const [s, e] = trimRange(source, bodyStart, source.length);
            children = s < e ? [{ type: 'raw', start: s, end: e, text: source.slice(s, e) }] : [];
        } else {
            children = this.parseBlocks(new View(source), bodyStart, source.length);
        }
        return {
            type: 'doc',
            start: 0,
            end: source.length,
            source,
            frontmatter,
            children,
            diagnostics: this.sortedDiagnostics(),
        };
    }

    // -----------------------------------------------------------------------
    // Front matter
    // -----------------------------------------------------------------------

    frontmatter() {
        const s = this.source;
        const p = s.charCodeAt(0) === 0xfeff ? 1 : 0;
        const none = { frontmatter: null, bodyStart: p };
        if (!s.startsWith('---', p) || !isBlank(s, p + 3, lineEndOf(s, p, s.length))) return none;
        const entries = {};
        const duplicates = [];
        let ls = lineEndOf(s, p, s.length) + 1;
        while (ls < s.length) {
            const le = lineEndOf(s, ls, s.length);
            if (s.startsWith('---', ls) && isBlank(s, ls + 3, le)) {
                for (const d of duplicates) this.diag('warning', `duplicate front matter key '${d.key}'`, d.start, d.end);
                return { frontmatter: { start: p, end: le, entries }, bodyStart: Math.min(le + 1, s.length) };
            }
            const ks = skipSpaces(s, ls, le);
            if (ks < le) {
                let ke = ks;
                while (ke < le && isKeyChar(s.charCodeAt(ke))) ke++;
                const colon = skipSpaces(s, ke, le);
                if (ke === ks || s.charCodeAt(colon) !== COLON) break;
                const key = s.slice(ks, ke);
                const [vs, ve] = trimRange(s, colon + 1, le);
                if (Object.hasOwn(entries, key)) duplicates.push({ key, start: ks, end: ke });
                Object.defineProperty(entries, key, {
                    value: { value: s.slice(vs, ve), keyStart: ks, valueStart: vs, valueEnd: ve },
                    enumerable: true,
                    writable: true,
                    configurable: true,
                });
            }
            ls = le + 1;
        }
        this.diag('warning', "front matter has no closing '---'; parsed as body", p, p + 3);
        return none;
    }

    // -----------------------------------------------------------------------
    // Blocks
    // -----------------------------------------------------------------------

    /**
     * Parse view.text[from, to) as blocks.
     * @param {View} view
     * @returns {Block[]}
     */
    parseBlocks(view, from, to) {
        if (from >= to) return [];
        if (this.depth >= MAX_DEPTH) return this.tooDeepRaw(view, from, to);
        this.depth++;
        const region = new Region(view, from, to);
        const text = view.text;
        const blocks = [];
        let pos = from;
        while (pos < to) {
            const le = lineEndOf(text, pos, to);
            const ind = skipSpaces(text, pos, le);
            if (ind === le) {
                pos = le + 1;
                continue;
            }
            const start = this.blockStart(region, pos);
            const result = start === null ? this.paragraph(region, ind) : this.block(region, start, pos, le);
            if (result.next <= pos) throw new Error(`no progress at offset ${view.src(pos)}`);
            blocks.push(result.node);
            pos = result.next;
        }
        this.depth--;
        return blocks;
    }

    /** Blocks nested past MAX_DEPTH stay one raw block. */
    tooDeepRaw(view, from, to) {
        const [s, e] = trimRange(view.text, from, to);
        if (s === e) return [];
        const start = view.src(s), end = view.srcEnd(e);
        this.tooDeep(view, s);
        return [{ type: 'raw', start, end, text: this.source.slice(start, end) }];
    }

    /** Reports the nesting limit once per parse. */
    tooDeep(view, pos) {
        if (this.deepReported) return;
        this.deepReported = true;
        const at = view.src(pos);
        this.diag('warning', 'nesting too deep; inner content kept as text', at, at + 1);
    }

    /** Cached block start descriptor for the line at `ls`, or null for paragraph text. */
    blockStart(region, ls) {
        let start = region.starts.get(ls);
        if (start === undefined) {
            start = this.detectBlock(region, ls);
            region.starts.set(ls, start);
        }
        return start;
    }

    detectBlock(region, ls) {
        const text = region.view.text;
        const le = lineEndOf(text, ls, region.end);
        const ind = skipSpaces(text, ls, le);
        if (ind === le) return null;
        const c = text.charCodeAt(ind);
        if (ind === ls) {
            if (c === HASH) {
                const heading = headingAt(text, ls, le);
                if (heading !== null) return heading;
            } else if (c === DASH) {
                const rule = ruleAt(text, ls, le);
                if (rule !== null) return rule;
            } else if (c === GT) {
                return { kind: 'quote' };
            }
        }
        switch (c) {
            case BACKTICK:
                return fenceAt(text, ind, le);
            case DOLLAR:
                return this.mathBlockAt(region, ind);
            case LBRACKET:
            case LBRACE:
                return this.blockDirectiveAt(region, ind, le);
            case PIPE:
                return tableAt(text, ind, le, region.end);
            default:
                return listMarkerAt(text, ind, le);
        }
    }

    /** True when a paragraph must stop at the newline `nl`. */
    stopsAfter(region, nl) {
        let stop = region.stops.get(nl);
        if (stop === undefined) {
            const ls = nl + 1;
            stop = ls >= region.end || this.blockStartOrBlank(region, ls);
            region.stops.set(nl, stop);
        }
        return stop;
    }

    blockStartOrBlank(region, ls) {
        const text = region.view.text;
        const le = lineEndOf(text, ls, region.end);
        return skipSpaces(text, ls, le) === le || this.blockStart(region, ls) !== null;
    }

    block(region, start, ls, le) {
        switch (start.kind) {
            case 'heading':
                return this.heading(region, start, ls, le);
            case 'rule':
                return this.rule(region, start, ls);
            case 'quote':
                return this.blockquote(region, ls);
            case 'fence':
                return this.fence(region, start, le);
            case 'math':
                return this.mathBlock(region, start);
            case 'directive':
                return this.blockDirective(region, start.scan);
            case 'table':
                return this.table(region, ls, le);
            default:
                return this.list(region, start, ls);
        }
    }

    heading(region, start, ls, le) {
        const { view } = region;
        const text = view.text;
        const cs = start.contentStart;
        const { tokens, end } = this.scanInline({ view, mode: LINE, from: cs, limit: region.end, region });
        const ce = trimTokensEnd(tokens, text, cs);
        const children = this.buildInline(view, tokens);
        // a heading that is only links is a way to somewhere else, not a section: it has no address of its own
        const isLink = (c) => c.type === 'link' || (c.type === 'directive' && (c.name === 'link' || c.name === 'card'));
        const onlyLinks = children.some(isLink) && children.every(c => isLink(c) || (c.type === 'text' && !c.value.trim()));
        const node = {
            type: 'heading',
            start: view.src(ls),
            end: view.srcEnd(ce > cs ? ce : ls + start.level),
            level: start.level,
            id: onlyLinks ? null : this.headingId(text.slice(cs, le).trim()),
            children,
        };
        return { node, next: end + 1 };
    }

    /** Legacy slug of the heading's first line, made unique in document order. */
    headingId(title) {
        const slug = legacySlug(title);
        const count = this.slugCounts.get(slug) ?? 0;
        this.slugCounts.set(slug, count + 1);
        return count > 0 ? `${slug}-${count}` : slug;
    }

    rule(region, start, ls) {
        const { view } = region;
        const end = ls + start.length;
        const node = { type: 'rule', start: view.src(ls), end: view.srcEnd(end) };
        return { node, next: lineEndOf(view.text, end, region.end) + 1 };
    }

    blockquote(region, ls) {
        const { view } = region;
        const text = view.text;
        const lines = [];
        let pos = ls;
        while (pos < region.end && text.charCodeAt(pos) === GT) {
            const le = lineEndOf(text, pos, region.end);
            lines.push({ cs: skipSpaces(text, pos + 1, le), le });
            pos = le + 1;
        }
        const inner = view.derive(lines);
        const node = {
            type: 'blockquote',
            start: view.src(ls),
            end: view.srcEnd(lines[lines.length - 1].le),
            children: this.parseBlocks(inner, 0, inner.text.length),
        };
        return { node, next: pos };
    }

    fence(region, start, le) {
        const { view } = region;
        const text = view.text;
        const info = text.slice(start.infoStart, start.infoEnd).trim();
        const lang = info === '' ? null : info.split(/\s/, 1)[0];
        for (let ls = le + 1; ls < region.end; ) {
            const e = lineEndOf(text, ls, region.end);
            const i = skipSpaces(text, ls, e);
            let j = i;
            while (j < e && text.charCodeAt(j) === BACKTICK) j++;
            if (j - i >= start.ticks && isBlank(text, j, e)) {
                const node = {
                    type: 'code',
                    start: view.src(start.ind),
                    end: view.srcEnd(j),
                    lang,
                    text: ls > le + 1 ? text.slice(le + 1, ls - 1) : '',
                };
                return { node, next: e + 1 };
            }
            ls = e + 1;
        }
        const stop = blankLineAfter(text, start.ind, region.end);
        const end = Math.max(trimEnd(text, start.ind, stop), start.ind + start.ticks);
        const nodeStart = view.src(start.ind);
        this.diag('error', 'unclosed code fence', nodeStart, nodeStart + start.ticks);
        const node = {
            type: 'code',
            start: nodeStart,
            end: view.srcEnd(end),
            lang,
            text: stop > le ? text.slice(le + 1, stop) : '',
        };
        return { node, next: stop + 1 };
    }

    /** `$$...$$` standing alone; the math may span lines but not a blank line. */
    mathBlockAt(region, ind) {
        const { view } = region;
        const text = view.text;
        if (text.charCodeAt(ind + 1) !== DOLLAR || ind + 1 >= region.end) return null;
        const close = findMathEnd(view, ind + 2, region.end, true, (nl) => {
            const ls = nl + 1;
            return ls < region.end && !isBlank(text, ls, lineEndOf(text, ls, region.end));
        });
        if (close < 0 || !isBlank(text, close + 2, lineEndOf(text, close + 2, region.end))) return null;
        return { kind: 'math', ind, close };
    }

    mathBlock(region, start) {
        const { view } = region;
        const end = start.close + 2;
        const node = {
            type: 'math',
            start: view.src(start.ind),
            end: view.srcEnd(end),
            tex: view.text.slice(start.ind + 2, start.close),
        };
        return { node, next: lineEndOf(view.text, end, region.end) + 1 };
    }

    /** A directive standing alone on its line(s) whose schema allows a block. */
    blockDirectiveAt(region, ind, le) {
        const { view } = region;
        const text = view.text;
        let scan;
        if (text.charCodeAt(ind) === LBRACKET) {
            if (text.charCodeAt(ind + 1) !== LBRACKET || ind + 1 >= le) return null;
            scan = this.scanDirective(view, ind, PARA, region.end, region.start);
        } else {
            if (text.charCodeAt(ind + 1) !== LBRACE || ind + 1 >= le) return null;
            scan = scanMacro(text, ind, le);
        }
        if (!scan.ok || !isBlank(text, scan.end, lineEndOf(text, scan.end, region.end))) return null;
        const spec = this.spec(scan.name);
        if (spec !== undefined && !spec.block) return null;
        return { kind: 'directive', scan };
    }

    blockDirective(region, scan) {
        const node = this.buildDirective(region.view, scan, true);
        return { node, next: lineEndOf(region.view.text, scan.end, region.end) + 1 };
    }

    table(region, ls, le) {
        const { view } = region;
        const text = view.text;
        const header = rowRange(text, ls, le);
        const sepStart = le + 1;
        const sepEnd = lineEndOf(text, sepStart, region.end);
        const sep = rowRange(text, sepStart, sepEnd);
        const align = plainCells(text, sep).map(([s, e]) => {
            const left = text.charCodeAt(s) === COLON, right = text.charCodeAt(e - 1) === COLON;
            return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
        });
        const body = [];
        let pos = sepEnd + 1;
        while (pos < region.end) {
            const e = lineEndOf(text, pos, region.end);
            const row = rowRange(text, pos, e);
            if (row === null) break;
            body.push(row);
            pos = e + 1;
        }
        const cells = (row) => tableCells(view, row).map(([s, e]) => this.inlineRange(view, s, e));
        const last = body.length > 0 ? body[body.length - 1] : sep;
        const node = {
            type: 'table',
            start: view.src(header[0]),
            end: view.srcEnd(last[1]),
            align,
            header: cells(header),
            rows: body.map(cells),
        };
        return { node, next: pos };
    }

    list(region, first, ls) {
        const { view } = region;
        const text = view.text;
        const items = [];
        let marker = first, pos = ls;
        for (;;) {
            const cs = marker.contentStart;
            const { tokens, end } = this.scanInline({ view, mode: LINE, from: cs, limit: region.end, region });
            const ce = trimTokensEnd(tokens, text, cs);
            items.push({
                type: 'item',
                start: view.src(marker.ind),
                end: view.srcEnd(ce > cs ? ce : marker.markerEnd),
                children: this.buildInline(view, tokens),
            });
            pos = end + 1;
            if (pos >= region.end) break;
            const next = this.blockStart(region, pos);
            if (next === null || next.kind !== 'list' || next.ordered !== first.ordered) break;
            marker = next;
        }
        const node = {
            type: 'list',
            start: items[0].start,
            end: items[items.length - 1].end,
            ordered: first.ordered,
            items,
        };
        return { node, next: pos };
    }

    paragraph(region, ind) {
        const { view } = region;
        const text = view.text;
        const { tokens, end } = this.scanInline({ view, mode: PARA, from: ind, limit: region.end, region });
        const ce = trimTokensEnd(tokens, text, ind);
        const centered = stripCentered(tokens, text, ind, ce);
        const node = {
            type: 'paragraph',
            start: view.src(ind),
            end: view.srcEnd(ce),
            centered,
            children: this.buildInline(view, tokens),
        };
        return { node, next: end + 1 };
    }

    // -----------------------------------------------------------------------
    // Inline scanning
    // -----------------------------------------------------------------------

    /**
     * Inline content of view.text[from, limit) in the given mode. PARA stops at
     * a newline the paragraph cannot continue past; LINE stops at the first
     * newline; FIXED consumes the whole range. Newlines inside directive groups
     * never stop the scan.
     * @returns {{ tokens: object[], end: number }}
     */
    scanInline(ctx) {
        const { view, mode, limit } = ctx;
        const text = view.text;
        const tokens = [];
        let pos = ctx.from, textStart = pos;
        while (pos < limit) {
            const c = text.charCodeAt(pos);
            if (c >= 128 || SPECIAL[c] === 0) {
                pos++;
                continue;
            }
            if (c === NL) {
                if (mode === LINE || (mode === PARA && this.stopsAfter(ctx.region, pos))) break;
                pos++;
                continue;
            }
            const token = this.tokenAt(ctx, pos, c);
            if (token === null) {
                pos++;
                continue;
            }
            if (token.s > textStart) tokens.push({ k: TEXT, s: textStart, e: token.s });
            tokens.push(token);
            pos = textStart = token.e;
        }
        if (pos > textStart) tokens.push({ k: TEXT, s: textStart, e: pos });
        return { tokens, end: pos };
    }

    tokenAt(ctx, pos, c) {
        const { view, limit } = ctx;
        const text = view.text;
        const next = pos + 1 < limit ? text.charCodeAt(pos + 1) : -1;
        if (this.depth >= MAX_DEPTH && (c === LBRACKET || c === LBRACE || c === BANG)) {
            this.tooDeep(view, pos);
            return null;
        }
        switch (c) {
            case BACKSLASH:
                return isAsciiPunct(next) ? { k: ESC, s: pos, e: pos + 2 } : null;
            case BACKTICK:
                return this.codeSpanAt(ctx, pos);
            case DOLLAR:
                return this.mathAt(ctx, pos, next === DOLLAR);
            case LBRACKET:
                return next === LBRACKET ? this.directiveTokenAt(ctx, pos) : this.linkAt(ctx, pos, pos, LINK);
            case LBRACE: {
                if (next !== LBRACE) return null;
                const scan = scanMacro(text, pos, limit);
                if (scan.ok) return { k: DIR, s: pos, e: scan.end, scan };
                return pos + 2 < limit && isWordChar(text.charCodeAt(pos + 2)) ? { k: TEXT, s: pos, e: pos + 2, diag: scan.diag } : null;
            }
            case BANG:
                return next === LBRACKET ? this.linkAt(ctx, pos, pos + 1, IMAGE) : null;
            default:
                return delimAt(ctx, pos);
        }
    }

    /** Whether a construct being scanned may continue past the newline at `nl`. */
    canCross(ctx, nl) {
        return ctx.mode === FIXED || (ctx.mode === PARA && !this.stopsAfter(ctx.region, nl));
    }

    codeSpanAt(ctx, pos) {
        const { view, limit } = ctx;
        const text = view.text;
        let open = pos;
        while (open < limit && text.charCodeAt(open) === BACKTICK) open++;
        const n = open - pos;
        for (let i = open; i < limit; ) {
            const c = text.charCodeAt(i);
            if (c === NL) {
                if (!this.canCross(ctx, i)) break;
                i++;
            } else if (c === BACKTICK) {
                let j = i;
                while (j < limit && text.charCodeAt(j) === BACKTICK) j++;
                if (j - i === n) return { k: CODE, s: pos, e: j, cs: open, ce: i };
                i = j;
            } else {
                i++;
            }
        }
        return { k: TEXT, s: pos, e: open, diag: ['warning', 'unclosed code span', pos, open] };
    }

    mathAt(ctx, pos, display) {
        const { view, limit } = ctx;
        const open = display ? 2 : 1;
        const close = findMathEnd(view, pos + open, limit, display, (nl) => this.canCross(ctx, nl));
        if (close >= 0) return { k: MATH, s: pos, e: close + open, ts: pos + open, te: close };
        const message = display ? "unclosed '$$'" : "unclosed '$'";
        return { k: TEXT, s: pos, e: pos + open, diag: ['warning', message, pos, pos + open] };
    }

    directiveTokenAt(ctx, pos) {
        const regionStart = ctx.region ? ctx.region.start : ctx.from;
        const scan = this.scanDirective(ctx.view, pos, ctx.mode, ctx.limit, regionStart);
        if (scan.ok) return { k: DIR, s: pos, e: scan.end, scan };
        return { k: TEXT, s: pos, e: pos + 1, diag: scan.diag };
    }

    /** `[text](href)` or, with kind IMAGE, `![alt](src)` starting at `start`. */
    linkAt(ctx, start, bracket, kind) {
        const { view, limit } = ctx;
        const close = this.pairEnd(ctx, bracket, view.matchBracket(bracket));
        if (close < 0 || close + 1 >= limit || view.text.charCodeAt(close + 1) !== LPAREN) return null;
        const end = this.pairEnd(ctx, close + 1, view.matchParen(close + 1));
        if (end < 0) return null;
        return { k: kind, s: start, e: end + 1, ts: bracket + 1, te: close, hs: close + 2, he: end };
    }

    /** `match` (the partner of the char at `open`) if it is in range and reachable, else -1. */
    pairEnd(ctx, open, match) {
        if (match < 0 || match >= ctx.limit) return -1;
        if (ctx.mode !== FIXED) {
            const text = ctx.view.text;
            for (let i = open + 1; i < match; i++) {
                if (text.charCodeAt(i) === NL && !this.canCross(ctx, i)) return -1;
            }
        }
        return match;
    }

    // -----------------------------------------------------------------------
    // Directives
    // -----------------------------------------------------------------------

    /**
     * Scan `[[...]]` at `pos` plus its groups. Heads stay on one line; groups
     * are brace matched up to `limit`. Returns { ok: false, diag } on failure.
     */
    scanDirective(view, pos, mode, limit, regionStart) {
        const text = view.text;
        const lineEnd = lineEndOf(text, pos, limit);
        if (view.nextDoubleClose(pos + 2) + 2 > lineEnd) return failure("unclosed '[['", pos, pos + 2);
        const at = (i) => (i < lineEnd ? text.charCodeAt(i) : -1);
        const nameStart = pos + 2;
        let i = nameStart;
        while (i < lineEnd && isWordChar(text.charCodeAt(i))) i++;
        if (i > nameStart) {
            const name = text.slice(nameStart, i);
            const head = { form: 'call', name, start: pos, nameEnd: i, args: null };
            if (at(i) === LPAREN) {
                const args = scanArgs(text, i, lineEnd);
                if (args === null) return failure("unclosed '(' in directive arguments", pos, i + 1);
                if (at(args.close + 1) !== RBRACKET || at(args.close + 2) !== RBRACKET) {
                    return failure("expected ']]' after directive arguments", pos, args.close + 1);
                }
                head.args = { start: i, end: args.close + 1, items: args.items };
                return this.scanGroups(view, head, args.close + 3, mode, limit, regionStart);
            }
            if (at(i) === RBRACKET && at(i + 1) === RBRACKET) {
                const headEnd = i + 2;
                const brace = headEnd < limit && text.charCodeAt(headEnd) === LBRACE;
                const blockForm = mode === PARA && isLineStart(text, pos, regionStart) && nextLineBrace(text, headEnd, limit) >= 0;
                if (this.spec(name) !== undefined || brace || blockForm) {
                    return this.scanGroups(view, head, headEnd, mode, limit, regionStart);
                }
            }
        }
        return scanShortLink(text, pos, lineEnd);
    }

    scanGroups(view, head, headEnd, mode, limit, regionStart) {
        const text = view.text;
        const spec = this.spec(head.name);
        const lineStart = mode === PARA && isLineStart(text, head.start, regionStart);
        const groups = [];
        let pos = headEnd;
        for (let i = 0; spec === undefined || i < spec.groups.length || spec.rest !== undefined; i++) {
            let brace = -1, blockForm = false;
            if (pos < limit && text.charCodeAt(pos) === LBRACE) {
                brace = pos;
            } else if (lineStart) {
                brace = nextLineBrace(text, pos, limit);
                blockForm = brace >= 0;
            }
            if (brace < 0) break;
            const match = view.matchBrace(brace, declaredKind(spec, i) === 'raw');
            if (match >= 0 && match < limit) {
                groups.push({ start: brace, innerStart: brace + 1, innerEnd: match, end: match + 1, closed: true });
                pos = match + 1;
                continue;
            }
            const end = blockForm ? blankLineAfter(text, brace, limit)
                : mode === PARA ? paragraphEndAfter(text, brace, limit)
                : mode === LINE ? lineEndOf(text, brace, limit)
                : limit;
            groups.push({ start: brace, innerStart: brace + 1, innerEnd: end, end, closed: false });
            pos = end;
            break;
        }
        return { ok: true, ...head, groups, end: pos };
    }

    /** @returns {Directive} */
    buildDirective(view, scan, block) {
        const text = view.text;
        const arg = (key, ks, vs, ve) => ({
            key,
            value: text.slice(vs, ve),
            keyStart: view.src(ks),
            valueStart: view.src(vs),
            valueEnd: view.end(vs, ve),
        });
        let args = null;
        if (scan.form === 'call') {
            if (scan.args !== null) {
                args = {
                    start: view.src(scan.args.start),
                    end: view.srcEnd(scan.args.end),
                    items: scan.args.items.map((a) => arg(a.key, a.ks, a.vs, a.ve)),
                };
            }
        } else {
            const items = [arg(null, scan.target[0], scan.target[0], scan.target[1])];
            if (scan.display !== null) items.push(arg(null, scan.display[0], scan.display[0], scan.display[1]));
            args = { start: view.src(scan.start + 2), end: view.srcEnd(scan.end - 2), items };
        }
        const spec = this.spec(scan.name);
        if (scan.form === 'call' && spec === undefined) {
            this.diag('warning', `unknown directive '${scan.name}'`, view.src(scan.start), view.srcEnd(scan.nameEnd));
        }
        const groups = scan.groups.map((g, i) => {
            const kind = declaredKind(spec, i) ?? (block ? 'blocks' : 'inline');
            const start = view.src(g.start);
            const end = g.closed ? view.src(g.innerEnd) + 1 : view.end(g.start, g.end);
            const innerStart = view.src(g.innerStart);
            const innerEnd = g.closed ? end - 1 : end;
            if (!g.closed) this.diag('error', "unclosed '{'", start, start + 1);
            let children = null;
            if (kind === 'inline') {
                const [s, e] = trimRange(text, g.innerStart, g.innerEnd);
                children = this.inlineRange(view, s, e);
            } else if (kind === 'blocks') {
                children = this.parseBlocks(view, g.innerStart, g.innerEnd);
            }
            return {
                start,
                end,
                innerStart,
                innerEnd,
                kind,
                children,
                text: this.source.slice(innerStart, innerEnd),
            };
        });
        return {
            type: 'directive',
            start: view.src(scan.start),
            end: view.srcEnd(scan.end),
            name: scan.name,
            block,
            args,
            groups,
        };
    }

    // -----------------------------------------------------------------------
    // Inline building
    // -----------------------------------------------------------------------

    /**
     * Inline nodes for the whole of view.text[from, to).
     * @returns {Inline[]}
     */
    inlineRange(view, from, to) {
        if (from >= to) return [];
        this.depth++;
        const { tokens } = this.scanInline({ view, mode: FIXED, from, limit: to, region: null });
        const nodes = this.buildInline(view, tokens);
        this.depth--;
        return nodes;
    }

    buildInline(view, tokens) {
        const text = view.text;
        const items = [];
        for (const t of tokens) {
            switch (t.k) {
                case TEXT:
                    if (t.diag) this.diag(t.diag[0], t.diag[1], view.src(t.diag[2]), view.end(t.diag[2], t.diag[3]));
                    view.pieces(t.s, t.e, (s, e) => items.push({ kind: ITEM_TEXT, s, e, raw: text.slice(s, e) }));
                    break;
                case ESC:
                    items.push({ kind: ITEM_TEXT, s: t.s, e: t.e, raw: text[t.s + 1] });
                    break;
                case DELIM:
                    items.push({ kind: ITEM_DELIM, s: t.s, len: t.len, orig: t.len, open: t.open, close: t.close });
                    break;
                default:
                    items.push({ kind: ITEM_NODE, s: t.s, depth: 0, node: this.buildToken(view, t) });
            }
        }
        return this.finishInline(view, this.resolveEmphasis(view, items));
    }

    buildToken(view, t) {
        const text = view.text;
        const start = view.src(t.s), end = view.srcEnd(t.e);
        switch (t.k) {
            case CODE:
                return { type: 'codespan', start, end, value: text.slice(t.cs, t.ce).replace(/\r?\n/g, ' ') };
            case MATH:
                return { type: 'mathinline', start, end, tex: text.slice(t.ts, t.te) };
            case LINK:
                return {
                    type: 'link',
                    start,
                    end,
                    href: text.slice(t.hs, t.he).trim(),
                    children: this.inlineRange(view, t.ts, t.te),
                };
            case IMAGE:
                return { type: 'image', start, end, src: text.slice(t.hs, t.he).trim(), alt: text.slice(t.ts, t.te) };
            default:
                return this.buildDirective(view, t.scan, false);
        }
    }

    /**
     * Pair `*` runs into emph/strong (CommonMark delimiter rules, `*` only).
     * `bottoms` holds, per closer kind, the position below which an earlier
     * search found no opener. Emphasis nests no deeper than MAX_DEPTH allows.
     */
    resolveEmphasis(view, items) {
        const bottoms = [-1, -1, -1, -1, -1, -1];
        for (let i = 0; i < items.length; i++) {
            const closer = items[i];
            if (closer.kind !== ITEM_DELIM || !closer.close) continue;
            const slot = (closer.orig % 3) + (closer.open ? 3 : 0);
            while (closer.len > 0) {
                let j = i - 1, opener = null;
                for (; j >= 0 && items[j].s >= bottoms[slot]; j--) {
                    const o = items[j];
                    if (o.kind === ITEM_DELIM && o.open && o.len > 0 && !oddMatchBlocked(o, closer)) {
                        opener = o;
                        break;
                    }
                }
                if (opener === null) {
                    bottoms[slot] = closer.s;
                    break;
                }
                const inner = items.slice(j + 1, i);
                const depth = 1 + inner.reduce((d, it) => (it.kind === ITEM_NODE && it.depth > d ? it.depth : d), 0);
                if (this.depth + depth > MAX_DEPTH) {
                    const at = view.src(closer.s);
                    this.diag('warning', 'emphasis nested too deep; delimiters kept as text', at, at + closer.len);
                    break;
                }
                const use = opener.len >= 2 && closer.len >= 2 ? 2 : 1;
                const start = opener.s + opener.len - use;
                const node = {
                    type: use === 2 ? 'strong' : 'emph',
                    start: view.src(start),
                    end: view.srcEnd(closer.s + use),
                    children: this.finishInline(view, inner),
                };
                opener.len -= use;
                closer.s += use;
                closer.len -= use;
                items.splice(j + 1, i - j - 1, { kind: ITEM_NODE, s: start, depth, node });
                i = j + 2;
                if (opener.len === 0) {
                    items.splice(j, 1);
                    i--;
                }
            }
            if (closer.len === 0) {
                items.splice(i, 1);
                i--;
            }
        }
        return items;
    }

    /** Leftover delimiters become text; adjacent text merges into Text nodes. */
    finishInline(view, items) {
        const out = [];
        let pending = null;
        const flush = () => {
            if (pending === null) return;
            out.push({
                type: 'text',
                start: view.src(pending.s),
                end: view.srcEnd(pending.e),
                value: pending.raw.includes('\n') ? pending.raw.replace(/[ \t\r]*\n[ \t\r]*/g, ' ') : pending.raw,
            });
            pending = null;
        };
        for (const item of items) {
            if (item.kind === ITEM_NODE) {
                flush();
                out.push(item.node);
                continue;
            }
            const delim = item.kind === ITEM_DELIM;
            const s = item.s, e = delim ? item.s + item.len : item.e;
            if (e <= s) continue;
            const raw = delim ? '*'.repeat(item.len) : item.raw;
            if (pending !== null && view.contiguous(pending.e, s)) {
                pending.e = e;
                pending.raw += raw;
            } else {
                flush();
                pending = { s, e, raw };
            }
        }
        flush();
        return out;
    }
}

// ---------------------------------------------------------------------------
// Directive scanning helpers
// ---------------------------------------------------------------------------

/** A head that did not parse; its first character stays text with a warning. */
function failure(message, start, end) {
    return { ok: false, diag: ['warning', message, start, end] };
}

/** Schema kind of group `i`, or undefined when the schema leaves it to the default. */
function declaredKind(spec, i) {
    return spec === undefined ? undefined : (spec.groups[i] ?? spec.rest);
}

/** `{{name}}` embed. */
function scanMacro(text, pos, limit) {
    let i = pos + 2;
    while (i < limit && isWordChar(text.charCodeAt(i))) i++;
    if (i === pos + 2 || i + 1 >= limit || text.charCodeAt(i) !== RBRACE || text.charCodeAt(i + 1) !== RBRACE) {
        return failure("unclosed '{{'", pos, pos + 2);
    }
    return { ok: true, form: 'macro', name: 'macro', start: pos, nameEnd: pos + 2, target: [pos + 2, i], display: null, groups: [], end: i + 2 };
}

/** `[[target]]` or `[[target|display]]`; the target has no `[`, `(`, `)` or `|`. */
function scanShortLink(text, pos, lineEnd) {
    let i = pos + 2;
    while (i < lineEnd) {
        const c = text.charCodeAt(i);
        if (c === RBRACKET || c === PIPE || c === LPAREN || c === RPAREN || c === LBRACKET) break;
        i++;
    }
    const targetEnd = i;
    const stop = i < lineEnd ? text.charCodeAt(i) : -1;
    if (stop !== RBRACKET && stop !== PIPE) return failure("'[[' does not start a directive or link", pos, pos + 2);
    let display = null;
    if (stop === PIPE) {
        const close = text.indexOf(']', i + 1);
        if (close < 0 || close >= lineEnd) return failure("unclosed '[['", pos, pos + 2);
        display = trimRange(text, i + 1, close);
        if (display[0] === display[1]) display = null;
        i = close;
    }
    if (i + 1 >= lineEnd || text.charCodeAt(i + 1) !== RBRACKET) {
        return failure("'[[' does not start a directive or link", pos, pos + 2);
    }
    const target = trimRange(text, pos + 2, targetEnd);
    if (target[0] === target[1]) return failure('empty link target', pos, i + 2);
    return { ok: true, form: 'short', name: 'link', start: pos, nameEnd: pos + 2, target, display, groups: [], end: i + 2 };
}

/**
 * Arguments from the `(` at `open` to its `)` on the same line. Entries split
 * on commas outside nested (), [], {} and quotes; a quote only counts at the
 * start of a value. Returns null when the `)` is missing.
 */
function scanArgs(text, open, lineEnd) {
    const items = [];
    let paren = 0, nest = 0;
    let entryStart = open + 1, keyColon = -1, valueStart = true;
    const push = (end) => {
        const [s, e] = trimRange(text, entryStart, end);
        if (s === e) return;
        if (keyColon >= 0) {
            const [vs, ve] = trimRange(text, keyColon + 1, e);
            const empty = vs === ve;
            items.push({ key: text.slice(s, trimEnd(text, s, keyColon)), ks: s, vs: empty ? keyColon + 1 : vs, ve: empty ? keyColon + 1 : ve });
        } else {
            items.push({ key: null, ks: s, vs: s, ve: e });
        }
    };
    for (let i = open + 1; i < lineEnd; i++) {
        const c = text.charCodeAt(i);
        if (c === SP || c === TAB) continue;
        if (valueStart && (c === DQUOTE || c === SQUOTE)) {
            valueStart = false;
            const q = text.indexOf(c === DQUOTE ? '"' : "'", i + 1);
            if (q >= 0 && q < lineEnd) i = q;
            continue;
        }
        valueStart = false;
        if (c === LPAREN) {
            paren++;
        } else if (c === RPAREN) {
            if (paren === 0) {
                push(i);
                return { close: i, items };
            }
            paren--;
        } else if (c === LBRACKET || c === LBRACE) {
            nest++;
        } else if (c === RBRACKET || c === RBRACE) {
            if (nest > 0) nest--;
        } else if (paren === 0 && nest === 0) {
            if (c === COMMA) {
                push(i);
                entryStart = i + 1;
                keyColon = -1;
                valueStart = true;
            } else if (c === COLON && keyColon < 0 && isKeyBefore(text, entryStart, i) && !text.startsWith('//', i + 1)) {
                keyColon = i;
                valueStart = true;
            }
        }
    }
    return null;
}

/** Trimmed text in [start, end) is a `[\w-]+` key. */
function isKeyBefore(text, start, end) {
    const [s, e] = trimRange(text, start, end);
    if (s === e) return false;
    for (let i = s; i < e; i++) if (!isKeyChar(text.charCodeAt(i))) return false;
    return true;
}

/** Position of a `{` alone on the line after `pos` (only spaces before it on pos's line), or -1. */
function nextLineBrace(text, pos, limit) {
    let i = skipSpaces(text, pos, limit);
    if (i >= limit || text.charCodeAt(i) !== NL) return -1;
    i = skipSpaces(text, i + 1, limit);
    if (i >= limit || text.charCodeAt(i) !== LBRACE) return -1;
    const brace = i;
    i = skipSpaces(text, i + 1, limit);
    return i >= limit || text.charCodeAt(i) === NL ? brace : -1;
}

/** Only spaces between the start of pos's line (or regionStart) and pos. */
function isLineStart(text, pos, regionStart) {
    for (let i = pos - 1; i >= regionStart; i--) {
        const c = text.charCodeAt(i);
        if (c === NL) return true;
        if (!isSpace(c)) return false;
    }
    return true;
}

/** The newline before the first blank line after pos's line, or limit. */
function blankLineAfter(text, pos, limit) {
    let nl = lineEndOf(text, pos, limit);
    while (nl < limit) {
        const le = lineEndOf(text, nl + 1, limit);
        if (isBlank(text, nl + 1, le)) return nl;
        nl = le;
    }
    return limit;
}

/** Like blankLineAfter, but also stops before a line that looks like a block start. */
function paragraphEndAfter(text, pos, limit) {
    let nl = lineEndOf(text, pos, limit);
    while (nl < limit) {
        const ls = nl + 1;
        const le = lineEndOf(text, ls, limit);
        if (isBlank(text, ls, le) || looksLikeBlockStart(text, ls, le)) return nl;
        nl = le;
    }
    return limit;
}

/** Cheap block-start test for error recovery; never scans directives. */
function looksLikeBlockStart(text, ls, le) {
    const c0 = text.charCodeAt(ls);
    if (c0 === GT || (c0 === HASH && headingAt(text, ls, le) !== null) || (c0 === DASH && ruleAt(text, ls, le) !== null)) return true;
    const ind = skipSpaces(text, ls, le);
    const c = text.charCodeAt(ind), d = ind + 1 < le ? text.charCodeAt(ind + 1) : -1;
    if ((c === LBRACKET && d === LBRACKET) || (c === LBRACE && d === LBRACE) || (c === DOLLAR && d === DOLLAR)) return true;
    if (c === PIPE || (c === BACKTICK && fenceAt(text, ind, le) !== null)) return true;
    return listMarkerAt(text, ind, le) !== null;
}

// ---------------------------------------------------------------------------
// Block start detection
// ---------------------------------------------------------------------------

function headingAt(text, ls, le) {
    let i = ls;
    while (i < le && text.charCodeAt(i) === HASH) i++;
    const level = i - ls;
    const c = i < le ? text.charCodeAt(i) : -1;
    if (level > 6 || (c !== SP && c !== TAB)) return null;
    return { kind: 'heading', level, contentStart: skipSpaces(text, i, le) };
}

function ruleAt(text, ls, le) {
    let i = ls;
    while (i < le && text.charCodeAt(i) === DASH) i++;
    return i - ls >= 3 && isBlank(text, i, le) ? { kind: 'rule', length: i - ls } : null;
}

function fenceAt(text, ind, le) {
    let i = ind;
    while (i < le && text.charCodeAt(i) === BACKTICK) i++;
    if (i - ind < 3 || text.slice(i, le).includes('`')) return null;
    return { kind: 'fence', ind, ticks: i - ind, infoStart: i, infoEnd: le };
}

function listMarkerAt(text, ind, le) {
    const c = text.charCodeAt(ind);
    let i = ind, ordered = false;
    if (c === DASH || c === STAR) {
        i++;
    } else if (isDigit(c)) {
        while (i < le && i - ind < 9 && isDigit(text.charCodeAt(i))) i++;
        if (i >= le || text.charCodeAt(i) !== DOT) return null;
        i++;
        ordered = true;
    } else {
        return null;
    }
    const after = i < le ? text.charCodeAt(i) : -1;
    if (after !== SP && after !== TAB) return null;
    return { kind: 'list', ordered, ind, markerEnd: i, contentStart: skipSpaces(text, i, le) };
}

function tableAt(text, ind, le, limit) {
    if (rowRange(text, ind, le) === null || le >= limit) return null;
    const sepStart = le + 1;
    const sep = rowRange(text, sepStart, lineEndOf(text, sepStart, limit));
    if (sep === null) return null;
    const cells = plainCells(text, sep);
    for (const [s, e] of cells) {
        let i = s;
        if (text.charCodeAt(i) === COLON) i++;
        const dashes = i;
        while (i < e && text.charCodeAt(i) === DASH) i++;
        if (i === dashes) return null;
        if (i < e && text.charCodeAt(i) === COLON) i++;
        if (i !== e) return null;
    }
    return { kind: 'table' };
}

/** Trimmed [start, end) of a `|...|` table row, or null. */
function rowRange(text, ls, le) {
    const s = skipSpaces(text, ls, le);
    const e = trimEnd(text, s, le);
    return e - s > 1 && text.charCodeAt(s) === PIPE && text.charCodeAt(e - 1) === PIPE ? [s, e] : null;
}

/** Trimmed cell ranges split on every `|` (separator rows). */
function plainCells(text, [s, e]) {
    const cells = [];
    let cellStart = s + 1;
    for (let i = s + 1; i <= e - 1; i++) {
        if (i === e - 1 || text.charCodeAt(i) === PIPE) {
            cells.push(trimRange(text, cellStart, i));
            cellStart = i + 1;
        }
    }
    return cells;
}

/** Trimmed cell ranges split on `|` outside escapes, code spans, math, `[[...]]` and `{...}`. */
function tableCells(view, [s, e]) {
    const text = view.text;
    const inner = e - 1;
    const cells = [];
    let cellStart = s + 1, links = 0, braces = 0;
    for (let i = s + 1; i < inner; i++) {
        const c = text.charCodeAt(i);
        if (c === BACKSLASH) {
            i++;
        } else if (c === BACKTICK) {
            i = codeSpanEnd(text, i, inner) - 1;
        } else if (c === DOLLAR) {
            const display = i + 1 < inner && text.charCodeAt(i + 1) === DOLLAR;
            const close = findMathEnd(view, i + (display ? 2 : 1), inner, display, () => false);
            if (close >= 0) i = close + (display ? 1 : 0);
        } else if (c === LBRACKET && text.charCodeAt(i + 1) === LBRACKET) {
            links++;
            i++;
        } else if (c === RBRACKET && text.charCodeAt(i + 1) === RBRACKET && links > 0) {
            links--;
            i++;
        } else if (c === LBRACE) {
            braces++;
        } else if (c === RBRACE) {
            if (braces > 0) braces--;
        } else if (c === PIPE && links === 0 && braces === 0) {
            cells.push(trimRange(text, cellStart, i));
            cellStart = i + 1;
        }
    }
    cells.push(trimRange(text, cellStart, inner));
    return cells;
}

/** End of the code span opening at `pos` within [pos, limit), or the end of the opening run. */
function codeSpanEnd(text, pos, limit) {
    let open = pos;
    while (open < limit && text.charCodeAt(open) === BACKTICK) open++;
    for (let i = open; i < limit; ) {
        if (text.charCodeAt(i) !== BACKTICK) {
            i++;
            continue;
        }
        let j = i;
        while (j < limit && text.charCodeAt(j) === BACKTICK) j++;
        if (j - i === open - pos) return j;
        i = j;
    }
    return open;
}

/**
 * End of math started before `from`: the next `$` (or `$$`) outside braces,
 * skipping backslash escapes (KaTeX auto-render rules). `cross(nl)` decides if
 * the search may pass a newline. A `{` without a partner inside the range ends
 * the search, since the math could not close after it.
 */
function findMathEnd(view, from, limit, display, cross) {
    const text = view.text;
    let braces = 0;
    for (let i = from; i < limit; i++) {
        const c = text.charCodeAt(i);
        if (c === NL) {
            if (!cross(i)) return -1;
        } else if (c === DOLLAR && braces <= 0 && (!display || (i + 1 < limit && text.charCodeAt(i + 1) === DOLLAR))) {
            return i;
        } else if (c === BACKSLASH) {
            if (i + 1 < limit && text.charCodeAt(i + 1) !== NL) i++;
        } else if (c === LBRACE) {
            if (braces >= 0) {
                const match = view.matchBrace(i, false);
                if (match < 0 || match >= limit) return -1;
            }
            braces++;
        } else if (c === RBRACE) {
            braces--;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

/** A run of `*` with its CommonMark flanking flags. */
function delimAt(ctx, pos) {
    const { view, limit } = ctx;
    const text = view.text;
    let e = pos;
    while (e < limit && text.charCodeAt(e) === STAR) e++;
    const before = pos > ctx.from ? codePointBefore(text, pos) : -1;
    const after = e < limit ? text.codePointAt(e) : -1;
    const spaceBefore = before < 0 || isWhitespaceCp(before);
    const spaceAfter = after < 0 || isWhitespaceCp(after);
    const punctBefore = !spaceBefore && isPunctCp(before);
    const punctAfter = !spaceAfter && isPunctCp(after);
    return {
        k: DELIM,
        s: pos,
        e,
        len: e - pos,
        open: !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
        close: !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
    };
}

/** CommonMark "multiple of 3" rule for runs that can both open and close. */
function oddMatchBlocked(opener, closer) {
    if (!opener.close && !closer.open) return false;
    return (opener.orig + closer.orig) % 3 === 0 && !(opener.orig % 3 === 0 && closer.orig % 3 === 0);
}

/** Drops trailing whitespace from the last text tokens; returns the new end. */
function trimTokensEnd(tokens, text, floor) {
    while (tokens.length > 0) {
        const last = tokens[tokens.length - 1];
        if (last.k !== TEXT || last.diag) return last.e;
        const e = trimEnd(text, last.s, last.e);
        if (e > last.s) {
            last.e = e;
            return e;
        }
        tokens.pop();
    }
    return floor;
}

/**
 * For a paragraph written `->text<-`, removes the markers from the first and
 * last text tokens and returns true.
 */
function stripCentered(tokens, text, s, e) {
    if (e - s < 4 || !text.startsWith('->', s) || !text.startsWith('<-', e - 2)) return false;
    const first = tokens[0], last = tokens[tokens.length - 1];
    if (first.k !== TEXT || first.diag || last.k !== TEXT || last.diag || last.e !== e || last.e - last.s < 2) return false;
    if (first === last && first.e - first.s < 4) return false;
    first.s += 2;
    last.e -= 2;
    for (let i = 0; i < tokens.length && tokens[i].k === TEXT && !tokens[i].diag; ) {
        const t = tokens[i];
        t.s = Math.min(skipWs(text, t.s, t.e), t.e);
        if (t.s < t.e) break;
        tokens.splice(i, 1);
    }
    for (let i = tokens.length - 1; i >= 0 && tokens[i].k === TEXT && !tokens[i].diag; i--) {
        const t = tokens[i];
        t.e = trimEnd(text, t.s, t.e);
        if (t.e > t.s) break;
        tokens.splice(i, 1);
    }
    return true;
}

/**
 * Heading slug, identical to the legacy MarkdownParser.slugify before its
 * duplicate counter.
 */
function legacySlug(text) {
    const clean = text
        .replace(/<[^>]*>/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    const slug = clean
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return slug || 'section';
}

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

function clamp(n, lo, hi) {
    const v = Number.isFinite(n) ? Math.trunc(n) : lo;
    return v < lo ? lo : v > hi ? hi : v;
}

function lineEndOf(text, pos, limit) {
    const i = text.indexOf('\n', pos);
    return i < 0 || i > limit ? limit : i;
}

/** Spaces, tabs and carriage returns: whitespace inside a line. */
function isSpace(c) {
    return c === SP || c === TAB || c === CR;
}

function isWs(c) {
    return c === SP || c === TAB || c === CR || c === NL;
}

function skipSpaces(text, pos, end) {
    while (pos < end && isSpace(text.charCodeAt(pos))) pos++;
    return pos;
}

function skipWs(text, pos, end) {
    while (pos < end && isWs(text.charCodeAt(pos))) pos++;
    return pos;
}

function trimEnd(text, start, end) {
    while (end > start && isWs(text.charCodeAt(end - 1))) end--;
    return end;
}

/** [start, end) without surrounding whitespace; [start, start] when blank. */
function trimRange(text, start, end) {
    const s = skipWs(text, start, end);
    return s === end ? [start, start] : [s, trimEnd(text, s, end)];
}

function isBlank(text, start, end) {
    return skipSpaces(text, start, end) >= end;
}

function isDigit(c) {
    return c >= 48 && c <= 57;
}

function isWordChar(c) {
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isKeyChar(c) {
    return isWordChar(c) || c === DASH;
}

function isAsciiPunct(c) {
    return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}

function isWhitespaceCp(cp) {
    if (cp < 128) return cp === SP || cp === TAB || cp === NL || cp === CR || cp === 11 || cp === 12;
    return UNICODE_SPACE.test(String.fromCodePoint(cp));
}

function isPunctCp(cp) {
    return cp < 128 ? isAsciiPunct(cp) : UNICODE_PUNCT.test(String.fromCodePoint(cp));
}

function codePointBefore(text, pos) {
    const c = text.charCodeAt(pos - 1);
    if (c >= 0xdc00 && c <= 0xdfff && pos >= 2) {
        const h = text.charCodeAt(pos - 2);
        if (h >= 0xd800 && h <= 0xdbff) return (h - 0xd800) * 0x400 + (c - 0xdc00) + 0x10000;
    }
    return c;
}
