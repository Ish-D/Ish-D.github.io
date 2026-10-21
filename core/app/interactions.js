/**
 * Pointer and keyboard behavior of the page: clicks on links, images, notes
 * and sketches, hover links between notes and their markers, copy, undo, and
 * history navigation.
 */

import { selectionText } from '../render/dom.js';
import { pageUrl, routeFromLocation } from './urls.js';

export function installInteractions(app) {
    const { state, root, document, window } = app;
    const editing = () => !!state.editor?.enabled;

    /** One handler per kind of clickable thing; the first that applies wins. */
    const clicks = [
        (e) => !!e.target.closest('.sketch-pad'),
        // in the editor a figure is selected, not turned into text; its drawing pad opens too
        (e) => {
            const figure = editing() && e.target.closest('.obj[data-start]');
            if (!figure) return false;
            app.selection.select(figure);
            if (figure.dataset.sketch !== undefined) app.sketching.start(figure);
            return true;
        },
        (e) => editing() && !e.metaKey && !e.ctrlKey && state.editor.handleClick(e.target, { x: e.clientX, y: e.clientY }),
        (e) => {
            const link = e.target.closest('.heading-link');
            if (!link) return false;
            navigator.clipboard?.writeText(`${location.origin}${location.pathname}${pageUrl(state.page, `#${link.dataset.anchor}`)}`).catch(() => {});
            return true;
        },
        (e) => {
            const img = e.target.closest('img[data-full]');
            if (!img || editing()) return false;
            app.lightbox.open(img);
            return true;
        },
        (e) => {
            const toggle = e.target.closest('[data-toggle-note]');
            if (!toggle) return false;
            const key = Number(toggle.dataset.toggleNote);
            if (!state.expandedNotes.delete(key)) state.expandedNotes.add(key);
            app.view.relayout();
            return true;
        },
        (e) => {
            const card = e.target.closest('a[data-card]');
            if (!card) return false;
            app.pages.open(card.dataset.card);
            return true;
        },
        (e) => {
            const jump = e.target.closest('a[data-jump]');
            if (!jump) return false;
            app.nav.scrollToAnchor(jump.dataset.jump);
            return true;
        },
    ];

    root.addEventListener('click', (e) => {
        // a click anywhere but on the selected figure's own controls lets go of the selection
        if (!e.target.closest('.obj[data-start]') && !app.selection.owns(e.target)) app.selection.clear();
        for (const handle of clicks) {
            if (handle(e)) { e.preventDefault(); return; }
        }
    });

    /** Hovering a note lights its marker; hovering a marker marks its note. */
    const linkNotes = (e, on) => {
        const marker = e.target.closest?.('.mk[data-note]');
        const note = marker ? null : e.target.closest?.('aside.note');
        const hovered = marker ?? note;
        if (!hovered || !state.docEl) return;
        const other = marker ? 'aside.note' : '.mk';
        state.docEl.querySelectorAll(`${other}[data-note="${hovered.dataset.note}"]`).forEach(el => el.classList.toggle('on', on));
    };
    /** Pointing at a contents entry brings its text forward. */
    const pointAtContents = (e, on) => {
        const hit = e.target.closest?.('.toc-hit');
        if (!hit || !state.docEl) return;
        state.docEl.querySelectorAll(`.toc-text[data-toc="${hit.dataset.jump}"]`).forEach(el => el.classList.toggle('hot', on));
    };
    root.addEventListener('mouseover', (e) => { linkNotes(e, true); pointAtContents(e, true); });
    root.addEventListener('mouseout', (e) => { linkNotes(e, false); pointAtContents(e, false); });

    window.addEventListener('popstate', () => {
        const route = routeFromLocation(location);
        app.pages.open(route.page, { push: false, hash: route.hash });
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => app.view.relayout(), 80);
    });

    // copy as the source text the selection came from, not the broken-up lines
    document.addEventListener('copy', (e) => {
        const selection = getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        const text = selectionText(selection.getRangeAt(0).cloneContents());
        if (text) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!state.session || e.target?.tagName === 'TEXTAREA' || e.target?.tagName === 'INPUT') return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            state.editor?.close();
            if (e.shiftKey) state.session.redo(); else state.session.undo();
            app.saver.scheduleSave();
        }
    });
}
