import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDocument } from '../../core/layout/document.js';
import { renderLayout, selectionText, sanitizeCss } from '../../core/render/dom.js';
import { createDocument } from './fakedom.js';
import { makeEnv, parseCard, parseText, hyphenator, measurer } from '../layout/fixtures.js';

const document = createDocument();
const math = (tex) => ({ html: `<span class="katex">${tex}</span>`, width: tex.length * 5, height: 24, ascent: 18, descent: 6 });

function render(doc, width = 1280) {
    const layout = layoutDocument(doc, makeEnv(width, { hyphenator }));
    const root = document.createElement('div');
    const el = renderLayout(root, layout, { document, measurer, math, resolveAsset: (p) => `/${p}`, persist: new Map() });
    return { layout, root, el };
}

const allStyles = (el) => {
    const out = [];
    const walk = (e) => {
        out.push(e.style);
        e.children.filter(c => c.nodeType === 1).forEach(walk);
    };
    walk(el);
    return out;
};

test('the post renders to a .doc with sized children and no NaN positions', () => {
    const { layout, root, el } = render(parseCard('llms_for_bozos_1'));
    assert.equal(root.children[0], el);
    assert.equal(el.style.width, '1280px');
    assert.ok(el.style.height.endsWith('px'));
    for (const style of allStyles(el)) {
        for (const [k, v] of Object.entries(style)) {
            if (typeof v === 'string') assert.ok(!/NaN|undefined|Infinity/.test(v), `${k}: ${v}`);
        }
    }
    const lineCount = (items) => items.filter(i => i.lines).flatMap(i => i.lines).filter(l => !l.overflow).length;
    const expected = lineCount(layout.blocks) + layout.notes.reduce((n, note) => n + lineCount(note.items), 0)
        + layout.blocks.filter(b => b.type === 'object' && b.caption).reduce((n, b) => n + b.caption.lines.length, 0);
    assert.equal(el.querySelectorAll('.ln').length, expected);
});

test('headings carry their ids and a link affordance', () => {
    const { el } = render(parseCard('llms_for_bozos_1'));
    const h = el.querySelectorAll('.blk-heading');
    assert.ok(h.length >= 15);
    assert.ok(h.every(x => x.id));
    assert.ok(el.querySelectorAll('.heading-link').length === h.filter(x => x.id).length);
});

test('notes render as asides with their lines positioned inside them', () => {
    const { layout, el } = render(parseCard('llms_for_bozos_1'));
    const asides = el.querySelectorAll('aside');
    assert.equal(asides.length, layout.notes.length);
    for (const a of asides) assert.ok(a.querySelectorAll('.ln').length > 0);
});

test('links keep their kind: external, card, jump', () => {
    const doc = parseText('See [[link(about, display: "the about page")]] and [site](https://example.com) and [[jump(target)]]{here}.\n\n[[anchor(target)]]{Target text.}');
    const { el } = render(doc);
    assert.ok(el.querySelector('a.lnk-card'));
    assert.equal(el.querySelector('a.lnk-card').dataset.card, 'about');
    assert.equal(el.querySelector('a.lnk-external').href, 'https://example.com');
    assert.equal(el.querySelector('a.lnk-jump').dataset.jump, 'target');
});

test('math atoms get a zero-height wrapper with the rendered html inside', () => {
    const { el } = render(parseText('Energy is $E = mc^2$ always.'));
    const atom = el.querySelector('.atom-math');
    assert.ok(atom);
    assert.equal(atom.children[0].innerHTML, '<span class="katex">E = mc^2</span>');
    assert.equal(atom.children[0].style.top, '-18px');
});

test('hyphenated lines end with a .hy span and selectionText reassembles the paragraph', () => {
    const text = 'Typographic quality depends on the evenness of color across a page, and nothing disturbs color more than loose lines followed by tight ones, so the optimizer trades tightness for looseness.';
    const { el } = render(parseText(text), 300);
    const joined = selectionText(el);
    assert.equal(joined.replace(/\s+/g, ' ').trim(), text);
    assert.ok(el.querySelectorAll('.hy').length > 0, 'a narrow measure should hyphenate');
});

test('viz objects expose their data attributes and persist across renders', () => {
    const doc = parseText('[[viz(type: neuron-approx, height: 200, width: 300, align: center)]]');
    const persist = new Map();
    const layout = layoutDocument(doc, makeEnv(1280, { hyphenator }));
    const root = document.createElement('div');
    const a = renderLayout(root, layout, { document, measurer, math, persist });
    const body1 = a.querySelector('.viz-container');
    assert.equal(body1.dataset.vizHeight, '200');
    assert.equal(body1.getAttribute('data-viz-type'), 'neuron-approx');
    const b = renderLayout(root, layout, { document, measurer, math, persist });
    assert.equal(b.querySelector('.viz-container'), body1, 'the same element is reused');
});

test('drop caps and bullets and rules render', () => {
    const { el } = render(parseText('[[drop(I)]]n my time creating this site I found the quote true.\n\n- one\n- two\n\n---\n'));
    assert.ok(el.querySelector('.dropcap'));
    assert.equal(el.querySelectorAll('.bullet').length, 2);
    assert.ok(el.querySelector('.rule'));
});

test('sanitizeCss keeps harmless declarations only', () => {
    assert.equal(sanitizeCss('color: red; position: fixed; font-weight: bold'), 'color: red; font-weight: bold');
    assert.equal(sanitizeCss('background: url(http://x/y.png)'), '');
    assert.equal(sanitizeCss('color: javascript:alert(1)'), '');
});

import { clipPathFor } from '../../core/render/dom.js';
import { parseWrap } from '../../core/layout/objects.js';

test('shaped wraps clip the object to the same shape; box and contour do not', () => {
    const rect = { width: 200, height: 100 };
    assert.equal(clipPathFor(parseWrap('circle'), rect), 'circle(50px at 50% 50%)');
    assert.equal(clipPathFor(parseWrap('ellipse'), rect), 'ellipse(100px 50px at 50% 50%)');
    assert.equal(clipPathFor(parseWrap('polygon(0 0, 100% 0, 50% 100%)'), rect), 'polygon(0px 0px, 200px 0px, 100px 100px)');
    assert.equal(clipPathFor(parseWrap('box'), rect), null);
    assert.equal(clipPathFor(parseWrap('contour'), rect), null);
});

test('an object with a shaped wrap carries a clip-path unless clip: none', () => {
    const doc = parseText('[[image(a.png, place: right, width: 200, height: 200, wrap: circle)]]\n\n[[image(b.png, place: right, width: 200, height: 200, wrap: circle, clip: none)]]');
    const { el } = render(doc);
    const bodies = el.querySelectorAll('.obj-body');
    assert.ok(bodies[0].style.clipPath.startsWith('circle('));
    assert.equal(bodies[1].style.clipPath, undefined);
});
