/**
 * Display list -> DOM.
 *
 * Every item is placed with absolute coordinates inside one `.doc` element, so
 * the page's geometry is exactly what the layout engine computed. Text lines
 * are single-line boxes; spacing adjustments arrive as `word-spacing`.
 */

import { parseStrokes, parseView, strokesSvg, DEFAULT_VIEW } from '../runtime/strokes.js';
import { resolveLength, listItems } from '../layout/values.js';

const FAMILY_CSS = {
    MonotypeModern: "'MonotypeModern', Georgia, serif",
    ImprintMTShadow: "'ImprintMTShadow', serif",
    'Courier New': "'Courier New', Courier, monospace",
};

const SAFE_CSS = new Set(['color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'background', 'background-color', 'letter-spacing', 'font-variant']);

const px = (n) => `${Math.round(n * 100) / 100}px`;

/**
 * CSS clip-path matching a wrap shape, so a picture wrapped in an oval is also
 * cut to that oval. Returns null for box and contour wraps.
 * @param {{ kind: string, args: any[] }} wrap
 * @param {{ width: number, height: number }} rect
 */
export function clipPathFor(wrap, rect, em = 16) {
    const { width: w, height: h } = rect;
    const basis = Math.min(w, h);
    const len = (value, ref, fallback) => resolveLength(value, { em, basis: ref, fallback });
    switch (wrap.kind) {
        case 'circle':
            return `circle(${px(len(wrap.args[0], basis, basis / 2))} at 50% 50%)`;
        case 'ellipse':
            return `ellipse(${px(len(wrap.args[0], w, w / 2))} ${px(len(wrap.args[1], h, h / 2))} at 50% 50%)`;
        case 'polygon': {
            const points = wrap.args.map((arg) => {
                const [x, y] = listItems(arg);
                return `${px(len(x, w, 0))} ${px(len(y, h, 0))}`;
            });
            return points.length >= 3 ? `polygon(${points.join(', ')})` : null;
        }
        default:
            return null;
    }
}

export function sanitizeCss(css) {
    return String(css ?? '').split(';').map(d => d.trim()).filter(Boolean).filter(decl => {
        const i = decl.indexOf(':');
        if (i === -1) return false;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).toLowerCase();
        return SAFE_CSS.has(prop) && !/url\(|expression|javascript:|@import/.test(value);
    }).join('; ');
}

/**
 * @typedef {Object} RenderContext
 * @property {Document} document
 * @property {import('../types.js').Measurer} measurer
 * @property {(tex: string, display: boolean) => { html: string, width: number, height: number, ascent: number } | null} math
 * @property {(el: HTMLElement, lang: string | null) => void} [highlight]
 * @property {(path: string) => string} [resolveAsset]
 * @property {(node: any) => HTMLElement | null} [widget]
 * @property {Map<string, HTMLElement>} [persist]   bodies that keep their DOM across re-renders
 * @property {(name: string) => string} [formatVar]   current text of an article variable
 * @property {(el: HTMLElement, tex: string, display: boolean) => void} [liveMath]   keeps math with \val{} in step with the variables
 * @property {(type: string) => boolean} [isFigure]
 * @property {(path: string) => string} [fullAsset]   the original of an image whose displayed copy is a web-sized variant
 * @property {(src: string) => { markup: string } | null} [drawing]   themed SVG markup for a drawing file
 * @property {boolean} [eager]   images load now, whether or not they are near the screen (paper)
 */

/**
 * @param {HTMLElement} root
 * @param {object} layout       result of layoutDocument
 * @param {RenderContext} ctx
 * @returns {HTMLElement} the .doc element
 */
export function renderLayout(root, layout, ctx) {
    const { document } = ctx;
    const doc = document.createElement('div');
    doc.className = 'doc';
    doc.style.width = px(layout.width);
    doc.style.height = px(layout.height);

    const noteIndex = new Map();
    layout.notes.forEach((n, i) => noteIndex.set(n.node, i));
    const env = { ctx, layout, noteIndex };

    for (const item of layout.blocks) renderItem(env, doc, item, 0, 0);

    layout.notes.forEach((note, i) => {
        const aside = document.createElement('aside');
        aside.className = `note note-${note.side}`;
        aside.dataset.note = String(i);
        const body = note.node.groups?.[note.node.name === 'margin' ? 0 : 1];
        if (body) {
            aside.dataset.start = String(body.innerStart);
            aside.dataset.end = String(body.innerEnd);
        }
        if (note.rotate) {
            const { box } = note;
            place(aside, box.x, box.y, box.width, box.height);
            aside.style.transformOrigin = '0 0';
            aside.style.transform = `rotate(${note.rotate}deg)`;
            for (const item of note.items) renderItem(env, aside, item, 0, 0);
        } else {
            place(aside, note.x, note.y, note.width, note.height);
            for (const item of note.items) renderItem(env, aside, item, note.x, note.y);
            if (note.overflow) {
                aside.classList.toggle('clipped', !!note.clipped);
                const more = document.createElement('button');
                more.className = 'note-more';
                more.dataset.toggleNote = String(note.node.start);
                more.textContent = note.clipped ? 'more' : 'less';
                aside.appendChild(more);
            }
        }
        doc.appendChild(aside);
    });

    root.replaceChildren(doc);
    return doc;
}

function place(el, x, y, width, height) {
    el.style.left = px(x);
    el.style.top = px(y);
    if (width !== undefined) el.style.width = px(width);
    if (height !== undefined) el.style.height = px(height);
}

function renderItem(env, parent, item, ox, oy) {
    const { document } = env.ctx;
    switch (item.type) {
        case 'paragraph':
        case 'heading':
            parent.appendChild(renderTextBlock(env, item, ox, oy));
            break;
        case 'dropcap': {
            const m = env.ctx.measurer.metrics(item.font);
            const el = document.createElement('span');
            el.className = 'dropcap';
            el.textContent = item.letter;
            el.style.fontFamily = FAMILY_CSS[item.font.family] ?? item.font.family;
            el.style.fontSize = px(item.font.size);
            el.style.lineHeight = px(m.ascent + m.descent);
            place(el, item.x - ox, item.baseline - m.ascent - oy);
            parent.appendChild(el);
            break;
        }
        case 'bullet': {
            const el = document.createElement('span');
            el.className = 'bullet';
            el.textContent = item.text;
            el.style.lineHeight = px(item.lineHeight);
            el.style.fontSize = px(item.font.size);
            place(el, item.x - ox - 48, item.y - oy, 48);
            parent.appendChild(el);
            break;
        }
        case 'rule': {
            const el = document.createElement('div');
            el.className = 'rule';
            place(el, item.x - ox, item.y - oy, item.width, item.thickness ?? 1);
            parent.appendChild(el);
            break;
        }
        case 'quote-rule': {
            const el = document.createElement('div');
            el.className = 'qrule';
            place(el, item.x - ox, item.y - oy, item.width, item.height);
            parent.appendChild(el);
            break;
        }
        case 'code':
            parent.appendChild(renderCode(env, item, ox, oy));
            break;
        case 'editor': {
            const el = document.createElement('div');
            el.className = 'editor-slot';
            el.dataset.editStart = String(item.start);
            el.dataset.editEnd = String(item.end);
            place(el, item.x - ox, item.y - oy, item.width, item.height);
            parent.appendChild(el);
            break;
        }
        case 'math': {
            const el = document.createElement('div');
            el.className = 'mathblock';
            if (item.node) {
                el.dataset.start = String(item.node.start);
                el.dataset.end = String(item.node.end);
            }
            const rendered = env.ctx.math(item.tex, true);
            if (rendered) {
                el.innerHTML = rendered.html;
                if (item.tex.includes('\\val{')) env.ctx.liveMath?.(el, item.tex, true);
            } else {
                el.textContent = item.tex;
            }
            place(el, item.x - ox, item.y - oy, item.width, item.height);
            el.style.lineHeight = px(item.height);
            // set at the size it was measured at
            if (item.fontSize) el.style.fontSize = px(item.fontSize);
            parent.appendChild(el);
            break;
        }
        case 'object':
            parent.appendChild(renderObject(env, item, ox, oy));
            break;
        case 'toc':
            parent.appendChild(renderToc(env, item, ox, oy));
            break;
        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function fontStyle(el, font, base) {
    if (font.family !== base.family) el.style.fontFamily = FAMILY_CSS[font.family] ?? font.family;
    if (font.size !== base.size) el.style.fontSize = px(font.size);
    const bold = font.weight === 'bold' || font.weight >= 600;
    const baseBold = base.weight === 'bold' || base.weight >= 600;
    if (bold !== baseBold) el.style.fontWeight = bold ? 'bold' : 'normal';
    if ((font.style === 'italic') !== (base.style === 'italic')) el.style.fontStyle = font.style === 'italic' ? 'italic' : 'normal';
    if (!!font.caps !== !!base.caps) el.style.textTransform = font.caps ? 'uppercase' : 'none';
    if ((font.tracking ?? 0) !== (base.tracking ?? 0)) el.style.letterSpacing = font.tracking ? `${font.tracking}em` : 'normal';
}

function baseFontOf(item) {
    return item.font ?? item.spans?.find(s => s.kind === 'text')?.font ?? { family: 'MonotypeModern', size: 16 };
}

function renderTextBlock(env, item, ox, oy) {
    const { document } = env.ctx;
    const el = document.createElement(item.type === 'heading' ? `h${Math.min(6, item.level)}` : 'p');
    el.className = `blk blk-${item.type}`;
    if (item.align) el.dataset.align = item.align;
    if (item.tocId) { el.dataset.toc = item.tocId; el.classList.add('toc-text'); }
    if (item.id) el.id = item.id;
    if (item.node) {
        el.dataset.start = String(item.node.start);
        el.dataset.end = String(item.node.end);
    }
    const lines = item.lines.filter(l => !l.overflow);
    const left = Math.min(item.x, ...lines.map(l => l.x));
    place(el, left - ox, item.top - oy, undefined, item.bottom - item.top);
    el.style.width = px(Math.max(0, Math.max(item.x + item.width, ...lines.map(l => l.x + l.width)) - left));
    const base = baseFontOf(item);
    el.style.fontFamily = FAMILY_CSS[base.family] ?? base.family;
    el.style.fontSize = px(base.size);
    if (base.weight === 'bold') el.style.fontWeight = 'bold';
    if (base.style === 'italic') el.style.fontStyle = 'italic';
    if (base.caps) el.style.textTransform = 'uppercase';
    if (base.tracking) el.style.letterSpacing = `${base.tracking}em`;
    el.style.lineHeight = px(item.lineHeight);

    for (const node of renderLines(env, lines, item, base, left, item.top)) el.appendChild(node);
    if (item.type === 'heading' && item.id) {
        const a = document.createElement('a');
        a.className = 'heading-link';
        a.href = `#${item.id}`;
        a.dataset.anchor = item.id;
        a.textContent = '§';
        a.setAttribute('aria-label', 'Link to this section');
        el.appendChild(a);
    }
    return el;
}

/**
 * For each line, how it takes part in a word split across lines. The first piece of the word keeps
 * the whole word as text, so the word can be found and copied whole; the piece on the next line is
 * drawn as generated content (`cont`), and so is the hyphen after the first piece.
 * @returns {Array<{ cont: string, hyphen: boolean, tail: string }>}
 */
function splitWords(lines) {
    const parts = lines.map(() => ({ cont: '', hyphen: false, tail: '' }));
    const first = (line) => (line?.runs[0]?.kind === 'text' ? /^\S+/.exec(line.runs[0].text)?.[0] ?? '' : '');
    /** A line that is nothing but a piece of a word, so the word goes on below it. */
    const onlyPiece = (line) => line.runs.filter(r => r.kind === 'text').length === 1 && !/\s/.test(line.runs.find(r => r.kind === 'text').text);
    lines.forEach((line, i) => {
        if (!line.hyphenated) return;
        parts[i].hyphen = true;
        if (parts[i].cont && onlyPiece(line)) return;
        let k = i;
        for (;;) {
            const next = lines[k + 1];
            const piece = first(next);
            if (!piece) break;
            parts[k + 1].cont = piece;
            parts[i].tail += piece;
            if (!(next.hyphenated && onlyPiece(next))) break;
            k++;
        }
    });
    return parts;
}

function renderLines(env, lines, item, base, blockLeft, blockTop) {
    const parts = splitWords(lines);
    return lines.map((line, i) => renderLine(env, line, item, base, blockLeft, blockTop, parts[i]));
}

function renderLine(env, line, item, base, blockLeft, blockTop, part) {
    const { document } = env.ctx;
    const ln = document.createElement('span');
    ln.className = line.ratio !== 0 && !line.last ? 'ln just' : 'ln';
    ln.style.left = px(line.x - blockLeft);
    ln.style.top = px(line.y - blockTop);
    ln.style.width = px(line.width);
    ln.style.height = px(item.lineHeight);

    for (const marker of line.markers) {
        const index = marker.ref?.type === 'note' ? env.noteIndex.get(marker.ref.node) : undefined;
        const mk = document.createElement('span');
        mk.className = 'mk';
        mk.style.left = px(marker.x);
        if (index !== undefined) mk.dataset.note = String(index);
        if (marker.ref?.type === 'anchor' && marker.ref.id) mk.id = `a-${marker.ref.id}`;
        ln.appendChild(mk);
    }

    // a hyphen is not text: it is drawn after the last piece, so it is neither found nor copied
    const runs = line.runs.filter(r => r.kind !== 'hyphen');
    runs.forEach((run, k) => {
        const split = { cont: k === 0 ? part.cont : '', hyphen: part.hyphen && k === runs.length - 1, tail: part.tail };
        const node = renderRun(env, run, item, base, split);
        if (node) ln.appendChild(node);
    });
    // what the break after the line stands for, as text that is not drawn: a space, or the end of a paragraph
    if (line.join === 'space' || line.join === 'end') {
        const sp = document.createElement('span');
        sp.className = 'sp';
        sp.textContent = line.join === 'space' ? ' ' : '\n';
        ln.appendChild(sp);
    }
    return ln;
}

/**
 * The text of a run. Where a word is split across lines, the piece from the line below is drawn
 * first (`ct`), and the last piece (`hd`) carries the rest of the word (`tl`) and then the hyphen (`brk`).
 */
function fillText(document, el, text, { cont, hyphen, tail }) {
    if (!cont && !hyphen) {
        el.textContent = text;
        return;
    }
    let rest = text;
    if (cont) {
        const ct = document.createElement('span');
        ct.className = 'ct';
        ct.dataset.t = cont;
        rest = rest.slice(cont.length);
        if (hyphen && !rest) ct.dataset.hy = '';
        el.appendChild(ct);
        if (hyphen && !rest) return;
    }
    if (!hyphen) {
        if (rest) el.appendChild(document.createTextNode(rest));
        return;
    }
    const head = /\S+$/.exec(rest)?.[0] ?? '';
    const before = rest.slice(0, rest.length - head.length);
    if (before) el.appendChild(document.createTextNode(before));
    if (!head) {
        el.dataset.hy = '';
        return;
    }
    const hd = document.createElement('span');
    hd.className = 'hd';
    hd.textContent = head;
    el.appendChild(hd);
    if (tail) {
        const tl = document.createElement('span');
        tl.className = 'tl';
        tl.textContent = tail;
        el.appendChild(tl);
    }
    // the hyphen is drawn after all of the word's text, so it never comes between its pieces
    const brk = document.createElement('span');
    brk.className = 'brk';
    el.appendChild(brk);
}

function renderRun(env, run, item, base, split) {
    const { document } = env.ctx;
    const span = item.spans[run.span];
    if (run.kind === 'atom') return renderAtom(env, span, run, base);

    const ref = span.ref ?? {};
    const text = document.createElement('span');
    text.className = 'r';
    fillText(document, text, run.text, split);
    fontStyle(text, span.font, base);
    if (run.wordSpacing) text.style.wordSpacing = px(run.wordSpacing);
    if (ref.sup) { text.classList.add('sup'); text.style.top = px(-base.size * 0.38); }
    if (ref.code) text.classList.add('code');
    if (ref.underline) text.classList.add(`u-${ref.underline}`);
    if (ref.css) {
        const safe = sanitizeCss(ref.css);
        if (safe) text.style.cssText += `;${safe}`;
    }
    if (!ref.link) return text;

    const link = document.createElement('a');
    link.className = `lnk lnk-${ref.link.type}`;
    if (ref.link.type === 'external') {
        link.href = ref.link.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    } else if (ref.link.type === 'card') {
        link.href = env.ctx.pageUrl ? env.ctx.pageUrl(ref.link.href) : `?page=${encodeURIComponent(ref.link.href)}`;
        link.dataset.card = ref.link.href;
    } else if (ref.link.type === 'jump') {
        link.href = `#${ref.link.target}`;
        link.dataset.jump = ref.link.target;
    }
    link.appendChild(text);
    return link;
}

function renderAtom(env, span, run, base) {
    const { document } = env.ctx;
    const ref = span?.ref ?? {};
    if (ref.type === 'var') {
        const v = document.createElement('span');
        v.className = ref.readonly ? 'var var-ro' : 'var';
        v.dataset.var = ref.name;
        v.style.width = px(run.width);
        v.textContent = env.ctx.formatVar?.(ref.name) ?? '';
        if (!ref.readonly) {
            v.tabIndex = 0;
            v.setAttribute('role', 'spinbutton');
            v.title = 'Drag, or use the arrow keys';
        }
        return v;
    }
    const wrap = document.createElement('span');
    wrap.className = `atom atom-${ref.type ?? 'box'}`;
    wrap.style.width = px(run.width);
    if (ref.type === 'math') {
        const rendered = env.ctx.math(ref.tex, false);
        const inner = document.createElement('span');
        inner.className = 'atom-inner';
        if (rendered) {
            inner.innerHTML = rendered.html;
            inner.style.top = px(-(ref.ascent ?? rendered.ascent));
            if (ref.tex.includes('\\val{')) env.ctx.liveMath?.(inner, ref.tex, false);
        } else {
            inner.textContent = ref.tex;
        }
        wrap.appendChild(inner);
    } else if (ref.type === 'widget') {
        const widget = env.ctx.widget?.(ref.node);
        if (widget) wrap.appendChild(widget);
    } else if (ref.type === 'image') {
        const img = document.createElement('img');
        img.src = env.ctx.resolveAsset ? env.ctx.resolveAsset(ref.node.src) : ref.node.src;
        img.alt = ref.node.alt ?? '';
        img.style.height = px(span.height);
        wrap.appendChild(img);
    }
    return wrap;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function renderCode(env, item, ox, oy) {
    const { document } = env.ctx;
    const pre = document.createElement('pre');
    pre.className = 'codeblock';
    if (item.node) {
        pre.dataset.start = String(item.node.start);
        pre.dataset.end = String(item.node.end);
    }
    place(pre, item.x - ox, item.y - oy, item.width, item.height);
    pre.style.padding = px(item.pad);
    // a block cut at a page break has no padding where it was cut
    if (item.cutTop) pre.style.paddingTop = '0';
    if (item.cutBottom) pre.style.paddingBottom = '0';
    pre.style.fontFamily = FAMILY_CSS[item.font.family] ?? item.font.family;
    pre.style.fontSize = px(item.font.size);
    pre.style.lineHeight = px(item.lineHeight);
    const code = document.createElement('code');
    if (item.lang) code.className = `language-${item.lang}`;
    code.textContent = item.lines.join('\n');
    pre.appendChild(code);
    env.ctx.highlight?.(code, item.lang);
    return pre;
}

function argValue(node, key) {
    return node.args?.items.find(a => a.key === key)?.value;
}

function positionalValue(node, i = 0) {
    return node.args?.items.filter(a => a.key === null)[i]?.value;
}

function renderObject(env, item, ox, oy) {
    const { document } = env.ctx;
    const wrap = document.createElement('figure');
    wrap.className = `obj obj-${item.name} place-${item.place.kind}`;
    if (item.layer === 'under') wrap.classList.add('under');
    place(wrap, item.rect.x - ox, item.rect.y - oy, item.rect.width, item.rect.height);
    if (item.node) {
        wrap.dataset.start = String(item.node.start);
        wrap.dataset.end = String(item.node.end);
    }

    const isViz = item.name === 'viz' || item.name === 'figure';
    const persistKey = isViz && item.node ? `viz:${item.node.start}:${argValue(item.node, 'type')}` : null;
    const kept = persistKey ? env.ctx.persist?.get(persistKey) : null;
    const body = kept ?? document.createElement('div');
    if (!kept) {
        body.className = 'obj-body';
        body.style.width = '100%';
        body.style.height = '100%';
    }

    if (kept) {
        // Stateful bodies (3D scenes) keep their DOM and are only re-parented.
    } else if (item.name === 'image') {
        const src = positionalValue(item.node, 0) ?? argValue(item.node, 'src') ?? '';
        const img = document.createElement('img');
        img.src = env.ctx.resolveAsset ? env.ctx.resolveAsset(src) : src;
        img.alt = argValue(item.node, 'alt') ?? '';
        const full = env.ctx.fullAsset ? env.ctx.fullAsset(src) : src;
        if (full !== img.src) {
            img.dataset.full = full;
            img.onerror = () => { img.onerror = null; img.src = full; };
        }
        img.loading = env.ctx.eager ? 'eager' : 'lazy';
        img.decoding = env.ctx.eager ? 'sync' : 'async';
        img.style.objectFit = argValue(item.node, 'fit') ?? 'contain';
        img.style.width = '100%';
        img.style.height = '100%';
        body.appendChild(img);
    } else if (item.name === 'drawing' && !(positionalValue(item.node, 0) ?? argValue(item.node, 'src'))) {
        // strokes drawn by hand, stored in the directive's body
        body.classList.add('drawing', 'sketch-body');
        const svg = strokesSvg(document, parseStrokes(item.node.groups?.[0]?.text), parseView(argValue(item.node, 'view')) ?? DEFAULT_VIEW);
        svg.style.width = '100%';
        svg.style.height = '100%';
        body.appendChild(svg);
        if (item.node.groups?.[0]) {
            wrap.dataset.sketch = String(item.node.groups[0].innerStart);
            wrap.dataset.sketchEnd = String(item.node.groups[0].innerEnd);
        }
    } else if (item.name === 'drawing') {
        body.classList.add('drawing');
        const asset = env.ctx.drawing?.(positionalValue(item.node, 0) ?? argValue(item.node, 'src') ?? '');
        if (asset?.markup) body.innerHTML = asset.markup;
        const svg = body.querySelector?.('svg');
        if (svg) {
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.style.width = '100%';
            svg.style.height = '100%';
        }
    } else if (item.name === 'widget') {
        const widget = env.ctx.widget?.(item.node);
        if (widget) body.appendChild(widget);
    } else if (isViz) {
        body.className += ' viz-container';
        for (const arg of item.node.args?.items ?? []) {
            if (arg.key) body.dataset[`viz${arg.key.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}`] = arg.value;
        }
        body.setAttribute('data-viz-type', argValue(item.node, 'type') ?? '');
        if (env.ctx.isFigure?.(argValue(item.node, 'type'))) body.dataset.figure = argValue(item.node, 'type');
        env.ctx.persist?.set(persistKey, body);
    }
    if (argValue(item.node, 'clip') !== 'none') {
        const clip = clipPathFor(item.wrap, item.rect, item.em);
        if (clip) body.style.clipPath = clip;
    }
    wrap.appendChild(body);

    if (item.caption) {
        const cap = document.createElement('figcaption');
        cap.className = 'caption';
        place(cap, 0, item.rect.height + (item.caption.y - (item.rect.y + item.rect.height)), item.caption.width, item.caption.height);
        const captionBlock = {
            type: 'paragraph', lines: item.caption.lines, lineHeight: item.caption.lineHeight, spans: item.caption.spans,
            x: item.rect.x, top: item.caption.y, bottom: item.caption.y + item.caption.height, width: item.caption.width,
        };
        const base = item.caption.spans.find(s => s.kind === 'text')?.font ?? baseFontOf(captionBlock);
        for (const node of renderLines(env, item.caption.lines, captionBlock, base, item.rect.x, item.caption.y)) cap.appendChild(node);
        cap.style.fontSize = px(base.size);
        cap.style.lineHeight = px(item.caption.lineHeight);
        wrap.appendChild(cap);
    }
    return wrap;
}

function renderToc(env, item, ox, oy) {
    const { document } = env.ctx;
    const nav = document.createElement('nav');
    nav.className = 'toc';
    nav.setAttribute('aria-label', 'Table of contents');
    place(nav, item.rect.x - ox, item.rect.y - oy, item.rect.width, item.rect.height);
    for (const entry of item.items) {
        const a = document.createElement('a');
        a.className = `toc-hit toc-h${entry.level}`;
        a.href = `#${entry.id}`;
        a.dataset.jump = entry.id;
        place(a, 0, entry.top - item.rect.y, item.rect.width, entry.bottom - entry.top);
        nav.appendChild(a);
    }
    return nav;
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

/** Parts of the page that are for pointing at, not for reading: nothing of them is copied. */
const NOT_COPIED = ['heading-link', 'note-more', 'mk', 'katex-mathml'];

/**
 * Plain text for a copied selection. The lines carry their own breaks (a space where a line ends between
 * words, nothing inside a word, a newline where a paragraph ends), so the text is read straight off the
 * fragment. Math is copied as its TeX.
 * @param {DocumentFragment | HTMLElement} fragment
 * @returns {string | null} null when the fragment holds none of the page's text
 */
export function selectionText(fragment) {
    if (!fragment.querySelectorAll || fragment.querySelectorAll('.ln, .codeblock, .mathblock, .dropcap').length === 0) return null;
    return copiedText(fragment).replace(/[\u00A0\u2003]+/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function copiedText(node) {
    if (node.nodeType === 3) return node.data ?? node.textContent;
    const classes = node.classList;
    if (classes?.contains) {
        if (NOT_COPIED.some(c => classes.contains(c))) return '';
        if (classes.contains('katex')) {
            const tex = node.querySelector?.('annotation')?.textContent;
            return tex ? `$${tex}$` : '';
        }
        if (classes.contains('codeblock')) return `\n${node.textContent}\n`;
    }
    const children = node.childNodes ?? node.children ?? [];
    let out = '';
    for (const child of children) out += copiedText(child);
    if (children.length === 0 && node.nodeType === 1) out += node.textContent ?? '';
    if (classes?.contains) {
        if (classes.contains('bullet')) out += ' ';
        else if (classes.contains('blk') || classes.contains('mathblock')) out += '\n';
    }
    return out;
}
