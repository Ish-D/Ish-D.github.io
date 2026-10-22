/**
 * Checks the range contract of core/types.js on a parsed document: every
 * node's [start, end) lies inside its parent, siblings are ordered and
 * disjoint, and fields defined as source slices match their slice.
 * Returns a list of problems; empty means the tree is valid.
 */

const GROUP_KINDS = new Set(['inline', 'blocks', 'raw']);
const UNESCAPE = /\\([!-/:-@[-`{-~])/g;

export function checkDoc(doc) {
    const problems = [];
    const src = doc.source;
    const fail = (message, node) => problems.push(`${message}: ${node?.type ?? 'group'} [${node?.start},${node?.end})`);

    if (doc.type !== 'doc' || doc.start !== 0 || doc.end !== src.length) fail('bad doc range', doc);
    let floor = 0;
    if (doc.frontmatter) {
        const fm = doc.frontmatter;
        if (!inRange(fm.start, fm.end, 0, src.length)) fail('frontmatter out of range', fm);
        for (const [key, e] of Object.entries(fm.entries)) {
            if (!src.startsWith(key, e.keyStart)) fail(`frontmatter key ${key} not at keyStart`, fm);
            if (!inRange(e.valueStart, e.valueEnd, fm.start, fm.end) || e.keyStart >= e.valueStart) fail(`frontmatter ${key} range`, fm);
            if (src.slice(e.valueStart, e.valueEnd) !== e.value) fail(`frontmatter ${key} value slice`, fm);
        }
        floor = fm.end;
    }
    checkList(doc.children, floor, doc.end, doc);

    for (const d of doc.diagnostics) {
        if (d.severity !== 'error' && d.severity !== 'warning') fail(`bad severity ${d.severity}`, d);
        if (!inRange(d.start, d.end, 0, src.length) || !d.message) fail('bad diagnostic', d);
    }
    return problems;

    function checkList(nodes, lo, hi, parent) {
        let prev = lo;
        for (const node of nodes) {
            if (!node || typeof node.type !== 'string') {
                fail('not a node', parent);
                continue;
            }
            if (!inRange(node.start, node.end, lo, hi)) fail(`outside parent ${parent.type} [${lo},${hi})`, node);
            if (node.start < prev) fail('overlaps previous sibling', node);
            prev = Math.max(prev, node.end);
            checkNode(node);
        }
    }

    function checkNode(node) {
        const slice = src.slice(node.start, node.end);
        switch (node.type) {
            case 'heading':
                // a heading that is only links has no address; any other has one
                if (!(node.level >= 1 && node.level <= 6) || !slice.startsWith('#'.repeat(node.level)) || (node.id === null ? !onlyLinks(node) : !node.id)) fail('bad heading', node);
                checkList(node.children, node.start, node.end, node);
                break;
            case 'paragraph':
                if (node.centered && !(slice.startsWith('->') && slice.endsWith('<-'))) fail('centered without markers', node);
                if (node.start === node.end) fail('empty paragraph', node);
                checkList(node.children, node.start, node.end, node);
                break;
            case 'item':
            case 'blockquote':
            case 'emph':
            case 'strong':
            case 'link':
                checkList(node.children, node.start, node.end, node);
                if (node.type === 'emph' && !(slice.startsWith('*') && slice.endsWith('*'))) fail('emph without *', node);
                if (node.type === 'strong' && !(slice.startsWith('**') && slice.endsWith('**'))) fail('strong without **', node);
                if (node.type === 'link' && !(slice.startsWith('[') && slice.endsWith(')'))) fail('bad link slice', node);
                break;
            case 'list':
                checkList(node.items, node.start, node.end, node);
                break;
            case 'table':
                checkList([...node.header.flat(), ...node.rows.flat(2)], node.start, node.end, node);
                if (!slice.startsWith('|') || !slice.endsWith('|')) fail('bad table slice', node);
                break;
            case 'code':
                if (!slice.startsWith('```') || typeof node.text !== 'string') fail('bad code block', node);
                break;
            case 'math':
                if (!slice.startsWith('$$') || !slice.endsWith('$$')) fail('bad math block', node);
                break;
            case 'rule':
                if (!/^-{3,}$/.test(slice)) fail('bad rule', node);
                break;
            case 'raw':
                if (node.text !== slice) fail('raw text does not match slice', node);
                break;
            case 'text': {
                if (node.start === node.end) fail('empty text', node);
                const expected = slice.replace(UNESCAPE, '$1').replace(/[ \t\r]*\n[ \t\r]*/g, ' ');
                if (node.value !== expected) fail(`text value ${JSON.stringify(node.value)} != ${JSON.stringify(expected)}`, node);
                break;
            }
            case 'codespan':
                if (!slice.startsWith('`') || !slice.endsWith('`')) fail('bad codespan', node);
                break;
            case 'mathinline':
                if (!slice.startsWith('$') || !slice.endsWith('$') || slice.length < 2) fail('bad inline math', node);
                break;
            case 'image':
                if (!slice.startsWith('![') || !slice.endsWith(')')) fail('bad image', node);
                break;
            case 'directive':
                checkDirective(node, slice);
                break;
            default:
                fail('unknown node type', node);
        }
    }

    function checkDirective(node, slice) {
        if (!(slice.startsWith('[[') || slice.startsWith('{{'))) fail('directive does not start with [[ or {{', node);
        let floor = node.start + 2;
        if (node.args !== null) {
            const { start, end, items } = node.args;
            if (!inRange(start, end, node.start, node.end)) fail('args outside directive', node);
            let prev = start;
            for (const a of items) {
                if (!inRange(a.valueStart, a.valueEnd, start, end) || a.keyStart < prev || a.keyStart > a.valueStart) {
                    fail(`arg ${a.key ?? a.value} range`, node);
                }
                if (src.slice(a.valueStart, a.valueEnd) !== a.value) fail(`arg value slice ${JSON.stringify(a.value)}`, node);
                if (a.key !== null && !src.startsWith(a.key, a.keyStart)) fail(`arg key ${a.key} not at keyStart`, node);
                prev = a.valueEnd;
            }
            floor = end;
        }
        for (const g of node.groups) {
            if (!(floor <= g.start && g.start < g.innerStart && g.innerStart <= g.innerEnd && g.innerEnd <= g.end && g.end <= node.end)) {
                fail('group range', node);
            }
            if (src[g.start] !== '{' || g.innerStart !== g.start + 1) fail('group does not open with {', node);
            if (g.end !== g.innerEnd && (g.end !== g.innerEnd + 1 || src[g.innerEnd] !== '}')) fail('group does not close with }', node);
            if (g.text !== src.slice(g.innerStart, g.innerEnd)) fail('group text does not match slice', node);
            if (!GROUP_KINDS.has(g.kind) || (g.kind === 'raw') !== (g.children === null)) fail(`bad group kind ${g.kind}`, node);
            if (g.children) checkList(g.children, g.innerStart, g.innerEnd, node);
            floor = g.end;
        }
    }
}

function inRange(start, end, lo, hi) {
    return Number.isInteger(start) && Number.isInteger(end) && lo <= start && start <= end && end <= hi;
}

const isLink = (c) => c.type === 'link' || (c.type === 'directive' && (c.name === 'link' || c.name === 'card'));
const onlyLinks = (heading) => heading.children.some(isLink) && heading.children.every(c => isLink(c) || (c.type === 'text' && !c.value.trim()));
