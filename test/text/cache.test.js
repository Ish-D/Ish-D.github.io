import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedCache } from '../../core/text/cache.js';

test('bounded cache holds at most `limit` entries and keeps recently read ones', () => {
    const cache = createBoundedCache(4);
    for (const key of ['a', 'b', 'c']) cache.set(key, key.toUpperCase());
    assert.equal(cache.get('a'), 'A'); // read from the old generation, copied forward
    cache.set('d', 'D');
    cache.set('e', 'E');
    assert.equal(cache.get('a'), 'A');
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('missing'), undefined);

    const big = createBoundedCache(100);
    for (let i = 0; i < 1000; i++) big.set(i, i);
    for (let i = 0; i < 900; i++) assert.equal(big.get(i), undefined);
    for (let i = 950; i < 1000; i++) assert.equal(big.get(i), i);
});

test('bounded cache rejects limits below 2', () => {
    assert.throws(() => createBoundedCache(1), RangeError);
    assert.throws(() => createBoundedCache(NaN), RangeError);
});
