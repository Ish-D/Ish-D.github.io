/**
 * Minimal reactive primitives: signals, computed values and effects.
 *
 * A computed or effect re-runs when any signal it read changes. Effects return
 * a disposer. `batch` groups several writes into one round of updates.
 */

let current = null;
let batchDepth = 0;
const queue = new Set();

function flush() {
    for (let guard = 0; queue.size && guard < 1000; guard++) {
        const jobs = [...queue];
        queue.clear();
        for (const job of jobs) job();
    }
}

function schedule(job) {
    queue.add(job);
    if (batchDepth === 0) flush();
}

export function batch(fn) {
    batchDepth++;
    try { return fn(); } finally {
        batchDepth--;
        if (batchDepth === 0) flush();
    }
}

/** @template T @param {T} initial */
export function signal(initial) {
    let value = initial;
    const subscribers = new Set();
    const read = () => {
        if (current) { subscribers.add(current); current.sources.add(subscribers); }
        return value;
    };
    read.peek = () => value;
    read.set = (next) => {
        if (Object.is(next, value)) return;
        value = next;
        for (const sub of [...subscribers]) schedule(sub);
    };
    read.subscribe = (fn) => effect(() => fn(read()));
    return read;
}

function track(run) {
    const node = () => {
        for (const set of node.sources) set.delete(node);
        node.sources.clear();
        const previous = current;
        current = node;
        try { run(); } finally { current = previous; }
    };
    node.sources = new Set();
    return node;
}

/** Runs `fn` now and again whenever a signal it read changes. */
export function effect(fn) {
    let cleanup = null;
    const node = track(() => {
        if (typeof cleanup === 'function') cleanup();
        cleanup = fn();
    });
    node();
    return () => {
        for (const set of node.sources) set.delete(node);
        node.sources.clear();
        if (typeof cleanup === 'function') cleanup();
    };
}

/** A signal whose value is derived from other signals. */
export function computed(fn) {
    const out = signal(undefined);
    effect(() => { out.set(fn()); });
    const read = () => out();
    read.peek = out.peek;
    read.subscribe = (cb) => effect(() => cb(out()));
    return read;
}
