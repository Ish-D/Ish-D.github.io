/**
 * Moving things by hand. Dragging writes the new position into the source, so
 * a moved note or figure stays where it was put and the text re-flows around it.
 *
 *  - A margin note takes `type: absolute, pos:` (its distance from the top of
 *    the page), or goes back to following its anchor when dropped beside it,
 *    and its side follows which half of the page it was dropped on.
 *  - A figure gets `dx` and `dy` offsets from where its placement would put it.
 */

import { argValue, directiveAt, updateArgs } from './args.js';
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
 * A grip above a margin note while editing; dragging it moves the note.
 * @param {{ document: Document, root: HTMLElement, getSession: () => any, getLayout: () => any, onEdited: () => void }} deps
 */
export function createNoteMover({ document, root, getSession, getLayout, onEdited }) {
    const grip = document.createElement('div');
    grip.className = 'move-grip';
    grip.title = 'Drag to move this note';
    grip.textContent = '⠿';
    grip.hidden = true;
    document.body.appendChild(grip);

    let note = null;
    let element = null;
    let hideTimer = 0;
    const hide = () => { grip.hidden = true; if (!dragging) { note = null; element = null; } };
    let dragging = false;

    root.addEventListener('mousemove', (e) => {
        if (!document.body.classList.contains('editing') || dragging) return;
        const aside = e.target.closest?.('aside.note[data-note]');
        if (!aside) return;
        const layout = getLayout();
        const found = layout?.notes[Number(aside.dataset.note)];
        if (!found) return;
        clearTimeout(hideTimer);
        note = found;
        element = aside;
        const r = aside.getBoundingClientRect();
        grip.hidden = false;
        grip.style.left = `${r.left + scrollX - 2}px`;
        grip.style.top = `${r.top + scrollY - 24}px`;
        hideTimer = setTimeout(hide, 2500);
    });

    let base = '';
    makeDraggable(grip, {
        onStart() {
            dragging = true;
            clearTimeout(hideTimer);
            base = element.style.transform;
            element.classList.add('moving');
        },
        onMove(dx, dy) {
            element.style.transform = `translate(${dx}px, ${dy}px) ${base}`;
            grip.style.transform = `translate(${dx}px, ${dy}px)`;
        },
        onDrop(dx, dy) {
            const layout = getLayout();
            const session = getSession();
            const target = { node: note.node, y: note.y, x: note.x, width: note.width, anchorY: note.anchor.y };
            const changes = noteMoveChanges(target, { dx, dy, pageWidth: layout.width, lineHeight: layout.styles.lineHeight, topPad: PAGE.topPad });
            const start = note.node.start;
            dragging = false;
            grip.style.transform = '';
            element.classList.remove('moving');
            hide();
            if (session && directiveAt(session, start) && updateArgs(session, start, changes, `move-${Date.now()}`)) onEdited();
            else element.style.transform = base;
        },
        onCancel() {
            dragging = false;
            if (element) { element.style.transform = base; element.classList.remove('moving'); }
            grip.style.transform = '';
        },
    });

    return { dispose() { grip.remove(); clearTimeout(hideTimer); } };
}
