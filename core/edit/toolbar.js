/**
 * The bar along the bottom of the window while editing: undo and redo,
 * snapping and guides, and the screen width to preview the page at.
 */

/**
 * @param {{ document: Document, prefs: ReturnType<typeof import('./prefs.js').createPrefs>, previews: Array<[number, string]>,
 *           getSession: () => any, onUndo: () => void, onRedo: () => void }} deps
 */
export function createToolbar({ document, prefs, previews, getSession, onUndo, onRedo }) {
    const bar = document.createElement('div');
    bar.className = 'edit-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.hidden = true;

    const make = (label, title, onclick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.onclick = onclick;
        return b;
    };
    const sep = () => Object.assign(document.createElement('span'), { className: 'sep' });

    const undo = make('↶', 'Undo (Cmd-Z)', onUndo);
    const redo = make('↷', 'Redo (Shift-Cmd-Z)', onRedo);
    const snap = make('Snap', 'Pull things to guides as you move them (hold Alt to move freely)', () => prefs.set('snap', !prefs.values.snap));
    const guides = make('Guides', 'Show the lines things snap to while moving', () => prefs.set('guides', !prefs.values.guides));
    const widths = previews.map(([width, label]) => {
        const b = make(label, width ? `Preview at ${width}px wide` : 'Use the whole window', () => prefs.set('preview', width));
        b.dataset.width = String(width);
        return b;
    });
    bar.append(undo, redo, sep(), snap, guides, sep(), ...widths);
    document.body.appendChild(bar);

    const sync = () => {
        const session = getSession();
        undo.disabled = !session?.canUndo;
        redo.disabled = !session?.canRedo;
        snap.classList.toggle('on', prefs.values.snap);
        guides.classList.toggle('on', prefs.values.guides);
        for (const b of widths) b.classList.toggle('on', Number(b.dataset.width) === prefs.values.preview);
        bar.hidden = !document.body.classList.contains('editing');
    };
    prefs.subscribe(sync);
    sync();

    return { refresh: sync, dispose() { bar.remove(); } };
}
