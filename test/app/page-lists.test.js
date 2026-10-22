import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writingBlocks, tagBlocks, macroBlocks } from '../../core/app/page-lists.js';

const at = { start: 0, end: 5 };
const manifest = {
    cards: ['old', 'new', 'undated', 'secret'],
    metadata: {
        old: { name: 'Old Post', date: '01-02-2025', tags: '[a, x], [b, x]' },
        new: { name: 'New Post', date: '03-04-2026', tags: '[a, x]' },
        undated: { name: 'Undated', tags: '[c, y]' },
        secret: { name: 'Secret', date: '05-06-2026', encrypted: true, tags: '[a, x]' },
    },
};
const linkTargets = (block) => block.children.filter(c => c.type === 'directive').map(c => c.args.items[0].value);

test('writing lists dated, public posts newest first', () => {
    assert.deepEqual(writingBlocks(manifest, at).map(b => linkTargets(b)[0]), ['new', 'old']);
});

test('tags are alphabetical and list their public pages', () => {
    const blocks = tagBlocks(manifest, at);
    assert.deepEqual(blocks.map(b => b.children[0].value.trim()), ['a:', 'b:', 'c:']);
    assert.deepEqual(linkTargets(blocks[0]), ['old', 'new']);
});

test('macros pick the right list and ignore other nodes', () => {
    const macro = (name) => ({ ...at, name: 'macro', args: { items: [{ key: null, value: name }] } });
    assert.equal(macroBlocks(manifest, macro('writing')).length, 2);
    assert.equal(macroBlocks(manifest, macro('tags')).length, 3);
    assert.equal(macroBlocks(manifest, macro('other')), null);
    assert.equal(macroBlocks(manifest, { name: 'note' }), null);
    assert.deepEqual(writingBlocks(null, at), []);
});

test('a page marked unlisted is in neither list', () => {
    const marked = { cards: ['a', 'b'], metadata: { a: { name: 'A', date: '01-01-2026', tags: '[t, x]' }, b: { name: 'B', date: '02-01-2026', tags: '[t, x]', unlisted: true } } };
    assert.deepEqual(writingBlocks(marked, at).map(b => linkTargets(b)[0]), ['a']);
    assert.deepEqual(linkTargets(tagBlocks(marked, at)[0]), ['a']);
});
