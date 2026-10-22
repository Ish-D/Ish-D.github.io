import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from '../../core/doc/parse.js';
import { walk } from '../../core/doc/walk.js';
import { MarkdownParser } from '../../MarkdownParser.js';
import { checkDoc } from './validate.js';
import { slack } from '../slack.js';

const CARDS = new URL('../../cards/', import.meta.url);
const cards = readdirSync(CARDS)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((name) => ({ name, source: readFileSync(new URL(name, CARDS), 'utf8') }));

const isEncrypted = (doc) => doc.frontmatter?.entries.encrypted?.value === 'true';

describe('corpus', () => {
    it('finds the cards', () => {
        assert.ok(cards.length >= 17, `found ${cards.length} cards`);
    });

    for (const { name, source } of cards) {
        it(`${name} parses with no errors and valid ranges`, () => {
            const doc = parse(source);
            assert.deepEqual(doc.diagnostics.filter((d) => d.severity === 'error'), []);
            assert.deepEqual(checkDoc(doc), []);
        });
    }

    it('keeps encrypted cards as one raw block', () => {
        const encrypted = cards.map(({ source }) => parse(source)).filter(isEncrypted);
        assert.ok(encrypted.length >= 2);
        for (const doc of encrypted) assert.deepEqual(doc.children.map((b) => b.type), ['raw']);
    });

    it('gives every heading the id the legacy parser gives it', () => {
        let compared = 0;
        for (const { name, source } of cards) {
            const doc = parse(source);
            if (isEncrypted(doc)) continue;
            const ids = [];
            walk(doc, (node) => {
                if (node.type === 'heading') ids.push(node.id);
            });
            const html = new MarkdownParser().parse(source).content;
            const legacy = [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1]);
            assert.deepEqual(ids, legacy, name);
            compared += ids.length;
        }
        assert.ok(compared >= 60, `compared ${compared} headings`);
    });

    it('parses weird.md and llms_for_bozos_1.md in under 15 ms warm', () => {
        for (const name of ['weird.md', 'llms_for_bozos_1.md']) {
            const { source } = cards.find((c) => c.name === name);
            for (let i = 0; i < 20; i++) parse(source);
            const times = [];
            for (let i = 0; i < 21; i++) {
                const t0 = performance.now();
                parse(source);
                times.push(performance.now() - t0);
            }
            const median = times.sort((a, b) => a - b)[10];
            assert.ok(median < 15 * slack, `${name}: median ${median.toFixed(2)} ms`);
        }
    });
});
