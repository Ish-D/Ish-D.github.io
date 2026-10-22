/**
 * The frame loop for animated figures. It runs while the figure is on screen, the tab is
 * showing and the reader has not asked for less motion, and it stops otherwise. When the
 * browser is not producing frames (a hidden or throttled page) a timer steps it instead.
 */

/** The longest step a frame may take, in seconds, so a pause does not leap ahead. */
const MAX_STEP = 0.05;
const WATCHDOG_MS = 100;

/**
 * @param {Object} options
 * @param {Element} options.el
 * @param {Document} options.document
 * @param {AbortSignal} options.signal   stops the loop for good
 * @param {(dt: number) => void} options.tick   advances and draws, `dt` in seconds
 */
export function createLoop({ el, document, signal, tick }) {
    const win = document.defaultView;
    const motion = win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    let onScreen = true;
    let running = false;
    let last = 0;
    let raf = 0;
    let timer = 0;

    const now = () => win.performance.now();
    const wanted = () => onScreen && !document.hidden && !motion?.matches && !signal.aborted;

    function cancel() {
        win.cancelAnimationFrame?.(raf);
        win.clearTimeout(timer);
    }

    function schedule() {
        raf = win.requestAnimationFrame?.(frame) ?? 0;
        timer = win.setTimeout(() => frame(now()), WATCHDOG_MS);
    }

    function frame(time) {
        cancel();
        if (!running) return;
        const dt = Math.min(MAX_STEP, Math.max(0, (time - last) / 1000));
        last = time;
        tick(dt);
        if (running) schedule();
    }

    function update() {
        if (wanted() && !running) {
            running = true;
            last = now();
            schedule();
        } else if (!wanted() && running) {
            running = false;
            cancel();
        }
    }

    const observer = typeof win.IntersectionObserver === 'function'
        ? new win.IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1].isIntersecting;
            update();
        })
        : null;
    observer?.observe(el);
    document.addEventListener('visibilitychange', update, { signal });
    motion?.addEventListener?.('change', update, { signal });
    signal.addEventListener('abort', () => { running = false; cancel(); observer?.disconnect(); });
    update();

    return {
        /** True when the reader has asked for less motion. */
        get reduced() { return !!motion?.matches; },
        get running() { return running; },
    };
}
