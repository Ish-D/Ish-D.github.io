/**
 * Pointer dragging for a handle: reports how far it has moved, and hands the
 * final distance over on release. Moves under a few pixels count as a click.
 */

const THRESHOLD = 3;

/**
 * @param {HTMLElement} handle
 * @param {{ onStart?: () => void, onMove: (dx: number, dy: number) => void, onDrop: (dx: number, dy: number) => void, onCancel?: () => void }} hooks
 * @returns {() => void} removes the listeners
 */
export function makeDraggable(handle, { onStart, onMove, onDrop, onCancel }) {
    let drag = null;

    const down = (e) => {
        if (e.button > 0) return;
        e.preventDefault();
        e.stopPropagation();
        try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        drag = { x: e.clientX, y: e.clientY, moved: false };
    };
    const body = () => handle.ownerDocument.body;
    const move = (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved) {
            if (Math.hypot(dx, dy) < THRESHOLD) return;
            drag.moved = true;
            body().classList.add('dragging-item');
            onStart?.();
        }
        onMove(dx, dy);
    };
    const up = (e) => {
        if (!drag) return;
        const { moved, x, y } = drag;
        drag = null;
        body().classList.remove('dragging-item');
        if (moved) onDrop(e.clientX - x, e.clientY - y); else onCancel?.();
    };
    const cancel = () => {
        if (!drag) return;
        const { moved } = drag;
        drag = null;
        body().classList.remove('dragging-item');
        if (moved) onCancel?.();
    };

    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    return () => {
        handle.removeEventListener('pointerdown', down);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', cancel);
    };
}
