/**
 * Cross-references over a parsed document: numbered citations and jumps.
 *
 * Numbers come from one counter in document order. A jump takes a new number;
 * a citation takes a new number the first time its URL appears and reuses it
 * after that. Anchors list the numbers of the jumps that point at them.
 */

import { walk } from '../doc/walk.js';

/** @typedef {import('../types.js').Doc} Doc */

const positional = (node, i = 0) => node.args?.items.filter(a => a.key === null)[i]?.value;

/**
 * @typedef {Object} References
 * @property {Map<string, { number: number, url: string, nodes: any[] }>} citations   by URL
 * @property {Map<any, number>} numberOf          directive node -> its superscript number
 * @property {Map<string, Array<{ number: number, node: any }>>} jumps    by target id
 */

/** @param {Doc} doc @returns {References} */
export function collectReferences(doc) {
    const citations = new Map();
    const numberOf = new Map();
    const jumps = new Map();
    let counter = 0;

    walk(doc, (node) => {
        if (node.type !== 'directive') return;
        if (node.name === 'jump') {
            const target = positional(node);
            if (!target) return;
            counter++;
            numberOf.set(node, counter);
            const list = jumps.get(target) ?? [];
            list.push({ number: counter, node });
            jumps.set(target, list);
        } else if (node.name === 'cite') {
            const url = positional(node);
            if (!url) return;
            let entry = citations.get(url);
            if (!entry) {
                counter++;
                entry = { number: counter, url, nodes: [] };
                citations.set(url, entry);
            }
            entry.nodes.push(node);
            numberOf.set(node, entry.number);
        }
    });
    return { citations, numberOf, jumps };
}

function plainText(nodes) {
    return nodes.map(n => n.value ?? n.tex ?? (n.children ? plainText(n.children) : '')).join('').replace(/\s+/g, ' ').trim();
}

/** Headings of level 2 and 3, numbered 1, 1.1, 1.2, 2, ... as the contents list shows them. */
export function collectOutline(doc) {
    const out = [];
    let h2 = 0;
    let h3 = 0;
    walk(doc, (node) => {
        if (node.type !== 'heading' || node.level < 2 || node.level > 3) return;
        if (node.level === 2) { h2++; h3 = 0; } else { h3++; }
        const number = node.level === 2 ? `${h2}` : (h2 > 0 ? `${h2}.${h3}` : `${h3}`);
        out.push({ level: node.level, number, id: node.id, text: plainText(node.children), node });
    });
    return out;
}

/**
 * Variable declarations from [[var(name, value, min:, max:, step:, unit:)]]; the
 * first declaration of a name wins, later uses only display or scrub it.
 */
export function collectVars(doc) {
    const out = new Map();
    walk(doc, (node) => {
        if (node.type !== 'directive' || node.name !== 'var') return;
        const items = node.args?.items ?? [];
        const named = (k) => items.find(a => a.key === k)?.value;
        const pos = items.filter(a => a.key === null).map(a => a.value);
        const name = pos[0];
        if (!name || out.has(name)) return;
        const value = Number(pos[1] ?? named('value') ?? 0);
        out.set(name, {
            name,
            value,
            min: Number(named('min') ?? Math.min(0, value)),
            max: Number(named('max') ?? Math.max(100, value * 2)),
            step: Number(named('step') ?? 1),
            unit: (named('unit') ?? '').replace(/^["']|["']$/g, ''),
        });
    });
    return [...out.values()];
}
