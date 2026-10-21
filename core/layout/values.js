/**
 * Directive argument values: numbers with units, keywords, quoted strings,
 * calls such as circle(40%), and space-separated lists such as `0 0`.
 *
 *   parseValue('polygon(0 0, 100% 0, 50% 100%)')
 *   resolveLength(parseValue('12em'), { em: 20 })   // 240
 */

/**
 * @typedef {{ type: 'number', value: number, unit: string }
 *   | { type: 'keyword', name: string }
 *   | { type: 'string', value: string }
 *   | { type: 'call', name: string, args: Value[] }
 *   | { type: 'list', items: Value[] }} Value
 */

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/** @returns {Value | null} null for empty input */
export function parseValue(text) {
    const src = String(text ?? '').trim();
    if (!src) return null;
    const parser = { src, pos: 0 };
    const value = parseList(parser);
    skipSpace(parser);
    return parser.pos === src.length ? value : { type: 'keyword', name: src };
}

function skipSpace(p) {
    while (p.pos < p.src.length && /\s/.test(p.src[p.pos])) p.pos++;
}

function parseList(p) {
    const items = [];
    for (;;) {
        skipSpace(p);
        const ch = p.src[p.pos];
        if (ch === undefined || ch === ',' || ch === ')') break;
        items.push(parseAtom(p));
    }
    if (items.length === 0) return { type: 'keyword', name: '' };
    return items.length === 1 ? items[0] : { type: 'list', items };
}

function parseAtom(p) {
    const rest = p.src.slice(p.pos);
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
        const end = rest.indexOf(quote, 1);
        const stop = end === -1 ? rest.length : end;
        p.pos += stop + 1;
        return { type: 'string', value: rest.slice(1, stop) };
    }
    const num = NUMBER.exec(rest);
    if (num) {
        p.pos += num[0].length;
        const unit = /^(?:%|[a-z]+)/i.exec(p.src.slice(p.pos));
        if (unit) p.pos += unit[0].length;
        return { type: 'number', value: parseFloat(num[0]), unit: unit ? unit[0].toLowerCase() : '' };
    }
    const word = /^[^\s,()]+/.exec(rest);
    if (!word) { p.pos++; return { type: 'keyword', name: '' }; }
    p.pos += word[0].length;
    if (p.src[p.pos] === '(') {
        p.pos++;
        const args = [];
        for (;;) {
            args.push(parseList(p));
            skipSpace(p);
            if (p.src[p.pos] === ',') { p.pos++; continue; }
            if (p.src[p.pos] === ')') p.pos++;
            break;
        }
        return { type: 'call', name: word[0].toLowerCase(), args: args.filter(a => !(a.type === 'keyword' && a.name === '')) };
    }
    return { type: 'keyword', name: word[0].toLowerCase() };
}

/**
 * Length in px. `%` resolves against `basis`, `em` against `em`.
 * Returns `fallback` for keywords such as `auto` or missing values.
 * @param {Value | null | undefined} value
 * @param {{ em?: number, basis?: number, fallback?: number | null }} [ctx]
 */
export function resolveLength(value, { em = 16, basis = 0, fallback = null } = {}) {
    if (!value || value.type !== 'number') return fallback;
    switch (value.unit) {
        case '': case 'px': return value.value;
        case 'em': case 'rem': return value.value * em;
        case '%': return (value.value / 100) * basis;
        case 'pt': return value.value * (4 / 3);
        case 'vw': case 'vh': return fallback;
        default: return fallback;
    }
}

export const isKeyword = (value, name) => !!value && value.type === 'keyword' && value.name === name;
export const callName = (value) => (value && value.type === 'call' ? value.name : null);

/** Items of a list value, or the value itself as a one-item list. */
export const listItems = (value) => (value ? (value.type === 'list' ? value.items : [value]) : []);
