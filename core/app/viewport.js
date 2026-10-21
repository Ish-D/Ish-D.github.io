/**
 * The width the page is laid out for. Normally the window; while editing it can
 * be set to a phone, tablet or desktop width to see the page as readers on those
 * screens will, with the page centred in the window.
 */

export const PREVIEWS = [[0, 'Window'], [390, 'Phone'], [768, 'Tablet'], [1280, 'Desktop']];

/** @param {{ document: Document, window: Window, prefs: ReturnType<typeof import('../edit/prefs.js').createPrefs>, state: any }} deps */
export function createViewport({ document, window, prefs, state }) {
    const editing = () => document.body.classList.contains('editing');

    const api = {
        /** Width to lay the page out for, in px. */
        width() {
            const preview = editing() ? prefs.values.preview : 0;
            return preview > 0 ? Math.min(preview, document.documentElement.clientWidth) : document.documentElement.clientWidth;
        },
        /** Page x of the layout's x = 0: how far the page is centred in the window. */
        originX() {
            return state.docEl ? state.docEl.getBoundingClientRect().left + window.scrollX : 0;
        },
        /** Marks the body while a smaller width than the window is in use. */
        apply() {
            document.body.classList.toggle('previewing', editing() && prefs.values.preview > 0 && prefs.values.preview < document.documentElement.clientWidth);
        },
    };
    return api;
}
