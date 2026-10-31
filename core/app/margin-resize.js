/**
 * Drag handles on either side of the text column. Dragging one changes the
 * reading width setting, the same one the settings panel has.
 */

import { textWidthRange } from '../layout/document.js';

const HANDLE_PX = 10;

/**
 * Reading width, in px, when a handle is dragged to `clientX`. The column stays centred,
 * so the far edge follows.
 */
export function widthFor(side, clientX, windowWidth) {
    const edge = side === 'left' ? clientX : windowWidth - clientX;
    const { min, max } = textWidthRange(windowWidth);
    return Math.round(Math.min(max, Math.max(min, windowWidth - 2 * edge)));
}

/**
 * @param {{ document: Document, window: Window, settings: ReturnType<typeof import('./settings.js').createSettings> }} deps
 */
export function createMarginResize({ document, window, settings }) {
    const handles = ['left', 'right'].map((side) => {
        const el = document.createElement('div');
        el.className = `margin-handle margin-handle-${side}`;
        el.title = 'Drag to change the reading width';
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
            const width = widthFor(side, e.clientX, window.innerWidth);
            if (width !== settings.values.width) settings.set('width', width);
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
        update(geometry) {
            for (const { side, el } of handles) {
                el.hidden = geometry.narrow;
                if (geometry.narrow) continue;
                const edge = side === 'left' ? geometry.text.x : geometry.text.x + geometry.text.width;
                el.style.left = `${side === 'left' ? edge - HANDLE_PX : edge}px`;
            }
        },
        dispose() { handles.forEach(({ el }) => el.remove()); },
    };
}
