/**
 * Block flow: places the blocks of a document (or of a container inside it)
 * into columns, producing a display list of positioned items.
 *
 * A `scope` is the state of one container: its content box, columns, the
 * shapes text must avoid, and a cursor. Nested containers (lists, quotes,
 * columns, notes) fork their parent scope.
 */

import { createSlotCursor, slotStream } from './slots.js';
import { layoutParagraph } from './paragraph.js';
import { flattenInline, fontFor } from './inline.js';
import { parsePlace, parseWrap, resolveSize, placeRect, wrapShape } from './objects.js';
import { parseValue, resolveLength } from './values.js';
import * as geometry from './geometry.js';
import { createStyles } from './style.js';
import { flowGenerated } from './generated.js';
import { parseView, DEFAULT_VIEW } from '../runtime/strokes.js';

/** @typedef {import('../types.js').Block} Block */

export const argOf = (node, key) => node.args?.items.find(a => a.key === key)?.value;
export const positionalArg = (node, i = 0) => node.args?.items.filter(a => a.key === null)[i]?.value;

/**
 * @typedef {Object} Scope
 * @property {object} env
 * @property {object} styles
 * @property {number} x
 * @property {number} width
 * @property {import('./slots.js').Column[]} columns
 * @property {number} columnIndex
 * @property {number} y
 * @property {import('./geometry.js').Shape[]} shapes
 * @property {object[]} out
 * @property {{ node: any, marker: object, anchor: { x: number, y: number } | null }[]} notes
 * @property {Map<string, { x: number, y: number }>} anchors
 * @property {object[]} marginObjects
 * @property {Array<[number, number]>} bleeds
 * @property {boolean} overflow
 * @property {string} align
 * @property {object} inlineFlags
 */

export function createScope(env, { x, width, y = 0, styles = env.styles, columns, align = 'justify' }) {
    return {
        env,
        styles,
        x,
        width,
        columns: columns ?? [{ x, width, top: y, bottom: Infinity }],
        columnIndex: 0,
        y,
        shapes: [],
        out: [],
        notes: [],
        anchors: new Map(),
        marginObjects: [],
        bleeds: [],
        overflow: false,
        maxY: y,
        align,
        inlineFlags: {},
        page: env.pageBox ?? { x: 0, width },
        diagnostics: env.diagnostics,
    };
}

/** Child scope sharing output collections with its parent. */
export function fork(scope, overrides = {}) {
    return { ...scope, ...overrides };
}

function adopt(parent, child) {
    parent.y = Math.max(parent.y, child.y);
    parent.overflow = parent.overflow || child.overflow;
}

/** @param {boolean} [atRoot]  true only for the document's own top-level block list */
export function flowBlocks(scope, blocks, atRoot = false) {
    const editing = scope.env.editing;
    if (!editing) {
        for (let i = 0; i < blocks.length; i++) flowBlock(scope, blocks[i], blocks, i);
        return;
    }
    flowEditing(scope, blocks, editing, atRoot);
}

/**
 * Blocks inside the region being edited are replaced by one reserved slot, so
 * the surrounding text reflows around the text box that edits them.
 */
function flowEditing(scope, blocks, editing, atRoot) {
    const inside = (b) => b.end > b.start && b.start >= editing.start && b.end <= editing.end;
    const empty = editing.start === editing.end;
    const hosted = blocks.some(b => b.end > b.start && !inside(b)
        && (empty ? b.start < editing.start && editing.end < b.end : b.start <= editing.start && editing.end <= b.end));
    const byOrder = atRoot && !hosted && !blocks.some(inside);
    let placed = false;
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (inside(b)) {
            if (!placed) { placeEditor(scope, editing); placed = true; }
            continue;
        }
        if (byOrder && !placed && b.start >= editing.end) { placeEditor(scope, editing); placed = true; }
        flowBlock(scope, b, blocks, i);
    }
    if (byOrder && !placed) placeEditor(scope, editing);
}

function placeEditor(scope, editing) {
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    const height = editing.height ?? scope.styles.lineHeight * 2;
    scope.out.push({ type: 'editor', start: editing.start, end: editing.end, x: col.x, y: scope.y, width: col.width, height });
    scope.y += height + scope.styles.paragraphGap;
    scope.maxY = Math.max(scope.maxY, scope.y);
}

function flowBlock(scope, block, siblings, index) {
    switch (block.type) {
        case 'heading': return flowHeading(scope, block);
        case 'paragraph': return flowParagraph(scope, block);
        case 'list': return flowList(scope, block);
        case 'blockquote': return flowQuote(scope, block.children, null);
        case 'code': return flowCode(scope, block.text, block.lang, block);
        case 'math': return flowDisplayMath(scope, block);
        case 'table': return flowTable(scope, block);
        case 'rule': return flowRule(scope);
        case 'raw': return flowRaw(scope, block);
        case 'directive': return flowDirective(scope, block, siblings, index);
        default: return undefined;
    }
}

// ---------------------------------------------------------------------------
// Text blocks
// ---------------------------------------------------------------------------

function inlineContext(scope) {
    return {
        styles: scope.styles,
        atoms: scope.env.atoms,
        notes: [],
        diagnostics: scope.diagnostics,
        refs: scope.env.refs,
        extend: scope.env.extendInline,
    };
}

function paragraphContext(scope, lineHeight) {
    const { env } = scope;
    return {
        measurer: env.measurer,
        hyphenator: env.hyphenator,
        params: env.textParams,
        kp: { emergencyStretch: scope.styles.size * 2.5, ...env.kp },
        lineHeight,
    };
}

function makeStream(scope, lineHeight, fromY) {
    const cursor = createSlotCursor({
        columns: scope.columns,
        lineHeight,
        shapes: scope.shapes,
        minSlot: scope.styles.size * 4,
        grid: 0,
    });
    cursor.seek(scope.columnIndex, fromY);
    return slotStream(cursor);
}

const widthsUniform = (scope) =>
    scope.shapes.length === 0 && new Set(scope.columns.map(c => c.width)).size === 1;

/**
 * Lays out spans as a text block and appends it to the scope.
 * @returns {{ block: object, lines: object[] } | null}
 */
function placeText(scope, spans, { kind, node, lineHeight, align, indent = 0, after = 0, before = 0, extra = {}, hyphenate = true }) {
    if (!spans.some(s => s.kind === 'text' && s.text.trim() || s.kind === 'atom' || s.kind === 'marker')) {
        return null;
    }
    const startY = scope.y + before;
    const stream = makeStream(scope, lineHeight, startY);
    const ctx = paragraphContext(scope, lineHeight);
    if (!hyphenate) ctx.params = { ...ctx.params, hyphenate: false };
    const result = layoutParagraph(spans, ctx, stream, {
        align, indent, uniform: widthsUniform(scope),
    });
    if (result.lines.length === 0) {
        for (const m of spans.filter(s => s.kind === 'marker')) recordMarkerAnchor(scope, m.ref, { x: scope.x, y: startY });
        scope.y = startY;
        return null;
    }
    const lines = result.lines;
    const placed = lines.filter(l => !l.overflow);
    const lastPlaced = placed[placed.length - 1] ?? lines[0];
    const bottom = (Number.isNaN(lastPlaced.y) ? startY : lastPlaced.y) + lineHeight;
    if (result.overflow > 0) scope.overflow = true;

    for (const line of lines) {
        for (const m of line.markers) recordMarkerAnchor(scope, m.ref, { x: line.x + m.x, y: line.y });
    }

    const block = {
        type: kind,
        node,
        spans,
        lines,
        lineHeight,
        top: startY,
        bottom,
        x: scope.x,
        width: scope.width,
        ...extra,
    };
    scope.out.push(block);
    scope.y = bottom + after;
    if (placed.length) scope.columnIndex = lastPlaced.column;
    scope.maxY = Math.max(scope.maxY, bottom);
    return { block, lines };
}

function recordMarkerAnchor(scope, ref, at) {
    if (!ref) return;
    if (ref.type === 'note') {
        const entry = scope.notes.find(n => n.marker === ref);
        if (entry) entry.anchor = at;
    } else if (ref.type === 'anchor' && ref.id) {
        scope.anchors.set(ref.id, at);
    }
}

/** Registers margin notes; returns the ones that must be set inline instead. */
function collectNotes(scope, inlineCtx) {
    const inline = [];
    for (const n of inlineCtx.notes) {
        if (scope.env.inlineAllNotes || scope.env.breakIn?.has(n.node)) inline.push(n);
        else scope.notes.push({ node: n.node, marker: n.marker, anchor: null });
    }
    return inline;
}

export function noteBodyBlocks(node) {
    return node.name === 'margin' ? (node.groups[0]?.children ?? []) : (node.groups[1]?.children ?? []);
}

/** Sets a note as a small indented block with a rule, right after its paragraph. */
function flowBreakIn(scope, note) {
    const blocks = noteBodyBlocks(note.node);
    if (blocks.length === 0) return;
    const noteStyles = createStyles({ fontSize: scope.styles.size * 0.85, lineHeight: 1.5, family: scope.styles.family });
    const inset = 14;
    const startY = scope.y;
    const sub = fork(scope, {
        styles: noteStyles,
        x: scope.x + inset,
        width: scope.width - inset,
        columns: scope.columns.map(c => ({ ...c, x: c.x + inset, width: c.width - inset })),
        align: 'left',
        inlineFlags: {},
        env: { ...scope.env, inlineAllNotes: true },
    });
    flowBlocks(sub, blocks);
    adopt(scope, sub);
    scope.columnIndex = sub.columnIndex;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    scope.out.push({ type: 'quote-rule', x: col.x, y: startY, width: 1, height: Math.max(0, sub.y - noteStyles.paragraphGap - startY) });
    scope.y = Math.max(scope.y - noteStyles.paragraphGap + scope.styles.paragraphGap, startY);
}

function flowHeading(scope, node) {
    const { styles } = scope;
    const style = styles.heading[Math.min(6, Math.max(1, node.level))];
    const ictx = inlineContext(scope);
    const spans = flattenInline(node.children, ictx, { font: style.font });
    const inline = collectNotes(scope, ictx);
    const top = scope.y + style.before;
    if (node.id) scope.anchors.set(node.id, { x: scope.x, y: top });
    placeText(scope, spans, {
        kind: 'heading', node, lineHeight: style.lineHeight, align: style.align,
        before: style.before, after: style.after, hyphenate: false,
        extra: { level: node.level, id: node.id, font: style.font },
    });
    for (const n of inline) flowBreakIn(scope, n);
}

function leadingDirective(children, name) {
    const first = children[0];
    return first && first.type === 'directive' && first.name === name ? first : null;
}

function flowParagraph(scope, node) {
    const { styles } = scope;
    let children = node.children;
    let indent = 0;
    let dropCap = null;

    const tab = leadingDirective(children, 'tab');
    if (tab) { indent = styles.indentEm * styles.size; children = children.slice(1); }
    const drop = leadingDirective(children, 'drop');
    if (drop) { dropCap = positionalArg(drop) ?? ''; children = children.slice(1); }

    const ictx = inlineContext(scope);
    const spans = flattenInline(children, ictx, { ...scope.inlineFlags });
    const inline = collectNotes(scope, ictx);

    const align = node.centered ? 'center' : scope.align;
    const lineHeight = styles.lineHeight;
    let addedShape = null;
    let capBottom = -Infinity;

    if (dropCap) {
        const cap = dropCapMetrics(scope, dropCap, lineHeight);
        const first = makeStream(scope, lineHeight, scope.y).get(0);
        const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
        const capX = first ? first.x : col.x;
        const top = first ? first.y : scope.y;
        const capHeight = cap.lines * lineHeight;
        addedShape = geometry.rect(capX, top, cap.width, capHeight);
        scope.shapes.push(addedShape);
        capBottom = top + capHeight;
        scope.out.push({
            type: 'dropcap', letter: dropCap, x: capX, y: top, width: cap.width, height: capHeight, font: cap.font,
            baseline: top + (cap.lines - 1) * lineHeight + cap.baselineInLine,
        });
        indent = 0;
    }

    placeText(scope, spans, {
        kind: 'paragraph', node, lineHeight, align, indent, after: styles.paragraphGap,
    });
    if (capBottom > scope.y) scope.y = capBottom;
    for (const n of inline) flowBreakIn(scope, n);
}

function dropCapMetrics(scope, letter, lineHeight) {
    const { styles, env } = scope;
    const lines = styles.dropCap.lines;
    const bodyMetrics = env.measurer.metrics(styles.body);
    const probe = { family: styles.dropCap.family, size: 100 };
    const capRatio = env.measurer.metrics(probe).capHeight / 100 || 0.7;
    const target = (lines - 1) * lineHeight + bodyMetrics.capHeight;
    const size = target / capRatio;
    const font = { family: styles.dropCap.family, size };
    const width = env.measurer.width(letter, font) + styles.dropCap.gap;
    const lineBox = (lineHeight - (bodyMetrics.ascent + bodyMetrics.descent)) / 2 + bodyMetrics.ascent;
    return { lines, font, width, baselineInLine: lineBox };
}

// ---------------------------------------------------------------------------
// Lists, quotes, code, rules, tables, math, raw
// ---------------------------------------------------------------------------

function flowList(scope, node) {
    const { styles } = scope;
    const indent = styles.list.indent;
    const bulletFont = styles.body;
    let number = 1;
    for (const item of node.items) {
        const marker = node.ordered ? `${number++}.` : '•';
        const startY = scope.y;
        const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
        const sub = fork(scope, {
            x: scope.x + indent,
            width: scope.width - indent,
            columns: scope.columns.map(c => ({ ...c, x: c.x + indent, width: c.width - indent })),
            align: 'left',
        });
        const ictx = inlineContext(scope);
        const spans = flattenInline(item.children, ictx, { ...scope.inlineFlags });
        const inline = collectNotes(scope, ictx);
        const placed = placeText(sub, spans, { kind: 'paragraph', node: item, lineHeight: styles.lineHeight, align: 'left', after: styles.list.itemGap });
        for (const n of inline) flowBreakIn(sub, n);
        scope.y = sub.y;
        scope.columnIndex = sub.columnIndex;
        scope.overflow = scope.overflow || sub.overflow;
        if (placed) {
            const first = placed.lines[0];
            scope.out.push({
                type: 'bullet', text: marker, font: bulletFont,
                x: col.x + indent - styles.list.bulletGap, y: first.y, align: 'right', lineHeight: styles.lineHeight,
            });
        } else {
            scope.y = startY;
        }
    }
    scope.y += styles.list.after - styles.list.itemGap;
}

function flowQuote(scope, children, citation) {
    const { styles } = scope;
    const q = styles.quote;
    const inset = q.rule + q.pad;
    scope.y += q.before;
    const startY = scope.y;
    const sub = fork(scope, {
        x: scope.x + inset,
        width: scope.width - inset,
        columns: scope.columns.map(c => ({ ...c, x: c.x + inset, width: c.width - inset })),
        align: 'left',
        inlineFlags: { ...scope.inlineFlags, italic: true },
    });
    flowBlocks(sub, children);
    if (citation) {
        const ictx = inlineContext(scope);
        const spans = flattenInline(citation, ictx, { font: styles.body });
        placeText(sub, spans, { kind: 'paragraph', node: null, lineHeight: styles.lineHeight, align: 'right', extra: { cite: true } });
    }
    adopt(scope, sub);
    scope.columnIndex = sub.columnIndex;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    scope.out.push({ type: 'quote-rule', x: col.x, y: startY, width: q.rule, height: Math.max(0, sub.y - styles.paragraphGap - startY) });
    scope.y += q.after - styles.paragraphGap;
}

function flowCode(scope, text, lang, node) {
    const { styles, env } = scope;
    const c = styles.code;
    const lines = text.replace(/^\n+|\n+$/g, '').split('\n');
    const longest = lines.reduce((m, l) => Math.max(m, env.measurer.width(l.replace(/\t/g, '    '), c.font)), 0);
    scope.y += c.before;
    const height = lines.length * c.lineHeight + 2 * c.pad;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    scope.out.push({
        type: 'code', node, lang, lines, font: c.font, lineHeight: c.lineHeight, pad: c.pad,
        x: col.x, y: scope.y, width: col.width, height, contentWidth: longest + 2 * c.pad,
    });
    scope.y += height + c.after;
}

function flowRule(scope) {
    const r = scope.styles.rule;
    scope.y += r.before;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    // a rule runs beside a float rather than through it
    const blocked = geometry.blockedOver(scope.shapes, scope.y, scope.y + 1, col.x, col.x + col.width);
    const free = geometry.freeIntervals(col.x, col.x + col.width, blocked, 20).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
    const [from, to] = free[0] ?? [col.x, col.x + col.width];
    scope.out.push({ type: 'rule', x: from, y: scope.y, width: to - from });
    scope.y += 1 + r.after;
}

function flowDisplayMath(scope, node) {
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    const size = scope.env.atoms.displayMath(node.tex, col.width);
    const gap = scope.styles.paragraphGap;
    scope.out.push({
        type: 'math', node, tex: node.tex,
        x: col.x + (col.width - Math.min(size.width ?? col.width, col.width)) / 2,
        y: scope.y, width: Math.min(size.width ?? col.width, col.width), height: size.height,
    });
    scope.y += size.height + gap;
}

function flowRaw(scope, node) {
    scope.out.push({ type: 'raw', node, x: scope.x, y: scope.y, width: scope.width, height: 0 });
}

function flowTable(scope, node) {
    const { styles, env } = scope;
    const t = styles.table;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    const cols = Math.max(node.header.length, ...node.rows.map(r => r.length));
    const plain = (cell) => cell.map(n => n.value ?? n.tex ?? (n.children ? n.children.map(c => c.value ?? '').join('') : '')).join('');

    const minWidth = new Array(cols).fill(0);
    const maxWidth = new Array(cols).fill(0);
    const measure = (cells, font) => cells.forEach((cell, i) => {
        const text = plain(cell);
        maxWidth[i] = Math.max(maxWidth[i], env.measurer.width(text, font) + 2 * t.cellPadX);
        for (const word of text.split(/\s+/)) {
            minWidth[i] = Math.max(minWidth[i], env.measurer.width(word, font) + 2 * t.cellPadX);
        }
    });
    measure(node.header, { ...styles.body, weight: 'bold' });
    for (const r of node.rows) measure(r, styles.body);

    const sumMin = minWidth.reduce((a, b) => a + b, 0);
    const sumMax = maxWidth.reduce((a, b) => a + b, 0);
    let widths;
    if (sumMax <= col.width) {
        const extra = col.width - sumMax;
        widths = maxWidth.map(w => w + extra * (w / (sumMax || 1)));
    } else if (sumMin >= col.width) {
        widths = minWidth.map(w => w * col.width / (sumMin || 1));
    } else {
        const k = (col.width - sumMin) / (sumMax - sumMin);
        widths = minWidth.map((m, i) => m + (maxWidth[i] - m) * k);
    }

    scope.y += t.before;
    let y = scope.y;
    const row = (cells, isHead) => {
        let height = 0;
        const placed = [];
        let x = col.x;
        cells.forEach((cell, i) => {
            const sub = createScope(env, {
                x: x + t.cellPadX, width: Math.max(10, widths[i] - 2 * t.cellPadX), y: y + t.cellPadY, styles, align: 'left',
            });
            const ictx = inlineContext(scope);
            const flags = isHead ? { bold: true } : { ...scope.inlineFlags };
            const spans = flattenInline(cell, ictx, flags);
            collectNotes(scope, ictx);
            placeText(sub, spans, {
                kind: 'paragraph', node, lineHeight: styles.lineHeight,
                align: node.align?.[i] ?? 'left',
            });
            height = Math.max(height, sub.y - y - t.cellPadY + t.cellPadY * 2);
            placed.push(sub.out);
            x += widths[i];
        });
        for (const out of placed) for (const item of out) scope.out.push(item);
        height = Math.max(height, styles.lineHeight + 2 * t.cellPadY);
        y += height;
        const thickness = isHead ? t.headRuleWidth : t.ruleWidth;
        scope.out.push({ type: 'rule', x: col.x, y: y - thickness, width: col.width, thickness });
    };
    row(node.header, true);
    for (const r of node.rows) row(r, false);
    scope.y = y + t.after;
    scope.maxY = Math.max(scope.maxY, scope.y);
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

const OBJECT_DIRECTIVES = new Set(['image', 'viz', 'drawing', 'figure', 'gallery', 'embed']);
const INLINE_AS_BLOCK = new Set(['link', 'toggle', 'slider', 'button', 'cite', 'jump', 'anchor', 'card']);
const FORM_FIELDS = new Set(['input', 'textarea']);

function flowFormField(scope, node) {
    const { styles } = scope;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    const rows = node.name === 'textarea' ? Number(argOf(node, 'rows') ?? 5) : 1;
    const height = rows === 1 ? Math.round(styles.lineHeight * 1.5) : Math.round(rows * styles.lineHeight * 0.9 + 16);
    const width = Math.min(col.width, 460);
    scope.out.push({ type: 'object', name: 'widget', node, place: { kind: 'block' }, wrap: { kind: 'none', args: [] }, layer: 'over', caption: null,
        rect: { x: col.x + (col.width - width) / 2, y: scope.y, width, height } });
    scope.y += height + styles.paragraphGap;
}

/** [[style(css)]]{...}: text-align decides alignment; the rest decorates the spans. */
function flowStyled(scope, node) {
    const css = positionalArg(node) ?? '';
    const align = /text-align\s*:\s*(left|right|center|justify)/i.exec(css)?.[1]?.toLowerCase();
    const children = node.groups[0]?.children ?? [];
    const sub = fork(scope, { align: align ?? scope.align, inlineFlags: { ...scope.inlineFlags, css } });
    const blocks = children.length && children[0].type === 'text' || children.some(c => ['emph', 'strong', 'link', 'codespan', 'mathinline', 'image'].includes(c.type) || (c.type === 'directive' && !c.block))
        ? [{ type: 'paragraph', children, centered: false, start: node.start, end: node.end }]
        : children;
    flowBlocks(sub, blocks);
    adopt(scope, sub);
    scope.columnIndex = sub.columnIndex;
}

function flowDirective(scope, node, siblings, index) {
    switch (node.name) {
        case 'break':
            scope.y += scope.styles.smallBreak;
            return undefined;
        case 'bigbreak':
            scope.y += scope.styles.bigBreak;
            return undefined;
        case 'center':
            return flowCenter(scope, node);
        case 'quote':
            return flowQuote(scope, node.groups[0]?.children ?? [], citationOf(node));
        case 'code':
            return flowCode(scope, node.groups[0]?.text ?? '', positionalArg(node) ?? null, node);
        case 'columns':
            return flowColumns(scope, node);
        case 'note':
            return flowBlockNote(scope, node);
        case 'margin':
            return flowMarginBlock(scope, node);
        case 'tab':
            return undefined;
        default:
            break;
    }
    if (node.name === 'gallery') return flowGallery(scope, node);
    if (OBJECT_DIRECTIVES.has(node.name)) return flowObject(scope, node);
    if (INLINE_AS_BLOCK.has(node.name)) {
        return flowParagraph(scope, { type: 'paragraph', children: [node], centered: false, start: node.start, end: node.end });
    }
    if (FORM_FIELDS.has(node.name)) return flowFormField(scope, node);
    if (node.name === 'style') return flowStyled(scope, node);
    if (flowGenerated(scope, node)) return undefined;
    const generated = scope.env.generate?.(node, scope);
    if (generated) { flowBlocks(scope, generated); return undefined; }
    scope.diagnostics.push({ message: `No layout for block directive: ${node.name}`, start: node.start, end: node.end });
    return undefined;
}

function citationOf(node) {
    const cite = positionalArg(node);
    return cite ? [{ type: 'text', value: `— ${cite.replace(/^["']|["']$/g, '')}`, start: node.start, end: node.end }] : null;
}

/** A drawing made of inline strokes is as big as its view box. */
function sketchSize(node) {
    if (node.name !== 'drawing' || positionalArg(node)) return null;
    return parseView(argOf(node, 'view')) ?? DEFAULT_VIEW;
}

function flowCenter(scope, node) {
    const sub = fork(scope, { align: 'center' });
    flowBlocks(sub, node.groups[0]?.children ?? []);
    adopt(scope, sub);
    scope.columnIndex = sub.columnIndex;
}

function flowBlockNote(scope, node) {
    const marker = { type: 'note', node };
    scope.notes.push({ node, marker, anchor: { x: scope.x, y: scope.y } });
}

function flowMarginBlock(scope, node) {
    const side = positionalArg(node) ?? 'right';
    scope.marginObjects.push({ node, side, anchorY: scope.y, fixedY: absoluteMarginY(node, scope) });
}

function absoluteMarginY(node, scope) {
    if (argOf(node, 'type') !== 'absolute') return null;
    const pos = parseValue(argOf(node, 'pos'));
    return pos ? { value: pos } : { value: null };
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function flowColumns(scope, node) {
    const { styles } = scope;
    const count = Math.max(1, Math.round(resolveLength(parseValue(positionalArg(node) ?? argOf(node, 'count') ?? '2'), { em: styles.size, fallback: 2 })));
    const gap = resolveLength(parseValue(argOf(node, 'gap') ?? '2em'), { em: styles.size, basis: scope.width, fallback: styles.size * 2 });
    const children = node.groups[0]?.children ?? [];
    const colWidth = (scope.width - gap * (count - 1)) / count;
    const top = scope.y;
    const mk = (bottom) => Array.from({ length: count }, (_, i) => ({
        x: scope.x + i * (colWidth + gap), width: colWidth, top, bottom,
    }));

    const probe = (lines) => {
        const sub = fork(scope, {
            columns: mk(top + lines * lh), columnIndex: 0, y: top, shapes: [], out: [], notes: [], anchors: new Map(),
            marginObjects: [], bleeds: [], overflow: false,
        });
        flowBlocks(sub, children);
        return sub;
    };

    const lh = styles.lineHeight;
    const single = fork(scope, {
        columns: [{ x: scope.x, width: colWidth, top, bottom: Infinity }],
        columnIndex: 0, y: top, shapes: [], out: [], notes: [], anchors: new Map(), marginObjects: [], bleeds: [], overflow: false,
    });
    flowBlocks(single, children);

    let hi = Math.max(1, Math.ceil((single.y - top) / lh));
    let best = probe(hi);
    while (best.overflow && hi < 20000) { hi *= 2; best = probe(hi); }
    let lo = 0;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const sub = probe(mid);
        if (sub.overflow) lo = mid;
        else { hi = mid; best = sub; }
    }
    const height = hi * lh;
    for (const item of best.out) scope.out.push(item);
    scope.notes.push(...best.notes);
    for (const [k, v] of best.anchors) scope.anchors.set(k, v);
    scope.marginObjects.push(...best.marginObjects);
    scope.bleeds.push(...best.bleeds);
    const used = Math.max(height, ...best.shapes.map(s => s.bounds.y1 - top));
    scope.y = top + used + styles.paragraphGap;
    scope.columnIndex = 0;
}

// ---------------------------------------------------------------------------
// Objects (images, figures, drawings, widgets)
// ---------------------------------------------------------------------------

function paramsOf(node) {
    const get = (k) => argOf(node, k);
    return {
        width: get('width'), height: get('height'), size: get('size'), aspect: get('aspect'),
        place: get('place'), wrap: get('wrap'), pad: get('pad'), dx: get('dx'), dy: get('dy'),
        align: get('align'), layer: get('layer'),
    };
}

function flowObject(scope, node) {
    const { styles, env } = scope;
    const p = paramsOf(node);
    const place = parsePlace(p.place ?? (node.name === 'gallery' ? 'block' : 'block'));
    const em = styles.size;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];

    if (place.kind === 'margin') {
        scope.marginObjects.push({ node, side: place.side, anchorY: scope.y, object: true, params: p });
        return;
    }

    const isFloat = ['left', 'right', 'center', 'gutter', 'at'].includes(place.kind);
    const basis = place.kind === 'span' ? scope.width : place.kind === 'full' ? scope.page.width : col.width;
    const natural = env.objects?.natural?.(node) ?? sketchSize(node);
    const size = resolveSize(p, { basis, em }, natural, { defaultWidth: isFloat ? 0.5 : 1 });

    const caption = captionOf(scope, node, size.width);
    const totalHeight = size.height + (caption ? caption.height + styles.paragraphGap / 2 : 0);

    const dx = resolveLength(parseValue(p.dx), { em, basis, fallback: 0 });
    const dy = resolveLength(parseValue(p.dy), { em, basis, fallback: 0 });
    const geom = {
        columns: scope.columns, columnIndex: scope.columnIndex, cursorY: scope.y,
        container: { x: scope.x, width: scope.width }, page: scope.page, em,
    };
    let rect = placeRect(place, { width: size.width, height: totalHeight }, geom, { dx, dy });

    if (isFloat) {
        const wrap = parseWrap(p.wrap, 'box');
        const pad = resolveLength(parseValue(p.pad), { em, basis, fallback: em * 0.6 });
        const imageRect = { ...rect, height: size.height };
        const shape = wrapShape(wrap, wrap.kind === 'box' ? rect : imageRect, pad, { em, mask: env.objects?.mask?.(node, imageRect) ?? null });
        if (shape) scope.shapes.push(shape);
        if (shape && caption && wrap.kind !== 'box') {
            scope.shapes.push(geometry.rect(rect.x, rect.y + size.height, rect.width, rect.height - size.height, pad));
        }
        scope.maxY = Math.max(scope.maxY ?? 0, rect.y + rect.height);
        pushObject(scope, node, rect, size, caption, p, place, wrap);
        return;
    }

    rect = clearShapes(scope, rect);
    const align = p.align ?? 'center';
    if (place.kind === 'block' && align !== 'center') {
        rect.x = align === 'right' ? col.x + col.width - rect.width : col.x;
    }
    if (place.kind === 'full') scope.bleeds.push([rect.y, rect.y + rect.height]);
    pushObject(scope, node, rect, size, caption, p, place, { kind: 'none', args: [] });
    scope.y = rect.y + rect.height + styles.paragraphGap;
}

function pushObject(scope, node, rect, size, caption, params, place, wrap) {
    const item = {
        type: 'object', node, name: node.name, rect: { ...rect, height: size.height },
        place, wrap, layer: params.layer ?? 'over', caption: null, em: scope.styles.size,
    };
    if (caption) {
        item.caption = {
            ...caption,
            x: rect.x,
            y: rect.y + size.height + scope.styles.paragraphGap / 2,
            lines: caption.lines.map(l => ({ ...l, x: l.x + rect.x, y: l.y + rect.y + size.height + scope.styles.paragraphGap / 2 })),
        };
    }
    scope.out.push(item);
}

function captionOf(scope, node, width) {
    const group = node.groups[0];
    const text = argOf(node, 'caption')?.replace(/^["']|["']$/g, '');
    const children = group?.children?.length ? group.children
        : text ? [{ type: 'text', value: text, start: node.start, end: node.end }] : null;
    if (!children) return null;
    const ictx = inlineContext(scope);
    const font = { ...scope.styles.body, size: scope.styles.size * 0.85 };
    const spans = flattenInline(children, ictx, { font });
    if (!spans.some(s => s.kind === 'text' && s.text.trim())) return null;
    const lineHeight = Math.round(font.size * 1.4);
    const stream = slotStream(createSlotCursor({
        columns: [{ x: 0, width, top: 0, bottom: Infinity }], lineHeight, minSlot: 0,
    }));
    const result = layoutParagraph(spans, paragraphContext(scope, lineHeight), stream, { align: 'center', uniform: true });
    if (result.lines.length === 0) return null;
    return { lines: result.lines, spans, lineHeight, height: result.lines.length * lineHeight, width };
}

/** Moves a block-level rect below any wrapped shape it would collide with. */
function clearShapes(scope, rect) {
    let y = rect.y;
    for (let guard = 0; guard < 50; guard++) {
        let moved = false;
        for (const s of scope.shapes) {
            const b = s.bounds;
            if (rect.x < b.x1 && rect.x + rect.width > b.x0 && y < b.y1 && y + rect.height > b.y0) {
                y = b.y1;
                moved = true;
            }
        }
        if (!moved) break;
    }
    return { ...rect, y };
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

/**
 * [[gallery(columns: 3, gap: 10)]]{ path | alt | caption } lines, one image per line.
 * Images are packed into the shortest column, so mixed aspect ratios sit together.
 */
function flowGallery(scope, node) {
    const { styles, env } = scope;
    const col = scope.columns[Math.min(scope.columnIndex, scope.columns.length - 1)];
    const rows = (node.groups[0]?.text ?? '').split('\n').map(l => l.trim()).filter(Boolean)
        .map(line => line.split('|').map(p => p.trim()));
    if (rows.length === 0) return;

    const gap = resolveLength(parseValue(argOf(node, 'gap') ?? '10'), { em: styles.size, basis: col.width, fallback: 10 });
    const count = Math.max(1, Number(argOf(node, 'columns')) || Math.floor((col.width + gap) / (240 + gap)));
    const cellW = (col.width - gap * (count - 1)) / count;
    const heights = new Array(count).fill(0);
    const top = scope.y + styles.paragraphGap;

    for (const [src, alt = '', label = ''] of rows) {
        const arg = (key, value) => ({ key, value, keyStart: 0, valueStart: 0, valueEnd: 0 });
        const image = {
            type: 'directive', name: 'image', block: true, start: node.start, end: node.end,
            args: { start: node.start, end: node.end, items: [arg(null, src), arg('alt', alt), arg('fit', 'cover')] },
            groups: label ? [{
                kind: 'inline', start: node.start, end: node.end, innerStart: node.start, innerEnd: node.end, text: label,
                children: [{ type: 'text', value: label, start: node.start, end: node.end }],
            }] : [],
        };
        const natural = env.objects?.natural?.(image);
        const aspect = natural && natural.height > 0 ? natural.width / natural.height : 1.5;
        const imageHeight = cellW / aspect;
        const caption = captionOf(scope, image, cellW);
        let target = 0;
        for (let i = 1; i < count; i++) if (heights[i] < heights[target]) target = i;
        const x = col.x + target * (cellW + gap);
        const y = top + heights[target];
        const rect = { x, y, width: cellW, height: imageHeight };
        const total = imageHeight + (caption ? caption.height + styles.paragraphGap / 2 : 0);
        pushObject(scope, image, { ...rect, height: total }, { width: cellW, height: imageHeight }, caption,
            { layer: 'over' }, { kind: 'block' }, { kind: 'none', args: [] });
        heights[target] += total + gap;
    }
    scope.y = top + Math.max(...heights) - gap + styles.paragraphGap;
    scope.maxY = Math.max(scope.maxY, scope.y);
}
