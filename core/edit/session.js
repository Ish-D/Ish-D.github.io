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
    /** Each entry is one undo step: a group of edits, kept in the order they were made. */
    let undoStack = [];
    let redoStack = [];
    const listeners = new Set();
    const notify = (change) => { onChange(change); for (const fn of listeners) fn(change); };

    const commit = (edit, kind) => {
        const result = applyEdit(text, edit);
        text = result.source;
        doc = parse(text);
        notify({ source: text, doc, edit, kind });
        return result;
    };

    return {
        get source() { return text; },
        get doc() { return doc; },
        get canUndo() { return undoStack.length > 0; },
        get canRedo() { return redoStack.length > 0; },

        /** Hears every change to the text, whoever makes it. Returns an unsubscribe function. */
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

        /**
         * @param {{ start: number, end: number, text: string }} edit
         * @param {{ group?: string }} [options]
         */
        apply(edit, { group = null } = {}) {
            const before = text.slice(edit.start, edit.end);
            if (before === edit.text) return;
            // Edits in a group may land anywhere, so each keeps its own inverse
            // and undo runs them back to front.
            const step = { forward: { ...edit }, inverse: { start: edit.start, end: edit.start + edit.text.length, text: before } };
            const top = undoStack[undoStack.length - 1];
            if (group && top && top.group === group) top.steps.push(step);
            else undoStack.push({ group, steps: [step] });
            redoStack = [];
            commit(edit, 'edit');
        },

        undo() {
            const entry = undoStack.pop();
            if (!entry) return null;
            for (let i = entry.steps.length - 1; i >= 0; i--) commit(entry.steps[i].inverse, 'undo');
            redoStack.push(entry);
            return entry.steps[0].inverse;
        },

        redo() {
            const entry = redoStack.pop();
            if (!entry) return null;
            for (const step of entry.steps) commit(step.forward, 'redo');
            undoStack.push(entry);
            return entry.steps[entry.steps.length - 1].forward;
        },

        /** Replace the whole text from outside (file changed on disk); history is dropped. */
        reset(next) {
            if (next === text) return;
            text = next;
            doc = parse(text);
            undoStack = [];
            redoStack = [];
            notify({ source: text, doc, edit: null, kind: 'reset' });
        },
    };
}
