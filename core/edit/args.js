/**
 * Changing a directive's arguments in the page source.
 */

import { setArg, removeArg } from '../doc/edit.js';
import { walk } from '../doc/walk.js';

/** The directive that starts at `start`, or null. */
export function directiveAt(session, start) {
    let found = null;
    walk(session.doc, (n) => {
        if (n.type === 'directive' && n.start === start) { found = n; return false; }
        return undefined;
    });
    return found;
}

/** Current value text of argument `key` (a name, or the index of a positional one), or undefined. */
export function argValue(node, key) {
    const items = node.args?.items ?? [];
    return typeof key === 'number' ? items.filter(a => a.key === null)[key]?.value : items.findLast(a => a.key === key)?.value;
}

/**
 * Applies argument changes to the directive at `start` as one undo step.
 * A change is `{ key, value }`; a null value removes the argument, and a value
 * the argument already has is skipped.
 * @returns {boolean} whether anything changed
 */
export function updateArgs(session, start, changes, group = `args-${Date.now()}`) {
    let changed = false;
    for (const { key, value } of changes) {
        const node = directiveAt(session, start);
        if (!node) break;
        const current = argValue(node, key);
        if ((value ?? undefined) === current) continue;
        const edit = value == null ? removeArg(node, key) : setArg(node, key, value);
        if (!edit) continue;
        session.apply(edit, { group });
        changed = true;
    }
    return changed;
}
