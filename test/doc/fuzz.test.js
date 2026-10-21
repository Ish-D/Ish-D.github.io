import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from '../../core/doc/parse.js';
import { checkDoc } from './validate.js';

const SEED = 20261020;
const OFFSETS = 200;
const ALPHABET = '[]{}()*$`\\|>#-:,"\'!\n\n  \tab';
const FRAGMENTS = ['\n> ', '>', '\n| a | b |\n|---|:-:|\n| ', '\n```js\n', '\n$$\n', '\n- ', '\n# ', '\n---\n', '[[x]]{', '[[quote(a)]]\n{\n', '[[note(r)]]{a}{', '->', '<-', '**', '{{t}}', '![a](b)', '[l]('];

const CARDS = new URL('../../cards/', import.meta.url);
const cards = readdirSync(CARDS)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((name) => ({ name, source: readFileSync(new URL(name, CARDS), 'utf8') }));

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** Deletes 1-8 chars at `offset`, or inserts 1-4 chars from ALPHABET or one DSL fragment. */
function randomEdit(source, offset, random) {
    const r = random();
    if (r < 0.4) return source.slice(0, offset) + source.slice(offset + 1 + Math.floor(random() * 8));
    let text = '';
    if (r < 0.7) {
        for (let n = 1 + Math.floor(random() * 4); n > 0; n--) text += ALPHABET[Math.floor(random() * ALPHABET.length)];
    } else {
        text = FRAGMENTS[Math.floor(random() * FRAGMENTS.length)];
    }
    return source.slice(0, offset) + text + source.slice(offset);
}

describe('range checker', () => {
    const source = 'A *b* [[cite(u, T)]]{c}\n\n- d';
    const broken = [
        ['a child outside its parent', (d) => (d.children[0].children[1].end = d.children[0].end + 5)],
        ['overlapping siblings', (d) => (d.children[0].children[1].start -= 1)],
        ['a text value off its slice', (d) => (d.children[0].children[0].value = 'X ')],
        ['a group text off its slice', (d) => (d.children[0].children[3].groups[0].text = 'z')],
        ['an argument value off its slice', (d) => (d.children[0].children[3].args.items[1].value = 'U')],
        ['a list item outside the list', (d) => (d.children[1].items[0].end = d.source.length + 1)],
    ];

    it('accepts the unmodified tree', () => {
        assert.deepEqual(checkDoc(parse(source)), []);
    });

    for (const [label, mutate] of broken) {
        it(`rejects ${label}`, () => {
            const doc = parse(source);
            mutate(doc);
            assert.notDeepEqual(checkDoc(doc), []);
        });
    }
});

describe('typing-time robustness', () => {
    for (const { name, source } of cards) {
        it(`${name} survives ${OFFSETS} truncations and ${OFFSETS} random edits`, () => {
            const random = prng(SEED ^ hash(name));
            let total = 0, worst = 0;
            for (let k = 0; k < OFFSETS; k++) {
                const offset = Math.floor(random() * (source.length + 1));
                const variants = { truncated: source.slice(0, offset), edited: randomEdit(source, offset, random) };
                for (const [kind, variant] of Object.entries(variants)) {
                    const t0 = performance.now();
                    const doc = parse(variant);
                    const ms = performance.now() - t0;
                    total += ms;
                    worst = Math.max(worst, ms);
                    const where = `${name} ${kind} at ${offset}`;
                    assert.deepEqual(doc.diagnostics.filter((d) => d.message.startsWith('internal')), [], where);
                    const problems = checkDoc(doc);
                    if (problems.length > 0) assert.fail(`${where}: ${problems.slice(0, 3).join('; ')}`);
                }
            }
            assert.ok(worst < 100, `slowest parse ${worst.toFixed(1)} ms`);
            assert.ok(total / (2 * OFFSETS) < 5, `mean parse ${(total / (2 * OFFSETS)).toFixed(2)} ms`);
        });
    }
});
