/**
 * Keyboard shortcuts for the selected figure: arrows nudge it, Delete removes
 * it, Cmd-D duplicates it.
 */

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * @param {{ document: Document, active: () => boolean, selection: ReturnType<typeof import('./selection.js').createSelection> }} deps
 */
export function installKeys({ document, active, selection }) {
    document.addEventListener('keydown', (e) => {
        if (!active() || selection.selected === null) return;
        const t = e.target;
        if (TYPING.test(t?.tagName) || t?.isContentEditable) return;
        const step = e.shiftKey ? 10 : 1;
        const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (arrows[e.key]) {
            e.preventDefault();
            selection.nudge(...arrows[e.key]);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            selection.remove();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            selection.duplicate();
        }
    });
}
