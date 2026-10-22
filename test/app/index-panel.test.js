import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageEntries, matchPages } from '../../core/app/index-panel.js';

const manifest = {
    cards: ['about', 'lab', 'menu', 'old', 'new', 'secret', 'tags', 'writing'],
    metadata: {
        about: { name: 'About' },
        lab: { name: 'Lab', date: '10-20-2026', unlisted: true },
        old: { name: 'Old Post', date: '01-02-2025', tags: '[gpu, technical]' },
        new: { name: 'New Post', date: '03-04-2026', tags: '[llm, technical]' },
        secret: { name: 'Secret', encrypted: true },
        tags: { name: 'Tags' },
        writing: { name: 'Writing' },
    },
};

test('the list has the pages A to Z and then the posts, newest first, without the home page, private pages or unlisted ones', () => {
    assert.deepEqual(pageEntries(manifest).map(e => e.name), ['about', 'tags', 'writing', 'new', 'old']);
});

test('the owner sees every page but the home page', () => {
    assert.deepEqual(pageEntries(manifest, { all: true }).map(e => e.name), ['about', 'secret', 'tags', 'writing', 'lab', 'new', 'old']);
});

test('typing narrows the list to titles, names and tags that have every word, titles that start with it first', () => {
    const entries = pageEntries(manifest);
    assert.deepEqual(matchPages(entries, '').map(e => e.name), entries.map(e => e.name));
    assert.deepEqual(matchPages(entries, 'post').map(e => e.name), ['new', 'old']);
    assert.deepEqual(matchPages(entries, 'technical').map(e => e.name), ['new', 'old']);
    assert.deepEqual(matchPages(entries, 'llm tech').map(e => e.name), ['new']);
    assert.deepEqual(matchPages(entries, 'w').map(e => e.name), ['writing', 'new'], 'a title that starts with it comes before one that has it inside');
    assert.deepEqual(matchPages(entries, 'zzz'), []);
    assert.deepEqual(pageEntries(null), []);
});
