import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../core/doc/parse.js';
import { countWords, flagsOf, statsText } from '../../core/app/reading-stats.js';

const doc = parse('---\nname: X\nwordCount: true\nreadTime: true\nprogressBar: true\n---\n\n# Title here\n\nOne two three [[image(a.png, width: 50)]]{four five} six.\n');

test('words come from prose, not markup or directive arguments', () => {
    assert.equal(countWords(doc), 2 + 3 + 2 + 1);
});

test('flags come from front matter', () => {
    assert.deepEqual(flagsOf(doc), { wordCount: true, readTime: true, progressBar: true });
    assert.deepEqual(flagsOf(parse('# nothing')), { wordCount: false, readTime: false, progressBar: false });
});

test('the line shows only what is switched on', () => {
    assert.equal(statsText({ flags: flagsOf(doc), words: 1000, progress: 0.426 }), '1000 words | 5m | 43%');
    assert.equal(statsText({ flags: { readTime: true }, words: 10, progress: 0 }), '1m');
    assert.equal(statsText({ flags: {}, words: 10, progress: 0 }), '');
});
