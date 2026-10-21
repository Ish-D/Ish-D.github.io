/**
 * An editing session over one document's source text.
 *
 * Every change goes through `apply`, which keeps the parsed tree in step with
 * the text and records an inverse edit for undo. Changes made inside one
 * editing burst (same `group`) collapse into a single undo step.
 */

import { applyEdit } from '../doc/edit.js';

/**
 * @param {string} source
 * @param {{ parse: (source: string) => any, onChange?: (change: { source: string, doc: any, edit: any, kind: string }) => void }} options
 */
export function createSession(source, { parse, onChange = () => {} }) {
    let text = source;
    let doc = parse(text);
    let undoStack = [];
    let redoStack = [];

    const commit = (edit, kind) => {
        const result = applyEdit(text, edit);
        text = result.source;
        doc = parse(text);
        onChange({ source: text, doc, edit, kind });
        return result;
    };

    return {
        get source() { return text; },
        get doc() { return doc; },
        get canUndo() { return undoStack.length > 0; },
        get canRedo() { return redoStack.length > 0; },

        /**
         * @param {{ start: number, end: number, text: string }} edit
         * @param {{ group?: string }} [options]
         */
        apply(edit, { group = null } = {}) {
            const before = text.slice(edit.start, edit.end);
            if (before === edit.text) return;
            const inverse = { start: edit.start, end: edit.start + edit.text.length, text: before };
            const top = undoStack[undoStack.length - 1];
            if (group && top && top.group === group) {
                // Same burst: the earlier inverse restores the text from before the burst.
                top.inverse = { start: top.inverse.start, end: edit.start + edit.text.length, text: top.inverse.text };
            } else {
                undoStack.push({ group, inverse });
            }
            redoStack = [];
            commit(edit, 'edit');
        },

        undo() {
            const step = undoStack.pop();
            if (!step) return null;
            const redo = { start: step.inverse.start, end: step.inverse.end, text: text.slice(step.inverse.start, step.inverse.end) };
            commit(step.inverse, 'undo');
            redoStack.push({ group: step.group, inverse: { start: redo.start, end: redo.start + step.inverse.text.length, text: redo.text } });
            return step.inverse;
        },

        redo() {
            const step = redoStack.pop();
            if (!step) return null;
            const back = { start: step.inverse.start, end: step.inverse.end, text: text.slice(step.inverse.start, step.inverse.end) };
            commit(step.inverse, 'redo');
            undoStack.push({ group: null, inverse: { start: back.start, end: back.start + step.inverse.text.length, text: back.text } });
            return step.inverse;
        },

        /** Replace the whole text from outside (file changed on disk); history is dropped. */
        reset(next) {
            if (next === text) return;
            text = next;
            doc = parse(text);
            undoStack = [];
            redoStack = [];
            onChange({ source: text, doc, edit: null, kind: 'reset' });
        },
    };
}
