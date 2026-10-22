import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../../core/doc/parse.js';
import { layoutPrint, PAPER, SHEET } from '../../core/layout/print.js';
import { renderSheets } from '../../core/render/print.js';
import { selectionText } from '../../core/render/dom.js';
import { makeEnv } from '../../tools/render-layout.js';
import { createDocument } from './fakedom.js';

const document = createDocument();
const card = (name) => parse(readFileSync(new URL(`../../cards/${name}.md`, import.meta.url), 'utf8'));
const math = (tex) => ({ html: `<span class="katex">${tex}</span>`, width: tex.length * 5, height: 24, ascent: 18, descent: 6 });

function draw(name, paper = PAPER.letter, heading = { title: 'The title', address: 'example.com/page' }) {
    const env = makeEnv(1280, { fontSize: 20, width: 32 });
    const printed = layoutPrint(card(name), env, paper);
    const root = document.createElement('div');
    renderSheets(root, printed, { document, measurer: env.measurer, math, resolveAsset: (p) => `/${p}`, persist: new Map(), eager: true }, heading);
    return { printed, root };
}

test('each sheet is a box the size of the paper, one pixel short so it never spills onto a blank sheet', () => {
    const { printed, root } = draw('llms_for_bozos_1');
    const sheets = root.children;
    assert.equal(sheets.length, printed.sheets.length);
    assert.ok(sheets.length > 10);
    for (const sheet of sheets) {
        assert.ok(sheet.classList.contains('sheet'));
        assert.equal(sheet.style.width, '816px');
        assert.equal(sheet.style.height, '1055px');
    }
});

test('the title runs along the top from the second sheet, and every sheet has its number and the address', () => {
    const { root } = draw('llms_for_bozos_1');
    const sheets = root.children;
    assert.equal(sheets[0].querySelector('.sheet-head'), null, 'the first sheet starts with the title of the page itself');
    for (const sheet of sheets.slice(1)) assert.equal(sheet.querySelector('.sheet-head').textContent, 'The title');
    sheets.forEach((sheet, k) => {
        assert.equal(sheet.querySelector('.sheet-folio').textContent, String(k + 1));
        assert.equal(sheet.querySelector('.sheet-address').textContent, 'example.com/page');
    });
});

test('the text sits below the top margin and is as wide as the paper, centred by the lines themselves', () => {
    const { root, printed } = draw('about', PAPER.a4);
    const body = root.children[0].querySelector('.sheet-body');
    assert.equal(body.style.top, `${SHEET.top}px`);
    assert.equal(body.style.width, '793.7px');
    assert.equal(body.style.height, `${printed.room}px`);
    assert.equal(root.children[0].style.height, '1121.5px');
});

test('what is drawn reads back as the page, in order, with nothing of the screen in it', () => {
    const { root, printed } = draw('llms_for_bozos_1');
    const read = selectionText(root);
    const words = (text) => text.replace(/[\s\u00A0]+/g, ' ');
    assert.ok(read.length > 20000);
    assert.ok(!read.includes('§'), 'no section links on paper');
    assert.equal(root.querySelectorAll('.heading-link').length, 0);
    // every heading and paragraph of the first sheet is in the copy, in order
    const first = printed.sheets[0].items.filter(i => i.lines).map(i => i.lines.map(l => l.runs.filter(r => r.kind === 'text').map(r => r.text).join('')).join(' '));
    let at = 0;
    for (const block of first) {
        const start = words(block).split(' ').slice(0, 3).join(' ');
        const found = words(read).indexOf(start, at);
        assert.ok(found >= at, `"${start}" is in the copy after the part before it`);
        at = found;
    }
});

test('no block of a printed page has an id, so the page on screen keeps its own', () => {
    const { root } = draw('llms_for_bozos_1');
    assert.equal(root.querySelectorAll('.blk').filter(b => b.id).length, 0);
});
