import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlsFor, joinLength, removalOf, splitLength } from '../../core/edit/figure-props.js';

test('lengths split into a number and a unit and join back the way they were written', () => {
    assert.deepEqual(splitLength('220'), { value: 220, unit: 'px' });
    assert.deepEqual(splitLength('50%'), { value: 50, unit: '%' });
    assert.deepEqual(splitLength('12.5em'), { value: 12.5, unit: 'em' });
    assert.deepEqual(splitLength('wide'), { value: null, unit: 'px' });
    assert.deepEqual(splitLength(undefined), { value: null, unit: 'px' });
    assert.equal(joinLength(220, 'px'), '220');
    assert.equal(joinLength(50, '%'), '50%');
    assert.equal(joinLength(33.3333, '%'), '33.33%');
});

test('each kind of figure offers the controls that mean something for it', () => {
    assert.ok(controlsFor('image').includes('fit'));
    assert.ok(!controlsFor('drawing').includes('fit'));
    assert.ok(controlsFor('viz').includes('pad'));
    assert.deepEqual(controlsFor('paragraph'), []);
});

test('removing a figure takes its line break with it', () => {
    const source = 'Before.\n\n[[image(a.png)]]\nAfter.\n';
    const start = source.indexOf('[[image');
    const edit = removalOf(source, { start, end: source.indexOf(')]]') + 3 });
    assert.equal(source.slice(0, edit.start) + source.slice(edit.end), 'Before.\n\nAfter.\n');
});
