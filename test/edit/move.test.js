import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../core/doc/parse.js';
import { createSession } from '../../core/edit/session.js';
import { updateArgs } from '../../core/edit/args.js';
import { noteMoveChanges, figureMoveChanges } from '../../core/edit/move.js';

const geom = { pageWidth: 1000, lineHeight: 28, em: 20 };
const note = { y: 400, x: 740, width: 240, baseY: 400 };

test('a note dropped away from its anchor is nudged by that much, in em', () => {
    assert.deepEqual(noteMoveChanges(note, { ...geom, dx: 0, dy: 300 }), [
        { key: 0, value: 'right' }, { key: 'dy', value: '15em' }, { key: 'type', value: null }, { key: 'pos', value: null },
    ]);
    assert.equal(noteMoveChanges(note, { ...geom, dx: 0, dy: -50 })[1].value, '-2.5em');
});

test('a note dropped beside its anchor goes back to following the text', () => {
    assert.equal(noteMoveChanges(note, { ...geom, dx: 0, dy: 10 })[1].value, null);
});

test('the side follows the half of the page the note is dropped on', () => {
    assert.equal(noteMoveChanges(note, { ...geom, dx: -700, dy: 0 })[0].value, 'left');
    assert.equal(noteMoveChanges({ ...note, x: 20 }, { ...geom, dx: 600, dy: 0 })[0].value, 'right');
});

const unit = { em: 20, basis: 400 };

test('a figure takes offsets in units that survive a change of screen: share of the column across, em down', () => {
    assert.deepEqual(figureMoveChanges({ place: 'left' }, { dx: 40, dy: -10 }, unit), [{ key: 'dx', value: '10%' }, { key: 'dy', value: '-0.5em' }]);
    assert.deepEqual(figureMoveChanges({ place: 'left', dx: '10%', dy: '1em' }, { dx: 20, dy: 20 }, unit), [{ key: 'dx', value: '15%' }, { key: 'dy', value: '2em' }]);
    assert.deepEqual(figureMoveChanges({ place: 'left', dx: '40', dy: '5' }, { dx: -40, dy: -5 }, unit), [{ key: 'dx', value: null }, { key: 'dy', value: null }]);
});

test('right-placed figures are measured from the right edge', () => {
    assert.equal(figureMoveChanges({ place: 'right', dx: '4%' }, { dx: 40, dy: 0 }, unit)[0].value, '-6%');
});

test('snapping to a placement saves the placement and drops the sideways offset', () => {
    const changes = figureMoveChanges({ place: 'gutter', dx: '12%' }, { dx: 5, dy: 20 }, { ...unit, placement: 'center' });
    assert.deepEqual(changes, [{ key: 'place', value: 'center' }, { key: 'dx', value: null }, { key: 'dy', value: '1em' }]);
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
