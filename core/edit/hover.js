/**
 * What the pointer is over, for everything that appears on hover while
 * editing. One place decides it, from the pointer's current position, so no
 * overlay can be left showing: leaving the page, the window losing focus,
 * switching editing off or a new page all report "nothing".
 */

/**
 * @param {{ document: Document, root: HTMLElement, active: () => boolean }} deps  `active`: whether editing is on
 */
export function createHover({ document, root, active }) {
    const listeners = new Set();
    let current = null;

    const emit = (target) => {
        if (target === current) return;
        current = target;
        for (const fn of listeners) fn(target);
    };

    root.addEventListener('pointermove', (e) => emit(active() ? e.target : null), { passive: true });
    root.addEventListener('pointerleave', () => emit(null));
    document.documentElement.addEventListener('mouseleave', () => emit(null));
    document.defaultView.addEventListener('blur', () => emit(null));
    document.addEventListener('visibilitychange', () => emit(null));

    // switching editing off removes the class that every overlay depends on
    new MutationObserver(() => { if (!active()) emit(null); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return {
        get current() { return current; },
        /** Calls `fn` with the element under the pointer, or null. Returns an unsubscribe function. */
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        /** Forget what was hovered (after the page is rebuilt, for example). */
        reset() { emit(null); },
    };
}

/**
 * Shows and hides one overlay for a hover target, with a short grace period so
 * the pointer can travel from the target to the overlay.
 * @param {{ hover: ReturnType<typeof createHover>, pick: (el: Element) => any, show: (picked: any) => void, hide: () => void, overlays?: Element[], delay?: number }} options
 */
export function followHover({ hover, pick, show, hide, overlays = [], delay = 280 }) {
    let timer = 0;
    let overlay = false;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (!overlay) hide(); }, delay); };
    for (const el of overlays) {
        el.addEventListener('pointerenter', () => { overlay = true; clearTimeout(timer); });
        el.addEventListener('pointerleave', () => { overlay = false; later(); });
    }
    return hover.subscribe((target) => {
        const picked = target ? pick(target) : null;
        if (picked) { clearTimeout(timer); show(picked); } else later();
    });
}
