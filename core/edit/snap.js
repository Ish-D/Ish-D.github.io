/**
 * Snapping for things moved by hand. A moving box offers its edges and centre;
 * guides are the lines worth lining up with (the text column, the seam
 * between columns, other figures, the tops of paragraphs). The nearest pair
 * within reach wins, separately across and down.
 *
 * @typedef {{ value: number, kind: string, label: string, from?: number, to?: number }} Guide
 *   `from`/`to` bound the stretch the line is drawn over; without them it spans the page
 * @typedef {{ x: Guide[], y: Guide[] }} Guides
 * @typedef {'start' | 'center' | 'end'} Role
 */

/** Distance, in px, within which a guide pulls. */
export const SNAP_REACH = 7;

const ORDER = { center: 0, start: 1, end: 1 };

/**
 * The closest guide to any of the candidates, or null.
 * @param {Array<{ at: number, role: Role }>} candidates
 * @param {Guide[]} guides
 * @param {number} reach
 * @returns {{ delta: number, guide: Guide, role: Role } | null}
 */
export function nearest(candidates, guides, reach = SNAP_REACH) {
    let best = null;
    for (const { at, role } of candidates) {
        for (const guide of guides) {
            const distance = Math.abs(guide.value - at);
            if (distance > reach) continue;
            if (!best || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) < 1e-9 && ORDER[role] < ORDER[best.role])) {
                best = { distance, delta: guide.value - at, guide, role };
            }
        }
    }
    return best && { delta: best.delta, guide: best.guide, role: best.role };
}

/**
 * Where to move a box so its edges or centre line up with a guide.
 * @param {{ x: number, y: number, width: number, height: number }} rect   the box where it would land
 * @param {Guides} guides
 * @param {{ reach?: number, axes?: 'both' | 'x' | 'y' }} [options]
 * @returns {{ dx: number, dy: number, x: ReturnType<typeof nearest>, y: ReturnType<typeof nearest> }}
 */
export function snapRect(rect, guides, { reach = SNAP_REACH, axes = 'both' } = {}) {
    const x = axes === 'y' ? null : nearest([
        { at: rect.x, role: 'start' }, { at: rect.x + rect.width / 2, role: 'center' }, { at: rect.x + rect.width, role: 'end' },
    ], guides.x, reach);
    const y = axes === 'x' ? null : nearest([
        { at: rect.y, role: 'start' }, { at: rect.y + rect.height / 2, role: 'center' }, { at: rect.y + rect.height, role: 'end' },
    ], guides.y, reach);
    return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, x, y };
}

/**
 * The placement a hit stands for, when there is one: lining the left edge of a
 * figure up with the text column means "place: left", and so on. Saving that
 * instead of a pixel offset keeps the figure there at every screen size.
 * @returns {'left' | 'right' | 'center' | 'gutter' | null}
 */
export function placementOf(hit) {
    if (!hit) return null;
    const { kind } = hit.guide;
    if (kind === 'text-left' && hit.role === 'start') return 'left';
    if (kind === 'text-right' && hit.role === 'end') return 'right';
    if (kind === 'text-center' && hit.role === 'center') return 'center';
    if (kind === 'seam' && hit.role === 'center') return 'gutter';
    return null;
}
