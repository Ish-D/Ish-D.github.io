/**
 * Reader settings (theme, text size, margin width), kept in local storage.
 */

const KEY = 'v2-settings';

/**
 * @param {{ document: Document, storage?: Storage, prefersDark?: boolean }} deps
 */
export function createSettings({ document, storage, prefersDark = false }) {
    const defaults = Object.freeze({ fontSize: 20, marginPercent: 28, theme: prefersDark ? 'dark' : 'light' });
    const listeners = new Set();

    const load = () => {
        try {
            return { ...defaults, ...JSON.parse(storage?.getItem(KEY) ?? '{}') };
        } catch {
            return { ...defaults };
        }
    };
    let values = load();

    const save = () => {
        try { storage?.setItem(KEY, JSON.stringify(values)); } catch { /* storage unavailable */ }
    };
    const applyTheme = () => { document.documentElement.dataset.theme = values.theme; };

    return {
        defaults,
        get values() { return values; },

        /** Changes one setting, keeps it, and tells listeners. */
        set(key, value) {
            values = { ...values, [key]: value };
            save();
            if (key === 'theme') applyTheme();
            for (const fn of listeners) fn(key, value);
        },

        reset() {
            values = { ...defaults };
            save();
            applyTheme();
            for (const fn of listeners) fn('*', null);
        },

        /** Uses `value` for this visit only (for example ?theme=dark). */
        preview(key, value) {
            values = { ...values, [key]: value };
            if (key === 'theme') applyTheme();
        },

        applyTheme,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
}
