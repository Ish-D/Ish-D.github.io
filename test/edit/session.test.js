import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../core/edit/session.js';
import { expandToLines, closeRange, rangeForNode } from '../../core/edit/ranges.js';
import { parse } from '../../core/doc/parse.js';

const make = (source, log = []) => createSession(source, { parse, onChange: (c) => log.push(c.kind) });

test('apply changes the text and keeps the tree in step', () => {
    const s = make('# Title\n\nFirst paragraph.\n');
    s.apply({ start: 9, end: 25, text: 'Second paragraph.' });
    assert.equal(s.source, '# Title\n\nSecond paragraph.\n');
    assert.equal(s.doc.children[1].type, 'paragraph');
    assert.equal(s.source.slice(s.doc.children[1].start, s.doc.children[1].end), 'Second paragraph.');
});

test('undo and redo restore text exactly, including after several edits', () => {
    const s = make('alpha\n\nbeta\n\ngamma\n');
    s.apply({ start: 0, end: 5, text: 'ALPHA!' });
    s.apply({ start: 14, end: 19, text: 'g' });
    const after = s.source;
    assert.equal(after, 'ALPHA!\n\nbeta\n\ng\n');
    s.undo();
    assert.equal(s.source, 'ALPHA!\n\nbeta\n\ngamma\n');
    s.undo();
    assert.equal(s.source, 'alpha\n\nbeta\n\ngamma\n');
    assert.equal(s.canUndo, false);
    s.redo();
    s.redo();
    assert.equal(s.source, after);
    assert.equal(s.canRedo, false);
});

test('edits in one burst collapse into one undo step', () => {
    const s = make('one two three\n');
    let end = 13;
    for (const t of ['o', 'on', 'one', 'one!']) {
        s.apply({ start: 0, end, text: t }, { group: 'typing' });
        end = t.length;
    }
    assert.equal(s.source, 'one!\n');
    s.undo();
    assert.equal(s.source, 'one two three\n');
    assert.equal(s.canUndo, false);
    s.redo();
    assert.equal(s.source, 'one!\n');
});

test('a new edit clears redo; a no-op edit records nothing', () => {
    const s = make('abc\n');
    s.apply({ start: 0, end: 3, text: 'xyz' });
    s.undo();
    s.apply({ start: 0, end: 3, text: 'abc' });
    assert.equal(s.canUndo, false, 'identical text is a no-op');
    s.apply({ start: 0, end: 3, text: 'q' });
    s.undo();
    s.apply({ start: 0, end: 3, text: 'r' });
    assert.equal(s.canRedo, false);
});

test('reset swaps the text from outside and drops history', () => {
    const log = [];
    const s = make('one\n', log);
    s.apply({ start: 0, end: 3, text: 'two' });
    s.reset('three\n');
    assert.equal(s.source, 'three\n');
    assert.equal(s.canUndo, false);
    assert.equal(log.at(-1), 'reset');
    s.reset('three\n');
    assert.equal(log.length, 2, 'unchanged text does not notify');
});

test('expandToLines widens to whole lines', () => {
    const src = 'first line\nsecond line here\nthird\n';
    assert.deepEqual(expandToLines(src, 14, 20), { start: 11, end: 27 });
    assert.deepEqual(expandToLines(src, 0, 3), { start: 0, end: 10 });
    assert.deepEqual(expandToLines(src, 28, 33), { start: 28, end: 33 });
});

test('rangeForNode includes list markers', () => {
    const src = 'Intro.\n\n- first\n- second\n';
    const doc = parse(src);
    const list = doc.children.find(c => c.type === 'list');
    const item = list.items[1];
    const r = rangeForNode(src, item);
    assert.equal(src.slice(r.start, r.end), '- second');
});

test('closeRange swallows a block merged into by a deleted blank line', () => {
    const src = 'Para one.\nPara two.\n\nPara three.\n';
    const doc = parse(src);
    // an editing region that covers only the second line of the first paragraph
    const r = closeRange(doc, { start: 10, end: 19 });
    assert.deepEqual(r, { start: 0, end: 19 });
});

test('closeRange leaves a region that sits inside one block alone', () => {
    const src = '[[quote]]\n{\nInner text.\n}\n';
    const doc = parse(src);
    const inner = src.indexOf('Inner');
    assert.deepEqual(closeRange(doc, { start: inner, end: inner + 11 }), { start: inner, end: inner + 11 });
});

import { caretFromHint } from '../../core/edit/editor.js';

test('caretFromHint finds the clicked spot in the source text', () => {
    const src = '[[tab]]The quick brown fox jumps over the lazy dog.';
    const at = caretFromHint(src, 'quick brown \u0000fox jumps over');
    assert.equal(src.slice(at, at + 3), 'fox');
    assert.equal(caretFromHint(src, ''), src.length);
    assert.equal(caretFromHint(src, 'nothing here \u0000matches'), src.length);
});
