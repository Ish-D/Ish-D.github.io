import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paginate } from '../../core/layout/paginate.js';
import { PAPER, SHEET, layoutPrint, paperFor } from '../../core/layout/print.js';
import { parse } from '../../core/doc/parse.js';
import { makeEnv } from '../../tools/render-layout.js';
import { layoutDocument } from '../../core/layout/document.js';

const LH = 20;
const line = (y, text = 'text') => ({ x: 0, y, width: 300, runs: [{ kind: 'text', text }], overflow: false });
const text = (type, first, count, extra = {}) => ({
    type, lineHeight: LH, x: 0, width: 300, top: first, bottom: first + count * LH,
    lines: Array.from({ length: count }, (_, i) => line(first + i * LH, `${type[0]}${first / LH + i}`)), ...extra,
});
const rowsOf = (sheets) => sheets.map(s => s.items.filter(i => i.lines).flatMap(i => i.lines.map(l => l.text ?? l.runs[0].text)));

test('text fills a sheet and carries on to the next, with every line once and the y of each sheet starting at 0', () => {
    const blocks = [text('paragraph', 0, 12), text('paragraph', 13 * LH, 12)];
    const sheets = paginate(blocks, { height: 10 * LH });
    const all = rowsOf(sheets).flat();
    assert.equal(all.length, 24);
    assert.deepEqual(all, [...blocks[0].lines, ...blocks[1].lines].map(l => l.runs[0].text));
    for (const sheet of sheets) {
        assert.ok(sheet.height <= 10 * LH + 1e-6);
        const ys = sheet.items.flatMap(i => i.lines ?? []).map(l => l.y);
        assert.equal(Math.min(...ys), 0);
    }
});

test('a paragraph is never left with one line at the bottom of a sheet or one at the top of the next', () => {
    for (let lines = 2; lines <= 14; lines++) {
        for (let start = 0; start < 12; start++) {
            const blocks = [text('paragraph', start * LH, lines)];
            const sheets = paginate(blocks, { height: 12 * LH });
            const counts = sheets.map(s => s.items[0].lines.length);
            if (counts.length > 1) assert.ok(counts.every(n => n >= 2), `${lines} lines from ${start}: ${counts}`);
        }
    }
});

test('a short paragraph moves whole instead of splitting', () => {
    const blocks = [text('paragraph', 0, 8), text('paragraph', 9 * LH, 3)];
    const sheets = paginate(blocks, { height: 10 * LH });
    assert.equal(sheets.length, 2);
    assert.equal(sheets[1].items[0].lines.length, 3);
});

test('a heading goes to the next sheet with the first lines of what follows it', () => {
    const blocks = [text('paragraph', 0, 8), text('heading', 9 * LH, 1), text('paragraph', 10 * LH, 6)];
    const sheets = paginate(blocks, { height: 10 * LH });
    assert.equal(sheets.length, 2);
    assert.equal(sheets[1].items[0].type, 'heading', 'the heading starts the second sheet');
    assert.ok(sheets[0].items.every(i => i.type !== 'heading'));
});

test('a figure moves whole, with its caption', () => {
    const figure = { type: 'object', name: 'image', rect: { x: 0, y: 9 * LH, width: 200, height: 4 * LH }, caption: { y: 13 * LH, height: LH, lines: [line(13 * LH, 'cap')] } };
    const sheets = paginate([text('paragraph', 0, 8), figure, text('paragraph', 15 * LH, 4)], { height: 12 * LH });
    assert.equal(sheets.length, 2);
    assert.equal(sheets[1].items[0].type, 'object');
    assert.equal(sheets[1].items[0].rect.y, 0);
    assert.equal(sheets[1].items[0].caption.y, 4 * LH);
});

test('bullets and drop caps go with their text, and a quote rule is cut with the quote', () => {
    const paragraph = text('paragraph', 0, 14);
    const bullet = { type: 'bullet', text: '•', y: 0, x: -10, lineHeight: LH };
    const cap = { type: 'dropcap', letter: 'T', x: 0, y: 0, width: 40, height: 3 * LH, baseline: 2 * LH };
    const rule = { type: 'quote-rule', x: -8, y: 0, width: 1, height: 14 * LH };
    const sheets = paginate([bullet, cap, rule, paragraph], { height: 10 * LH });
    assert.equal(sheets.length, 2);
    assert.deepEqual(sheets[0].items.map(i => i.type), ['bullet', 'dropcap', 'quote-rule', 'paragraph']);
    assert.deepEqual(sheets[1].items.map(i => i.type), ['quote-rule', 'paragraph']);
    assert.ok(sheets[0].items[2].height <= 10 * LH && sheets[1].items[0].y === 0);
    assert.ok(Math.abs(sheets[0].items[2].height + sheets[1].items[0].height - 14 * LH) < LH + 1e-6);
});

test('the lines beside a drop cap stay together', () => {
    const paragraph = text('paragraph', 0, 12);
    const cap = { type: 'dropcap', letter: 'T', x: 0, y: 9 * LH, width: 40, height: 3 * LH, baseline: 11 * LH };
    paragraph.lines.forEach((l, i) => { l.y = (9 + i) * LH; });
    paragraph.top = 9 * LH;
    const sheets = paginate([text('paragraph', 0, 9), cap, paragraph], { height: 10 * LH });
    const first = sheets[1].items.find(i => i.type === 'paragraph');
    assert.ok(first.lines.length >= 3);
});

test('side by side cells are one band and a rule at the edge of a sheet is dropped', () => {
    const cellA = text('paragraph', 8 * LH, 2);
    const cellB = text('paragraph', 8 * LH, 3);
    const rule = { type: 'rule', x: 0, y: 11 * LH, width: 300, thickness: 1 };
    const sheets = paginate([text('paragraph', 0, 8), cellA, cellB, rule, text('paragraph', 12 * LH, 4)], { height: 11 * LH });
    assert.equal(sheets[0].items.filter(i => i.type === 'paragraph').length, 3, 'both cells and the text above are on the first sheet');
    assert.ok(sheets.every(s => s.items[0].type !== 'rule' && s.items.at(-1).type !== 'rule'));
});

test('a code block taller than a sheet is cut between lines, and the cut edges lose their padding', () => {
    const code = { type: 'code', lines: Array.from({ length: 30 }, (_, i) => `line ${i}`), lineHeight: LH, pad: 10, x: 0, y: 0, width: 300, height: 30 * LH + 20 };
    const sheets = paginate([code], { height: 12 * LH });
    assert.ok(sheets.length >= 3);
    assert.equal(sheets.flatMap(s => s.items[0].lines).length, 30);
    assert.equal(sheets[0].items[0].cutTop, false);
    assert.equal(sheets[0].items[0].cutBottom, true);
    assert.equal(sheets.at(-1).items[0].cutBottom, false);
    assert.ok(sheets.every(s => s.items[0].height <= 12 * LH + 1e-6));
});

test('the paper is Letter in the United States and A4 elsewhere', () => {
    assert.equal(paperFor('en-US'), PAPER.letter);
    assert.equal(paperFor('en-CA'), PAPER.letter);
    assert.equal(paperFor('en-GB'), PAPER.a4);
    assert.equal(paperFor('de-DE'), PAPER.a4);
    assert.equal(paperFor(''), PAPER.a4);
});

const card = (name) => readFileSync(new URL(`../../cards/${name}.md`, import.meta.url), 'utf8');
const lineText = (l) => l.runs.map(r => (r.kind === 'hyphen' ? '-' : r.text ?? '')).join('');

for (const paper of [PAPER.letter, PAPER.a4]) {
    test(`the long post prints on ${paper.name}: every line once, nothing taller than a sheet, no stranded lines`, () => {
        const printed = layoutPrint(parse(card('llms_for_bozos_1')), makeEnv(1280, { fontSize: 20, width: 32 }), paper);
        const { layout, sheets, room } = printed;
        assert.ok(sheets.length > 10 && sheets.length < 40, `${sheets.length} sheets`);

        const wanted = layout.blocks.filter(b => b.lines).flatMap(b => b.lines.filter(l => !l.overflow).map(lineText));
        const got = sheets.flatMap(s => s.items.filter(i => i.lines).flatMap(i => i.lines.map(lineText)));
        assert.deepEqual(got, wanted);

        for (const sheet of sheets) {
            assert.ok(sheet.height <= room + 1e-6, `a sheet ${sheet.height} tall`);
            for (const item of sheet.items.filter(i => i.lines)) {
                for (const l of item.lines) assert.ok(l.y >= -1e-6 && l.y + item.lineHeight <= room + 1e-6, 'text inside the sheet');
            }
        }

        // a paragraph that runs over a page break has two lines or more on each side
        const parts = new Map();
        sheets.forEach((sheet, k) => sheet.items.filter(i => i.type === 'paragraph' && i.node).forEach(i => {
            if (!parts.has(i.node)) parts.set(i.node, []);
            parts.get(i.node).push({ sheet: k, lines: i.lines.length });
        }));
        for (const [node, pieces] of parts) {
            const sheetsOf = new Set(pieces.map(p => p.sheet));
            if (sheetsOf.size > 1 && pieces.length === sheetsOf.size) assert.ok(pieces.every(p => p.lines >= 2), `paragraph at ${node.start}: ${JSON.stringify(pieces)}`);
        }

        // a heading is never the last thing on a sheet
        sheets.slice(0, -1).forEach((sheet, k) => {
            const last = sheet.items.filter(i => i.lines).at(-1);
            assert.notEqual(last?.type, 'heading', `sheet ${k} ends on a heading`);
        });
    });
}

test('on paper the text is one centred column, figures sit between paragraphs, and there is no contents box', () => {
    const printed = layoutPrint(parse(card('layout-test')), makeEnv(1280, { fontSize: 20, width: 32 }), PAPER.letter);
    const { layout, sheets } = printed;
    const column = layout.geometry.text;
    assert.ok(column.width <= SHEET.measure * SHEET.fontSize, 'no wider than the measure');
    assert.equal(Math.round(column.x * 2 + column.width), PAPER.letter.width);
    assert.ok(layout.blocks.every(b => b.type !== 'toc'));
    for (const sheet of sheets) {
        for (const item of sheet.items.filter(i => i.lines)) {
            for (const l of item.lines) assert.ok(l.x >= column.x - SHEET.fontSize && l.x + l.width <= column.x + column.width + SHEET.fontSize, 'text stays in the column');
        }
        const figures = sheet.items.filter(i => i.type === 'object');
        for (const figure of figures) {
            for (const item of sheet.items.filter(i => i.lines)) {
                for (const l of item.lines) {
                    const overlap = l.y < figure.rect.y + figure.rect.height && l.y + item.lineHeight > figure.rect.y;
                    assert.ok(!overlap, 'no text beside a figure');
                }
            }
        }
    }
});

test('a figure placed by hand is on its own line on paper, wherever it was nudged to on screen', () => {
    const page = (args) => `Before the figure.\n\n[[viz(type: umbrella, place: gutter, width: 265px, height: 358px${args})]]\n\nAfter the figure.\n`;
    const rectOf = (text) => {
        const { sheets } = layoutPrint(parse(text), makeEnv(1280, { fontSize: 20, width: 32 }), PAPER.letter);
        return sheets.flatMap(s => s.items).find(i => i.type === 'object').rect;
    };
    const plain = rectOf(page(''));
    assert.deepEqual(rectOf(page(', dy: 8.75em, dx: 4%')), plain);
    assert.equal(Math.round(plain.x * 2 + plain.width), PAPER.letter.width, 'centred on the sheet');
});

test('a page with no notes is set at the full measure, and one with notes gives up width to keep its margins', () => {
    const env = () => makeEnv(1280, { fontSize: 20, width: 32 });
    const plain = layoutPrint(parse('Some text with no note in it.\n'), env(), PAPER.letter).layout.geometry;
    assert.equal(Math.round(plain.text.width), SHEET.measure * SHEET.fontSize);
    assert.equal(plain.left.width, 0);
    const noted = layoutPrint(parse('Some text.[[note(right)]]{}{A note in the margin.}\n'), env(), PAPER.letter).layout.geometry;
    assert.ok(noted.text.width < plain.text.width);
    assert.ok(noted.right.width >= 140 && noted.left.width >= 140);
});

test('margin notes stay in the margins on paper, beside the line they belong to, inside the sheet and clear of each other', () => {
    for (const paper of [PAPER.letter, PAPER.a4]) {
        const printed = layoutPrint(parse(card('llms_for_bozos_1')), makeEnv(1280, { fontSize: 20, width: 32 }), paper);
        const { sheets, room, layout } = printed;
        const column = layout.geometry.text;
        const placed = sheets.flatMap(s => s.notes);
        assert.ok(placed.length >= 8, `${placed.length} notes in the margins`);
        sheets.forEach((sheet, k) => {
            for (const note of sheet.notes) {
                assert.ok(note.x >= 0 && note.x + note.width <= paper.width, `note ${k} inside the paper`);
                assert.ok(note.x + note.width <= column.x || note.x >= column.x + column.width, `note ${k} clear of the text`);
                assert.ok(note.y >= -1e-6 && note.y + note.height <= room + 1e-6, `note ${k} inside the sheet: ${note.y} to ${note.y + note.height} of ${room}`);
                assert.ok(note.anchor.y >= -1e-6 && note.anchor.y < room, 'its anchor line is on this sheet');
            }
            for (const side of ['left', 'right']) {
                const own = sheet.notes.filter(n => n.side === side).sort((a, b) => a.y - b.y);
                own.slice(1).forEach((n, i) => assert.ok(n.y >= own[i].y + own[i].height - 1e-6, `notes on sheet ${k} overlap`));
            }
        });
        // a note is where it was written: a note that fits sits next to its anchor
        const near = placed.filter(n => Math.abs(n.y - n.anchor.y) < 4 * layout.styles.lineHeight).length;
        assert.ok(near > placed.length / 2, `${near} of ${placed.length} notes are near their anchors`);
    }
});

test('a figure that keeps off paper is left out of the printed page and stays on the screen one', () => {
    const text = 'Before.\n\n[[viz(type: scatter, src: a.png, height: 300, place: full)]]\n\nAfter.\n';
    const env = makeEnv(1280, { fontSize: 20, width: 32 });
    const kept = { ...env, objects: { ...env.objects, onPaper: () => false } };
    assert.ok(layoutDocument(parse(text), kept).blocks.some(b => b.type === 'object'));
    assert.ok(!layoutPrint(parse(text), kept, PAPER.letter).layout.blocks.some(b => b.type === 'object'));
    assert.ok(layoutPrint(parse(text), env, PAPER.letter).layout.blocks.some(b => b.type === 'object'));
});
