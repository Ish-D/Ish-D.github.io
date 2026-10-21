/**
 * Changing a directive's arguments in the page source.
 */

import { setArg, removeArg } from '../doc/edit.js';
import { walk } from '../doc/walk.js';

/**
 * The directive that starts at `start`, or null. Offsets go stale as soon as
 * the source changes, so callers that hold one name the kinds of directive
 * they expect and a stale offset that lands on something else finds nothing.
 * @param {string[]} [names]
 */
export function directiveAt(session, start, names) {
    let found = null;
    walk(session.doc, (n) => {
        if (n.type === 'directive' && n.start === start) { found = n; return false; }
        return undefined;
    });
    return found && (!names || names.includes(found.name)) ? found : null;
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
export function updateArgs(session, start, changes, group = `args-${Date.now()}`, names) {
    let changed = false;
    for (const { key, value } of changes) {
        const node = directiveAt(session, start, names);
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

/**
 * A live preview of argument changes while something is being dragged. Each
 * `show` sets the arguments to the given values (not relative to the last
 * call), so the page can re-flow on every pointer move; all of it is one undo
 * step. If the source is changed by anything else mid-drag the preview stops
 * touching it.
 */
export function createPreview(session, start, names) {
    const original = session.source;
    const group = `drag-${Date.now()}`;
    let last = original;
    let lost = false;

    return {
        get lost() { return lost; },
        /** @returns {boolean} false once the source has changed under the drag */
        show(changes) {
            if (lost || session.source !== last) { lost = true; return false; }
            updateArgs(session, start, changes, group, names);
            last = session.source;
            return true;
        },
        /** Puts the source back as it was before the drag. */
        cancel() {
            if (lost || session.source !== last) return;
            for (let i = 0; i < 20 && session.source !== original; i++) session.undo();
            last = session.source;
        },
        get changed() { return !lost && session.source !== original; },
    };
}
