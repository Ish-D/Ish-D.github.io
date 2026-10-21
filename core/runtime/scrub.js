/**
 * Scrubbing: drag a number in the prose (or use the arrow keys) to change the
 * article variable it shows.
 */

/** Pixels of drag per step: a full sweep of the range takes about 360px. */
export function pixelsPerStep(spec) {
    const steps = Math.max(1, (spec.max - spec.min) / spec.step);
    return Math.max(2, Math.min(10, 360 / steps));
}

/**
 * Delegated listeners on `root` for elements marked `.var[data-var]`.
 * @param {HTMLElement} root
 * @param {ReturnType<import('./store.js').createStore>} store
 * @returns {() => void} detach
 */
export function attachScrub(root, store) {
    let drag = null;

    const onDown = (e) => {
        const el = e.target.closest?.('.var[data-var]');
        if (!el || el.classList.contains('var-ro')) return;
        const name = el.dataset.var;
        const spec = store.spec(name);
        if (!spec) return;
        drag = { name, spec, startX: e.clientX, start: store.peek(name), ppx: pixelsPerStep(spec) };
        root.setPointerCapture?.(e.pointerId);
        root.classList.add('scrubbing');
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!drag) return;
        const steps = Math.round((e.clientX - drag.startX) / drag.ppx);
        store.set(drag.name, drag.start + steps * drag.spec.step);
    };

    const onUp = (e) => {
        if (!drag) return;
        root.releasePointerCapture?.(e.pointerId);
        root.classList.remove('scrubbing');
        drag = null;
    };

    const onKey = (e) => {
        const el = e.target.closest?.('.var[data-var]');
        if (!el || el.classList.contains('var-ro')) return;
        const name = el.dataset.var;
        const spec = store.spec(name);
        const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!spec || !dir) return;
        e.preventDefault();
        store.set(name, store.peek(name) + dir * spec.step * (e.shiftKey ? 10 : 1));
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('keydown', onKey);
    return () => {
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', onUp);
        root.removeEventListener('keydown', onKey);
    };
}

/**
 * Keeps every `.var[data-var]` element's text in step with the store.
 * Returns a disposer.
 * @param {HTMLElement} root
 */
export function bindVars(root, store, format) {
    const stops = [];
    for (const el of root.querySelectorAll('.var[data-var]')) {
        const name = el.dataset.var;
        if (!store.has(name)) continue;
        stops.push(store.subscribe(name, (value) => {
            el.textContent = format(value, store.spec(name));
            el.setAttribute('aria-valuenow', String(value));
        }));
    }
    return () => stops.forEach(stop => stop());
}
