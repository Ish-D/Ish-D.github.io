/**
 * Draws a layout as SVG for visual inspection without a browser.
 * Words are positioned individually from the engine's own measurements, so the
 * picture shows what the line breaker decided, not what a renderer would do.
 */

import { wrapShape } from '../core/layout/objects.js';

const INK = '#2d2926';
const PAPER = '#fbfaf7';

const FAMILY = {
    MonotypeModern: 'Monotype Modern Extended',
    ImprintMTShadow: 'Imprint MT Shadow',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(n * 100) / 100;

function fontAttrs(font) {
    const family = FAMILY[font.family] ?? font.family;
    let a = `font-family="${esc(family)}" font-size="${num(font.size)}"`;
    if (font.weight === 'bold' || font.weight >= 600) a += ' font-weight="bold"';
    if (font.style === 'italic') a += ' font-style="italic"';
    return a;
}

function text(out, x, y, str, font, extra = '') {
    if (!str) return;
    out.push(`<text x="${num(x)}" y="${num(y)}" ${fontAttrs(font)} fill="${INK}" xml:space="preserve" ${extra}>${esc(str)}</text>`);
}

function baselineOf(measurer, font, lineHeight) {
    const m = measurer.metrics(font);
    return (lineHeight - (m.ascent + m.descent)) / 2 + m.ascent;
}

function drawLines(out, lines, spans, lineHeight, measurer, baseFont) {
    for (const line of lines) {
        if (line.overflow) continue;
        const baseline = line.y + baselineOf(measurer, baseFont, lineHeight);
        let x = line.x;
        for (const run of line.runs) {
            const span = spans[run.span];
            if (run.kind === 'atom') {
                const ref = span?.ref;
                const h = span?.height ?? lineHeight * 0.8;
                out.push(`<rect x="${num(x)}" y="${num(baseline - (ref?.ascent ?? h * 0.75))}" width="${num(run.width)}" height="${num(h)}" rx="3" fill="#e6e1d6" stroke="#b9b2a2" stroke-width="0.6"/>`);
                if (ref?.tex) text(out, x + 2, baseline - 2, ref.tex.slice(0, Math.max(2, Math.floor(run.width / 6))), { family: 'Courier New', size: 9 }, 'fill-opacity="0.6"');
                x += run.width;
                continue;
            }
            const font = run.kind === 'hyphen' ? (span?.font ?? baseFont) : span.font;
            const startX = x;
            if (run.kind === 'hyphen') {
                text(out, x, baseline, '-', font);
                x += run.width;
                continue;
            }
            const spaceW = measurer.width(' ', font) + run.wordSpacing;
            const parts = run.text.split(/( | )/);
            for (const part of parts) {
                if (part === ' ' || part === ' ') { x += spaceW; continue; }
                if (!part) continue;
                const raise = span.ref?.sup ? baseFont.size * 0.38 : 0;
                text(out, x, baseline - raise, part, font);
                x += measurer.width(part, font);
            }
            const ref = span.ref;
            if (ref?.underline) {
                const dash = ref.underline === 'dotted' ? ' stroke-dasharray="1.5 2"' : '';
                out.push(`<line x1="${num(startX)}" x2="${num(x)}" y1="${num(baseline + 3)}" y2="${num(baseline + 3)}" stroke="${INK}" stroke-width="0.7"${dash}/>`);
            }
        }
        for (const m of line.markers ?? []) {
            out.push(`<circle cx="${num(line.x + m.x)}" cy="${num(baseline - lineHeight * 0.32)}" r="2.2" fill="#c4452c"/>`);
        }
    }
}

function baseFontOf(item, styles) {
    return item.font ?? item.spans?.find(s => s.kind === 'text')?.font ?? styles.body;
}

/**
 * @param {object} layout       result of layoutDocument
 * @param {{ measurer: any }} env
 * @param {{ from?: number, to?: number, guides?: boolean, background?: string }} [opts]
 */
export function layoutToSvg(layout, env, opts = {}) {
    const { measurer } = env;
    const from = opts.from ?? 0;
    const to = Math.min(opts.to ?? layout.height, layout.height);
    const W = layout.width;
    const out = [];
    const g = layout.geometry;

    if (opts.guides !== false) {
        out.push(`<rect x="${g.text.x}" y="${from}" width="${g.text.width}" height="${to - from}" fill="#ffffff"/>`);
        for (const side of ['left', 'right']) {
            const s = g[side];
            if (s.width > 0) out.push(`<rect x="${s.x}" y="${from}" width="${s.width}" height="${to - from}" fill="#f4f1ea"/>`);
        }
    }

    const all = [...layout.blocks, ...(layout.notes ?? []).flatMap(n => n.items)];
    for (const item of all) {
        switch (item.type) {
            case 'paragraph':
            case 'heading':
                drawLines(out, item.lines, item.spans, item.lineHeight, measurer, baseFontOf(item, layout.styles));
                break;
            case 'toc':
                out.push(`<rect x="${num(item.rect.x)}" y="${num(item.rect.y)}" width="${num(item.rect.width)}" height="${num(item.rect.height)}" fill="#ffffff" stroke="#bdb7aa" stroke-width="0.8"/>`);
                break;
            case 'dropcap':
                text(out, item.x, item.baseline, item.letter, item.font);
                break;
            case 'bullet':
                text(out, item.x, item.y + baselineOf(measurer, item.font, item.lineHeight), item.text, item.font, 'text-anchor="end"');
                break;
            case 'rule':
                out.push(`<line x1="${num(item.x)}" x2="${num(item.x + item.width)}" y1="${num(item.y)}" y2="${num(item.y)}" stroke="#bdb7aa" stroke-width="${item.thickness ?? 1}"/>`);
                break;
            case 'quote-rule':
                out.push(`<rect x="${num(item.x)}" y="${num(item.y)}" width="${item.width}" height="${num(item.height)}" fill="#c9c3b6"/>`);
                break;
            case 'code': {
                out.push(`<rect x="${num(item.x)}" y="${num(item.y)}" width="${num(item.width)}" height="${num(item.height)}" fill="#f1eee6"/>`);
                item.lines.forEach((l, i) => text(out, item.x + item.pad, item.y + item.pad + i * item.lineHeight + item.lineHeight * 0.75, l.replace(/\t/g, '    '), item.font));
                break;
            }
            case 'math':
                out.push(`<rect x="${num(item.x)}" y="${num(item.y)}" width="${num(item.width)}" height="${num(item.height)}" rx="4" fill="#ece7db" stroke="#b9b2a2" stroke-width="0.6"/>`);
                text(out, item.x + 8, item.y + item.height / 2 + 4, item.tex.slice(0, 80), { family: 'Courier New', size: 11 });
                break;
            case 'object': {
                const r = item.rect;
                out.push(`<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.width)}" height="${num(r.height)}" fill="#e3ebf2" stroke="#7d93a8" stroke-width="0.8"/>`);
                out.push(`<path d="M${num(r.x)} ${num(r.y)}L${num(r.x + r.width)} ${num(r.y + r.height)}M${num(r.x + r.width)} ${num(r.y)}L${num(r.x)} ${num(r.y + r.height)}" stroke="#a9bacb" stroke-width="0.6"/>`);
                text(out, r.x + 6, r.y + 14, `${item.name} · ${item.place.kind}${item.wrap.kind !== 'none' ? ' · wrap ' + item.wrap.kind : ''}`, { family: 'Courier New', size: 10 });
                const shape = item.wrap.kind !== 'none' ? wrapShape(item.wrap, r, 0, { em: layout.styles.size }) : null;
                if (shape && (shape.type === 'ellipse' || shape.type === 'polygon')) {
                    const b = shape.bounds;
                    if (shape.type === 'ellipse') out.push(`<ellipse cx="${num((b.x0 + b.x1) / 2)}" cy="${num((b.y0 + b.y1) / 2)}" rx="${num((b.x1 - b.x0) / 2)}" ry="${num((b.y1 - b.y0) / 2)}" fill="none" stroke="#c4452c" stroke-width="0.8" stroke-dasharray="3 3"/>`);
                }
                if (item.caption) {
                    drawLines(out, item.caption.lines, item.caption.spans, item.caption.lineHeight, measurer, item.caption.spans.find(s => s.kind === 'text')?.font ?? layout.styles.body);
                }
                break;
            }
            default:
                break;
        }
    }

    for (const n of layout.notes ?? []) {
        const ax = n.anchor.x;
        const ay = n.anchor.y + layout.styles.lineHeight / 2;
        const nx = n.side === 'right' ? n.x : n.x + n.width;
        out.push(`<line x1="${num(ax)}" y1="${num(ay)}" x2="${num(nx)}" y2="${num(n.y + 10)}" stroke="#c4452c" stroke-width="0.5" stroke-opacity="0.45"/>`);
        out.push(`<rect x="${num(n.x)}" y="${num(n.y)}" width="${num(n.width)}" height="${num(n.height)}" fill="none" stroke="#c4452c" stroke-opacity="0.25" stroke-width="0.6"/>`);
    }

    const height = Math.max(1, to - from);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${num(height)}" viewBox="0 ${from} ${W} ${num(height)}">`
        + `<rect x="0" y="${from}" width="${W}" height="${num(height)}" fill="${opts.background ?? PAPER}"/>${out.join('')}</svg>`;
}
