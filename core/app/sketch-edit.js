/**
 * Drawing on a sketch figure: opens the pad over it and writes the strokes
 * back into the page source when it closes.
 */

import { openSketchPad } from '../edit/sketchpad.js';
import { parseStrokes, parseView, DEFAULT_VIEW } from '../runtime/strokes.js';

export function createSketchEditing(app) {
    const { state, document } = app;

    /** @param {HTMLElement} figure a figure carrying data-sketch (start of the strokes in the source) */
    function start(figure) {
        const from = Number(figure.dataset.sketch);
        const to = Number(figure.dataset.sketchEnd);
        const source = state.session.source;
        const header = source.slice(source.lastIndexOf('[[', from), from);
        const view = parseView(/view:\s*([0-9.]+\s*[x×]\s*[0-9.]+)/.exec(header)?.[1]) ?? DEFAULT_VIEW;
        state.editor.close();
        state.sketching = true;
        openSketchPad({
            document, figure, view, strokes: parseStrokes(source.slice(from, to)),
            onDone(text) {
                state.sketching = false;
                const body = text ? `\n${text}\n` : '';
                if (state.session.source.slice(from, to) !== body) {
                    state.session.apply({ start: from, end: to, text: body }, { group: `sketch-${Date.now()}` });
                    app.saver.scheduleSave();
                }
                app.view.relayout();
            },
        });
    }

    return { start };
}
