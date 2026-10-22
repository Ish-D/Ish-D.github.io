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

test('a paragraph is copied exactly as it was written, however its lines were broken', () => {
    const text = 'Typographic quality depends on the evenness of color across a page, and nothing disturbs color more than loose lines followed by tight ones, so the optimizer trades tightness for looseness.';
    for (const width of [300, 360, 420, 520]) {
        const { el } = render(parseText(text), width);
        assert.equal(selectionText(el), text, `at ${width}px`);
    }
});

const LONG_WORDS = 'Extraordinarily incomprehensible internationalization considerations notwithstanding characteristically unrepresentative misunderstandings overwhelmingly counterintuitive acknowledgements demonstrably';

test('a hyphen is drawn, not text, and a split word is whole in the text of its first line', () => {
    const { el } = render(parseText(LONG_WORDS));
    assert.equal(el.querySelectorAll('.hy').length, 0, 'no hyphen element');
    const heads = el.querySelectorAll('.hd');
    assert.ok(heads.length > 0, 'a narrow measure should hyphenate');
    for (const head of heads) {
        const tail = head.parentNode.children.find(c => c.matches?.('.tl'));
        assert.ok(tail, 'the rest of the word follows the first piece');
        const lines = el.querySelectorAll('.ln');
        const line = head.closest('.ln');
        const next = lines[lines.indexOf(line) + 1];
        const piece = next.querySelector('.ct');
        assert.ok(piece, 'the next line draws its piece');
        assert.equal(piece.dataset.t, tail.textContent.slice(0, piece.dataset.t.length));
        assert.ok(!/-/.test(head.textContent + tail.textContent), 'no hyphen in the word');
        const kids = head.parentNode.children;
        const after = kids[kids.indexOf(tail) + 1];
        assert.ok(after?.matches?.('.brk') && after.textContent === '', 'the hyphen is drawn after the whole word');
    }
    // the pieces on the next lines are not text
    assert.ok(el.querySelectorAll('.ct').every(c => c.textContent === ''));
});

test('a word split over three lines is whole in the first one, and the middle line draws its piece and a hyphen', () => {
    const word = 'supercalifragilisticexpialidocious';
    const { el } = render(parseText(`Say ${word} now`), 110);
    const lines = el.querySelectorAll('.ln');
    assert.ok(lines.length >= 3);
    const heads = el.querySelectorAll('.hd');
    assert.equal(heads.length, 1);
    assert.equal(heads[0].textContent + heads[0].parentNode.children.find(c => c.matches?.('.tl')).textContent, word);
    const middle = el.querySelectorAll('.ct').filter(c => c.dataset.hy !== undefined);
    assert.ok(middle.length >= 1, 'a middle piece carries its own hyphen');
    assert.equal(selectionText(el), `Say ${word} now`);
});

test('a break at a hyphen that is already there is not a space', () => {
    const text = 'Looking at the state-of-the-art long-standing well-known results here';
    let seen = false;
    for (let width = 200; width <= 420; width += 10) {
        const { layout, el } = render(parseText(text), width);
        const lines = layout.blocks.find(b => b.type === 'paragraph').lines;
        if (lines.some((l, i) => i < lines.length - 1 && l.join === 'none')) seen = true;
        assert.equal(selectionText(el), text, `at ${width}px`);
    }
    assert.ok(seen, 'some width breaks a word at its own hyphen');
});

test('lines say what follows them: a space between words, the end of a paragraph, or nothing inside a word', () => {
    const { el } = render(parseText('One short paragraph of words that wraps onto a few lines at this narrow width, and another below.\n\nSecond.'), 260);
    const separators = el.querySelectorAll('.sp').map(sp => sp.textContent);
    assert.ok(separators.filter(t => t === ' ').length >= 2);
    assert.equal(separators.filter(t => t === '\n').length, 2, 'one at the end of each paragraph');
    assert.equal(selectionText(el), 'One short paragraph of words that wraps onto a few lines at this narrow width, and another below.\n\nSecond.');
});

test('copying leaves out the section link and the markers, turns math into its TeX and keeps drop caps and bullets', () => {
    const { el } = render(parseText('## A heading\n\n[[drop(I)]]n my time here, with $x^2$ in a line.\n\n- one\n- two\n'));
    const copied = selectionText(el);
    assert.ok(!copied.includes('§'));
    assert.ok(copied.startsWith('A heading'));
    assert.match(copied, /In my time here, with .* in a line\./);
    assert.match(copied, /one\s+two|\S one\n\n\S two/, 'list items stay apart');
    assert.equal(selectionText(document.createElement('div')), null, 'nothing of the page, nothing copied');
});

test('math is copied as its TeX, once', () => {
    const el = (tag, className, ...kids) => {
        const e = document.createElement(tag);
        e.className = className;
        for (const k of kids) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
        return e;
    };
    const line = el('span', 'ln', el('span', 'r', 'the square '), el('span', 'atom atom-math',
        el('span', 'katex', el('span', 'katex-mathml', el('annotation', '', 'x^2')), el('span', 'katex-html', 'x2'))),
    el('span', 'r', ' of it'), el('span', 'sp', '\n'));
    assert.equal(selectionText(el('p', 'blk', line)), 'the square $x^2$ of it');
});

test('every paragraph of the post is copied as its own text, however it was broken, at several widths', () => {
    const normal = (text) => text.replace(/[\s\u00A0\u2003]+/g, ' ').trim();
    let checked = 0;
    for (const width of [420, 700, 1280]) {
        const { layout, el } = render(parseCard('llms_for_bozos_1'), width);
        const drawn = el.children.filter(c => c.classList?.contains('blk'));
        const texts = layout.blocks.filter(b => b.type === 'paragraph' || b.type === 'heading');
        assert.equal(drawn.length, texts.length);
        for (const [i, block] of texts.entries()) {
            if (block.type !== 'paragraph' || block.spans.some(sp => sp.kind !== 'text' && sp.kind !== 'marker')) continue;
            const blockEl = drawn[i];
            if (blockEl.classList.contains('toc-text')) continue;
            const expected = normal(block.spans.filter(sp => sp.kind === 'text').map(sp => sp.text).join(''));
            assert.equal(normal(selectionText(blockEl) ?? ''), expected, `at ${width}px`);
            checked++;
        }
    }
    assert.ok(checked > 100, `${checked} paragraphs checked`);
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

test('images wait until they are near on screen, and load and decode at once on paper', () => {
    const layout = layoutDocument(parseText('[[image(a.png, place: block, width: 200, height: 100)]]\n'), makeEnv(1280, { hyphenator }));
    const image = (extra) => {
        const ctx = { document, measurer, math, resolveAsset: (p) => `/${p}`, persist: new Map(), ...extra };
        return renderLayout(document.createElement('div'), layout, ctx).querySelectorAll('img')[0];
    };
    const screen = image({});
    assert.deepEqual([screen.loading, screen.decoding], ['lazy', 'async']);
    const paper = image({ eager: true });
    assert.deepEqual([paper.loading, paper.decoding], ['eager', 'sync']);
});

test('capitals and tracking reach the page as styles on the block', () => {
    const { el } = render(parseText('# Title\n\n### Small heading\n\nBody text here.\n'));
    const h3 = el.querySelectorAll('h3')[0];
    assert.equal(h3.style.textTransform, 'uppercase');
    assert.equal(h3.style.letterSpacing, '0.1em');
    const p = el.querySelectorAll('p')[0];
    assert.equal(p.style.textTransform, undefined);
    assert.equal(p.style.letterSpacing, undefined);
});

test('strong text keeps the weight of the page and is set in capitals instead', () => {
    const { el } = render(parseText('Some **loud** words.\n'));
    const runs = el.querySelectorAll('.r');
    const loud = runs.find(r => r.textContent === 'loud');
    assert.ok(loud, 'the strong run is its own span');
    assert.equal(loud.style.textTransform, 'uppercase');
    assert.equal(loud.style.fontWeight, undefined);
});
