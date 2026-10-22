import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { LIMITS, lintBlocks, tally } from '../../core/layout/lint.js';
import { layoutDocument } from '../../core/layout/document.js';
import { parse } from '../../core/doc/parse.js';
import { makeEnv as realEnv } from '../../tools/render-layout.js';

const run = (text, extra = {}) => ({ kind: 'text', span: 0, text, wordSpacing: 0, width: text.length * 5, ...extra });
const line = (text, over = {}) => ({
    runs: [run(text)], ratio: 0, natural: text.length * 5, width: 300, hyphenated: false, last: false, overflow: false, ...over,
});
const paragraph = (lines) => ({ type: 'paragraph', lines, spans: [{ kind: 'text', text: '', font: { family: 'Test', size: 10 } }] });
const kinds = (issues) => issues.map(i => `${i.kind}:${i.level}`);

test('a line stretched past the optimizer\'s tolerance is loose, and past TeX\'s own warning level it is bad', () => {
    const issues = lintBlocks([paragraph([
        line('fine', { ratio: 0.8 }),
        line('a bit loose', { ratio: LIMITS.loose + 0.1 }),
        line('far too loose', { ratio: LIMITS.veryLoose + 0.1 }),
        line('last', { last: true, natural: 300 }),
    ])]);
    assert.deepEqual(kinds(issues), ['loose:warn', 'loose:bad']);
    assert.deepEqual(issues.map(i => i.line), [1, 2]);
    assert.equal(issues[1].text, 'far too loose');
});

test('a line squeezed to its limit is noted, and a line wider than its slot after shrinking is bad', () => {
    const issues = lintBlocks([paragraph([
        line('cramped', { ratio: LIMITS.tight - 0.05 }),
        line('too wide', { ratio: -1, natural: 320, width: 300 }),
        line('last', { last: true, natural: 300 }),
    ])]);
    assert.deepEqual(kinds(issues), ['tight:note', 'overfull:bad']);
});

test('hyphens on two lines in a row are noted, on three they are bad', () => {
    const hy = (text) => line(text, { hyphenated: true, runs: [run(text.slice(0, -1)), { kind: 'hyphen', text: '-', width: 5 }] });
    const two = lintBlocks([paragraph([hy('abcde-'), hy('fghij-'), line('plain'), line('last words here', { last: true, natural: 300 })])]);
    assert.deepEqual(kinds(two), ['stacked-hyphens:note']);
    assert.equal(two[0].amount, 2);
    const three = lintBlocks([paragraph([hy('abcde-'), hy('fghij-'), hy('klmno-'), line('plain'), line('last words here', { last: true, natural: 300 })])]);
    assert.deepEqual(kinds(three), ['stacked-hyphens:bad']);
    assert.equal(three[0].amount, 3);
});

test('a last line that is one short word is a warning, a short one of several words a note, and a full one nothing', () => {
    const lastOf = (text, natural) => lintBlocks([paragraph([line('a line of the paragraph'), line(text, { last: true, natural })])]);
    assert.deepEqual(kinds(lastOf('word', 40)), ['one-word-last-line:warn']);
    assert.deepEqual(kinds(lastOf('two words', 25)), ['stub-last-line:note']);
    assert.deepEqual(kinds(lastOf('a good run of words', 250)), []);
    assert.deepEqual(kinds(lastOf('unbreakable-address', 250)), [], 'a long single word is not a stub');
});

test('a paragraph that ends on the tail of a hyphenated word is noted', () => {
    const issues = lintBlocks([paragraph([
        line('first'),
        line('second part-', { hyphenated: true, runs: [run('second part'), { kind: 'hyphen', text: '-', width: 5 }] }),
        line('and the rest of it', { last: true, natural: 250 }),
    ])]);
    assert.deepEqual(kinds(issues), ['hyphen-before-last-line:note']);
});

test('a one-line paragraph and lines that overflowed the layout are left alone', () => {
    assert.deepEqual(lintBlocks([paragraph([line('short', { last: true })])]), []);
    assert.deepEqual(lintBlocks([paragraph([line('x', { ratio: 5, overflow: true }), line('end', { last: true, natural: 250 })])]), []);
    assert.deepEqual(lintBlocks([{ type: 'object' }, { type: 'rule' }]), []);
});

test('issues are counted by kind and level', () => {
    const counts = tally([{ kind: 'loose', level: 'bad' }, { kind: 'loose', level: 'bad' }, { kind: 'tight', level: 'note' }]);
    assert.deepEqual(counts, { 'loose:bad': 2, 'tight:note': 1 });
});

// The pages are laid out in the real font at the default reading width on a desktop and on a phone,
// and none may have a line sticking out of its slot.
const pages = readdirSync(new URL('../../cards/', import.meta.url))
    .filter(name => name.endsWith('.md'))
    .map(name => [name.slice(0, -3), readFileSync(new URL(`../../cards/${name}`, import.meta.url), 'utf8')])
    .filter(([, text]) => !/^encrypted:\s*true/m.test(text.slice(0, 600)));

for (const [name, text] of pages) {
    for (const [width, fontSize] of [[1280, 20], [390, 18]]) {
        test(`${name} at ${width}px has no line sticking out of its slot`, () => {
            const layout = layoutDocument(parse(text), realEnv(width, { fontSize, width: 32 }));
            const bad = lintBlocks(layout.blocks).filter(i => i.kind === 'overfull');
            assert.deepEqual(bad.map(i => i.text), []);
        });
    }
}
