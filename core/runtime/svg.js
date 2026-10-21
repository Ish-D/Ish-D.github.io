/**
 * Small SVG builder for figures. Colors come from the page's theme so a
 * figure follows light and dark mode without redrawing by hand.
 */

const NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element with attributes; children may be elements or strings. */
export function el(document, tag, attrs = {}, ...children) {
    const node = document.createElementNS ? document.createElementNS(NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        node.setAttribute(k === 'className' ? 'class' : k, String(v));
    }
    for (const child of children.flat()) {
        if (child === undefined || child === null || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

/**
 * A figure-sized <svg> that scales with its container.
 * @returns {{ svg: SVGElement, draw: Record<string, Function>, clear: () => void }}
 */
export function canvas(document, host, width, height) {
    const svg = el(document, 'svg', {
        viewBox: `0 0 ${width} ${height}`, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet',
        role: 'img', className: 'fig',
    });
    host.appendChild(svg);
    const make = (tag) => (attrs, ...kids) => svg.appendChild(el(document, tag, attrs, ...kids));
    return {
        svg,
        clear() { while (svg.firstChild) svg.removeChild(svg.firstChild); },
        draw: {
            line: make('line'),
            rect: make('rect'),
            circle: make('circle'),
            path: make('path'),
            text: (attrs, str) => svg.appendChild(el(document, 'text', attrs, String(str))),
            group: make('g'),
        },
    };
}

/** Linear map from a domain to a range. */
export function scale([d0, d1], [r0, r1]) {
    const k = (r1 - r0) / (d1 - d0 || 1);
    const fn = (v) => r0 + (v - d0) * k;
    fn.invert = (v) => d0 + (v - r0) / (k || 1);
    return fn;
}

/** Palette from the page's CSS variables. */
export function themeColors(document) {
    const css = document.defaultView?.getComputedStyle?.(document.documentElement);
    const read = (name, fallback) => (css?.getPropertyValue(name).trim() || fallback);
    const dark = document.documentElement.dataset.theme === 'dark';
    return {
        ink: read('--color-text-primary', dark ? '#e0e0e0' : '#2d2926'),
        muted: read('--color-text-secondary', dark ? '#a0a0a0' : '#555555'),
        paper: read('--color-card-background', dark ? '#1a1a1a' : '#ffffff'),
        rule: read('--color-border', dark ? '#333333' : '#cccccc'),
        accent: dark ? '#e8765a' : '#c4452c',
        accent2: dark ? '#6fa8dc' : '#2b6a99',
        isDark: dark,
    };
}

/** Deterministic pseudo-random numbers so a figure looks the same on every load. */
export function seeded(seed) {
    let a = seed >>> 0;
    const uniform = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    uniform.normal = () => {
        const u = Math.max(uniform(), 1e-12);
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
    };
    return uniform;
}
