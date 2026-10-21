/**
 * Lays out a card and renders it to PNG without a browser (needs rsvg-convert).
 *
 *   node tools/render-layout.js cards/llms_for_bozos_1.md 1280 out.png [--from 0] [--to 1500] [--text "..."]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../core/doc/parse.js';
import { layoutDocument } from '../core/layout/document.js';
import { parseOpenType } from '../core/text/otf.js';
import { createOtfMeasurer } from '../core/text/otf-measurer.js';
import { english } from '../core/text/hyphenate.js';
import { layoutToSvg } from './layout-svg.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => parseOpenType(readFileSync(resolve(root, p)));

const modern = load('fonts/MonotypeModern.otf');
const imprint = load('fonts/imprint-mt-shadow.ttf');
const measurer = createOtfMeasurer({
    MonotypeModern: modern,
    ImprintMTShadow: imprint,
    'Courier New': modern,
});

export function makeEnv(width, settings = {}) {
    const bodyFont = { family: 'MonotypeModern', size: settings.fontSize ?? 20 };
    return {
        width,
        measurer,
        hyphenator: english,
        settings,
        atoms: {
            inlineMath: (tex) => ({ width: measurer.width(tex.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_]/g, ''), bodyFont) * 0.9 + 6, height: bodyFont.size * 1.2, ascent: bodyFont.size * 0.9 }),
            displayMath: (tex, width) => ({ width: Math.min(width, measurer.width(tex, bodyFont) * 0.8), height: bodyFont.size * 2.6 }),
            image: () => ({ width: 120, height: 80 }),
            widget: () => ({ width: 90, height: 26 }),
        },
        objects: { natural: () => ({ width: 640, height: 400 }), mask: () => null },
    };
}

export function renderToPng(layout, env, outPath, opts = {}) {
    const svg = layoutToSvg(layout, env, opts);
    const dir = dirname(resolve(outPath));
    mkdirSync(dir, { recursive: true });
    const svgPath = resolve(outPath).replace(/\.png$/, '.svg');
    writeFileSync(svgPath, svg);
    const fc = '/tmp/claude-501/fc';
    mkdirSync(`${fc}/cache`, { recursive: true });
    const conf = `${fc}/fonts.conf`;
    if (!existsSync(conf)) {
        writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${resolve(root, 'fonts')}</dir><cachedir>${fc}/cache</cachedir><include ignore_missing="yes">/opt/homebrew/etc/fonts/fonts.conf</include></fontconfig>`);
    }
    execFileSync('rsvg-convert', ['-o', resolve(outPath), svgPath], {
        env: { ...process.env, FONTCONFIG_FILE: conf, PANGOCAIRO_BACKEND: 'fc' },
    });
    return svgPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
    const fromArg = flag('--from');
    const toArg = flag('--to');
    const fontArg = flag('--font-size');
    const inline = flag('--text');
    const from = fromArg === undefined ? 0 : Number(fromArg);
    const to = toArg === undefined ? undefined : Number(toArg);
    const fontSize = fontArg === undefined ? undefined : Number(fontArg);
    const [file, widthArg, out] = args;
    const source = inline ?? readFileSync(resolve(file), 'utf8');
    const env = makeEnv(Number(widthArg ?? 1280), { fontSize });
    const t0 = performance.now();
    const layout = layoutDocument(parse(source), env);
    const ms = performance.now() - t0;
    renderToPng(layout, env, out ?? '/tmp/claude-501/viz/layout.png', { from, to });
    console.log(`laid out in ${ms.toFixed(0)} ms: ${layout.blocks.length} items, ${layout.notes.length} margin notes, height ${Math.round(layout.height)}px`);
    for (const d of layout.diagnostics.slice(0, 8)) console.log('diagnostic:', d.message);
}
