import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDocument, PAGE } from '../../core/layout/document.js';
import { makeEnv, parseCard, parseText, hyphenator } from './fixtures.js';

// table cells are padded inside their rows; the table as a whole starts and ends on the grid
const lines = (layout) => layout.blocks
    .filter(b => b.lines && !b.note && !b.tocId && b.node?.type !== 'table' && (b.type === 'paragraph' || b.type === 'heading'))
    .flatMap(b => b.lines.filter(l => !l.overflow).map(l => ({ y: l.y, lineHeight: b.lineHeight, type: b.type })));

const onGrid = (y) => Math.abs(((y - PAGE.topPad) / 28) - Math.round((y - PAGE.topPad) / 28)) < 1e-6;

test('every line of body text sits on one grid of 28px lines, in the post and in the two-column test page', () => {
    for (const name of ['llms_for_bozos_1', 'layout-test', 'lab', 'about']) {
        const layout = layoutDocument(parseCard(name), makeEnv(1280, { hyphenator }));
        const off = lines(layout).filter(l => l.lineHeight % 28 === 0 && !onGrid(l.y));
        assert.equal(off.length, 0, `${name}: ${off.length} lines off the grid, first at y ${off[0]?.y}`);
    }
});

test('a heading, a figure, a list, a quote, a code block and a table leave the text back on the grid', () => {
    const src = [
        '## A heading', '', 'First paragraph, long enough to take more than one line when it is set in a narrow column of text like this.', '',
        '[[image(a.png, place: block, width: 200, height: 77)]]', '', 'After the figure.', '',
        '- one', '- two', '', 'After the list.', '',
        '> quoted words', '', 'After the quote.', '',
        '```', 'code', 'more', '```', '', 'After the code.', '',
        '| a | b |', '| - | - |', '| 1 | 2 |', '', 'After the table.', '',
        '---', '', 'After the rule.', '',
    ].join('\n');
    const layout = layoutDocument(parseText(src), makeEnv(700, { hyphenator }));
    const text = lines(layout);
    assert.ok(text.length > 8);
    assert.deepEqual(text.filter(l => !onGrid(l.y)), []);
});

test('paragraphs are a blank line apart and are not indented, even when they start with a tab', () => {
    const layout = layoutDocument(parseText('[[tab]] First paragraph here.\n\nSecond paragraph here.\n'), makeEnv(1280, { hyphenator }));
    const [a, b] = layout.blocks.filter(x => x.type === 'paragraph');
    assert.equal(b.lines[0].y - a.lines[0].y, 2 * 28);
    assert.equal(a.lines[0].x, layout.geometry.text.x);
    assert.equal(a.lines[0].runs[0].text.startsWith(' '), false);
});

test('a heading takes whole lines and the text that follows it starts straight below', () => {
    const layout = layoutDocument(parseText('## Heading\n\nBody text.\n'), makeEnv(1280, { hyphenator }));
    const heading = layout.blocks.find(x => x.type === 'heading');
    const body = layout.blocks.find(x => x.type === 'paragraph');
    assert.equal(heading.lineHeight, 56);
    assert.equal(body.lines[0].y, heading.lines[0].y + 56);
});
