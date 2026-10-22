/**
 * An image broken into rotated, overlapping pieces that together rebuild it.
 * Pieces can be dragged around and come to the front when grabbed.
 *
 *   [[viz(type: scatter, src: images/higuchi.png, pieces: 12, size: 350, height: 480, place: full)]]
 */

import { defineFigure } from '../runtime/figures.js';
import { scatterImage } from './scatter-image.js';

defineFigure('scatter', (ctx) => {
    const { el, params } = ctx;
    const size = Number(params.size) || 350;
    const urls = [];
    let disposed = false;

    el.style.position = 'relative';
    el.style.overflow = 'visible';

    (async () => {
        const src = params.src?.startsWith('/') ? params.src : `/${params.src ?? ''}`;
        let specs;
        try {
            specs = await scatterImage(src, Number(params.pieces) || 12, size, size, size / 2, size / 2);
        } catch (err) {
            console.warn('scatter figure failed', err);
            return;
        }
        if (disposed) { specs.forEach(s => URL.revokeObjectURL(s.dataUrl)); return; }

        // pieces are placed once; the image is centred in the figure and the edges spill sideways
        const originX = () => (el.clientWidth - size) / 2;
        let top = 0;
        let front = specs.length;
        for (const s of specs) {
            const rad = s.rotation * Math.PI / 180;
            top = Math.min(top, s.y + s.height / 2 - (Math.abs(s.width / 2 * Math.sin(rad)) + Math.abs(s.height / 2 * Math.cos(rad))));
        }
        for (const s of specs) {
            urls.push(s.dataUrl);
            const piece = document.createElement('img');
            piece.src = s.dataUrl;
            piece.draggable = false;
            piece.className = 'scatter-piece';
            Object.assign(piece.style, {
                position: 'absolute', width: `${s.width}px`, height: `${s.height}px`,
                left: `${originX() + s.x}px`, top: `${s.y - top}px`,
                transform: `rotate(${s.rotation}deg)`, zIndex: String(s.zIndex),
            });
            let drag = null;
            piece.addEventListener('pointerdown', (e) => {
                piece.setPointerCapture?.(e.pointerId);
                drag = { x: e.clientX, y: e.clientY, left: parseFloat(piece.style.left), top: parseFloat(piece.style.top) };
                piece.style.zIndex = String(++front);
                piece.classList.add('held');
            });
            piece.addEventListener('pointermove', (e) => {
                if (!drag) return;
                piece.style.left = `${drag.left + e.clientX - drag.x}px`;
                piece.style.top = `${drag.top + e.clientY - drag.y}px`;
            });
            const drop = () => { drag = null; piece.classList.remove('held'); };
            piece.addEventListener('pointerup', drop);
            piece.addEventListener('pointercancel', drop);
            el.appendChild(piece);
        }
    })();

    return {
        dispose() {
            disposed = true;
            urls.forEach(u => URL.revokeObjectURL(u));
        },
    };
}, { paper: false });
