/**
 * Drag handles on either side of the text column. Dragging one changes the
 * margin width setting, the same one the settings panel has.
 */

const MIN_PERCENT = 0;
const MAX_PERCENT = 40;
const HANDLE_PX = 10;

/** Margin width, as a percent of the window, when a handle is dragged to `clientX`. */
export function marginPercentFor(side, clientX, windowWidth) {
    const edge = side === 'left' ? clientX : windowWidth - clientX;
    return Math.round(Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, (edge / windowWidth) * 100)));
}

/**
 * @param {{ document: Document, window: Window, settings: ReturnType<typeof import('./settings.js').createSettings> }} deps
 */
export function createMarginResize({ document, window, settings }) {
    const handles = ['left', 'right'].map((side) => {
        const el = document.createElement('div');
        el.className = `margin-handle margin-handle-${side}`;
        el.title = 'Drag to change the margin width';
        el.hidden = true;
        document.body.appendChild(el);

        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
            el.classList.add('dragging');
            document.body.classList.add('resizing-margins');
        });
        el.addEventListener('pointermove', (e) => {
            if (!el.classList.contains('dragging')) return;
            const percent = marginPercentFor(side, e.clientX, window.innerWidth);
            if (percent !== settings.values.marginPercent) settings.set('marginPercent', percent);
        });
        const stop = () => {
            el.classList.remove('dragging');
            document.body.classList.remove('resizing-margins');
        };
        el.addEventListener('pointerup', stop);
        el.addEventListener('pointercancel', stop);
        return { side, el };
    });

    return {
        /** Call after every layout. */
        update(geometry, originX = 0) {
            for (const { side, el } of handles) {
                el.hidden = geometry.narrow;
                if (geometry.narrow) continue;
                const edge = side === 'left' ? geometry.text.x : geometry.text.x + geometry.text.width;
                el.style.left = `${originX + (side === 'left' ? edge - HANDLE_PX : edge)}px`;
            }
        },
        dispose() { handles.forEach(({ el }) => el.remove()); },
    };
}
