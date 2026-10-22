/**
 * Pictures of figures for paper. A printed figure is a copy that does not change and does not need the page's
 * scripts or styles: a drawing (svg) is painted onto a canvas, a canvas is copied, and anything else is cloned.
 * A canvas is printed as it was drawn.
 */

/** Pixels of picture per CSS px; 3 is close to 300 dpi on paper. */
const DENSITY = 3;
/** The most pixels one picture has, so a big figure does not use up the memory. */
const MAX_PIXELS = 16e6;

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
/** Parts of a drawing that are not drawn. */
const UNDRAWN = new Set(['defs', 'title', 'desc', 'metadata', 'style', 'script']);
/** Parts of a drawing this cannot paint the way a browser would; a drawing with one is copied as it is. */
const UNPAINTED = new Set(['use', 'image', 'clippath', 'mask', 'filter', 'foreignobject', 'lineargradient', 'radialgradient', 'pattern', 'marker', 'symbol']);

const numberOf = (el, name, fallback = 0) => {
    const v = parseFloat(el.getAttribute(name));
    return Number.isFinite(v) ? v : fallback;
};

/** Path data for a shape, or null when there is nothing to draw. */
export function shapeData(el) {
    switch (el.tagName.toLowerCase()) {
        case 'path': return el.getAttribute('d') || null;
        case 'rect': return rectData(numberOf(el, 'x'), numberOf(el, 'y'), numberOf(el, 'width'), numberOf(el, 'height'), el.getAttribute('rx'), el.getAttribute('ry'));
        case 'circle': return ellipseData(numberOf(el, 'cx'), numberOf(el, 'cy'), numberOf(el, 'r'), numberOf(el, 'r'));
        case 'ellipse': return ellipseData(numberOf(el, 'cx'), numberOf(el, 'cy'), numberOf(el, 'rx'), numberOf(el, 'ry'));
        case 'line': return `M${numberOf(el, 'x1')} ${numberOf(el, 'y1')}L${numberOf(el, 'x2')} ${numberOf(el, 'y2')}`;
        case 'polyline':
        case 'polygon': {
            const p = (el.getAttribute('points') ?? '').match(NUMBER)?.map(Number) ?? [];
            if (p.length < 4) return null;
            let d = `M${p[0]} ${p[1]}`;
            for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
            return el.tagName.toLowerCase() === 'polygon' ? `${d}Z` : d;
        }
        default: return null;
    }
}

function rectData(x, y, w, h, rxAttr, ryAttr) {
    if (!(w > 0 && h > 0)) return null;
    let rx = parseFloat(rxAttr);
    let ry = parseFloat(ryAttr);
    if (!Number.isFinite(rx) && !Number.isFinite(ry)) rx = ry = 0;
    else if (!Number.isFinite(rx)) rx = ry;
    else if (!Number.isFinite(ry)) ry = rx;
    rx = Math.min(Math.max(rx, 0), w / 2);
    ry = Math.min(Math.max(ry, 0), h / 2);
    if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    const arc = (px, py) => `A${rx} ${ry} 0 0 1 ${px} ${py}`;
    return `M${x + rx} ${y}H${x + w - rx}${arc(x + w, y + ry)}V${y + h - ry}${arc(x + w - rx, y + h)}H${x + rx}${arc(x, y + h - ry)}V${y + ry}${arc(x + rx, y)}Z`;
}

function ellipseData(cx, cy, rx, ry) {
    if (!(rx > 0 && ry > 0)) return null;
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

/** The matrix `[a, b, c, d, e, f]` of an SVG transform attribute, or null when there is none. */
export function parseTransform(text) {
    if (!text) return null;
    let m = [1, 0, 0, 1, 0, 0];
    const times = (n) => {
        m = [
            m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
        ];
    };
    for (const [, name, args] of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
        const a = args.match(NUMBER)?.map(Number) ?? [];
        switch (name) {
            case 'matrix': if (a.length === 6) times(a); break;
            case 'translate': times([1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]); break;
            case 'scale': times([a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]); break;
            case 'rotate': {
                const t = ((a[0] ?? 0) * Math.PI) / 180;
                const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
                times([1, 0, 0, 1, cx, cy]);
                times([Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
                times([1, 0, 0, 1, -cx, -cy]);
                break;
            }
            case 'skewX': times([1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]); break;
            case 'skewY': times([1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]); break;
            default: break;
        }
    }
    return m;
}

/** A color to paint with, null for none, or false for a paint this cannot make (a gradient). */
function paintOf(value) {
    if (!value || value === 'none') return null;
    return value.startsWith('url(') ? false : value;
}

const alphaOf = (value) => {
    const v = parseFloat(value);
    return Number.isFinite(v) ? v : 1;
};

function paintShape(el, g, css, makePath) {
    const d = shapeData(el);
    if (!d || css.visibility === 'hidden' || css.visibility === 'collapse') return true;
    const fill = paintOf(css.fill);
    const stroke = paintOf(css.stroke);
    if (fill === false || stroke === false) return false;
    const path = makePath(d);

    const paintFill = () => {
        if (!fill) return;
        g.save();
        g.globalAlpha *= alphaOf(css.fillOpacity);
        g.fillStyle = fill;
        g.fill(path, css.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        g.restore();
    };
    const paintStroke = () => {
        const width = parseFloat(css.strokeWidth);
        if (!stroke || !(width > 0)) return;
        g.save();
        g.globalAlpha *= alphaOf(css.strokeOpacity);
        g.strokeStyle = stroke;
        g.lineWidth = width;
        g.lineCap = css.strokeLinecap === 'round' || css.strokeLinecap === 'square' ? css.strokeLinecap : 'butt';
        g.lineJoin = css.strokeLinejoin === 'round' || css.strokeLinejoin === 'bevel' ? css.strokeLinejoin : 'miter';
        g.miterLimit = parseFloat(css.strokeMiterlimit) || 4;
        const dashes = css.strokeDasharray?.match(NUMBER)?.map(Number) ?? [];
        g.setLineDash(dashes.length && dashes.every(n => n >= 0) && dashes.some(n => n > 0) ? dashes : []);
        g.lineDashOffset = parseFloat(css.strokeDashoffset) || 0;
        g.stroke(path);
        g.restore();
    };
    if (css.paintOrder?.startsWith('stroke')) { paintStroke(); paintFill(); } else { paintFill(); paintStroke(); }
    return true;
}

function paintText(el, g, css) {
    const text = el.textContent;
    const fill = paintOf(css.fill);
    if (!text || !fill || css.visibility === 'hidden') return fill !== false;
    g.save();
    g.globalAlpha *= alphaOf(css.fillOpacity);
    g.fillStyle = fill;
    g.font = `${css.fontStyle ?? 'normal'} ${css.fontWeight ?? 'normal'} ${css.fontSize ?? '16px'} ${css.fontFamily ?? 'serif'}`;
    g.textAlign = css.textAnchor === 'middle' ? 'center' : css.textAnchor === 'end' ? 'right' : 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(text, numberOf(el, 'x') + numberOf(el, 'dx'), numberOf(el, 'y') + numberOf(el, 'dy'));
    g.restore();
    return true;
}

function paintNode(el, g, deps) {
    const tag = el.tagName.toLowerCase();
    if (UNDRAWN.has(tag)) return true;
    if (UNPAINTED.has(tag)) return false;
    const css = deps.style(el);
    if (css.display === 'none') return true;
    g.save();
    const m = parseTransform(el.getAttribute('transform'));
    if (m) g.transform(...m);
    const alpha = alphaOf(css.opacity);
    if (alpha < 1) g.globalAlpha *= alpha;
    let ok = true;
    if (tag === 'g' || tag === 'a' || tag === 'svg') ok = paintChildren(el, g, deps);
    else if (tag === 'text') ok = paintText(el, g, css);
    else ok = paintShape(el, g, css, deps.makePath);
    g.restore();
    return ok;
}

function paintChildren(el, g, deps) {
    for (const child of el.children) {
        if (!paintNode(child, g, deps)) return false;
    }
    return true;
}

/** The part of the drawing's own space that is shown, from its viewBox or else its size. */
function viewBoxOf(svg) {
    const v = svg.getAttribute('viewBox')?.match(NUMBER)?.map(Number);
    if (v?.length === 4 && v[2] > 0 && v[3] > 0) return { x: v[0], y: v[1], width: v[2], height: v[3] };
    const width = numberOf(svg, 'width', svg.clientWidth);
    const height = numberOf(svg, 'height', svg.clientHeight);
    return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
}

/**
 * A drawing painted onto a canvas, or null when it has something this cannot paint.
 * `style(el)` gives the computed style of a part of the drawing, which is where colors and widths come from.
 * @param {Element} svg
 * @param {{ document: Document, style: (el: Element) => any, makePath?: (d: string) => any }} deps
 */
export function paintSvg(svg, { document, style, makePath = (d) => new Path2D(d) }) {
    const box = viewBoxOf(svg);
    if (!box) return null;
    const density = Math.min(DENSITY, Math.sqrt(MAX_PIXELS / (box.width * box.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(box.width * density));
    canvas.height = Math.max(1, Math.round(box.height * density));
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.scale(canvas.width / box.width, canvas.height / box.height);
    g.translate(-box.x, -box.y);
    return paintChildren(svg, g, { style, makePath }) ? canvas : null;
}

const cssLength = (value) => (/^[\d.]+$/.test(value) ? `${value}px` : value);

function copyCanvas(source, document) {
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    copy.className = source.className;
    copy.style.cssText = source.style.cssText;
    try {
        copy.getContext('2d').drawImage(source, 0, 0);
    } catch {
        // a canvas holding another site's picture cannot be read, so its copy stays empty
    }
    return copy;
}

function paintedDrawing(svg, deps) {
    const canvas = paintSvg(svg, deps);
    if (!canvas) return svg.cloneNode(true);
    canvas.className = svg.getAttribute('class') ?? '';
    canvas.style.cssText = svg.getAttribute('style') ?? '';
    const [width, height] = [svg.getAttribute('width'), svg.getAttribute('height')];
    if (width) canvas.style.width = cssLength(width);
    if (height) canvas.style.height = cssLength(height);
    canvas.style.objectFit = 'contain';
    return canvas;
}

function still(node, deps) {
    if (node.nodeType !== 1) return node.cloneNode(true);
    const tag = node.tagName.toLowerCase();
    if (tag === 'canvas') return copyCanvas(node, deps.document);
    if (tag === 'svg') return paintedDrawing(node, deps);
    const copy = node.cloneNode(false);
    for (const child of node.childNodes) copy.appendChild(still(child, deps));
    return copy;
}

/**
 * A copy of a figure as it looks now, that holds no script and needs no style from the page. The figure is first
 * told to draw once more with a `printsnapshot` event, for the ones whose canvas is cleared as soon as the browser has
 * shown it.
 * @param {Element} host
 * @param {{ document: Document, style?: (el: Element) => any, makePath?: (d: string) => any }} deps
 * @returns {Element}
 */
export function snapshotOf(host, { document, style, makePath }) {
    const view = document.defaultView;
    const deps = { document, style: style ?? ((el) => view.getComputedStyle(el)), makePath };
    host.dispatchEvent(new view.CustomEvent('printsnapshot'));
    const copy = host.cloneNode(false);
    copy.removeAttribute('data-figure');
    for (const child of host.childNodes) copy.appendChild(still(child, deps));
    return copy;
}
