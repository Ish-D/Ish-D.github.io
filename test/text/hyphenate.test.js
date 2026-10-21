import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHyphenator, english } from '../../core/text/hyphenate.js';
import { patterns, exceptions } from '../../core/text/patterns-en-us.js';

/** @param {{ points(word: string): number[] }} hyphenator @param {string} word */
function hyphenate(hyphenator, word) {
    const points = new Set(hyphenator.points(word));
    let out = '';
    for (let i = 0; i < word.length; i++) out += (points.has(i) ? '-' : '') + word[i];
    return out;
}

/** Deterministic PRNG (mulberry32). */
function random(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomWords(count, seed, alphabet, maxLength) {
    const next = random(seed);
    const chars = [...alphabet];
    return Array.from({ length: count }, () => {
        let word = '';
        const length = Math.floor(next() * (maxLength + 1));
        for (let i = 0; i < length; i++) word += chars[Math.floor(next() * chars.length)];
        return word;
    });
}

// Expected forms match plain TeX's \showhyphens with hyphen.tex.
test('matches TeX hyphenation of common words', () => {
    const expected = [
        'hy-phen-ation', 'al-go-rithm', 'ty-pog-ra-phy', 'com-puter', 'math-e-mat-ics', 'para-graph',
        'jus-ti-fi-ca-tion', 'type-set-ting', 'knowl-edge', 'in-de-pen-dent', 'com-mu-ni-ca-tion',
        'in-for-ma-tion', 'uni-ver-sity', 'en-cy-clo-pe-dia', 'demo-crat', 'bi-ol-ogy', 'char-ac-ters',
        'de-vel-op-ment', 'su-per-cal-ifrag-ilis-tic-ex-pi-ali-do-cious',
    ];
    for (const form of expected) assert.equal(hyphenate(english, form.replaceAll('-', '')), form);
    assert.deepEqual(english.points('hyphenation'), [2, 6]);
});

test('is case-insensitive and reports indices into the original word', () => {
    assert.equal(hyphenate(english, 'Hyphenation'), 'Hy-phen-ation');
    assert.equal(hyphenate(english, 'TYPOGRAPHY'), 'TY-POG-RA-PHY');
    assert.deepEqual(english.points('AlGoRiThM'), english.points('algorithm'));
});

test('TeX exceptions override the patterns', () => {
    const patternsOnly = createHyphenator({ patterns });
    assert.equal(hyphenate(patternsOnly, 'associate'), 'as-so-ci-ate');
    assert.equal(hyphenate(patternsOnly, 'table'), 'table');
    assert.equal(hyphenate(patternsOnly, 'present'), 'pre-sent');
    assert.equal(hyphenate(patternsOnly, 'project'), 'pro-ject');

    assert.equal(hyphenate(english, 'associate'), 'as-so-ciate');
    assert.equal(hyphenate(english, 'associates'), 'as-so-ciates');
    assert.equal(hyphenate(english, 'table'), 'ta-ble');
    assert.equal(hyphenate(english, 'Table'), 'Ta-ble');
    assert.equal(hyphenate(english, 'reciprocity'), 'reci-procity');
    for (const word of ['present', 'presents', 'project', 'projects']) assert.deepEqual(english.points(word), []);
    assert.equal(Object.keys(exceptions).length, 14);
});

test('exceptions respect minLeft and minRight', () => {
    const strict = createHyphenator({ patterns, exceptions, minRight: 4 });
    assert.deepEqual(strict.points('table'), []);
    assert.deepEqual(strict.points('associate'), [2, 4]);
    const custom = createHyphenator({ patterns, exceptions: { Gauss: 'g-a-u-s-s' }, minLeft: 1, minRight: 1 });
    assert.deepEqual(custom.points('gauss'), [1, 2, 3, 4]);
});

test('takes the max level per boundary, breaks at odd levels, anchors dots at word edges', () => {
    // a1b allows a|b; 2bab outvotes it before "bab"; .ab3 applies only at the word start.
    const toy = createHyphenator({ patterns: 'a1b 2bab .ab3', minLeft: 1, minRight: 1 });
    assert.deepEqual(toy.points('abab'), [2, 3]);
    assert.deepEqual(toy.points('aabab'), [4]);
    assert.deepEqual(toy.points('abb'), [1, 2]);
    assert.deepEqual(toy.points('cab'), []); // 'c' is outside the patterns' alphabet
});

test('never violates minLeft/minRight', () => {
    const words = randomWords(4000, 7, 'abcdefghijklmnopqrstuvwxyz', 24);
    for (const [minLeft, minRight] of [[1, 1], [2, 2], [2, 3], [3, 3], [4, 6]]) {
        const h = createHyphenator({ patterns, exceptions, minLeft, minRight });
        for (const word of [...words, ...Object.keys(exceptions), 'hyphenation', 'typography']) {
            for (const i of h.points(word)) {
                assert.ok(i >= minLeft && i <= word.length - minRight, `${word}: ${i} with ${minLeft}/${minRight}`);
            }
        }
    }
});

test('words with non-letters get no points', () => {
    for (const word of [
        '', 'a', 'ab', "don't", 'rock’n’roll', 'e-mail', 'hyphen.ation', 'mp3player', '2nd', 'naïve',
        'hyphenation!', 'hy phenation', 'résumé', 'İstanbul', '\u{1F600}hyphenation',
    ]) {
        assert.deepEqual(english.points(word), [], word);
    }
});

test('survives random input and keeps results sorted, unique, and cached', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-\'’ éßİ́\u{1F600}';
    const h = createHyphenator({ patterns, exceptions });
    for (const word of randomWords(5000, 42, alphabet, 40)) {
        const points = h.points(word);
        assert.ok(Object.isFrozen(points));
        for (let k = 0; k < points.length; k++) {
            assert.ok(Number.isInteger(points[k]) && points[k] >= 2 && points[k] <= word.length - 3);
            if (k > 0) assert.ok(points[k] > points[k - 1]);
        }
        assert.equal(h.points(word), points);
    }
    const long = 'pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(200);
    assert.ok(h.points(long).length > 0);
});

test('rejects bad options and malformed data', () => {
    assert.throws(() => createHyphenator({ patterns, minLeft: 0 }), RangeError);
    assert.throws(() => createHyphenator({ patterns, minRight: 1.5 }), RangeError);
    assert.throws(() => createHyphenator({ patterns: 'a1b a12b' }), /Invalid hyphenation pattern/);
    assert.throws(() => createHyphenator({ patterns: 'a.b' }), /Invalid hyphenation pattern/);
    assert.throws(() => createHyphenator({ patterns: 'a1b a3b' }), /Duplicate hyphenation pattern/);
    assert.throws(() => createHyphenator({ patterns, exceptions: { table: 'ta-bel' } }), /does not spell/);
});

test('hyphenates more than 200k words/s with a warm JIT', () => {
    const warmup = createHyphenator({ patterns, exceptions });
    for (const word of randomWords(20000, 1, 'etaoinshrdlcumwfgypbvkjxqz', 14)) warmup.points(word);
    const words = randomWords(50000, 2, 'etaoinshrdlcumwfgypbvkjxqz', 14);
    let best = 0;
    for (let run = 0; run < 3; run++) {
        const h = createHyphenator({ patterns, exceptions });
        const start = performance.now();
        for (const word of words) h.points(word);
        best = Math.max(best, words.length / ((performance.now() - start) / 1000));
    }
    assert.ok(best > 200_000, `${Math.round(best)} words/s`);
});
