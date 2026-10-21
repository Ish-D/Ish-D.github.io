import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge3 } from '../../core/vault/merge.js';

const doc = (...lines) => lines.map(l => `${l}\n`).join('');
const base = doc('one', 'two', 'three', 'four', 'five', 'six', 'seven');

test('identical or one-sided edits are trivially clean', () => {
    assert.deepEqual(merge3(base, base, base), { clean: true, text: base });
    const ours = doc('one', 'TWO', 'three', 'four', 'five', 'six', 'seven');
    assert.equal(merge3(base, ours, base).text, ours);
    assert.equal(merge3(base, base, ours).text, ours);
    assert.equal(merge3(base, ours, ours).text, ours);
});

test('edits to different regions both survive', () => {
    const ours = doc('one', 'TWO', 'three', 'four', 'five', 'six', 'seven');
    const theirs = doc('one', 'two', 'three', 'four', 'five', 'SIX', 'seven');
    const merged = merge3(base, ours, theirs);
    assert.equal(merged.clean, true);
    assert.equal(merged.text, doc('one', 'TWO', 'three', 'four', 'five', 'SIX', 'seven'));
});

test('insertions and deletions in different regions merge', () => {
    const ours = doc('zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven');
    const theirs = doc('one', 'two', 'three', 'four', 'five', 'seven');
    const merged = merge3(base, ours, theirs);
    assert.equal(merged.clean, true);
    assert.equal(merged.text, doc('zero', 'one', 'two', 'three', 'four', 'five', 'seven'));
});

test('the same change on both sides applies once', () => {
    const both = doc('one', 'two', 'THREE', 'four', 'five', 'six', 'seven');
    const ours = doc('ONE', 'two', 'THREE', 'four', 'five', 'six', 'seven');
    const merged = merge3(base, ours, both);
    assert.equal(merged.clean, true);
    assert.equal(merged.text, ours);
});

test('different edits to the same line conflict', () => {
    const ours = doc('one', 'two', 'ours', 'four', 'five', 'six', 'seven');
    const theirs = doc('one', 'two', 'theirs', 'four', 'five', 'six', 'seven');
    const merged = merge3(base, ours, theirs);
    assert.equal(merged.clean, false);
    assert.equal(merged.text, ours);
});

test('edits on adjacent lines conflict', () => {
    const ours = doc('one', 'TWO', 'three', 'four', 'five', 'six', 'seven');
    const theirs = doc('one', 'two', 'THREE', 'four', 'five', 'six', 'seven');
    assert.equal(merge3(base, ours, theirs).clean, false);
});

test('a one-line gap between edits is enough', () => {
    const ours = doc('one', 'TWO', 'three', 'four', 'five', 'six', 'seven');
    const theirs = doc('one', 'two', 'three', 'FOUR', 'five', 'six', 'seven');
    const merged = merge3(base, ours, theirs);
    assert.equal(merged.clean, true);
    assert.equal(merged.text, doc('one', 'TWO', 'three', 'FOUR', 'five', 'six', 'seven'));
});

test('works with an empty base and with no trailing newline', () => {
    assert.equal(merge3('', 'a\n', 'a\n').text, 'a\n');
    assert.equal(merge3('', 'a\n', '').text, 'a\n');
    assert.equal(merge3('x\ny\nz', 'x\nY\nz', 'x\ny\nz\n').clean, false);
});

function random(seed) {
    let a = seed;
    return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 2 ** 32; };
}

test('fuzz: edits confined to separate halves keep every changed line', () => {
    for (let seed = 1; seed <= 200; seed++) {
        const rand = random(seed);
        const n = 40 + Math.floor(rand() * 40);
        const lines = Array.from({ length: n }, (_, i) => `line ${i}`);
        const mid = Math.floor(n / 2);
        const edit = (from, to) => {
            const copy = [...lines];
            for (let i = 0; i < 1 + Math.floor(rand() * 4); i++) {
                const at = from + Math.floor(rand() * (to - from));
                const op = rand();
                if (op < 0.4) copy[at] = `${copy[at]} edited ${seed}`;
                else if (op < 0.7) copy.splice(at, 0, `new ${seed} ${i}`);
                else copy.splice(at, 1);
            }
            return copy;
        };
        const ours = edit(0, mid - 4);
        const theirs = edit(mid + 4, n - 8);
        const merged = merge3(doc(...lines), doc(...ours), doc(...theirs));
        assert.equal(merged.clean, true, `seed ${seed}`);
        const out = merged.text.split('\n');
        for (const line of [...ours, ...theirs]) {
            if (/edited|new/.test(line)) assert.ok(out.includes(line), `seed ${seed}: missing ${line}`);
        }
    }
});

test('fuzz: an unchanged side returns the other side', () => {
    for (let seed = 1; seed <= 100; seed++) {
        const rand = random(seed + 1000);
        const lines = Array.from({ length: 30 }, (_, i) => `l${i}`);
        const edited = lines.filter(() => rand() > 0.2).map(l => (rand() > 0.8 ? `${l}!` : l));
        assert.equal(merge3(doc(...lines), doc(...edited), doc(...lines)).text, doc(...edited));
        assert.equal(merge3(doc(...lines), doc(...lines), doc(...edited)).text, doc(...edited));
    }
});

test('very different texts give up instead of hanging', () => {
    const make = (p) => Array.from({ length: 3000 }, (_, i) => `${p}${i}\n`).join('');
    assert.equal(merge3(make('a'), make('b'), make('c')).clean, false);
});
