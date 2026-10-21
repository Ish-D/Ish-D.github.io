import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, frontMatter, manifestEntry, scaffold, slugify, titleOf, withTitle } from '../../core/vault/pages.js';

test('front matter is read as plain entries', () => {
    const text = '---\nname: Lab\ndate: 10-20-2026\ntags: [a, b], [c, d]\n---\n\n# Heading\n';
    assert.deepEqual(frontMatter(text), { name: 'Lab', date: '10-20-2026', tags: '[a, b], [c, d]' });
    assert.deepEqual(frontMatter('no front matter'), {});
});

test('the title comes from name:, then the first heading, then a default', () => {
    assert.equal(titleOf('---\nname: Lab\n---\n# Other\n'), 'Lab');
    assert.equal(titleOf('# Just A Heading\n\nbody'), 'Just A Heading');
    assert.equal(titleOf('---\ndate: 1\n---\n## Not a first-level heading'), 'Untitled');
    assert.equal(titleOf('plain'), 'Untitled');
});

test('withTitle sets or adds the name', () => {
    assert.equal(withTitle('---\nname: Old\ndate: 1\n---\n\nbody\n', 'New'), '---\nname: New\ndate: 1\n---\n\nbody\n');
    assert.equal(withTitle('---\ndate: 1\n---\nbody\n', 'New'), '---\nname: New\ndate: 1\n---\nbody\n');
    assert.equal(withTitle('body\n', 'New'), '---\nname: New\n---\n\nbody\n');
    assert.equal(titleOf(withTitle(scaffold('A'), 'B')), 'B');
});

test('manifestEntry keeps only the fields the manifest lists', () => {
    assert.deepEqual(manifestEntry('---\nname: X\ndate: 01-02-2026\ntags: [t]\nwidth: 400\n---\n'), { name: 'X', date: '01-02-2026', tags: '[t]' });
});

test('slugify makes safe file names', () => {
    assert.equal(slugify('Lab notes!'), 'lab-notes');
    assert.equal(slugify('  Café  au  lait '), 'cafe-au-lait');
    assert.equal(slugify('???'), '');
});

test('contentHash is stable and sensitive to changes', async () => {
    assert.equal(await contentHash('a'), await contentHash('a'));
    assert.notEqual(await contentHash('a'), await contentHash('b'));
    assert.equal((await contentHash('a')).length, 22);
});
