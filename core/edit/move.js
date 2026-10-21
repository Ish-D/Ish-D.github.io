/**
 * Moving things by hand. Dragging writes the new position into the source, so
 * a moved note or figure stays where it was put and the text re-flows around it.
 *
 *  - A margin note takes `type: absolute, pos:` (its distance from the top of
 *    the page), or goes back to following its anchor when dropped beside it,
 *    and its side follows which half of the page it was dropped on.
 *  - A figure gets `dx` and `dy` offsets from where its placement would put it.
 */

import { argValue, createPreview } from './args.js';
import { makeDraggable } from './drag.js';
import { parseValue, resolveLength } from '../layout/values.js';
import { PAGE } from '../layout/document.js';
import { followHover } from './hover.js';

/** px of a length written as 12, 12px, 4% (of `basis`) or 1.5em. */
const pixels = (text, { em, basis }) => resolveLength(parseValue(text), { em, basis, fallback: 0 });

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * How far to move a margin note, as a nudge from where its anchor puts it
 * (`dy: 1.5em`), so it keeps its place in the text when the page is reflowed
 * at another size. A note dropped beside its anchor goes back to following it.
 * @param {{ y: number, x: number, width: number, baseY: number }} note   where the note is now, and where its anchor puts it
 * @param {{ dx: number, dy: number, pageWidth: number, lineHeight: number, em: number }} drop
 * @returns {Array<{ key: string | number, value: string | null }>}
 */
export function noteMoveChanges(note, { dx, dy, pageWidth, lineHeight, em }) {
    const y = note.y + dy;
    const side = note.x + note.width / 2 + dx < pageWidth / 2 ? 'left' : 'right';
    const nudge = y - note.baseY;
    const follows = Math.abs(nudge) <= lineHeight * 0.5;
    return [
        { key: 0, value: side },
        { key: 'dy', value: follows ? null : `${round2(nudge / em)}em` },
        // an older note pinned with type/pos now follows its anchor like the rest
        { key: 'type', value: null },
        { key: 'pos', value: null },
    ];
}

/**
 * Offsets for a figure moved by hand, kept in units that survive a change of
 * screen: across as a share of the text column, down in lines of type.
 * @param {{ place: string | undefined, dx: string | undefined, dy: string | undefined }} args   the figure's current arguments
 * @param {{ dx: number, dy: number }} drag   how far it was dragged, in px
 * @param {{ em: number, basis: number, placement?: string | null }} unit
 */
export function figureMoveChanges(args, drag, { em, basis, placement = null }) {
    // a figure placed on the right is measured from the right edge
    const sign = (placement ?? args.place) === 'right' ? -1 : 1;
    const dx = placement ? 0 : pixels(args.dx, { em, basis }) + sign * drag.dx;
    const dy = pixels(args.dy, { em, basis }) + drag.dy;
    const across = round2((dx / basis) * 100);
    const down = round2(dy / em);
    const changes = [
        { key: 'dx', value: across === 0 ? null : `${across}%` },
        { key: 'dy', value: down === 0 ? null : `${down}em` },
    ];
    if (placement) changes.unshift({ key: 'place', value: placement });
    return changes;
}

const NOTES = ['note', 'margin'];

/** Current dx/dy/place of a figure directive, as text. */
export const figureArgs = (node) => ({ place: argValue(node, 'place'), dx: argValue(node, 'dx'), dy: argValue(node, 'dy') });

/**
 * A grip above a margin note while editing; dragging it moves the note, and
 * the page re-flows around it on every move.
 * @param {{ document: Document, hover: ReturnType<typeof import('./hover.js').createHover>, snapper: ReturnType<typeof import('./snapper.js').createSnapper>, getSession: () => any, getLayout: () => any, onEdited: () => void }} deps
 */
export function createNoteMover({ document, hover, snapper, getSession, getLayout, onEdited }) {
    const grip = document.createElement('div');
    grip.className = 'move-grip';
    grip.title = 'Drag to move this note';
    grip.textContent = '⠿';
    grip.hidden = true;
    document.body.appendChild(grip);

    let hovered = null;
    let shownFor = null;   // the source the note's offsets belong to
    let drag = null;
    const hide = () => { if (!drag) { grip.hidden = true; hovered = null; } };

    followHover({
        hover,
        overlays: [grip],
        pick: (el) => {
            if (drag) return hovered;
            const aside = el.closest?.('aside.note[data-note]');
            const note = aside && getLayout()?.notes[Number(aside.dataset.note)];
            return note ? { note, aside } : null;
        },
        show: ({ note, aside }) => {
            if (drag) return;
            hovered = note;
            shownFor = getSession()?.source ?? null;
            const r = aside.getBoundingClientRect();
            grip.hidden = false;
            grip.style.left = `${r.left + scrollX - 2}px`;
            grip.style.top = `${r.top + scrollY - 24}px`;
        },
        hide,
    });

    /** Previews the note at the pointer's position, pulled to a guide when one is near. */
    const preview = (dx, dy, free) => {
        const snapped = drag.snap.move(dx, dy, free);
        drag.preview.show(noteMoveChanges(drag.from, { ...drag.page, dx: snapped.dx, dy: snapped.dy }));
        return snapped;
    };

    makeDraggable(grip, {
        onStart() {
            const session = getSession();
            const layout = getLayout();
            if (!hovered || !session || session.source !== shownFor) { hide(); return; }
            drag = {
                preview: createPreview(session, hovered.node.start, NOTES),
                from: { y: hovered.y, x: hovered.x, width: hovered.width, baseY: hovered.baseY ?? hovered.anchor.y },
                page: { pageWidth: layout.width, lineHeight: layout.styles.lineHeight, em: layout.styles.size },
                snap: snapper.begin({ x: hovered.x, y: hovered.y, width: hovered.width, height: hovered.height }, { ignoreNote: hovered, axes: 'y' }),
            };
        },
        onMove(dx, dy, e) {
            if (!drag) return;
            grip.style.transform = `translate(${dx}px, ${dy}px)`;
            preview(dx, dy, e.altKey);
        },
        onDrop(dx, dy, e) {
            if (!drag) return;
            preview(dx, dy, e.altKey);
            const { preview: edit, snap } = drag;
            drag = null;
            snap.end();
            grip.style.transform = '';
            hide();
            if (edit.changed) onEdited();
        },
        onCancel() {
            drag?.preview.cancel();
            drag?.snap.end();
            drag = null;
            grip.style.transform = '';
            hide();
        },
    });

    return { dispose() { grip.remove(); } };
}
