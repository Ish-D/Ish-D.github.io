/**
 * Browser-only services for the layout engine: font loading and KaTeX
 * measurement. Everything here needs a real DOM.
 */

const KATEX_FACES = [
    '1em KaTeX_Main', 'bold 1em KaTeX_Main', 'italic 1em KaTeX_Main', 'italic 1em KaTeX_Math',
    '1em KaTeX_AMS', '1em KaTeX_Size1', '1em KaTeX_Size2', '1em KaTeX_Size3', '1em KaTeX_Size4',
    '1em KaTeX_Caligraphic', '1em KaTeX_Script', '1em KaTeX_SansSerif', '1em KaTeX_Typewriter',
];

/** Loading a face needs text it covers; this has a letter and a space so every face of a family loads. */
const SAMPLE = 'Aa ';

export async function loadFonts(document, families = ['MonotypeModern', 'ImprintMTShadow'], { katex = false } = {}) {
    if (!document.fonts) return;
    const faces = families.map(f => `20px ${f}`);
    if (katex) faces.push(...KATEX_FACES);
    await Promise.all(faces.map(f => document.fonts.load(f, SAMPLE).catch(() => null)));
    await document.fonts.ready;
}

/**
 * Renders TeX with KaTeX and measures it in a hidden element that shares the
 * page's text styles. Results are cached per (tex, display, font size).
 */
export function createMathService({ document, katex, fontSize }) {
    let size = fontSize;
    const cache = new Map();
    let probe = null;
    let values = { widest: () => '0', current: () => '0' };

    const substitute = (tex, pick) => tex.replace(/\\val\{(\w+)\}/g, (_, name) => pick(name));
    const typeset = (tex, display) => katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        trust: (ctx) => ctx.command === '\\htmlClass' || ctx.command === '\\htmlData',
    });

    const ensureProbe = () => {
        if (probe) return probe;
        probe = document.createElement('div');
        probe.className = 'doc math-probe';
        probe.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;margin:0;overflow:visible;';
        document.body.appendChild(probe);
        return probe;
    };

    return {
        setFontSize(next) {
            if (next !== size) { size = next; cache.clear(); }
        },

        /** Forget measurements; call when fonts that affect them finish loading. */
        invalidate() { cache.clear(); },

        /** Supplies article variables for \val{name}: widest text for measuring, current text for display. */
        setValues(next) { values = next; cache.clear(); },

        /** Markup for the current variable values, without measuring. */
        html(tex, display) {
            try { return typeset(substitute(tex, values.current), display); } catch { return null; }
        },

        /** `at` is the font size the math is set in; it is measured there. */
        render(tex, display, at = size) {
            if (!katex) return null;
            const live = tex.includes('\\val{');
            const key = `${display ? 'D' : 'I'}|${at}|${live ? substitute(tex, values.widest) : tex}`;
            const hit = cache.get(key);
            if (hit !== undefined) return hit;

            let html;
            let measured;
            try {
                measured = typeset(substitute(tex, values.widest), display);
                html = live ? typeset(substitute(tex, values.current), display) : measured;
            } catch {
                cache.set(key, null);
                return null;
            }
            const host = ensureProbe();
            host.style.fontSize = `${at}px`;
            host.style.fontFamily = "'MonotypeModern', Georgia, serif";
            const marker = '<span class="math-marker" style="display:inline-block;width:0;height:0"></span>';
            host.innerHTML = `<span class="math-wrap" style="position:static">${measured}${marker}</span>`;
            const node = host.querySelector('.katex');
            const base = host.querySelector('.math-marker');
            const box = node.getBoundingClientRect();
            const baseline = base.getBoundingClientRect().bottom;
            const result = {
                html,
                width: box.width,
                height: box.height,
                ascent: Math.max(0, baseline - box.top),
                descent: Math.max(0, box.bottom - baseline),
            };
            host.innerHTML = '';
            cache.set(key, result);
            return result;
        },
    };
}

/** Pixel size from the first bytes of a PNG or JPEG, or null when they are not enough or not recognized. */
export function sniffImageSize(bytes) {
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let i = 2;
        while (i + 9 < bytes.length) {
            if (bytes[i] !== 0xFF) { i++; continue; }
            const marker = bytes[i + 1];
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
            }
            i += 2 + view.getUint16(i + 2);
        }
    }
    return null;
}

async function readHeader(src, limit = 65536) {
    const res = await fetch(src);
    if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
    const reader = res.body.getReader();
    let bytes = new Uint8Array(0);
    try {
        while (bytes.length < limit) {
            const { done, value } = await reader.read();
            if (done) break;
            const merged = new Uint8Array(bytes.length + value.length);
            merged.set(bytes);
            merged.set(value, bytes.length);
            bytes = merged;
            const size = sniffImageSize(bytes);
            if (size) return size;
        }
    } finally {
        reader.cancel().catch(() => {});
    }
    return sniffImageSize(bytes);
}

/** Natural sizes of images, found without downloading them whole; `onLoad` fires once per image. */
export function createImageSizes(onLoad) {
    const sizes = new Map();
    const viaElement = (src) => {
        const img = new Image();
        img.onload = () => { sizes.set(src, { width: img.naturalWidth, height: img.naturalHeight }); onLoad(); };
        img.src = src;
    };
    return {
        get(src) {
            if (sizes.has(src)) return sizes.get(src);
            sizes.set(src, null);
            readHeader(src).then((size) => {
                if (size) { sizes.set(src, size); onLoad(); } else viaElement(src);
            }).catch(() => viaElement(src));
            return null;
        },
    };
}

/**
 * Themed, sanitized SVG drawings loaded from files and inlined, so strokes can
 * follow the page colors. Black becomes the text color, white the page color.
 */
export function createSvgAssets(onLoad) {
    const cache = new Map();

    const themed = (markup) => markup
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
        .replace(/(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
        .replace(/(fill|stroke)\s*=\s*"(#000000|#000|black|rgb\(0,\s*0,\s*0\))"/gi, '$1="currentColor"')
        .replace(/(fill|stroke)\s*=\s*"(#ffffff|#fff|white)"/gi, '$1="var(--color-card-background)"')
        .replace(/(fill|stroke)\s*:\s*(#000000|#000|black)\b/gi, '$1:currentColor')
        .replace(/(fill|stroke)\s*:\s*(#ffffff|#fff|white)\b/gi, '$1:var(--color-card-background)');

    const sizeOf = (markup) => {
        const vb = /viewBox\s*=\s*"([\d.\s,eE+-]+)"/.exec(markup);
        if (vb) {
            const [, , w, h] = vb[1].trim().split(/[\s,]+/).map(Number);
            if (w > 0 && h > 0) return { width: w, height: h };
        }
        const w = /\swidth\s*=\s*"([\d.]+)/.exec(markup);
        const h = /\sheight\s*=\s*"([\d.]+)/.exec(markup);
        return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null;
    };

    return {
        get(src) {
            if (cache.has(src)) return cache.get(src);
            cache.set(src, null);
            fetch(src).then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status)))).then((text) => {
                const markup = themed(text);
                const size = sizeOf(markup);
                cache.set(src, size ? { ...size, markup } : { width: 400, height: 300, markup });
                onLoad();
            }).catch(() => cache.set(src, { width: 400, height: 300, markup: '' }));
            return null;
        },
    };
}
