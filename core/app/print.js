/**
 * Printing. The page on screen is a pile of lines placed by coordinates, which a printer cannot cut into sheets, so
 * when someone prints, the page is set again for paper, cut into sheets (see layout/print.js) and drawn off screen;
 * the print stylesheet shows that and hides everything else.
 *
 * Figures are not run again on paper. Each one is a picture of itself (see runtime/snapshot.js): the ones the page
 * draws itself are drawn once more for the sheet, in the colors of paper, and the rest are copied as they are on screen.
 */

import { layoutPrint, paperFor, SHEET } from '../layout/print.js';
import { renderSheets } from '../render/print.js';
import { mountFigures, disposeFigures } from '../runtime/figures.js';
import { snapshotOf } from '../runtime/snapshot.js';
import { themeColors } from '../runtime/svg.js';

/** How long sheets made for one print stay good, so the events that come with one print share the work. */
const FRESH_MS = 1500;

export function installPrint(app) {
    const { document, window, state } = app;
    const root = document.createElement('div');
    root.className = 'print-root paper';
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
    const pageRule = document.createElement('style');
    document.head.appendChild(pageRule);

    let made = null;

    /** The palette figures are drawn in on paper: the light theme, whatever the page is showing. */
    function lightColors() {
        const html = document.documentElement;
        const shown = html.dataset.theme;
        html.dataset.theme = 'light';
        const colors = themeColors(document);
        if (shown === undefined) delete html.dataset.theme; else html.dataset.theme = shown;
        return colors;
    }

    /** A figure the page draws itself, drawn once for paper where it can be measured, and pictured. */
    function drawnForPaper(body, colors) {
        const box = body.parentNode;
        const stage = document.createElement('div');
        stage.className = 'paper print-stage';
        stage.style.cssText = 'position: fixed; left: -100000px; top: 0;';
        const page = document.createElement('div');
        page.className = 'doc';
        page.style.cssText = `width: ${box.style.width}; height: ${box.style.height};`;
        const figure = box.cloneNode(false);
        figure.style.left = '0px';
        figure.style.top = '0px';
        const host = body.cloneNode(false);
        figure.appendChild(host);
        page.appendChild(figure);
        stage.appendChild(page);
        document.body.appendChild(stage);
        try {
            mountFigures(stage, { document, store: state.store, eager: true, colors: () => colors });
            return snapshotOf(host, { document });
        } finally {
            disposeFigures(stage);
            stage.remove();
        }
    }

    const hasPicture = (el) => !!el?.querySelector('canvas, svg, img');
    const attempt = (make) => {
        try {
            return make();
        } catch (err) {
            console.warn('a figure could not be pictured for paper', err);
            return null;
        }
    };

    /** Every figure in the sheets becomes a picture; one that cannot be pictured says where to see it. */
    function pictureFigures(address) {
        const colors = lightColors();
        for (const body of root.querySelectorAll('.viz-container')) {
            const live = app.persist.get(`viz:${body.parentNode.dataset.start}:${body.dataset.vizType}`);
            // a figure the page draws is drawn again for the sheet; one that draws later, or a script draws, is copied as it is on screen
            let picture = body.dataset.figure ? attempt(() => drawnForPaper(body, colors)) : null;
            if (!hasPicture(picture) && live) picture = attempt(() => snapshotOf(live, { document }));
            body.removeAttribute('data-figure');
            if (hasPicture(picture)) {
                body.replaceChildren(...picture.childNodes);
            } else {
                const missing = document.createElement('p');
                missing.className = 'figure-missing';
                missing.textContent = address ? `Interactive figure. See it at ${address}` : 'Interactive figure.';
                body.replaceChildren(missing);
            }
        }
    }

    function prepare() {
        const doc = app.view.currentDoc();
        if (!doc) return;
        if (made && made.doc === doc && Date.now() - made.at < FRESH_MS) return;

        const paper = paperFor(window.navigator?.language);
        pageRule.textContent = `@page { size: ${paper.css}; margin: 0; }`;
        const title = doc.frontmatter?.entries?.name?.value ?? '';
        const named = state.page && !state.page.startsWith('~');
        const address = named ? `${window.location.host}/${state.page}` : '';
        try {
            const printed = layoutPrint(doc, app.env.build({ width: paper.width, fontSize: SHEET.fontSize }), paper);
            // sheets get their own bodies, so the page on screen keeps its own
            const ctx = { ...app.env.renderContext(), persist: new Map(), liveMath: undefined, eager: true };
            renderSheets(root, printed, ctx, { title, address });
            pictureFigures(address);
        } finally {
            // the math service goes back to the size of the page on screen
            app.env.build();
        }
        document.documentElement.classList.add('has-sheets');
        made = { doc, at: Date.now() };
    }

    function release() {
        document.documentElement.classList.remove('has-sheets');
        root.replaceChildren();
        made = null;
    }

    window.addEventListener('beforeprint', prepare);
    window.addEventListener('afterprint', release);
    // a browser that says nothing before printing still switches to print media
    window.matchMedia?.('print').addEventListener?.('change', (e) => { if (e.matches) prepare(); });

    return { prepare, release };
}
