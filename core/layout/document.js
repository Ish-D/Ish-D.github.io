/**
 * Whole-document layout: page geometry, the block flow, and margin notes.
 *
 * Margin notes are laid out as small flows of their own at several type
 * scales, then the margin solver picks scales and positions. Notes the
 * solver cannot fit (or every note on a narrow page) are set inline after
 * their paragraph, which changes the flow, so the passes repeat until the
 * set of inline notes stops changing.
 */

import { createStyles } from './style.js';
import { createScope, flowBlocks, argOf, positionalArg } from './flow.js';
import { solveMargins } from './margins.js';
import { collectReferences, collectOutline } from '../doc/refs.js';
import { parseValue, resolveLength } from './values.js';

/**
 * @typedef {Object} LayoutEnv
 * @property {number} width
 * @property {import('../types.js').Measurer} measurer
 * @property {{ points(word: string): number[] }} [hyphenator]
 * @property {object} atoms        { inlineMath, displayMath, image, widget }
 * @property {object} [objects]    { natural(node), mask(node, rect) }
 * @property {object} [settings]   { fontSize, lineHeight, marginPercent }
 * @property {(node: any, scope: object) => any[] | null} [generate]
 */

export const PAGE = Object.freeze({
    narrowPad: 16,
    pad: 24,
    gap: 16,
    minMargin: 150,
    minText: 280,
    topPad: 32,
    bottomPad: 96,
});

export function pageGeometry(env) {
    const W = env.width;
    const percent = env.settings?.marginPercent ?? 28;
    let gutter = (percent / 100) * W;
    let pad = PAGE.pad;
    let strip = gutter - pad - PAGE.gap;
    let narrow = strip < PAGE.minMargin;
    if (narrow) {
        pad = PAGE.narrowPad;
        gutter = pad;
        strip = 0;
    } else if (W - 2 * gutter < PAGE.minText) {
        gutter = Math.max(pad, (W - PAGE.minText) / 2);
        strip = gutter - pad - PAGE.gap;
        narrow = strip < PAGE.minMargin;
        if (narrow) { pad = PAGE.narrowPad; gutter = pad; strip = 0; }
    }
    const text = { x: gutter, width: W - 2 * gutter };
    return {
        width: W,
        narrow,
        pad,
        text,
        page: { x: 0, width: W },
        left: { x: pad, width: Math.max(0, strip) },
        right: { x: text.x + text.width + PAGE.gap, width: Math.max(0, strip) },
    };
}

export function layoutDocument(doc, env) {
    const styles = createStyles(env.settings);
    const geom = pageGeometry(env);
    env = { ...env, refs: collectReferences(doc), outline: collectOutline(doc), doc };
    const diagnostics = [];
    let breakIn = new Set();
    let scope;
    let notes = { placed: [], inline: new Set() };

    for (let pass = 0; pass < 4; pass++) {
        scope = flowPass(doc, env, styles, geom, diagnostics, breakIn);
        if (geom.narrow) break;
        notes = placeNotes(scope, env, styles, geom);
        const sameSize = notes.inline.size === breakIn.size && [...notes.inline].every(n => breakIn.has(n));
        if (sameSize) break;
        breakIn = new Set([...breakIn, ...notes.inline]);
        diagnostics.length = 0;
    }

    const items = [...scope.out];
    let bottom = scope.y;
    for (const n of notes.placed) bottom = Math.max(bottom, n.y + n.height);
    for (const it of items) bottom = Math.max(bottom, bottomOf(it));
    bottom = Math.max(bottom, scope.maxY ?? 0);

    return {
        width: env.width,
        height: bottom + PAGE.bottomPad,
        geometry: geom,
        styles,
        blocks: items,
        notes: notes.placed,
        anchors: scope.anchors,
        outline: env.outline.map(({ level, number, id, text }) => ({ level, number, id, text })),
        diagnostics,
        overflow: scope.overflow,
    };
}

function flowPass(doc, env, styles, geom, diagnostics, breakIn) {
    const passEnv = {
        ...env,
        styles,
        pageBox: geom.page,
        diagnostics,
        breakIn,
        inlineAllNotes: geom.narrow,
    };
    const scope = createScope(passEnv, {
        x: geom.text.x, width: geom.text.width, y: PAGE.topPad, styles,
    });
    scope.maxY = scope.y;
    flowBlocks(scope, doc.children, true);
    return scope;
}

function bottomOf(item) {
    switch (item.type) {
        case 'paragraph': case 'heading': return item.bottom ?? 0;
        case 'object': return item.rect.y + item.rect.height + (item.caption ? item.caption.height : 0);
        case 'code': case 'math': case 'editor': return item.y + item.height;
        default: return 0;
    }
}

// ---------------------------------------------------------------------------
// Margin notes
// ---------------------------------------------------------------------------

function noteSide(node) {
    const side = positionalArg(node);
    return side === 'left' ? 'left' : side === 'right' ? 'right' : 'either';
}

function noteBody(node) {
    if (node.name === 'margin') return node.groups[0]?.children ?? [];
    return node.groups[1]?.children ?? [];
}

function baselineIn(measurer, font, lineHeight) {
    const m = measurer.metrics(font);
    return (lineHeight - (m.ascent + m.descent)) / 2 + m.ascent;
}

/** Lays a note body out as its own flow at the given width and scale. */
function layoutNoteBody(blocks, env, styles, x, width, scale) {
    const noteStyles = createStyles({
        fontSize: styles.size * 0.85 * scale,
        lineHeight: 1.5,
        family: styles.family,
    });
    const scope = createScope({ ...env, styles: noteStyles, breakIn: new Set(), inlineAllNotes: true, diagnostics: env.diagnostics }, {
        x, width, y: 0, styles: noteStyles, align: 'left',
    });
    scope.maxY = 0;
    flowBlocks(scope, blocks);
    const last = scope.out.reduce((m, it) => Math.max(m, bottomOf(it)), 0);
    return { scope, height: Math.max(last, noteStyles.lineHeight), styles: noteStyles };
}

function placeNotes(scope, env, styles, geom) {
    const strips = { left: geom.left, right: geom.right };
    const items = [];
    const bodies = new Map();

    const bodyBaseline = baselineIn(env.measurer, styles.body, styles.lineHeight);
    const candidates = [
        ...scope.notes.filter(n => n.anchor).map(n => ({ id: n, node: n.node, anchor: n.anchor, side: noteSide(n.node), blocks: noteBody(n.node), fixed: null })),
        ...scope.marginObjects.filter(m => !m.object).map(m => ({
            id: m, node: m.node, anchor: { x: 0, y: m.anchorY }, side: m.side === 'left' ? 'left' : m.side === 'right' ? 'right' : 'either',
            blocks: m.node.groups[0]?.children ?? [], fixed: m.fixedY,
        })),
    ];

    for (const c of candidates) {
        if (c.blocks.length === 0) continue;
        const variants = styles.note.variants
            .filter((v, i, all) => all.findIndex(o => o.scale === v.scale) === i)
            .map(v => {
                const sideForWidth = c.side === 'left' ? 'left' : 'right';
                const strip = strips[sideForWidth];
                const body = layoutNoteBody(c.blocks, env, styles, strip.x, strip.width, v.scale);
                return { height: body.height, cost: v.cost, tag: { ...v, body, side: sideForWidth } };
            });
        const noteBaseline = baselineIn(env.measurer, variants[0].tag.body.styles.note?.font ?? styles.note.font, styles.note.lineHeight);
        items.push({
            id: c.id,
            anchorY: c.anchor.y + bodyBaseline - noteBaseline,
            side: c.side,
            variants,
        });
        bodies.set(c.id, c);
    }

    const obstacles = { left: scope.bleeds.slice(), right: scope.bleeds.slice() };
    const solved = solveMargins(items, {
        lo: PAGE.topPad,
        hi: Math.max(scope.y, scope.maxY ?? 0) + 400,
        gap: styles.note.gap,
        obstacles,
        maxDisplacement: styles.lineHeight * 12,
    });

    const placed = [];
    const inline = new Set();
    for (const p of solved.placements) {
        const c = bodies.get(p.id);
        if (p.breakIn) { inline.add(c.node); continue; }
        const item = items.find(i => i.id === p.id);
        const v = item.variants[p.variant];
        const strip = strips[p.side];
        const body = v.tag.side === p.side ? v.tag.body : layoutNoteBody(c.blocks, env, styles, strip.x, strip.width, v.tag.scale);
        const dy = p.y;
        const translated = body.scope.out.map(it => translateItem(it, 0, dy));
        placed.push({
            node: c.node, side: p.side, x: strip.x, y: dy, width: strip.width, height: v.height,
            anchor: c.anchor, scale: v.tag.scale, items: translated,
        });
    }
    return { placed, inline };
}

export function translateItem(item, dx, dy) {
    const out = { ...item };
    if ('x' in out && typeof out.x === 'number') out.x += dx;
    if ('y' in out && typeof out.y === 'number') out.y += dy;
    if ('top' in out && typeof out.top === 'number') out.top += dy;
    if ('bottom' in out && typeof out.bottom === 'number') out.bottom += dy;
    if (out.rect) out.rect = { ...out.rect, x: out.rect.x + dx, y: out.rect.y + dy };
    if (out.lines) {
        out.lines = out.lines.map(l => ({ ...l, x: l.x + dx, y: l.y + dy }));
    }
    if (out.caption) {
        out.caption = { ...out.caption, x: (out.caption.x ?? 0) + dx, y: (out.caption.y ?? 0) + dy, lines: out.caption.lines.map(l => ({ ...l, x: l.x + dx, y: l.y + dy })) };
    }
    return out;
}

export { argOf, parseValue, resolveLength };
