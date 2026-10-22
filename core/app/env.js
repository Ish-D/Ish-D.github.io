/**
 * What the layout engine and the renderer need from the browser: measuring,
 * math, images, generated page lists, and form widgets.
 */

import { english } from '../text/hyphenate.js';
import { titleScaleFor } from '../layout/style.js';
import { formatNumber } from '../runtime/store.js';
import { hasFigure, figureOnPaper } from '../runtime/figures.js';
import { assetUrl, displayUrl, imageSrc, hasDrawingSource, drawingUrl, pageUrl } from './urls.js';
import { macroBlocks } from './page-lists.js';

export function createEnv(app) {
    const { state, settings, measurer, math, images, drawings, window, document } = app;

    const varText = (name) => {
        const spec = state.store.spec(name);
        return spec ? formatNumber(state.store.peek(name), spec) : '';
    };
    math.setValues({ widest: varText, current: varText });

    /** Math that shows a variable is retypeset (and the page relaid out) when the variable changes. */
    function liveMath(_inner, tex) {
        const names = [...tex.matchAll(/\\val\{(\w+)\}/g)].map(m => m[1]);
        let first = true;
        state.liveStops.push(state.store.watch(names, () => {
            if (first) { first = false; return; }
            app.view.relayout();
        }));
    }

    /** Input for layoutDocument. `over` lays the page out at another width or text size, as for paper. */
    function build(over = {}) {
        const width = over.width ?? document.documentElement.clientWidth;
        const narrow = width < 600;
        const { width: readingWidth, titleAlign } = settings.values;
        const fontSize = over.fontSize ?? (narrow ? Math.min(settings.values.fontSize, 18) : settings.values.fontSize);
        math.setFontSize(fontSize);
        return {
            width,
            viewportHeight: window.innerHeight,
            expandedNotes: state.expandedNotes,
            measurer,
            hyphenator: english,
            settings: { fontSize, width: readingWidth, titleScale: titleScaleFor(width), titleAlign },
            editing: state.editing,
            atoms: {
                inlineMath: (tex, size = fontSize) => math.render(tex, false, size) ?? { width: tex.length * size * 0.5, height: size * 1.2, ascent: size },
                displayMath: (tex, _width, size = fontSize) => math.render(tex, true, size) ?? { width: 0, height: size * 2.5 },
                image: (node) => {
                    const size = images.get(displayUrl(node.src)) ?? { width: fontSize * 6, height: fontSize * 4 };
                    const height = Math.min(size.height, fontSize * 1.4);
                    return { width: size.width * (height / size.height), height };
                },
                widget: () => ({ width: fontSize * 5, height: fontSize * 1.3 }),
                variable: (name) => {
                    if (!state.store.has(name)) return null;
                    const text = state.store.widest(name, formatNumber);
                    return { width: measurer.width(text, { family: 'MonotypeModern', size: fontSize }) + 14, height: fontSize * 1.4 };
                },
            },
            objects: {
                natural: (node) => {
                    if (node.name === 'image') return images.get(displayUrl(imageSrc(node)));
                    if (node.name === 'drawing') return hasDrawingSource(node) ? drawings.get(drawingUrl(node)) : null;
                    return null;
                },
                mask: () => null,
                onPaper: (node) => !(node.name === 'viz' || node.name === 'figure') || figureOnPaper(node.args?.items.find(a => a.key === 'type')?.value),
            },
            generate: (node) => macroBlocks(state.manifest, node),
        };
    }

    /** Hooks for renderLayout. */
    function renderContext() {
        return {
            document,
            measurer,
            math: (tex, display) => math.render(tex, display),
            highlight: (el, lang) => { if (window.Prism && lang) window.Prism.highlightElement(el); },
            resolveAsset: displayUrl,
            pageUrl,
            fullAsset: assetUrl,
            persist: app.persist,
            widget: (node) => app.widgets.build(node),
            formatVar: varText,
            liveMath,
            isFigure: hasFigure,
            drawing: (src) => drawings.get(assetUrl(src)) ?? null,
        };
    }

    return { build, renderContext, varText };
}
