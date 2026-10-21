import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearest, placementOf, snapRect } from '../../core/edit/snap.js';
import { collectGuides } from '../../core/edit/guides.js';
import { layoutDocument } from '../../core/layout/document.js';
import { makeEnv, parseText, hyphenator } from '../layout/fixtures.js';

const g = (value, kind = 'x', label = '') => ({ value, kind, label });

test('the nearest guide within reach wins, and only within reach', () => {
    const hit = nearest([{ at: 100, role: 'start' }], [g(95), g(103), g(140)], 7);
    assert.deepEqual([hit.delta, hit.guide.value], [3, 103]);
    assert.equal(nearest([{ at: 100, role: 'start' }], [g(120)], 7), null);
});

test('a centre beats an edge at the same distance', () => {
    const hit = nearest([{ at: 100, role: 'start' }, { at: 106, role: 'center' }], [g(103)], 7);
    assert.equal(hit.role, 'center');
});

test('a box snaps across and down independently', () => {
    const result = snapRect({ x: 96, y: 200, width: 40, height: 20 }, { x: [g(100)], y: [g(300)] });
    assert.deepEqual([result.dx, result.dy, result.x.role, result.y], [4, 0, 'start', null]);
    const centred = snapRect({ x: 0, y: 290, width: 40, height: 20 }, { x: [], y: [g(303)] });
    assert.deepEqual([centred.dy, centred.y.role], [3, 'center']);
});

test('axes can be limited', () => {
    const result = snapRect({ x: 96, y: 298, width: 10, height: 10 }, { x: [g(100)], y: [g(300)] }, { axes: 'y' });
    assert.equal(result.dx, 0);
    assert.equal(result.x, null);
});

test('lining up with the text column or the seam stands for a placement', () => {
    const hit = (kind, role) => ({ guide: g(0, kind), role });
    assert.equal(placementOf(hit('text-left', 'start')), 'left');
    assert.equal(placementOf(hit('text-right', 'end')), 'right');
    assert.equal(placementOf(hit('text-center', 'center')), 'center');
    assert.equal(placementOf(hit('seam', 'center')), 'gutter');
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
