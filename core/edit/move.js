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
import { parseValue } from '../layout/values.js';
import { PAGE } from '../layout/document.js';

const number = (text) => {
    const v = parseValue(text);
    return v?.type === 'number' ? v.value : 0;
};

/**
 * @param {{ node: any, y: number, x: number, width: number, anchorY: number }} note   where the note is now
 * @param {{ dx: number, dy: number, pageWidth: number, lineHeight: number, topPad: number }} drop
 * @returns {Array<{ key: string | number, value: string | null }>}
 */
export function noteMoveChanges(note, { dx, dy, pageWidth, lineHeight, topPad }) {
    const y = note.y + dy;
    const side = note.x + note.width / 2 + dx < pageWidth / 2 ? 'left' : 'right';
    const changes = [{ key: 0, value: side }];
    if (Math.abs(y - note.anchorY) <= lineHeight) {
        changes.push({ key: 'type', value: null }, { key: 'pos', value: null });
    } else {
        changes.push({ key: 'type', value: 'absolute' }, { key: 'pos', value: String(Math.max(0, Math.round(y - topPad))) });
    }
    return changes;
}

/**
 * @param {{ place: string | undefined, dx: string | undefined, dy: string | undefined }} args   the figure's current arguments
 * @param {{ dx: number, dy: number }} drag   how far it was dragged, in px
 */
export function figureMoveChanges(args, drag) {
    const here = { dx: number(args.dx), dy: number(args.dy) };
    // a figure placed on the right is measured from the right edge
    const sign = args.place === 'right' ? -1 : 1;
    const dx = Math.round(here.dx + sign * drag.dx);
    const dy = Math.round(here.dy + drag.dy);
    return [
        { key: 'dx', value: dx === 0 ? null : String(dx) },
        { key: 'dy', value: dy === 0 ? null : String(dy) },
    ];
}

/** Current dx/dy/place of a figure directive, as text. */
export const figureArgs = (node) => ({ place: argValue(node, 'place'), dx: argValue(node, 'dx'), dy: argValue(node, 'dy') });

/**
 * A grip above a margin note while editing; dragging it moves the note, and
 * the page re-flows around it on every move.
 * @param {{ document: Document, root: HTMLElement, getSession: () => any, getLayout: () => any, onEdited: () => void }} deps
 */
export function createNoteMover({ document, root, getSession, getLayout, onEdited }) {
    const grip = document.createElement('div');
    grip.className = 'move-grip';
    grip.title = 'Drag to move this note';
    grip.textContent = '⠿';
    grip.hidden = true;
    document.body.appendChild(grip);

    let hovered = null;
    let hideTimer = 0;
    let drag = null;
    const hide = () => { if (!drag) { grip.hidden = true; hovered = null; } };

    root.addEventListener('mousemove', (e) => {
        if (!document.body.classList.contains('editing') || drag) return;
        const aside = e.target.closest?.('aside.note[data-note]');
        if (!aside) return;
        const note = getLayout()?.notes[Number(aside.dataset.note)];
        if (!note) return;
        clearTimeout(hideTimer);
        hovered = note;
        const r = aside.getBoundingClientRect();
        grip.hidden = false;
        grip.style.left = `${r.left + scrollX - 2}px`;
        grip.style.top = `${r.top + scrollY - 24}px`;
        hideTimer = setTimeout(hide, 2500);
    });

    const show = (dx, dy) => drag.preview.show(noteMoveChanges(drag.from, { ...drag.page, dx, dy }));

    makeDraggable(grip, {
        onStart() {
            const session = getSession();
            const layout = getLayout();
            if (!hovered || !session) return;
            clearTimeout(hideTimer);
            drag = {
                preview: createPreview(session, hovered.node.start),
                from: { y: hovered.y, x: hovered.x, width: hovered.width, anchorY: hovered.anchor.y },
                page: { pageWidth: layout.width, lineHeight: layout.styles.lineHeight, topPad: PAGE.topPad },
            };
        },
        onMove(dx, dy) {
            if (!drag) return;
            grip.style.transform = `translate(${dx}px, ${dy}px)`;
            show(dx, dy);
        },
        onDrop(dx, dy) {
            if (!drag) return;
            show(dx, dy);
            const { preview } = drag;
            drag = null;
            grip.style.transform = '';
            hide();
            if (preview.changed) onEdited();
        },
        onCancel() {
            drag?.preview.cancel();
            drag = null;
            grip.style.transform = '';
            hide();
        },
    });

    return { dispose() { grip.remove(); clearTimeout(hideTimer); } };
}
