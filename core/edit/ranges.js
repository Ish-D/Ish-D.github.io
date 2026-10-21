/**
 * Source ranges for editing.
 *
 * Editing works on whole lines: a block's range is widened to the lines it
 * touches, so list markers, quote markers and `[[tab]]` prefixes stay with
 * their text.
 */

import { walk } from '../doc/walk.js';

/** Widen [start, end) to full lines (end excludes the trailing newline). */
export function expandToLines(source, start, end) {
    const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    let lineEnd = source.indexOf('\n', Math.max(start, end));
    if (end > start && source[end - 1] === '\n') lineEnd = end - 1;
    if (lineEnd === -1) lineEnd = source.length;
    return { start: start === 0 ? 0 : lineStart, end: lineEnd };
}

/** Range of the source an element's block represents, line-aligned. */
export function rangeForNode(source, node) {
    return expandToLines(source, node.start, node.end);
}

const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

const LEAF_BLOCKS = new Set(['paragraph', 'heading', 'item', 'table', 'code', 'math', 'raw', 'rule']);
const CONTAINER_BLOCKS = new Set(['doc', 'list', 'blockquote']);

/** Only directives that hold block groups can contain other blocks. */
function holdsRegion(node, region) {
    return node.groups.some(g => g.kind === 'blocks' && g.innerStart <= region.start && region.end <= g.innerEnd);
}

/**
 * Grows `range` until it no longer cuts through a leaf block. A paragraph (or
 * heading, list item, directive...) cannot contain other blocks, so a region
 * that overlaps one must cover it whole. This keeps the text box showing the
 * entire block after an edit merges or splits paragraphs.
 */
export function closeRange(doc, range) {
    let current = { ...range };
    for (let guard = 0; guard < 20; guard++) {
        let next = current;
        walk(doc, (node) => {
            const isDirective = node.type === 'directive' && node.block;
            if (!LEAF_BLOCKS.has(node.type) && !isDirective && !CONTAINER_BLOCKS.has(node.type)) return false;
            if (CONTAINER_BLOCKS.has(node.type)) return undefined;
            const touches = overlaps(node, current)
                || (current.start === current.end && node.start <= current.start && current.start <= node.end);
            if (!touches) return false;
            if (isDirective && holdsRegion(node, current)) return undefined;
            if (!contains(current, node)) {
                next = { start: Math.min(next.start, node.start), end: Math.max(next.end, node.end) };
            }
            return false;
        });
        if (next.start === current.start && next.end === current.end) break;
        current = next;
    }
    return current;
}
