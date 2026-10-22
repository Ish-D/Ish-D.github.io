import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutParagraph } from '../../core/layout/paragraph.js';
import { createSlotCursor, slotStream } from '../../core/layout/slots.js';
import { circle, rect } from '../../core/layout/geometry.js';

const font = { family: 'Test', size: 10 };
const measurer = {
    width: (text) => [...text].length * 5,
    metrics: () => ({ ascent: 8, descent: 2, xHeight: 5, capHeight: 7, spaceWidth: 5 }),
};
const text = (t, extra = {}) => ({ kind: 'text', text: t, font, ...extra });
const hyphenator = {
    points(word) {
        const out = [];
        for (let i = 3; i <= word.length - 3; i += 3) out.push(i);
        return out;
    },
};
const ctx = { measurer, hyphenator };

const LOREM = 'It is a truism that typographic quality depends on the evenness of color across a page, '
    + 'and that nothing disturbs color more than loose lines followed by tight ones, so the optimizer '
    + 'trades a little tightness here for a little looseness there until every line looks alike.';

function stream({ x = 0, width = 200, shapes = [], bottom = Infinity, lineHeight = 14, minSlot = 0 } = {}) {
    const columns = [{ x, width, top: 0, bottom }];
    return slotStream(createSlotCursor({ columns, lineHeight, shapes, minSlot }), columns);
}

const rebuild = (lines) => {
    let out = '';
    for (const line of lines) {
        const t = line.runs.map(r => r.text ?? '').join('');
        if (line.hyphenated) out += t.slice(0, -1);
        else out += t + ' ';
    }
    return out.trim();
};

test('justified lines fill the slot exactly except the last', () => {
    const { lines, result } = layoutParagraph([text(LOREM)], ctx, stream(), { uniform: true, raggedBelow: 0 });
    assert.ok(lines.length > 4);
    for (const line of lines.slice(0, -1)) {
        const stretchable = line.runs.reduce((n, r) => n + (r.wordSpacing ? 1 : 0), 0);
        assert.ok(stretchable >= 0);
        const total = line.runs.reduce((w, r) => w + r.width, 0);
        assert.ok(Math.abs(total - line.width) < 1e-6 || line.ratio === -1 || line.ratio === 3,
            `line width ${total} vs slot ${line.width}`);
    }
    assert.ok(lines.at(-1).natural <= lines.at(-1).width);
    assert.ok(['pretolerance', 'tolerance'].includes(result.pass));
});

test('line text reassembles to the source', () => {
    const { lines } = layoutParagraph([text(LOREM)], ctx, stream(), { uniform: true });
    assert.equal(rebuild(lines).replace(/\s+/g, ' '), LOREM);
});

test('lines are stacked by slot y and start at the slot x', () => {
    const { lines } = layoutParagraph([text(LOREM)], ctx, stream({ x: 30 }), { uniform: true });
    lines.forEach((l, i) => {
        assert.equal(l.y, i * 14);
        assert.equal(l.x, 30);
        assert.equal(l.width, 200);
    });
});

test('hyphenated lines end with a hyphen run', () => {
    const narrow = layoutParagraph([text(LOREM)], ctx, stream({ width: 90 }), {});
    const hyphenated = narrow.lines.filter(l => l.hyphenated);
    assert.ok(hyphenated.length > 0, 'a narrow measure should need hyphens');
    for (const l of hyphenated) {
        const last = l.runs.at(-1);
        assert.equal(last.kind, 'hyphen');
        assert.equal(last.text, '-');
    }
    assert.equal(rebuild(narrow.lines).replace(/\s+/g, ' '), LOREM);
});

test('first-line indent shifts and narrows only the first line', () => {
    const { lines } = layoutParagraph([text(LOREM)], ctx, stream(), { indent: 20, uniform: true });
    assert.equal(lines[0].x, 20);
    assert.equal(lines[1].x, 0);
    const total0 = lines[0].runs.reduce((w, r) => w + r.width, 0);
    assert.ok(total0 <= 180 + 1e-6);
});

test('lines flow around a circle: slots narrow beside it and sit on its right', () => {
    const shapes = [circle(60, 50, 40, 6)];
    const { lines } = layoutParagraph([text(LOREM + ' ' + LOREM)], ctx, stream({ shapes, minSlot: 40 }), {});
    const beside = lines.filter(l => l.y >= 28 && l.y <= 70);
    assert.ok(beside.length >= 3);
    assert.ok(beside.every(l => l.x >= 60 || l.x + l.width <= 60));
    assert.ok(beside.some(l => l.width < 200));
    const total = (l) => l.runs.reduce((w, r) => w + r.width, 0);
    for (const l of lines) assert.ok(total(l) <= l.width + 1e-6, `${total(l)} > ${l.width}`);
});

test('markers land on the line holding the following word, with an x offset', () => {
    const spans = [text('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi '),
        { kind: 'marker', ref: 'here' }, text('rho sigma tau upsilon')];
    const { lines } = layoutParagraph(spans, ctx, stream({ width: 120 }), { uniform: true });
    const hits = lines.filter(l => l.markers.some(m => m.ref === 'here'));
    assert.equal(hits.length, 1);
    const line = hits[0];
    const joined = line.runs.map(r => r.text ?? '').join('');
    assert.ok(joined.includes('rho') || joined.endsWith('pi ') || joined.trimEnd().endsWith('pi'), joined);
    const marker = line.markers[0];
    assert.ok(marker.x >= 0 && marker.x <= line.width + 1e-6);
});

test('ragged text keeps natural spacing and supports alignment', () => {
    const left = layoutParagraph([text(LOREM)], ctx, stream(), { align: 'left', uniform: true });
    assert.ok(left.lines.every(l => l.ratio === 0));
    assert.ok(left.lines.every(l => l.runs.every(r => !r.wordSpacing)));
    const centered = layoutParagraph([text(LOREM)], ctx, stream(), { align: 'center', uniform: true });
    const l = centered.lines.find(x => x.x > 10);
    assert.ok(l && l.x > 0);
    const right = layoutParagraph([text(LOREM)], ctx, stream(), { align: 'right', uniform: true });
    const r = right.lines.find(x => x.x > 10);
    assert.ok(r && Math.abs(r.x + r.natural - 200) < 1e-6, 'right-aligned content ends at the slot edge');
});

test('a column that is too short marks the extra lines as overflow', () => {
    const { lines, overflow } = layoutParagraph([text(LOREM)], ctx, stream({ bottom: 14 * 3 }), {});
    assert.ok(overflow > 0);
    assert.equal(lines.filter(l => !l.overflow).length, 3);
});

test('an empty paragraph produces no lines', () => {
    assert.deepEqual(layoutParagraph([text('   ')], ctx, stream(), {}).lines, []);
});

test('justified text sets lines in narrow slots ragged and the rest flush', () => {
    const shapes = [circle(100, 70, 55, 8)];
    const wide = layoutParagraph([text(LOREM + ' ' + LOREM)], ctx, stream({ width: 400, shapes, minSlot: 40 }), {});
    const narrowLines = wide.lines.filter(l => l.width < 10 * 10);
    assert.ok(narrowLines.length >= 2, 'the circle should leave narrow slots');
    assert.ok(narrowLines.every(l => l.ratio <= 0), 'no stretching in narrow slots');
    assert.ok(narrowLines.every(l => l.runs.every(r => !r.wordSpacing || r.wordSpacing < 0)));
    const full = wide.lines.filter(l => l.width >= 10 * 10 && !l.last);
    assert.ok(full.length > 2);
    assert.ok(full.some(l => l.ratio > 0), 'ordinary lines are still justified');
});

test('lineStretch may be a function of the line index', () => {
    const items = randomItems();
    const constant = breakLines(items, 100, { lineStretch: 0 });
    const asFunction = breakLines(items, 100, { lineStretch: () => 0 });
    assert.deepEqual(constant.breaks.map(b => b.index), asFunction.breaks.map(b => b.index));
});

import { breakLines, box, glue, finishParagraph } from '../../core/text/kp.js';
function randomItems() {
    const out = [];
    for (let i = 0; i < 40; i++) { out.push(box(10 + (i * 7) % 23)); if (i < 39) out.push(glue(5, 3, 2)); }
    return finishParagraph(out);
}

test('a hyphen at the end of a justified line stands in the margin', () => {
    const { lines } = layoutParagraph([text(LOREM)], ctx, stream(), { uniform: true, raggedBelow: 0, hang: 'both' });
    const hyphenated = lines.filter(l => l.hyphenated);
    assert.ok(hyphenated.length > 0);
    for (const line of hyphenated) {
        assert.equal(line.hung.right, 5, 'the whole hyphen hangs');
        assert.equal(line.x + line.hung.left, 0);
        assert.equal(line.width, 200 + line.hung.left + line.hung.right);
    }
    assert.equal(rebuild(lines), LOREM);
    const plain = layoutParagraph([text(LOREM)], ctx, stream(), { uniform: true }).lines;
    assert.ok(plain.every(l => l.hung.left === 0 && l.hung.right === 0 && l.x === 0 && l.width === 200), 'nothing hangs unless asked');
});

test('a closing comma or full stop hangs too, and the last line hangs nothing on the right', () => {
    const { lines } = layoutParagraph([text('Words, then more words, and so on, until, at the very end, a full stop.')], ctx, stream({ width: 120 }), { hang: 'both' });
    for (const line of lines) {
        const shown = line.runs.map(r => r.text ?? '').join('');
        const expected = /[.,]$/.test(shown) && !line.last ? 5 : 0;
        if (!line.hyphenated) assert.equal(line.hung.right, expected, shown);
    }
    assert.equal(lines.at(-1).hung.right, 0);
});

test('an opening quote at the start of a line hangs on the left, and the markers keep their place in the text', () => {
    const marker = { kind: 'marker', ref: { type: 'anchor', id: 'm' } };
    const { lines } = layoutParagraph([marker, text('“Quoted words fill this line out and then wrap onto the next one.”')], ctx, stream({ width: 120 }), { hang: 'both' });
    assert.equal(lines[0].hung.left, 5);
    assert.equal(lines[0].x, -5);
    assert.equal(lines[0].markers[0].x, 5, 'the marker sits where the text starts, not where the line does');
    assert.equal(lines[1].hung.left, 0);
});

test('text set flush left hangs its left edge only', () => {
    const { lines } = layoutParagraph([text('“Quoted words fill this line out and then wrap, wrap, wrap, onto the next one.”')], ctx, stream({ width: 120 }), { align: 'left', hang: 'left' });
    assert.equal(lines[0].hung.left, 5);
    assert.ok(lines.every(l => l.hung.right === 0));
});

test('a slot that does not reach the edge of its column hangs nothing there', () => {
    // a figure takes the left of the column, so the lines start beside it, not at the column edge
    const { lines } = layoutParagraph([text('“Quoted words fill this line out and then wrap, wrap, wrap, wrap, wrap, wrap onto the next one.”')], ctx,
        stream({ width: 200, shapes: [rect(0, 0, 60, 28, 0)] }), { hang: 'both' });
    assert.ok(lines[0].x >= 60, 'the first line starts beside the figure');
    assert.equal(lines[0].hung.left, 0);
    assert.equal(lines[0].hung.right > 0 || !/[-.,]$/.test(lines[0].runs.map(r => r.text ?? '').join('')), true);
});

test('code and addresses keep their edges', () => {
    const { lines } = layoutParagraph([text('“code', { noHyphen: true }), text(' and words')], ctx, stream({ width: 200 }), { hang: 'both' });
    assert.equal(lines[0].hung.left, 0);
});

test('a column under 30 em is set ragged, and a wider one is justified', () => {
    // the test font is 10 px, so 30 em is 300 px
    const narrow = layoutParagraph([text(LOREM)], ctx, stream({ width: 280 }), { uniform: true }).lines;
    assert.ok(narrow.slice(0, -1).every(l => l.ratio <= 0), 'no space is stretched');
    assert.ok(narrow.slice(0, -1).some(l => l.natural < l.width - 3), 'the right edge is ragged');
    const wide = layoutParagraph([text(LOREM)], ctx, stream({ width: 400 }), { uniform: true }).lines;
    assert.ok(wide.slice(0, -1).some(l => l.ratio > 0), 'spaces are stretched to fill the line');
    assert.ok(wide.slice(0, -1).every(l => Math.abs(l.runs.reduce((w, r) => w + r.width, 0) - l.width) < 1e-6 || l.ratio === -1 || l.ratio === 3));
});

test('in a wide column only a slot narrower than 22 em beside a figure is set ragged', () => {
    const lines = layoutParagraph([text(LOREM + ' ' + LOREM)], ctx, stream({ width: 400, shapes: [rect(150, 0, 250, 56, 0)] }), {}).lines;
    const beside = lines.filter(l => l.width < 220);
    const full = lines.filter(l => l.width >= 399 && !l.last);
    assert.ok(beside.length >= 3 && full.length >= 3);
    assert.ok(beside.every(l => l.ratio <= 0), 'the narrow slot beside the figure is ragged');
    assert.ok(full.some(l => l.ratio > 0), 'the full lines are justified');
});

test('the last word of a paragraph is not split, so the last line is never the tail of a word', () => {
    for (const width of [200, 210, 220, 230]) {
        const { lines } = layoutParagraph([text(LOREM + ' and internationalization')], ctx, stream({ width }), { raggedBelow: 0 });
        assert.ok(!lines.at(-2).hyphenated, `no hyphen before the last line at ${width}`);
        assert.ok(lines.at(-1).runs.map(r => r.text ?? '').join('').trim().split(' ').length >= 2, `two words on the last line at ${width}`);
    }
});

test('an address with no spaces breaks after a slash instead of overflowing', () => {
    const url = 'https://www.example.com/docs/en/overview/getting-started/installation.html';
    const { lines, overflow } = layoutParagraph([text(url, { noHyphen: true })], ctx, stream({ width: 200 }), { raggedBelow: 0 });
    assert.equal(overflow, 0);
    assert.ok(lines.length > 1, 'the address is split over lines');
    assert.ok(lines.every(l => !l.hyphenated), 'with no hyphen added');
    assert.equal(lines.map(l => l.runs.map(r => r.text ?? '').join('')).join(''), url);
    for (const l of lines) assert.ok(l.natural <= l.width + 1e-6, `${l.natural} wider than ${l.width}`);
});
