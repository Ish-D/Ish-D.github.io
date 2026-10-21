import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REACH, STICK, nearest, placementOf, pull, snapRect } from '../../core/edit/snap.js';
import { collectGuides } from '../../core/edit/guides.js';
import { layoutDocument } from '../../core/layout/document.js';
import { makeEnv, parseText, hyphenator } from '../layout/fixtures.js';

const g = (value, kind = 'x', label = '') => ({ value, kind, label });

test('the pull is nothing out of reach, full on the guide, and never a step in between', () => {
    assert.equal(pull(REACH), 0);
    assert.equal(pull(-REACH - 1), 0);
    assert.equal(pull(STICK), STICK);
    assert.equal(pull(-1), -1);
    // the box's position (raw + pull) only ever moves forward as the pointer does
    let last = null;
    for (let raw = 0; raw <= 20; raw += 0.1) {
        const distance = 10 - raw;            // a guide at 10
        const position = raw + pull(distance);
        if (last !== null) {
            assert.ok(position >= last - 1e-9, `went back at ${raw}`);
            assert.ok(position - last < 0.5, `jumped at ${raw}`);
        }
        last = position;
    }
});

test('a box rests exactly on a guide for a few pixels of pointer travel, then carries on without a jump', () => {
    const at = (raw) => raw + pull(10 - raw);
    assert.equal(at(8), 10);
    assert.equal(at(10), 10);
    assert.equal(at(11.5), 10);
    assert.ok(at(14) > 10 && at(14) < 14);
    assert.equal(at(19), 19);
});

test('the nearest guide within reach wins, and only within reach', () => {
    const hit = nearest([{ at: 100, role: 'start' }], [g(95), g(103), g(140)]);
    assert.deepEqual([hit.guide.value, hit.locked], [103, false]);
    assert.ok(hit.shift > 0 && hit.shift < 3);
    assert.equal(nearest([{ at: 100, role: 'start' }], [g(120)]), null);
    assert.equal(nearest([{ at: 100, role: 'start' }], [g(101)]).locked, true);
});

test('a centre beats an edge at the same distance', () => {
    const hit = nearest([{ at: 100, role: 'start' }, { at: 106, role: 'center' }], [g(103)]);
    assert.equal(hit.role, 'center');
});

test('a box eases across and down independently', () => {
    const result = snapRect({ x: 98, y: 200, width: 40, height: 20 }, { x: [g(100)], y: [g(300)] });
    assert.deepEqual([result.dx, result.dy, result.x.role, result.y], [2, 0, 'start', null]);
    const centred = snapRect({ x: 0, y: 290, width: 40, height: 20 }, { x: [], y: [g(301)] });
    assert.deepEqual([centred.dy, centred.y.role], [1, 'center']);
});

test('axes can be limited', () => {
    const result = snapRect({ x: 96, y: 298, width: 10, height: 10 }, { x: [g(100)], y: [g(300)] }, { axes: 'y' });
    assert.equal(result.dx, 0);
    assert.equal(result.x, null);
});

test('only a box resting on the line stands for a placement', () => {
    const hit = (kind, role, locked = true) => ({ guide: g(0, kind), role, locked });
    assert.equal(placementOf(hit('text-left', 'start')), 'left');
    assert.equal(placementOf(hit('text-right', 'end')), 'right');
    assert.equal(placementOf(hit('text-center', 'center')), 'center');
    assert.equal(placementOf(hit('seam', 'center')), 'gutter');
    assert.equal(placementOf(hit('text-left', 'start', false)), null);
    assert.equal(placementOf(hit('text-left', 'end')), null);
    assert.equal(placementOf(hit('object', 'start')), null);
    assert.equal(placementOf(null), null);
});

test('guides come from the layout: the column, the seam, figures and text', () => {
    const src = '[[columns(2, gap: 40)]]\n{\n[[image(a.png, place: gutter, width: 100, height: 100, wrap: circle)]]\nSome words to fill the first column of a pair.\n}\n';
    const layout = layoutDocument(parseText(src), makeEnv(1300, { hyphenator }));
    const guides = collectGuides(layout);
    const kinds = (list) => new Set(list.map(l => l.kind));
    for (const kind of ['text-left', 'text-center', 'text-right', 'page-center', 'column', 'seam', 'object']) assert.ok(kinds(guides.x).has(kind), kind);
    assert.ok(kinds(guides.y).has('block'));
    const image = layout.blocks.find(b => b.type === 'object');
    const without = collectGuides(layout, { ignoreObject: image.node.start });
    assert.ok(!kinds(without.x).has('object'), 'the figure being moved is not a guide for itself');
});

test('a note can be left out of the guides it is moved against', () => {
    const doc = parseText('One[[note(right)]]{a}{First.} two[[note(left)]]{b}{Second.} three.\n');
    const layout = layoutDocument(doc, makeEnv(1300, { hyphenator }));
    const all = collectGuides(layout).y.filter(l => l.kind === 'note').length;
    const rest = collectGuides(layout, { ignoreNote: layout.notes[0] }).y.filter(l => l.kind === 'note').length;
    assert.equal(all - rest, 2);
});
