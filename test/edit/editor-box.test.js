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

import { bandInsets } from '../../core/edit/editor-box.js';

test('blocked stretches become insets from the side they touch', () => {
    // box spans x 100..500
    const insets = bandInsets([
        [],                    // nothing in the way
        [[80, 220]],           // a figure over the left edge
        [[420, 600]],          // one over the right edge
        [[100, 130], [450, 500]],
    ], 100, 400);
    assert.deepEqual(insets, [{ left: 0, right: 0 }, { left: 120, right: 0 }, { left: 0, right: 80 }, { left: 30, right: 50 }]);
});

test('a stretch in the middle leaves the text on the roomier side', () => {
    // 100..500 with a stretch at 150..250: more room on the right, so the left part is blocked
    assert.deepEqual(bandInsets([[[150, 250]]], 100, 400), [{ left: 150, right: 0 }]);
    assert.deepEqual(bandInsets([[[350, 450]]], 100, 400), [{ left: 0, right: 150 }]);
});

test('a stretch across the whole width blocks the band', () => {
    assert.deepEqual(bandInsets([[[0, 900]]], 100, 400), [{ left: 400, right: 0 }]);
});
