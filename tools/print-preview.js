/**
 * Shows how a page prints, without a browser: sets it for paper, cuts it into sheets, and draws each sheet
 * as a PNG (needs rsvg-convert), with a running head and a number as the printed page has.
 *
 *   node tools/print-preview.js cards/llms_for_bozos_1.md out-dir [--paper letter|a4] [--sheets 1,2,5]
 *
 * Writes sheet-1.png, sheet-2.png, ... into out-dir and says how many sheets there are.
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../core/doc/parse.js';
import { layoutPrint, PAPER } from '../core/layout/print.js';
import { layoutToSvg } from './layout-svg.js';
import { makeEnv, svgToPng } from './render-layout.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
    const paper = PAPER[flag('--paper') ?? 'letter'];
    const only = flag('--sheets')?.split(',').map(Number);
    const [file, outDir = '/tmp/claude-501/print'] = args;
    if (!file || !paper) {
        console.error('usage: node tools/print-preview.js page.md out-dir [--paper letter|a4] [--sheets 1,2]');
        process.exit(1);
    }
    const doc = parse(readFileSync(resolve(file), 'utf8'));
    const env = makeEnv(1280, { fontSize: 20, width: 32 });
    const printed = layoutPrint(doc, env, paper);
    const { layout, sheets, room, margins } = printed;
    const title = doc.frontmatter?.entries?.name?.value ?? '';
    mkdirSync(resolve(outDir), { recursive: true });

    sheets.forEach((sheet, k) => {
        if (only && !only.includes(k + 1)) return;
        const body = layoutToSvg({ ...layout, width: paper.width, height: room, blocks: sheet.items, notes: sheet.notes }, env, { guides: false, background: '#fff' });
        const inner = body.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
        const column = layout.geometry.text;
        const small = (x, y, str, anchor) => `<text x="${x}" y="${y}" font-family="Monotype Modern Extended" font-size="10" letter-spacing="1.4" fill="#555" text-anchor="${anchor}">${str.toUpperCase()}</text>`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.width}" height="${paper.height}" viewBox="0 0 ${paper.width} ${paper.height}">`
            + `<rect width="${paper.width}" height="${paper.height}" fill="#fff"/><rect x="0.5" y="0.5" width="${paper.width - 1}" height="${paper.height - 1}" fill="none" stroke="#ddd"/>`
            + `<g transform="translate(0 ${margins.top})">${inner}</g>`
            + (k > 0 && title ? small(paper.width / 2, 52, title, 'middle') : '')
            + small(column.x, paper.height - 44, 'ishandarji.com', 'start')
            + small(column.x + column.width, paper.height - 44, String(k + 1), 'end')
            + '</svg>';
        svgToPng(svg, resolve(outDir, `sheet-${k + 1}.png`));
    });
    console.log(`${sheets.length} sheets of ${paper.name} in ${resolve(outDir)}`);
}
