import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoop } from '../../core/runtime/loop.js';

function world({ hidden = false, reduced = false } = {}) {
    const frames = new Map();
    const timers = new Map();
    let ids = 0;
    let clock = 0;
    const listeners = {};
    const win = {
        performance: { now: () => clock },
        requestAnimationFrame: (fn) => { frames.set(++ids, fn); return ids; },
        cancelAnimationFrame: (id) => frames.delete(id),
        setTimeout: (fn, ms) => { timers.set(++ids, { fn, at: clock + ms }); return ids; },
        clearTimeout: (id) => timers.delete(id),
        matchMedia: () => ({ matches: reduced, addEventListener: (type, fn) => { listeners.motion = fn; } }),
    };
    const document = { defaultView: win, hidden, addEventListener: (type, fn) => { listeners[type] = fn; } };
    const controller = new AbortController();
    const ticks = [];
    return {
        win, document, controller, ticks, listeners, frames, timers,
        loop: () => createLoop({ el: {}, document, signal: controller.signal, tick: (dt) => ticks.push(dt) }),
        advanceTo(ms) { clock = ms; },
        runFrame() { const [id, fn] = [...frames][0]; frames.delete(id); fn(clock); },
    };
}

test('it runs a frame at a time with the time since the last', () => {
    const w = world();
    const loop = w.loop();
    assert.equal(loop.running, true);
    w.advanceTo(16);
    w.runFrame();
    w.advanceTo(33);
    w.runFrame();
    assert.deepEqual(w.ticks.map(t => Math.round(t * 1000)), [16, 17]);
});

test('a long pause does not make one huge step', () => {
    const w = world();
    w.loop();
    w.advanceTo(5000);
    w.runFrame();
    assert.equal(w.ticks[0], 0.05);
});

test('when the browser gives no frames a timer steps it instead', () => {
    const w = world();
    w.loop();
    w.advanceTo(100);
    const [, timer] = [...w.timers][0];
    timer.fn();
    assert.equal(w.ticks.length, 1);
    assert.ok(w.frames.size === 1 && w.timers.size === 1, 'the next frame is already scheduled');
});

test('it does not run when the reader wants less motion, and says so', () => {
    const w = world({ reduced: true });
    const loop = w.loop();
    assert.equal(loop.running, false);
    assert.equal(loop.reduced, true);
    assert.equal(w.frames.size, 0);
});

test('it waits while the tab is hidden and starts when it shows', () => {
    const w = world({ hidden: true });
    const loop = w.loop();
    assert.equal(loop.running, false);
    w.document.hidden = false;
    w.listeners.visibilitychange();
    assert.equal(loop.running, true);
    w.document.hidden = true;
    w.listeners.visibilitychange();
    assert.equal(loop.running, false);
    assert.equal(w.frames.size + w.timers.size, 0, 'nothing is left scheduled');
});

test('aborting the signal stops it for good', () => {
    const w = world();
    const loop = w.loop();
    w.controller.abort();
    assert.equal(loop.running, false);
    assert.equal(w.frames.size + w.timers.size, 0);
});
