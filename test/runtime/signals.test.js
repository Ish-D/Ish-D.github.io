import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch } from '../../core/runtime/signals.js';
import { createStore, formatNumber } from '../../core/runtime/store.js';

test('an effect runs now and again when a signal it read changes', () => {
    const a = signal(1);
    const seen = [];
    effect(() => { seen.push(a()); });
    a.set(2);
    a.set(2);
    a.set(3);
    assert.deepEqual(seen, [1, 2, 3]);
});

test('computed values follow their sources and chain', () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a() + b());
    const doubled = computed(() => sum() * 2);
    assert.equal(doubled(), 10);
    a.set(10);
    assert.equal(doubled(), 26);
});

test('an effect only depends on what its latest run read', () => {
    const useA = signal(true);
    const a = signal('a');
    const b = signal('b');
    let runs = 0;
    effect(() => { runs++; useA() ? a() : b(); });
    assert.equal(runs, 1);
    b.set('b2');
    assert.equal(runs, 1, 'b was not read yet');
    useA.set(false);
    assert.equal(runs, 2);
    a.set('a2');
    assert.equal(runs, 2, 'a is no longer read');
    b.set('b3');
    assert.equal(runs, 3);
});

test('batch runs dependents once after several writes', () => {
    const a = signal(1);
    const b = signal(1);
    let runs = 0;
    effect(() => { runs++; a(); b(); });
    batch(() => { a.set(2); b.set(2); a.set(3); });
    assert.equal(runs, 2);
});

test('a disposed effect stops running and cleans up', () => {
    const a = signal(0);
    const log = [];
    const stop = effect(() => { const v = a(); log.push(`run ${v}`); return () => log.push(`clean ${v}`); });
    a.set(1);
    stop();
    a.set(2);
    assert.deepEqual(log, ['run 0', 'clean 0', 'run 1', 'clean 1']);
});

test('store variables snap to their step and clamp to their range', () => {
    const store = createStore();
    store.define({ name: 'dk', value: 64, min: 8, max: 512, step: 8 });
    store.set('dk', 70);
    assert.equal(store.peek('dk'), 72);
    store.set('dk', 9999);
    assert.equal(store.peek('dk'), 512);
    store.set('dk', -5);
    assert.equal(store.peek('dk'), 8);
    store.define({ name: 'temp', value: 0.7, min: 0.1, max: 2, step: 0.05 });
    store.set('temp', 0.83);
    assert.equal(store.peek('temp'), 0.85);
});

test('subscribers and watchers see changes; redefining keeps the value', () => {
    const store = createStore();
    store.define({ name: 'n', value: 4, min: 1, max: 10, step: 1 });
    store.define({ name: 'm', value: 2, min: 1, max: 10, step: 1 });
    const seen = [];
    store.subscribe('n', v => seen.push(v));
    store.watch(['n', 'm'], vals => seen.push(vals.n * vals.m));
    store.set('n', 5);
    assert.deepEqual(seen, [4, 8, 5, 10]);
    store.define({ name: 'n', value: 4, min: 1, max: 6, step: 1 });
    assert.equal(store.peek('n'), 5);
    store.define({ name: 'n', value: 4, min: 1, max: 3, step: 1 });
    assert.equal(store.peek('n'), 3, 'a value outside the new range is clamped');
});

test('widest reserves room for the longest number a variable can show', () => {
    const store = createStore();
    store.define({ name: 'dk', value: 64, min: 8, max: 512, step: 8 });
    assert.equal(store.widest('dk'), '512');
    store.define({ name: 'p', value: 0.5, min: 0, max: 1, step: 0.01 });
    assert.equal(store.widest('p').length, 4);
    assert.equal(formatNumber(3.14159, { step: 0.01 }), '3.14');
});
