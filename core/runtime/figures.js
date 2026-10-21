/**
 * Figure registry and lifecycle.
 *
 * A figure is a function from a context to an optional handle:
 *
 *   defineFigure('name', (ctx) => { ...draw into ctx.el...; return { dispose() {}, resize(w, h) {} }; });
 *
 * Figures mount lazily when they approach the viewport, keep their DOM across
 * relayouts, follow the page theme, and are disposed with the page.
 */

import { themeColors } from './svg.js';

const registry = new Map();

export function defineFigure(name, factory) {
    registry.set(name, factory);
}

export const hasFigure = (name) => registry.has(name);
export const figureNames = () => [...registry.keys()];

function paramsOf(el) {
    const out = {};
    for (const [k, v] of Object.entries(el.dataset)) {
        if (k.startsWith('viz') && k.length > 3) out[k[3].toLowerCase() + k.slice(4)] = v;
    }
    return out;
}

/**
 * Mounts every unmounted `[data-figure]` under `root` as it nears the viewport.
 * @param {HTMLElement} root
 * @param {{ document: Document, store: any, window?: Window }} deps
 * @returns {() => void} stops observing (mounted figures stay until disposeFigures)
 */
export function mountFigures(root, { document, store, window: win = document.defaultView }) {
    const targets = [...root.querySelectorAll('[data-figure]')].filter(el => !el.__figure);
    if (targets.length === 0) return () => {};

    const mount = (el) => {
        if (el.__figure) return;
        const factory = registry.get(el.dataset.figure);
        if (!factory) return;
        const themeListeners = new Set();
        const resizeListeners = new Set();
        const controller = new AbortController();
        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => resizeListeners.forEach(cb => cb(el.clientWidth, el.clientHeight)))
            : null;
        observer?.observe(el);
        const themeWatch = typeof MutationObserver === 'function'
            ? new MutationObserver(() => themeListeners.forEach(cb => cb(themeColors(document))))
            : null;
        themeWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

        const ctx = {
            el,
            document,
            store,
            params: paramsOf(el),
            signal: controller.signal,
            get width() { return el.clientWidth; },
            get height() { return el.clientHeight; },
            theme: () => themeColors(document),
            onTheme: (cb) => { themeListeners.add(cb); return () => themeListeners.delete(cb); },
            onResize: (cb) => { resizeListeners.add(cb); return () => resizeListeners.delete(cb); },
        };
        const handle = factory(ctx) ?? {};
        el.__figure = {
            ...handle,
            dispose() {
                controller.abort();
                observer?.disconnect();
                themeWatch?.disconnect();
                handle.dispose?.();
            },
        };
    };

    if (typeof IntersectionObserver !== 'function' || !win) {
        targets.forEach(mount);
        return () => {};
    }
    const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            io.unobserve(entry.target);
            mount(entry.target);
        }
    }, { rootMargin: '400px 0px' });
    targets.forEach(el => io.observe(el));
    return () => io.disconnect();
}

/** Disposes every mounted figure under `root`. */
export function disposeFigures(root) {
    for (const el of root.querySelectorAll('[data-figure]')) {
        el.__figure?.dispose();
        el.__figure = null;
    }
}
