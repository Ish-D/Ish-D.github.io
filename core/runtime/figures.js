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
const onPaper = new Map();
const spotted = new Set();
const covers = new Map();

/**
 * `options.paper: false` keeps a figure off paper, for one that is only there to look at on screen.
 * `options.spot: true` says the figure carries the drawing's spot colour (`--color-figure-spot`); a page that shows one
 * takes that colour for its text selection. A drawing with a colour of its own sets it in theme.css by its name.
 * `options.cover: { rooms: [[[x, y], …], …], aspect }` lets the figure stand beside a cover page's type (`place: cover`):
 * `rooms` are the empty corners at its top left it can leave for the type, each in steps from the top down (so wide, down
 * to so far, as shares of its width and height), the first as it is drawn, and `aspect` is its width over its height. The
 * layout takes the one that lets the drawing stand largest; the figure reads which with `ctx.room()` (its index, or null
 * when no type stands beside it) and `ctx.onRoom(cb)`.
 */
export function defineFigure(name, factory, options = {}) {
    registry.set(name, factory);
    onPaper.set(name, options.paper !== false);
    if (options.spot) spotted.add(name); else spotted.delete(name);
    if (options.cover) covers.set(name, options.cover); else covers.delete(name);
}

export const hasFigure = (name) => registry.has(name);
export const figureOnPaper = (name) => onPaper.get(name) !== false;
export const figureSpot = (name) => spotted.has(name);
export const figureCover = (name) => covers.get(name) ?? null;
export const figureNames = () => [...registry.keys()];

function paramsOf(el) {
    const out = {};
    for (const [k, v] of Object.entries(el.dataset)) {
        if (k.startsWith('viz') && k.length > 3) out[k[3].toLowerCase() + k.slice(4)] = v;
    }
    return out;
}

/** Which of its `cover.rooms` a cover's layout left for its type (`data-room`), as an index, or null. */
const roomOf = (el) => (el.dataset.room ? Number(el.dataset.room) : null);

/**
 * Mounts every unmounted `[data-figure]` under `root` as it nears the viewport.
 * @param {HTMLElement} root
 * @param {{ document: Document, store: any, window?: Window, eager?: boolean, colors?: () => ReturnType<typeof themeColors> }} deps
 *   `eager` mounts every figure now, wherever it is; `colors` gives them a fixed palette instead of the page's theme
 * @returns {() => void} stops observing (mounted figures stay until disposeFigures)
 */
export function mountFigures(root, { document, store, window: win = document.defaultView, eager = false, colors = null }) {
    const targets = [...root.querySelectorAll('[data-figure]')].filter(el => !el.__figure);
    if (targets.length === 0) return () => {};

    const mount = (el) => {
        if (el.__figure) return;
        const factory = registry.get(el.dataset.figure);
        if (!factory) return;
        const themeListeners = new Set();
        const resizeListeners = new Set();
        const roomListeners = new Set();
        const controller = new AbortController();
        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => resizeListeners.forEach(cb => cb(el.clientWidth, el.clientHeight)))
            : null;
        observer?.observe(el);
        const themeWatch = !colors && typeof MutationObserver === 'function'
            ? new MutationObserver(() => themeListeners.forEach(cb => cb(themeColors(document))))
            : null;
        themeWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        // the layout says again on every render which room it left; the figure keeps what moves out of it
        const roomWatch = typeof MutationObserver === 'function'
            ? new MutationObserver(() => roomListeners.forEach(cb => cb(roomOf(el))))
            : null;
        roomWatch?.observe(el, { attributes: true, attributeFilter: ['data-room'] });

        const ctx = {
            el,
            document,
            store,
            params: paramsOf(el),
            signal: controller.signal,
            get width() { return el.clientWidth; },
            get height() { return el.clientHeight; },
            theme: () => (colors ? colors() : themeColors(document)),
            onTheme: (cb) => { themeListeners.add(cb); return () => themeListeners.delete(cb); },
            onResize: (cb) => { resizeListeners.add(cb); return () => resizeListeners.delete(cb); },
            room: () => roomOf(el),
            onRoom: (cb) => { roomListeners.add(cb); return () => roomListeners.delete(cb); },
        };
        const handle = factory(ctx) ?? {};
        el.__figure = {
            ...handle,
            dispose() {
                controller.abort();
                observer?.disconnect();
                themeWatch?.disconnect();
                roomWatch?.disconnect();
                handle.dispose?.();
            },
        };
    };

    if (eager || typeof IntersectionObserver !== 'function' || !win) {
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
