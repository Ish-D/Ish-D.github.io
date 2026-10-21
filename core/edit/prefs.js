/**
 * Editor preferences that outlive a page: snapping, visible guides, and the
 * screen width the page is previewed at.
 */

const KEY = 'v2-editor';
const DEFAULTS = Object.freeze({ snap: true, guides: false });

/** @param {Storage | null} storage */
export function createPrefs(storage) {
    let values = { ...DEFAULTS };
    try { values = { ...DEFAULTS, ...JSON.parse(storage?.getItem(KEY) ?? '{}') }; } catch { /* use the defaults */ }
    const listeners = new Set();
    return {
        get values() { return values; },
        set(key, value) {
            values = { ...values, [key]: value };
            try { storage?.setItem(KEY, JSON.stringify(values)); } catch { /* storage unavailable */ }
            for (const fn of listeners) fn(key, value);
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
}
