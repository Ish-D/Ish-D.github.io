import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightSource } from '../../core/edit/editor-box.js';

const kinds = (s) => highlightSource(s).map(r => [r.text, r.syntax]);

test('the runs always join back into the source', () => {
    for (const s of ['', 'plain text', '## Title here', 'a **bold** and *it* word', 'x [[note(right)]]{}{body} y', '$$\nE=mc^2\n$$', '`code` here']) {
        assert.equal(highlightSource(s).map(r => r.text).join(''), s);
    }
});

test('markup is marked and prose is not', () => {
    assert.deepEqual(kinds('## Title'), [['## ', true], ['Title', false]]);
    assert.deepEqual(kinds('a **b** c'), [['a ', false], ['**', true], ['b', false], ['**', true], [' c', false]]);
    assert.deepEqual(kinds('x[[note(right)]]{}{hi}'), [['x', false], ['[[note(right)]]', true], ['{', true], ['}', true], ['{', true], ['hi', false], ['}', true]]);
});

test('a hash inside a line is prose', () => {
    assert.deepEqual(kinds('issue #12 fixed'), [['issue #12 fixed', false]]);
});
