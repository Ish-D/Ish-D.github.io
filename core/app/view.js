/**
 * The render pipeline: lay the open document out, draw it, and redo that when
 * anything it depends on changes.
 */

import { layoutDocument } from '../layout/document.js';
import { renderLayout } from '../render/dom.js';
import { formatNumber } from '../runtime/store.js';
import { bindVars } from '../runtime/scrub.js';
import { mountFigures } from '../runtime/figures.js';
import { collectVars } from '../doc/refs.js';
import { createTocRail } from './toc.js';
import { createReadingStats } from './reading-stats.js';
import { createMarginResize } from './margin-resize.js';

/** Runs `fn` on the next frame, or soon after when frames are not being produced (hidden tab). */
function nextFrame(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    requestAnimationFrame(run);
    setTimeout(run, 60);
}

export function createView(app) {
    const { state, root, document, window } = app;
    let queued = false;
    let toc = null;
    let stats = null;
    let resizer = null;

    const currentDoc = () => (state.session ? state.session.doc : state.fallbackDoc);

    function render() {
        const doc = currentDoc();
        if (!doc) return;
        const place = app.nav.captureScroll();
        app.hoverOutline?.clear();
        for (const spec of collectVars(doc)) state.store.define(spec);
        state.liveStops.forEach(stop => stop());
        state.liveStops = [];
        state.unbindVars?.();

        const t0 = performance.now();
        const layout = layoutDocument(doc, app.env.build());
        const t1 = performance.now();
        state.layout = layout;
        state.docEl = renderLayout(root, layout, app.env.renderContext());
        state.unbindVars = bindVars(state.docEl, state.store, formatNumber);

        const tocBox = layout.blocks.find(b => b.type === 'toc');
        toc ??= createTocRail({ document, window, goTo: (id) => app.nav.scrollToAnchor(id) });
        toc.update({ outline: layout.outline, anchors: layout.anchors, tocRect: tocBox ? tocBox.rect : null, isNarrow: layout.geometry.narrow });
        stats ??= createReadingStats({ document, window });
        stats.update(doc);
        resizer ??= createMarginResize({ document, window, settings: app.settings });
        resizer.update(layout.geometry);
        mountFigures(state.docEl, { document, store: state.store });

        state.timing = { layoutMs: Math.round(t1 - t0), renderMs: Math.round(performance.now() - t1), count: (state.timing?.count ?? 0) + 1 };
        app.nav.restoreScroll(place);
        state.editor?.afterLayout();
        if (layout.diagnostics.length) console.debug('layout diagnostics', layout.diagnostics);
    }

    /** Lays out again on the next frame (once, however many times this is called). */
    function relayout() {
        if (queued) return;
        queued = true;
        nextFrame(() => { queued = false; if (!state.sketching) render(); });
    }

    return { render, relayout, currentDoc };
}
