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
        const off = (free) => !prefs.values.snap || free;

        return {
            /**
             * @param {number} dx   how far the pointer moved across
             * @param {number} dy   and down
             * @param {boolean} [free]   true while a modifier key asks for no snapping
             * @param {boolean} [final]  true when the move is ending: a box resting on a placement guide takes that placement
             * @returns {{ dx: number, dy: number, placement: string | null, hits: any[] }}
             */
            move(dx, dy, free = false, final = false) {
                if (off(free)) { overlay.draw({ hits: [], structure }); return { dx, dy, placement: null, hits: [] }; }
                const result = snapRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, guides, { axes: options.axes });
                const hits = [result.x && { ...result.x, axis: 'x' }, result.y && { ...result.y, axis: 'y' }].filter(Boolean);
                overlay.draw({ hits, structure });
                return { dx: dx + result.dx, dy: dy + result.dy, placement: final ? placementOf(result.x) : null, hits };
            },

            /**
             * A new width for a box resized from its left edge, eased so its right edge meets a guide or
             * a simple share of the column. At the end, a width resting on a share is returned as that share.
             * @returns {{ width: number, fraction: number | null }}
             */
            resize(width, free = false, column = layout.geometry.text, final = false) {
                if (off(free)) { overlay.draw({ hits: [], structure }); return { width, fraction: null }; }
                const edges = guides.x.concat(WIDTH_FRACTIONS.map(f => ({ value: column.x + f * column.width, kind: 'fraction', label: `${Math.round(f * 100)}% of the column`, fraction: f })));
                const hit = nearest([{ at: rect.x + width, role: 'end' }], edges);
                overlay.draw({ hits: hit ? [{ ...hit, axis: 'x' }] : [], structure });
                return { width: width + (hit?.shift ?? 0), fraction: final && hit?.locked ? hit.guide.fraction ?? null : null };
            },

            end() { overlay.hide(); },
        };
    }
    return { begin };
}
