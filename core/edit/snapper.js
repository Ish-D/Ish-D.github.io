/**
 * Snapping a drag: given how far the pointer has moved, how far the thing
 * should move. Ties the guides, the snap maths and the drawn lines together.
 */

import { collectGuides, WIDTH_FRACTIONS } from './guides.js';
import { nearest, placementOf, snapRect } from './snap.js';

/**
 * @param {{ getLayout: () => any, prefs: ReturnType<typeof import('./prefs.js').createPrefs>, overlay: ReturnType<typeof import('./snap-overlay.js').createSnapOverlay> }} deps
 */
export function createSnapper({ getLayout, prefs, overlay }) {
    /**
     * Starts a drag of a box whose page rectangle is `rect`.
     * @param {{ x: number, y: number, width: number, height: number }} rect
     * @param {{ ignoreObject?: number, ignoreNote?: any, axes?: 'both' | 'x' | 'y' }} [options]
     */
    function begin(rect, options = {}) {
        const layout = getLayout();
        const guides = collectGuides(layout, options);
        const structure = prefs.values.guides ? guides : null;

        return {
            /**
             * @param {number} dx   how far the pointer moved across
             * @param {number} dy   and down
             * @param {boolean} [free]  true while a modifier key asks for no snapping
             * @returns {{ dx: number, dy: number, placement: string | null, hits: any[] }}
             */
            move(dx, dy, free = false) {
                if (!prefs.values.snap || free) { overlay.draw({ hits: [], structure }); return { dx, dy, placement: null, hits: [] }; }
                const moved = { ...rect, x: rect.x + dx, y: rect.y + dy };
                const result = snapRect(moved, guides, { axes: options.axes });
                const hits = [];
                if (result.x) hits.push({ ...result.x, axis: 'x' });
                if (result.y) hits.push({ ...result.y, axis: 'y' });
                overlay.draw({ hits, structure });
                return { dx: dx + result.dx, dy: dy + result.dy, placement: placementOf(result.x), hits };
            },

            /**
             * A new width for a box resized from its left edge, snapped so its right edge meets a guide or
             * a simple fraction of the text column.
             * @returns {{ width: number, fraction: number | null }}
             */
            resize(width, free = false, column = layout.geometry.text) {
                if (!prefs.values.snap || free) { overlay.draw({ hits: [], structure }); return { width, fraction: null }; }
                const edges = guides.x.concat(WIDTH_FRACTIONS.map(f => ({ value: column.x + f * column.width, kind: 'fraction', label: `${Math.round(f * 100)}% of the column`, fraction: f })));
                const hit = nearest([{ at: rect.x + width, role: 'end' }], edges);
                overlay.draw({ hits: hit ? [{ ...hit, axis: 'x' }] : [], structure });
                const snapped = hit ? width + hit.delta : width;
                return { width: snapped, fraction: hit?.guide.fraction ?? null };
            },

            end() { overlay.hide(); },
        };
    }
    return { begin };
}
