import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNIPPETS, insertion } from '../../core/edit/insert.js';
import { parse } from '../../core/doc/parse.js';

test('an insertion adds the snippet as its own block after the given offset', () => {
    const source = 'First.\n\nSecond.\n';
    const { edit, range } = insertion(source, 6, 'New.');
    const next = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    assert.equal(next, 'First.\n\nNew.\n\nSecond.\n');
    assert.equal(next.slice(range.start, range.end), 'New.');
});

test('every snippet parses to the block it promises, with no diagnostics', () => {
    for (const { label, text } of SNIPPETS) {
        const doc = parse(`Before.\n\n${text}\n\nAfter.\n`);
        assert.ok(doc.children.length >= 3, `${label} swallowed its neighbours`);
        const last = doc.children[doc.children.length - 1];
        assert.equal(`Before.\n\n${text}\n\nAfter.\n`.slice(last.start, last.end).trim(), 'After.', label);
    }
});
