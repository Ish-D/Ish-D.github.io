/**
 * Snapping for things moved by hand. A moving box offers its edges and centre;
 * guides are the lines worth lining up with (the text column, the seam
 * between columns, other figures, the tops of paragraphs).
 *
 * The pull is soft. A guide only matters within a few pixels, and the box never
 * jumps: it slows as it nears the line, rests on it for a moment, and carries
 * on without a step. So the page below it moves the same way with or without
 * snapping, only the box eases onto the line.
 *
 * @typedef {{ value: number, kind: string, label: string, from?: number, to?: number }} Guide
 *   `from`/`to` bound the stretch the line is drawn over; without them it spans the page
 * @typedef {{ x: Guide[], y: Guide[] }} Guides
 * @typedef {'start' | 'center' | 'end'} Role
 */

/** Distance, in px, within which a guide has any pull. */
export const REACH = 8;
/** Distance within which a box rests exactly on the guide. */
export const STICK = 2.5;

const ORDER = { center: 0, start: 1, end: 1 };

/**
 * How far to shift a box that is `distance` px short of a guide (negative: past it).
 * Outside the reach nothing moves; inside the stick radius the box sits on the
 * guide; in between it is eased so the position stays continuous.
 */
export function pull(distance, reach = REACH, stick = STICK) {
    const a = Math.abs(distance);
    if (a >= reach) return 0;
    if (a <= stick) return distance;
    return distance - Math.sign(distance) * (a - stick) * reach / (reach - stick);
}

/**
 * The closest guide to any of the candidates, or null.
 * @param {Array<{ at: number, role: Role }>} candidates
 * @param {Guide[]} guides
 * @returns {{ shift: number, distance: number, guide: Guide, role: Role, locked: boolean } | null}
 */
export function nearest(candidates, guides, { reach = REACH, stick = STICK } = {}) {
    let best = null;
    for (const { at, role } of candidates) {
        for (const guide of guides) {
            const distance = guide.value - at;
            const a = Math.abs(distance);
            if (a >= reach) continue;
            if (!best || a < best.a - 1e-9 || (Math.abs(a - best.a) < 1e-9 && ORDER[role] < ORDER[best.role])) best = { a, distance, guide, role };
        }
    }
    return best && { shift: pull(best.distance, reach, stick), distance: best.distance, guide: best.guide, role: best.role, locked: best.a <= stick };
}

/**
 * Where to ease a box so its edges or centre meet a guide.
 * @param {{ x: number, y: number, width: number, height: number }} rect   the box where the pointer has put it
 * @param {Guides} guides
 * @param {{ axes?: 'both' | 'x' | 'y' }} [options]
 * @returns {{ dx: number, dy: number, x: ReturnType<typeof nearest>, y: ReturnType<typeof nearest> }}
 */
export function snapRect(rect, guides, { axes = 'both' } = {}) {
    const x = axes === 'y' ? null : nearest([
        { at: rect.x, role: 'start' }, { at: rect.x + rect.width / 2, role: 'center' }, { at: rect.x + rect.width, role: 'end' },
    ], guides.x);
    const y = axes === 'x' ? null : nearest([
        { at: rect.y, role: 'start' }, { at: rect.y + rect.height / 2, role: 'center' }, { at: rect.y + rect.height, role: 'end' },
    ], guides.y);
    return { dx: x?.shift ?? 0, dy: y?.shift ?? 0, x, y };
}

/**
 * The placement a hit stands for, when the box is resting on the guide: the
 * left edge on the text column's edge is "place: left", and so on. Saved when
 * a move ends, it keeps the figure there at every screen size.
 * @returns {'left' | 'right' | 'center' | 'gutter' | null}
 */
export function placementOf(hit) {
    if (!hit?.locked) return null;
    const { kind } = hit.guide;
    if (kind === 'text-left' && hit.role === 'start') return 'left';
    if (kind === 'text-right' && hit.role === 'end') return 'right';
    if (kind === 'text-center' && hit.role === 'center') return 'center';
    if (kind === 'seam' && hit.role === 'center') return 'gutter';
    return null;
}
