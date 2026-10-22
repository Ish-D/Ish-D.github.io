/**
 * Lays out pages at a range of screen and column widths and reports the lines that are set badly:
 * spaces pulled too wide or squeezed, a last line that is one word, hyphens stacked down the edge.
 *
 *   node tools/lint-type.js [page ...] [--viewports 360,768,1280] [--em 24,32,44] [--size 20] [--verbose]
 *
 * With no page it checks every page in cards/. Exits 1 when any line is bad.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../core/doc/parse.js';
import { layoutDocument } from '../core/layout/document.js';
import { titleScaleFor } from '../core/layout/style.js';
import { lintBlocks, tally } from '../core/layout/lint.js';
import { makeEnv } from './render-layout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    return args.splice(i, 2)[1];
};
const verbose = args.includes('--verbose') && args.splice(args.indexOf('--verbose'), 1).length > 0;
const list = (value) => String(value).split(',').map(Number).filter(Number.isFinite);

const viewports = list(flag('--viewports', '360,430,768,1280'));
const readingWidths = list(flag('--em', '24,28,32,36,40,44'));
const sizes = list(flag('--size', '20'));
const requested = args.filter(a => !a.startsWith('--'));

const cards = resolve(root, 'cards');
const names = requested.length ? requested : readdirSync(cards).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));

let bad = 0;
const rows = [];
for (const name of names) {
    const source = readFileSync(resolve(cards, `${name}.md`), 'utf8');
    if (/^encrypted:\s*true/m.test(source.slice(0, 600))) continue;
    const seen = new Set();
    const issues = [];
    let lines = 0;
    let configs = 0;
    for (const width of viewports) {
        for (const em of readingWidths) {
            for (const size of sizes) {
                const fontSize = width < 600 ? Math.min(size, 18) : size;
                const env = makeEnv(width, { fontSize, width: em, titleScale: titleScaleFor(width), titleAlign: 'left' });
                const layout = layoutDocument(parse(source), env);
                const key = `${Math.round(layout.geometry.text.width)}:${fontSize}`;
                if (seen.has(key)) continue;
                seen.add(key);
                configs++;
                for (const block of layout.blocks) lines += block.lines?.length ?? 0;
                for (const issue of lintBlocks(layout.blocks)) issues.push({ ...issue, setting: `${Math.round(layout.geometry.text.width)}px at ${fontSize}px` });
            }
        }
    }
    bad += issues.filter(i => i.level === 'bad').length;
    rows.push({ name, configs, lines, counts: tally(issues) });
    if (verbose) {
        for (const i of issues) {
            const amount = i.amount === undefined ? '' : ` (${Math.round(i.amount * 100) / 100})`;
            console.log(`${name} [${i.setting}] ${i.level.toUpperCase()} ${i.kind}${amount}: ${i.text}`);
        }
    }
}

for (const { name, configs, lines, counts } of rows) {
    const parts = Object.entries(counts).map(([key, n]) => `${n} ${key.replace(':', ' ')}`);
    console.log(`${name.padEnd(22)} ${String(configs).padStart(2)} widths  ${String(lines).padStart(6)} lines  ${parts.join(', ') || 'clean'}`);
}
process.exit(bad ? 1 : 0);
