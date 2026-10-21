/**
 * Pure source edits for the in-place editor. Directive helpers work from the
 * node's ranges alone and leave the rest of the argument text as written.
 *
 * @typedef {import('../types.js').Directive} Directive
 * @typedef {import('../types.js').Arg} Arg
 * @typedef {{ start: number, end: number, text: string }} Edit
 */

/**
 * Applies `edit` to `source`. `map(offset, assoc)` moves an offset of the old
 * source into the new one. Offsets inside the replaced range, and an offset at
 * a pure insertion point, go to the start of the edit when assoc < 0 (default)
 * or to the end of the inserted text when assoc > 0.
 * @param {string} source
 * @param {Edit} edit
 * @returns {{ source: string, map: (offset: number, assoc?: number) => number }}
 */
export function applyEdit(source, edit) {
    const start = clamp(edit.start, 0, source.length);
    const end = clamp(edit.end, start, source.length);
    const text = edit.text == null ? '' : String(edit.text);
    const delta = text.length - (end - start);
    const map = (offset, assoc = -1) => {
        if (offset < start || (offset === start && (assoc < 0 || end > start))) return offset;
        if (offset > end || (offset === end && end > start)) return offset + delta;
        return assoc < 0 ? start : start + text.length;
    };
    return { source: source.slice(0, start) + text + source.slice(end), map };
}

/**
 * Edit that sets argument `key` to the raw `valueText`: replaces the value of
 * the last `key:` entry, or appends `key: valueText`. A numeric key replaces the
 * value of that positional argument. A null value removes the argument.
 * `valueText` is inserted verbatim; quote it if it holds commas or parens.
 * Returns null when the directive's form cannot hold the change (short links
 * and `{{macro}}` have no named arguments).
 * @param {Directive} directive
 * @param {string | number} key
 * @param {string | null} valueText
 * @returns {Edit | null}
 */
export function setArg(directive, key, valueText) {
    if (valueText == null) return removeArg(directive, key);
    const value = String(valueText);
    if (typeof key === 'number') {
        const item = directive.args ? positional(directive.args.items, key) : undefined;
        return item ? { start: item.valueStart, end: item.valueEnd, text: value } : null;
    }
    if (directive.args === null) {
        const at = directive.start + 2 + directive.name.length;
        return { start: at, end: at, text: `(${key}: ${value})` };
    }
    if (!hasParens(directive)) return null;
    const { items } = directive.args;
    const item = items.findLast((a) => a.key === key);
    if (item) {
        const text = item.valueStart === item.valueEnd ? ` ${value}` : value;
        return { start: item.valueStart, end: item.valueEnd, text };
    }
    if (items.length === 0) {
        const at = directive.args.start + 1;
        return { start: at, end: at, text: `${key}: ${value}` };
    }
    const at = items[items.length - 1].valueEnd;
    return { start: at, end: at, text: `, ${key}: ${value}` };
}

/**
 * Edit that removes argument `key` (the last entry with that key, or the
 * positional argument at a numeric index) with its separating comma. Removing
 * the only argument removes the parentheses. Returns null when there is
 * nothing to remove.
 * @param {Directive} directive
 * @param {string | number} key
 * @returns {Edit | null}
 */
export function removeArg(directive, key) {
    if (!hasParens(directive)) return null;
    const { items } = directive.args;
    const target = typeof key === 'number' ? positional(items, key) : items.findLast((a) => a.key === key);
    if (target === undefined) return null;
    const i = items.indexOf(target);
    if (items.length === 1) return { start: directive.args.start, end: directive.args.end, text: '' };
    if (i < items.length - 1) return { start: target.keyStart, end: items[i + 1].keyStart, text: '' };
    return { start: items[i - 1].valueEnd, end: target.valueEnd, text: '' };
}

/** `[[name(...)]]` form: the argument range starts at the `(` right after the name. */
function hasParens(directive) {
    return directive.args !== null && directive.args.start === directive.start + 2 + directive.name.length;
}

/** @param {Arg[]} items */
function positional(items, index) {
    return items.filter((a) => a.key === null)[index];
}

function clamp(n, lo, hi) {
    const v = Number.isFinite(n) ? Math.trunc(n) : lo;
    return v < lo ? lo : v > hi ? hi : v;
}
