/**
 * Generated blocks for pages that list other pages: `{{writing}}` and `{{tags}}`.
 * They are built from the manifest and returned as ordinary document blocks. A page the manifest marks
 * `unlisted` (a test page) is not in them, though it still opens at its address.
 */

import { formatDate } from '../layout/generated.js';

export const parseDate = (text) => {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text ?? '');
    return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime() : 0;
};

const textNode = (value, at) => ({ type: 'text', value, start: at.start, end: at.end });

function link(page, display, at) {
    const arg = (key, value) => ({ key, value, keyStart: 0, valueStart: 0, valueEnd: 0 });
    return {
        type: 'directive', name: 'link', block: false, groups: [], start: at.start, end: at.end,
        args: { start: at.start, end: at.end, items: [arg(null, page), arg('display', display)] },
    };
}

/** Dated posts, newest first. */
export function writingBlocks(manifest, at) {
    const meta = manifest?.metadata ?? {};
    return (manifest?.cards ?? [])
        .map(name => ({ name, entry: meta[name] ?? {} }))
        .filter(({ entry }) => entry.date && !entry.encrypted && !entry.unlisted)
        .sort((a, b) => parseDate(b.entry.date) - parseDate(a.entry.date))
        .map(({ name, entry }) => ({
            type: 'paragraph', start: at.start, end: at.end,
            children: [link(name, entry.name ?? name, at), textNode(`  ${formatDate(entry.date)}`, at)],
        }));
}

/** Each tag, alphabetically, with the pages that carry it. */
export function tagBlocks(manifest, at) {
    const meta = manifest?.metadata ?? {};
    const byTag = new Map();
    for (const [name, entry] of Object.entries(meta)) {
        if (entry.encrypted || entry.unlisted || !entry.tags) continue;
        for (const m of entry.tags.matchAll(/\[([^\],]+),\s*([^\]]+)\]/g)) {
            const tag = m[1].trim();
            if (!byTag.has(tag)) byTag.set(tag, new Set());
            byTag.get(tag).add(name);
        }
    }
    return [...byTag.keys()].sort((a, b) => a.localeCompare(b)).map((tag) => {
        const children = [textNode(`${tag}:  `, at)];
        [...byTag.get(tag)].forEach((name, i) => {
            if (i) children.push(textNode(', ', at));
            children.push(link(name, meta[name].name ?? name, at));
        });
        return { type: 'paragraph', start: at.start, end: at.end, children };
    });
}

/** Blocks for a `{{macro}}` node, or null when it is not a list macro. */
export function macroBlocks(manifest, node) {
    const kind = node.name === 'macro' ? node.args?.items[0]?.value : null;
    if (kind === 'writing') return writingBlocks(manifest, node);
    if (kind === 'tags') return tagBlocks(manifest, node);
    return null;
}
