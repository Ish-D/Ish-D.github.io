import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItems, KEEP_TOGETHER } from '../../core/text/items.js';

const font = { family: 'Test', size: 10 };
const italic = { family: 'Test', size: 10, style: 'italic' };
const measurer = {
    width: (text) => [...text].length * 5,
    metrics: () => ({ ascent: 8, descent: 2, xHeight: 5, capHeight: 7, spaceWidth: 5 }),
};
const text = (t, f = font, extra = {}) => ({ kind: 'text', text: t, font: f, ...extra });
const kinds = (items) => items.map(it => it.kind[0]).join('');

test('words become boxes joined by glue, closed by fill glue and a forced break', () => {
    const { items, info } = buildItems([text('the quick brown fox')], { measurer, params: { keepLastTwo: false } });
    assert.equal(kinds(items), 'bgbgbgbgp');
    assert.equal(items[0].width, 15);
    assert.equal(items[1].width, 5);
    assert.deepEqual(info.map(i => i.role).slice(0, 3), ['text', 'space', 'text']);
    assert.equal(items.at(-1).penalty, -Infinity);
});

test('leading, trailing and repeated spaces collapse', () => {
    const { items } = buildItems([text('  a   b  ')], { measurer, params: { keepLastTwo: false } });
    assert.equal(kinds(items), 'bgbgp');
});

test('keepLastTwo forbids breaking before the last word, unless nothing else fits', () => {
    const { items } = buildItems([text('one two three')], { measurer });
    const glues = items.map((it, i) => [it, i]).filter(([it]) => it.kind === 'glue' && it.stretch < 1e8);
    const lastSpace = glues.at(-1)[1];
    assert.equal(items[lastSpace - 1].kind, 'penalty');
    assert.equal(items[lastSpace - 1].penalty, Infinity);
    assert.equal(items[lastSpace - 1].relaxedTo, KEEP_TOGETHER);
});

test('the last word is not hyphenated, and an earlier one still is', () => {
    const hyphenator = { points: () => [2, 5] };
    const { items, info } = buildItems([text('hyphenation hyphenation')], { measurer, hyphenator, params: { minHyphenWord: 5 } });
    const penalties = items.map((it, i) => ({ it, role: info[i].role })).filter(({ it, role }) => it.kind === 'penalty' && role === 'hyphen');
    assert.equal(penalties.length, 4);
    assert.ok(penalties.slice(0, 2).every(({ it }) => it.penalty === 50), 'the first word keeps its hyphenation points');
    assert.ok(penalties.slice(2).every(({ it }) => it.penalty === Infinity && it.relaxedTo === KEEP_TOGETHER), 'the last word does not');
});

test('addresses and code break after a slash or a hyphen they already have, and nowhere else', () => {
    const hyphenator = { points: () => [3] };
    const { items, info } = buildItems([text('see/the-long/address.html', font, { noHyphen: true })], { measurer, hyphenator });
    const roles = info.map(i => i.role).filter(r => r !== 'text' && r !== 'fill' && r !== 'end');
    assert.deepEqual(roles, ['address', 'hyphen', 'address']);
    const widths = items.filter(it => it.kind === 'penalty' && it.penalty !== -Infinity).map(it => it.width);
    assert.deepEqual(widths, [0, 0, 0], 'no hyphen is added');
});

test('hyphenation points become soft flagged penalties and pieces sum to the word width', () => {
    const hyphenator = { points: () => [2, 5] };
    const { items, info } = buildItems([text('hyphenation')], { measurer, hyphenator, params: { minHyphenWord: 5 } });
    const boxes = items.filter(it => it.kind === 'box');
    assert.equal(boxes.reduce((s, b) => s + b.width, 0), 'hyphenation'.length * 5);
    const pens = items.filter(it => it.kind === 'penalty' && it.soft);
    assert.equal(pens.length, 2);
    assert.ok(pens.every(p => p.flagged && p.width === 5 && p.penalty === 50));
    assert.deepEqual(info.filter(i => i.role === 'text').map(i => [i.from, i.to]), [[0, 2], [2, 5], [5, 11]]);
});

test('short words and noHyphen spans are not hyphenated', () => {
    const hyphenator = { points: () => [1] };
    assert.equal(buildItems([text('tiny')], { measurer, hyphenator }).items.filter(i => i.kind === 'penalty' && i.soft).length, 0);
    assert.equal(buildItems([text('verylongword', font, { noHyphen: true })], { measurer, hyphenator })
        .items.filter(i => i.kind === 'penalty' && i.soft).length, 0);
});

test('explicit hyphens and dashes allow breaks without adding width', () => {
    const { items } = buildItems([text('well-known and so—called')], { measurer, params: { keepLastTwo: false } });
    const pens = items.filter(it => it.kind === 'penalty' && it.penalty !== -Infinity);
    assert.equal(pens.length, 2);
    assert.ok(pens.every(p => p.width === 0 && !p.soft));
    assert.equal(pens[0].flagged, true);
    assert.equal(pens[1].flagged, false);
});

test('a non-breaking space is stretchable but unbreakable', () => {
    const { items } = buildItems([text('a\u00A0b c')], { measurer, params: { keepLastTwo: false } });
    assert.equal(kinds(items), 'bpgbgbgp');
    assert.equal(items[1].penalty, Infinity);
    assert.ok(items[2].stretch > 0);
});

test('words continue across spans and keep each span font and range', () => {
    const { items, info } = buildItems(
        [text('un'), text('believ', italic), text('able')],
        { measurer, params: { keepLastTwo: false } },
    );
    assert.equal(kinds(items), 'bbbgp');
    assert.deepEqual(info.slice(0, 3).map(i => i.span), [0, 1, 2]);
});

test('atoms are boxes inside words', () => {
    const { items, info } = buildItems(
        [text('see '), { kind: 'atom', width: 22, height: 14 }, text(', ok')],
        { measurer, params: { keepLastTwo: false } },
    );
    assert.equal(kinds(items), 'bgbbgbgp');
    assert.equal(info[2].role, 'atom');
    assert.equal(items[2].width, 22);
});

test('markers record the item that follows them', () => {
    const { items, markers } = buildItems(
        [text('alpha '), { kind: 'marker', ref: 'm1' }, text('beta'), { kind: 'marker', ref: 'm2' }],
        { measurer, params: { keepLastTwo: false } },
    );
    const byRef = Object.fromEntries(markers.map(m => [m.ref, m.at]));
    assert.equal(items[byRef.m1].kind, 'box');
    assert.equal(items[byRef.m1].width, 20);
    assert.equal(items[byRef.m2].kind, 'glue');
    assert.equal(byRef.m2, items.length - 2);
});

test('an explicit break span forces a line end', () => {
    const { items } = buildItems(
        [text('one two'), { kind: 'break' }, text('three four')],
        { measurer, params: { keepLastTwo: false } },
    );
    const forced = items.filter(it => it.kind === 'penalty' && it.penalty === -Infinity);
    assert.equal(forced.length, 2);
});

test('ragged text has no space stretch or shrink', () => {
    const { items } = buildItems([text('a b')], { measurer, params: { justify: false, keepLastTwo: false } });
    assert.equal(items[1].stretch, 0);
    assert.equal(items[1].shrink, 0);
});
