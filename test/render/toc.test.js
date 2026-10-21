import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTocRail, currentSection } from '../../core/app/toc.js';
import { createDocument } from './fakedom.js';

const entries = [{ y: 100 }, { y: 400 }, { y: 900 }];

test('currentSection finds the last heading at or above a position', () => {
    assert.equal(currentSection(entries, 50), -1);
    assert.equal(currentSection(entries, 100), 0);
    assert.equal(currentSection(entries, 899), 1);
    assert.equal(currentSection(entries, 5000), 2);
    assert.equal(currentSection([], 10), -1);
});

function setup(scrollY = 0) {
    const document = createDocument();
    document.body = document.createElement('body');
    const listeners = [];
    const window = {
        scrollY,
        localStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } },
        addEventListener: (t, fn) => listeners.push([t, fn]),
        removeEventListener() {},
        requestAnimationFrame: (fn) => fn(),
    };
    const jumps = [];
    const rail = createTocRail({ document, window, goTo: (id) => jumps.push(id) });
    const outline = [
        { level: 2, number: '1', id: 'one', text: 'One' },
        { level: 3, number: '1.1', id: 'one-a', text: 'One A' },
        { level: 2, number: '2', id: 'two', text: 'Two' },
    ];
    const anchors = new Map([['one', { y: 300 }], ['one-a', { y: 700 }], ['two', { y: 1500 }]]);
    return { document, window, rail, jumps, outline, anchors, scroll: () => listeners.filter(([t]) => t === 'scroll').forEach(([, fn]) => fn()) };
}

test('the rail stays hidden while the contents box is on screen and appears once it has scrolled away', () => {
    const t = setup(0);
    t.rail.update({ outline: t.outline, anchors: t.anchors, tocRect: { y: 100, height: 400 }, isNarrow: false });
    const nav = t.document.body.children[0];
    assert.equal(nav.classList.contains('live'), false);
    assert.equal(nav.style.props['--p'], '0.000');
    t.window.scrollY = 800;
    t.scroll();
    assert.equal(nav.classList.contains('live'), true);
    assert.equal(nav.style.props['--p'], '1.000');
    // fades in gradually while the box leaves
    t.window.scrollY = 400;
    t.scroll();
    assert.ok(Number(nav.style.props['--p']) > 0 && Number(nav.style.props['--p']) < 1);
    assert.equal(nav.querySelectorAll('.toc-item').length, 3);
});

test('the current section follows the scroll position', () => {
    const t = setup(0);
    t.rail.update({ outline: t.outline, anchors: t.anchors, tocRect: { y: 100, height: 200 }, isNarrow: false });
    const nav = t.document.body.children[0];
    t.window.scrollY = 700;
    t.scroll();
    const currentIds = () => nav.querySelectorAll('.toc-item').filter(li => li.classList.contains('current')).map(li => li.dataset.index);
    assert.deepEqual(currentIds(), ['1']);
    t.window.scrollY = 1500;
    t.scroll();
    assert.deepEqual(currentIds(), ['2']);
});

test('pages without a contents box get no rail; clicking a tick jumps to its heading', () => {
    const t = setup(2000);
    t.rail.update({ outline: t.outline, anchors: t.anchors, tocRect: null, isNarrow: false });
    const nav = t.document.body.children[0];
    t.scroll();
    assert.equal(nav.hidden, true);
    t.rail.update({ outline: t.outline, anchors: t.anchors, tocRect: { y: 0, height: 100 }, isNarrow: false });
    const link = nav.querySelectorAll('.toc-item')[2].children[0];
    link.dispatch('click');
    assert.deepEqual(t.jumps, ['two']);
});

test('the mode persists and narrow screens switch to a button', () => {
    const t = setup(2000);
    t.rail.update({ outline: t.outline, anchors: t.anchors, tocRect: { y: 0, height: 100 }, isNarrow: false });
    const nav = t.document.body.children[0];
    assert.equal(nav.dataset.mode, 'ticks');
    nav.querySelector('.toc-hide').dispatch('click');
    assert.equal(nav.dataset.mode, 'hidden');
    assert.equal(t.window.localStorage.getItem('v2-toc'), 'hidden');
    t.rail.update({ outline: t.outline, anchors: t.anchors, tocRect: { y: 0, height: 100 }, isNarrow: true });
    assert.equal(nav.dataset.mode, 'button', 'narrow screens show just the button');
    assert.equal(t.window.localStorage.getItem('v2-toc'), 'hidden', 'the preference is kept');
});
