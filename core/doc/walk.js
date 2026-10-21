/**
 * Traversal and offset lookup over a parsed document.
 *
 * @typedef {import('../types.js').Doc} Doc
 * @typedef {import('../types.js').NodeBase} NodeBase
 */

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'list', 'blockquote', 'code', 'math', 'table', 'rule', 'raw']);

/**
 * Child nodes in source order. Table cells and directive groups are flattened.
 * @param {NodeBase} node
 * @returns {NodeBase[]}
 */
export function childrenOf(node) {
    switch (node.type) {
        case 'list':
            return node.items;
        case 'table':
            return [...node.header.flat(), ...node.rows.flat(2)];
        case 'directive':
            return node.groups.flatMap((g) => g.children ?? []);
        default:
            return Array.isArray(node.children) ? node.children : [];
    }
}

/**
 * Depth-first pre-order walk. Returning false from `visitor` skips the node's children.
 * @param {NodeBase} node
 * @param {(node: NodeBase, parent: NodeBase | null) => boolean | void} visitor
 */
export function walk(node, visitor) {
    const visit = (n, parent) => {
        if (visitor(n, parent) === false) return;
        for (const child of childrenOf(n)) visit(child, n);
    };
    visit(node, null);
}

/**
 * Nodes containing `offset`, outermost (the doc) first. A node contains offsets
 * in [start, end); an offset equal to a node's end also matches when no later
 * sibling starts there, so a caret at the end of a word stays in that word.
 * @param {Doc} doc
 * @param {number} offset
 * @returns {NodeBase[]}
 */
export function nodeAt(doc, offset) {
    if (!(offset >= doc.start && offset <= doc.end)) return [];
    const chain = [doc];
    for (let node = childAt(childrenOf(doc), offset); node !== null; node = childAt(childrenOf(node), offset)) {
        chain.push(node);
    }
    return chain;
}

/**
 * Innermost block node containing `offset` (see nodeAt), or null.
 * @param {Doc} doc
 * @param {number} offset
 */
export function blockAt(doc, offset) {
    const chain = nodeAt(doc, offset);
    for (let i = chain.length - 1; i > 0; i--) {
        if (isBlock(chain[i])) return chain[i];
    }
    return null;
}

/** @param {NodeBase} node */
export function isBlock(node) {
    return BLOCK_TYPES.has(node.type) || (node.type === 'directive' && node.block === true);
}

/** Last child starting at or before `offset` if it contains it (end inclusive). */
function childAt(children, offset) {
    let lo = 0, hi = children.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (children[mid].start <= offset) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (found < 0) return null;
    const child = children[found];
    return offset <= child.end ? child : null;
}
