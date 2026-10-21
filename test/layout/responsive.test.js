import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { layoutDocument } from '../../core/layout/document.js';
import { makeEnv, parseText, hyphenator } from './fixtures.js';

// Pages have to come out right on every screen without anyone checking each one, so every page is laid out
// at phone to desktop widths and checked for the ways a layout can go wrong.
const WIDTHS = [320, 360, 390, 430, 600, 768, 1024, 1280, 1440, 1920];
const pages = readdirSync(new URL('../../cards/', import.meta.url))
    .filter(name => name.endsWith('.md'))
    .map(name => [name.slice(0, -3), readFileSync(new URL(`../../cards/${name}`, import.meta.url), 'utf8')])
    .filter(([, text]) => !/^encrypted:\s*true/m.test(text.slice(0, 600)));

const EPS = 1;

function lay(text, width) {
    const fontSize = width < 600 ? 18 : 20;
    return layoutDocument(parseText(text), makeEnv(width, { hyphenator, settings: { fontSize, marginPercent: 28 } }));
}

const linesOf = (layout) => layout.blocks
    .filter(b => (b.type === 'paragraph' || b.type === 'heading') && b.lines)
    .flatMap(b => b.lines.filter(l => !l.overflow).map(l => ({ x: l.x, y: l.y, width: l.width, height: b.lineHeight })));

/** Does a text line enter the space a wrapped figure keeps clear? */
function intersects(line, object) {
    const { rect, wrap } = object;
    if (line.y + line.height <= rect.y + EPS || line.y >= rect.y + rect.height - EPS) return false;
    if (line.x + line.width <= rect.x + EPS || line.x >= rect.x + rect.width - EPS) return false;
    if (wrap.kind === 'box') return true;
    if (wrap.kind === 'circle' || wrap.kind === 'ellipse') {
        const rx = rect.width / 2 - 2;
        const ry = rect.height / 2 - 2;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        // nearest point of the line to the ellipse's centre
        const px = Math.min(Math.max(cx, line.x), line.x + line.width);
        const py = Math.min(Math.max(cy, line.y), line.y + line.height);
        return ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 < 1;
    }
    return false;
}

for (const [name, text] of pages) {
    for (const width of WIDTHS) {
        test(`${name} at ${width}px stays on the page and clear of its figures`, () => {
            const layout = lay(text, width);
            assert.ok(Number.isFinite(layout.height) && layout.height > 0);

            for (const line of linesOf(layout)) {
                assert.ok(line.x >= -EPS && line.x + line.width <= width + EPS, `a line runs off the page: x ${Math.round(line.x)} to ${Math.round(line.x + line.width)}`);
            }
            const objects = layout.blocks.filter(b => b.type === 'object');
            for (const o of objects) {
                assert.ok(o.rect.x >= -EPS && o.rect.x + o.rect.width <= width + EPS, `a ${o.name} runs off the page: x ${Math.round(o.rect.x)} to ${Math.round(o.rect.x + o.rect.width)}`);
            }
            for (const n of layout.notes) {
                assert.ok(n.x >= -EPS && n.x + n.width <= width + EPS, 'a margin note runs off the page');
            }
            if (layout.geometry.narrow) assert.equal(layout.notes.length, 0, 'margin notes belong inline when there are no margins');

            // no paragraph is squeezed into slivers: every line but the last has some width to it
            const em = width < 600 ? 18 : 20;
            for (const b of layout.blocks) {
                if (b.type !== 'paragraph' || !b.lines || b.align === 'center' || b.cite) continue;
                const lines = b.lines.filter(l => !l.overflow);
                for (const l of lines.slice(0, -1)) assert.ok(l.width >= 4 * em, `a line of only ${Math.round(l.width)}px at y ${Math.round(l.y)}`);
            }

            // text must not run through a figure that text is meant to wrap around
            const wrapped = objects.filter(o => o.layer !== 'under' && o.wrap && o.wrap.kind !== 'none' && ['left', 'right', 'center', 'gutter', 'at'].includes(o.place.kind));
            for (const line of linesOf(layout)) {
                for (const o of wrapped) assert.ok(!intersects(line, o), `a line of text runs through a ${o.name} at y ${Math.round(line.y)}`);
            }
        });
    }
}
