import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from '../../core/doc/parse.js';
import { layoutDocument } from '../../core/layout/document.js';
import { renderLayout } from '../../core/render/dom.js';
import { createDocument } from '../render/fakedom.js';
import { makeEnv, hyphenator, measurer } from './fixtures.js';

const dir = new URL('../../cards/', import.meta.url);
const cards = readdirSync(dir).filter(f => f.endsWith('.md')).sort();

for (const file of cards) {
    for (const width of [1280, 390]) {
        test(`${file} lays out and renders at ${width}px`, () => {
            const doc = parse(readFileSync(new URL(file, dir), 'utf8'));
            const layout = layoutDocument(doc, makeEnv(width, { hyphenator }));
            assert.ok(Number.isFinite(layout.height) && layout.height > 0);

            const items = [...layout.blocks, ...layout.notes.flatMap(n => n.items)];
            for (const item of items) {
                for (const span of item.spans ?? []) {
                    if (span.kind === 'text') {
                        assert.equal(typeof span.font?.family, 'string', `span without a font in ${file}`);
                    }
                }
                const textLines = item.type === 'paragraph' || item.type === 'heading' ? item.lines : [];
                for (const line of textLines) {
                    if (!line.overflow) {
                        assert.ok(Number.isFinite(line.x) && Number.isFinite(line.y), `non-finite line in ${file}`);
                    }
                }
            }

            const document = createDocument();
            const root = document.createElement('div');
            const math = (tex) => ({ html: tex, width: 20, height: 20, ascent: 15, descent: 5 });
            renderLayout(root, layout, { document, measurer, math, persist: new Map() });
            assert.equal(root.children.length, 1);
        });
    }
}
