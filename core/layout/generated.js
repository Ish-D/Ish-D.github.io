/**
 * Blocks built from document data rather than written in the source:
 * [[date]], [[tags]], [[summary]], [[toc]] and [[bibliography]].
 */

import { flattenInline } from './inline.js';
import { createScope, flowBlocks } from './flow.js';
import { walk } from '../doc/walk.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "04-14-2026" -> "April 14, 2026"; anything else is returned as written. */
export function formatDate(text) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(text ?? '').trim());
    if (!m) return String(text ?? '');
    const month = MONTHS[Number(m[1]) - 1];
    return month ? `${month} ${Number(m[2])}, ${m[3]}` : text;
}

/** Sub-tags from `[sub, main], [sub, main]`; the sub-tag is what the page shows. */
export function parseTags(text) {
    const out = [];
    for (const m of String(text ?? '').matchAll(/\[([^\]]*)\]/g)) {
        const sub = m[1].split(',')[0].trim();
        if (sub && !out.includes(sub)) out.push(sub);
    }
    return out;
}

const synthetic = (type, props, start, end) => ({ type, start, end, ...props });
const textNode = (value, start, end) => synthetic('text', { value }, start, end);

/**
 * Handles generated directives; returns display blocks appended to the scope,
 * or false when the directive isn't one of these.
 */
export function flowGenerated(scope, node) {
    const front = scope.env.doc?.frontmatter?.entries ?? {};
    const { styles } = scope;
    const small = (scale, extra = {}) => ({ ...styles.body, size: styles.size * scale, ...extra });

    const centered = (children, font) => {
        const para = synthetic('paragraph', { centered: true, children }, node.start, node.end);
        const savedFlags = scope.inlineFlags;
        const savedStyles = scope.styles;
        scope.inlineFlags = { ...savedFlags, font };
        // a small line sets its own rhythm instead of borrowing the body's
        scope.styles = { ...styles, lineHeight: Math.round(font.size * 1.6), paragraphGap: 0 };
        flowBlocks(scope, [para]);
        scope.styles = savedStyles;
        scope.inlineFlags = savedFlags;
    };

    switch (node.name) {
        case 'date': {
            const value = front.date?.value;
            if (value) centered([textNode(formatDate(value), node.start, node.end)], small(0.6, { weight: 'bold' }));
            return true;
        }
        case 'tags': {
            const tags = parseTags(front.tags?.value);
            if (tags.length) centered([textNode(tags.join(', '), node.start, node.end)], small(0.65, { weight: 'bold' }));
            return true;
        }
        case 'summary': {
            const group = node.groups[0];
            if (group?.children?.length) {
                scope.y += styles.lineHeight * 0.5;
                const para = synthetic('paragraph', { centered: true, children: group.children }, node.start, node.end);
                const saved = scope.inlineFlags;
                scope.inlineFlags = { ...saved, italic: true };
                flowBlocks(scope, [para]);
                scope.inlineFlags = saved;
            }
            return true;
        }
        case 'bibliography':
            flowBibliography(scope, node);
            return true;
        case 'toc':
            flowToc(scope, node);
            return true;
        default:
            return false;
    }
}

/** References for the page's citations, as a final section when the page has no [[bibliography]] of its own. */
export function flowAutoBibliography(scope, doc) {
    if ((scope.env.refs?.citations.size ?? 0) === 0) return;
    let explicit = false;
    walk(doc, (n) => { if (n.type === 'directive' && n.name === 'bibliography') explicit = true; return !explicit; });
    if (!explicit) flowBibliography(scope, { start: doc.end, end: doc.end });
}

function flowBibliography(scope, node) {
    const citations = [...(scope.env.refs?.citations.values() ?? [])].sort((a, b) => a.number - b.number);
    if (citations.length === 0) return;
    const blocks = [
        synthetic('heading', { level: 3, id: 'references', children: [textNode('References', node.start, node.end)] }, node.start, node.end),
        ...citations.map(c => synthetic('paragraph', {
            children: [synthetic('directive', {
                name: 'link', block: false, groups: [],
                args: { start: node.start, end: node.end, items: [{ key: null, value: c.url, keyStart: 0, valueStart: 0, valueEnd: 0 }, { key: 'display', value: `${c.number}. ${c.url}`, keyStart: 0, valueStart: 0, valueEnd: 0 }] },
            }, node.start, node.end)],
        }, node.start, node.end)),
    ];
    flowBlocks(scope, blocks);
    for (const c of citations) scope.anchors.set(`ref-${c.number}`, { x: scope.x, y: scope.y });
}

/** A bordered, numbered contents list floated to the left of the text. */
function flowToc(scope, node) {
    const outline = scope.env.outline ?? [];
    if (outline.length === 0) return;
    const { styles, env } = scope;
    const width = Math.min(300, scope.width * 0.5);
    const pad = { x: 10, y: 8 };
    const font = { ...styles.body, size: styles.size - 2 };
    const lineHeight = Math.round(font.size * 1.35);
    const tocStyles = { ...styles, body: font, lineHeight };
    const sub = createScope({ ...env, inlineAllNotes: true }, {
        x: scope.x + pad.x, width: width - 2 * pad.x, y: scope.y + pad.y, styles: tocStyles, align: 'left',
    });
    sub.diagnostics = scope.diagnostics;
    // numbers sit in their own column per level, titles hang beside them
    const numberWidth = (level) => Math.max(0, ...outline.filter(o => o.level === level).map(o => env.measurer.width(o.number, font))) + font.size * 0.7;
    const columns = { 2: numberWidth(2), 3: numberWidth(3) };
    const indentOf = (level) => (level === 3 ? columns[2] : 0);
    const gap = Math.round(font.size * 0.3);
    const items = [];
    const flowIn = (x, width, top, text) => {
        const inner = { ...sub, x, width, y: top, columns: [{ x, width, top, bottom: Infinity }] };
        flowBlocks(inner, [synthetic('paragraph', { children: [textNode(text, node.start, node.end)] }, node.start, node.end)]);
        return inner.y - styles.paragraphGap; // inner shares sub's output list
    };
    for (const entry of outline) {
        const level = entry.level === 3 ? 3 : 2;
        const x = sub.x + indentOf(level);
        const startY = sub.y;
        flowIn(x, columns[level], startY, entry.number);
        const end = flowIn(x + columns[level], sub.width - indentOf(level) - columns[level], startY, entry.node.children.map(c => c.value ?? '').join(''));
        sub.y = end + gap;
        items.push({ id: entry.id, level: entry.level, top: startY, bottom: end });
    }
    sub.y += styles.paragraphGap - gap;
    const height = sub.y - scope.y + pad.y - styles.paragraphGap;
    const rect = { x: scope.x, y: scope.y, width, height };
    scope.shapes.push({
        type: 'rect',
        bounds: { x0: rect.x, y0: rect.y, x1: rect.x + width + 24, y1: rect.y + height + 14 },
        blocked: (y0, y1) => (y1 <= rect.y || y0 >= rect.y + height + 14 ? null : [rect.x, rect.x + width + 24]),
    });
    scope.out.push({ type: 'toc', rect, items });
    for (const item of sub.out) scope.out.push(item);
    scope.ruleTop = rect.y;
    scope.maxY = Math.max(scope.maxY, rect.y + height);
}
