import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValue, resolveLength, isKeyword, callName, listItems } from '../../core/layout/values.js';

test('numbers carry their units', () => {
    assert.deepEqual(parseValue('12'), { type: 'number', value: 12, unit: '' });
    assert.deepEqual(parseValue('40%'), { type: 'number', value: 40, unit: '%' });
    assert.deepEqual(parseValue('-1.5em'), { type: 'number', value: -1.5, unit: 'em' });
    assert.deepEqual(parseValue('.5px'), { type: 'number', value: 0.5, unit: 'px' });
});

test('keywords are lowercased and trimmed', () => {
    assert.deepEqual(parseValue('  Gutter '), { type: 'keyword', name: 'gutter' });
    assert.deepEqual(parseValue('margin-right'), { type: 'keyword', name: 'margin-right' });
    assert.equal(parseValue(''), null);
    assert.equal(parseValue(undefined), null);
});

test('quoted strings keep their content', () => {
    assert.deepEqual(parseValue('"Contact Me"'), { type: 'string', value: 'Contact Me' });
    assert.deepEqual(parseValue("'a, b'"), { type: 'string', value: 'a, b' });
});

test('calls hold comma-separated arguments', () => {
    const v = parseValue('circle(40%)');
    assert.equal(callName(v), 'circle');
    assert.deepEqual(v.args, [{ type: 'number', value: 40, unit: '%' }]);
    const at = parseValue('at(10%, 2em)');
    assert.equal(at.args.length, 2);
    assert.equal(at.args[1].unit, 'em');
});

test('space-separated numbers form a list, usable as polygon points', () => {
    const v = parseValue('polygon(0 0, 100% 0, 50% 100%)');
    assert.equal(callName(v), 'polygon');
    assert.equal(v.args.length, 3);
    assert.deepEqual(listItems(v.args[2]).map(x => [x.value, x.unit]), [[50, '%'], [100, '%']]);
});

test('nested calls parse', () => {
    const v = parseValue('inset(10px round(4px))');
    assert.equal(callName(v), 'inset');
    assert.equal(callName(listItems(v.args[0])[1]), 'round');
});

test('unparseable tails degrade to a keyword instead of throwing', () => {
    assert.equal(parseValue('foo(').type, 'call');
    assert.equal(parseValue(')').type, 'keyword');
});

test('resolveLength handles px, em, % and keywords', () => {
    const ctx = { em: 20, basis: 600 };
    assert.equal(resolveLength(parseValue('12'), ctx), 12);
    assert.equal(resolveLength(parseValue('12px'), ctx), 12);
    assert.equal(resolveLength(parseValue('2em'), ctx), 40);
    assert.equal(resolveLength(parseValue('25%'), ctx), 150);
    assert.equal(resolveLength(parseValue('auto'), { fallback: -1 }), -1);
    assert.equal(resolveLength(null, { fallback: 7 }), 7);
});

test('isKeyword', () => {
    assert.equal(isKeyword(parseValue('auto'), 'auto'), true);
    assert.equal(isKeyword(parseValue('12'), 'auto'), false);
});
