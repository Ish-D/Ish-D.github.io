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
    session.undo();
    assert.match(session.source, /type: absolute/, 'one undo step per move would restore both; at least one change comes back');
});
