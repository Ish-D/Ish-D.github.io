import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typographicText, typographicSpans } from '../../core/text/punctuation.js';
import { layoutParagraph } from '../../core/layout/paragraph.js';
import { slotStream, createSlotCursor } from '../../core/layout/slots.js';

const font = { family: 'Test', size: 10 };
const text = (t, extra = {}) => ({ kind: 'text', text: t, font, ...extra });

test('double quotes open at the start and after space or a bracket, and close elsewhere', () => {
    assert.equal(typographicText('"Hello," she said, "it works."'), '“Hello,” she said, “it works.”');
    assert.equal(typographicText('("quoted")'), '(“quoted”)');
    assert.equal(typographicText('a "b" c'), 'a “b” c');
});

test('apostrophes close, single quotes open after space, elisions stay closed', () => {
    assert.equal(typographicText("it's the users' choice"), 'it’s the users’ choice');
    assert.equal(typographicText("he said 'hi' twice"), 'he said ‘hi’ twice');
    assert.equal(typographicText("the '90s and 'tis"), 'the ’90s and ’tis');
    assert.equal(typographicText('"nested \'quote\' here"'), '“nested ‘quote’ here”');
});

test('a quote is read in the context of the text before it, across spans', () => {
    const out = typographicSpans([text('He said '), text('"'), text('folds', { ref: { node: 1 } }), text('" twice')]);
    assert.deepEqual(out.map(s => s.text), ['He said ', '“', 'folds', '” twice']);
    assert.equal(out[2].ref.node, 1);
});

test('a quote at the start of a paragraph opens, and one after an atom closes', () => {
    assert.equal(typographicSpans([text('"go')])[0].text, '“go');
    const out = typographicSpans([{ kind: 'atom', width: 5, height: 5 }, text('"')]);
    assert.equal(out[1].text, '”');
});

test('markers do not change what a quote follows', () => {
    const out = typographicSpans([text('a '), { kind: 'marker' }, text('"b"')]);
    assert.equal(out[2].text, '“b”');
});

test('code is left as typed', () => {
    const out = typographicSpans([text('say '), text('"hi"... --x', { ref: { code: true } }), text(' "ok"')]);
    assert.equal(out[1].text, '"hi"... --x');
    assert.equal(out[2].text, ' “ok”');
});

test('three dots become an ellipsis; longer runs are left alone', () => {
    assert.equal(typographicText('wait... what'), 'wait… what');
    assert.equal(typographicText('so.....'), 'so.....');
});

test('spaced and numeric double hyphens become an en dash, triple an em dash, flags stay', () => {
    assert.equal(typographicText('a -- b'), 'a – b');
    assert.equal(typographicText('pages 3--9'), 'pages 3–9');
    assert.equal(typographicText('one---two'), 'one—two');
    assert.equal(typographicText('run --help now'), 'run --help now');
    assert.equal(typographicText('a--b'), 'a--b');
});

test('text with nothing to change is returned as the same span', () => {
    const span = text('plain words');
    assert.equal(typographicSpans([span])[0], span);
});

test('a laid-out paragraph carries the curly text and the spans it was set from', () => {
    const measurer = {
        width: (t) => [...t].length * 5,
        metrics: () => ({ ascent: 8, descent: 2, xHeight: 5, capHeight: 7, spaceWidth: 5 }),
    };
    const stream = slotStream(createSlotCursor({ columns: [{ x: 0, width: 400, top: 0, bottom: Infinity }], lineHeight: 12, minSlot: 0 }));
    const result = layoutParagraph([text('He said "no" and it\'s fine.')], { measurer }, stream);
    const line = result.lines.map(l => l.runs.map(r => r.text).join('')).join(' ');
    assert.equal(line, 'He said “no” and it’s fine.');
    assert.equal(result.spans[0].text, 'He said “no” and it’s fine.');
});
