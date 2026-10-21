import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../core/doc/parse.js';
import { createSession } from '../../core/edit/session.js';
import { updateArgs } from '../../core/edit/args.js';
import { noteMoveChanges, figureMoveChanges } from '../../core/edit/move.js';

const geom = { pageWidth: 1000, lineHeight: 28, topPad: 32 };
const note = { y: 400, x: 740, width: 240, anchorY: 400 };

test('dropping a note away from its anchor pins it at that height', () => {
    assert.deepEqual(noteMoveChanges(note, { ...geom, dx: 0, dy: 300 }), [
        { key: 0, value: 'right' }, { key: 'type', value: 'absolute' }, { key: 'pos', value: '668' },
    ]);
});

test('dropping a note beside its anchor lets it follow the text again', () => {
    assert.deepEqual(noteMoveChanges(note, { ...geom, dx: 0, dy: 10 }), [
        { key: 0, value: 'right' }, { key: 'type', value: null }, { key: 'pos', value: null },
    ]);
});

test('the side follows the half of the page the note is dropped on', () => {
    assert.equal(noteMoveChanges(note, { ...geom, dx: -700, dy: 0 })[0].value, 'left');
    assert.equal(noteMoveChanges({ ...note, x: 20 }, { ...geom, dx: 600, dy: 0 })[0].value, 'right');
});

test('a figure takes offsets from where it was, right-placed ones measured from the right edge', () => {
    assert.deepEqual(figureMoveChanges({ place: 'left' }, { dx: 40, dy: -12 }), [{ key: 'dx', value: '40' }, { key: 'dy', value: '-12' }]);
    assert.deepEqual(figureMoveChanges({ place: 'right', dx: '10' }, { dx: 40, dy: 0 }), [{ key: 'dx', value: '-30' }, { key: 'dy', value: null }]);
    assert.deepEqual(figureMoveChanges({ place: 'left', dx: '40', dy: '5' }, { dx: -40, dy: -5 }), [{ key: 'dx', value: null }, { key: 'dy', value: null }]);
});

test('argument changes are applied to the directive and skip what is already there', () => {
    const session = createSession('Text[[note(right)]]{x}{Body.} more.\n', { parse, onChange() {} });
    const start = session.source.indexOf('[[note');
    assert.equal(updateArgs(session, start, [{ key: 0, value: 'left' }, { key: 'type', value: 'absolute' }, { key: 'pos', value: '120' }]), true);
    assert.match(session.source, /\[\[note\(left, type: absolute, pos: 120\)\]\]/);
    assert.equal(updateArgs(session, start, [{ key: 0, value: 'left' }, { key: 'pos', value: '120' }]), false);
    assert.equal(updateArgs(session, start, [{ key: 'type', value: null }, { key: 'pos', value: null }]), true);
    assert.match(session.source, /\[\[note\(left\)\]\]/);
});

test('the changes of one call undo together', () => {
    const original = 'Text[[note(right)]]{x}{Body.} more.\n';
    const session = createSession(original, { parse, onChange() {} });
    updateArgs(session, original.indexOf('[[note'), [{ key: 0, value: 'left' }, { key: 'type', value: 'absolute' }, { key: 'pos', value: '9' }], 'one-move');
    assert.notEqual(session.source, original);
    session.undo();
    assert.equal(session.source, original);
});

import { createPreview } from '../../core/edit/args.js';

test('a preview sets the arguments to each value in turn and undoes as one step', () => {
    const session = createSession('Text\n\n[[drawing(a.svg, place: left)]]\n\nMore.\n', { parse, onChange() {} });
    const original = session.source;
    const start = session.source.indexOf('[[drawing');
    const preview = createPreview(session, start);
    for (const dx of [5, 20, 35, 60]) assert.equal(preview.show([{ key: 'dx', value: String(dx) }]), true);
    assert.match(session.source, /dx: 60\)\]\]/);
    assert.equal((session.source.match(/dx:/g) ?? []).length, 1);
    assert.equal(preview.changed, true);
    preview.cancel();
    assert.equal(session.source, original);
});

test('a preview stops when something else changes the source mid-drag', () => {
    const session = createSession('[[drawing(a.svg)]]\n\nMore.\n', { parse, onChange() {} });
    const preview = createPreview(session, 0);
    assert.equal(preview.show([{ key: 'dx', value: '5' }]), true);
    session.reset('Something else entirely.\n');
    assert.equal(preview.show([{ key: 'dx', value: '9' }]), false);
    assert.equal(session.source, 'Something else entirely.\n');
    assert.equal(preview.changed, false);
    preview.cancel();
    assert.equal(session.source, 'Something else entirely.\n');
});
