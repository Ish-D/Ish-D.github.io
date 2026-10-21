import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDocument } from '../../core/layout/document.js';
import { makeEnv, parseCard, parseText, hyphenator } from './fixtures.js';

const textLines = (layout) => layout.blocks
    .filter(b => b.lines && !b.note && (b.type === 'paragraph' || b.type === 'heading'))
    .flatMap(b => b.lines.filter(l => !l.overflow).map(l => ({ block: b, line: l })));

const lineWidthOf = (line) => line.runs.reduce((w, r) => w + r.width, 0);

test('the published post lays out end to end at desktop width', () => {
    const doc = parseCard('llms_for_bozos_1');
    const layout = layoutDocument(doc, makeEnv(1280, { hyphenator }));
    assert.ok(layout.height > 3000, `height ${layout.height}`);
    assert.ok(layout.blocks.length > 100);
    assert.ok(layout.notes.length > 5, 'margin notes were placed');
    assert.equal(layout.geometry.narrow, false);
    const unknown = layout.diagnostics.filter(d => /No layout|Unknown/.test(d.message));
    assert.ok(unknown.length < 12, unknown.map(d => d.message).join('; '));
});

test('text lines stay inside the text column and never overflow their slot', () => {
    const layout = layoutDocument(parseCard('llms_for_bozos_1'), makeEnv(1280, { hyphenator }));
    const { text } = layout.geometry;
    for (const { block, line } of textLines(layout)) {
        if (block.cite) continue;
        assert.ok(line.x >= text.x - 1e-6, `x ${line.x} < ${text.x}`);
        assert.ok(line.x + line.width <= text.x + text.width + 1e-6);
        assert.ok(lineWidthOf(line) <= line.width + 1e-6, `line wider than slot: ${lineWidthOf(line)} > ${line.width}`);
    }
});

test('consecutive lines never overlap vertically within a block', () => {
    const layout = layoutDocument(parseCard('llms_for_bozos_1'), makeEnv(1280, { hyphenator }));
    for (const b of layout.blocks) {
        if (!b.lines) continue;
        for (let i = 1; i < b.lines.length; i++) {
            if (b.lines[i].overflow || b.lines[i - 1].overflow) continue;
            if (b.lines[i].column !== b.lines[i - 1].column) continue;
            assert.ok(b.lines[i].y >= b.lines[i - 1].y + b.lineHeight - 1e-6);
        }
    }
});

test('blocks flow downward: each text block starts below the previous one', () => {
    const layout = layoutDocument(parseCard('llms_for_bozos_1'), makeEnv(1280, { hyphenator }));
    const blocks = layout.blocks.filter(b => (b.type === 'paragraph' || b.type === 'heading') && !b.note && b.lines.length);
    let lastBottom = 0;
    for (const b of blocks) {
        if (b.x !== layout.geometry.text.x) continue;
        assert.ok(b.top >= lastBottom - 1e-6, `block at ${b.top} starts above ${lastBottom}`);
        lastBottom = b.bottom;
    }
});

test('margin notes do not overlap each other and sit in their strips', () => {
    const layout = layoutDocument(parseCard('llms_for_bozos_1'), makeEnv(1280, { hyphenator }));
    for (const side of ['left', 'right']) {
        const notes = layout.notes.filter(n => n.side === side).sort((a, b) => a.y - b.y);
        const strip = layout.geometry[side];
        for (let i = 0; i < notes.length; i++) {
            assert.ok(notes[i].x >= strip.x - 1e-6);
            assert.ok(notes[i].x + notes[i].width <= strip.x + strip.width + 1e-6);
            // flush against the text side of the strip
            if (side === 'left') assert.ok(Math.abs(notes[i].x + notes[i].width - (strip.x + strip.width)) < 1e-6);
            else assert.equal(notes[i].x, strip.x);
            if (i) assert.ok(notes[i].y >= notes[i - 1].y + notes[i - 1].height - 1e-6, `${side} notes overlap`);
        }
    }
});

test('notes stay near their anchors', () => {
    const layout = layoutDocument(parseCard('llms_for_bozos_1'), makeEnv(1280, { hyphenator }));
    const far = layout.notes.filter(n => Math.abs(n.y - n.anchor.y) > 28 * 14);
    assert.equal(far.length, 0);
});

test('at narrow widths every note is set inline and nothing lands in a margin', () => {
    const layout = layoutDocument(parseCard('llms_for_bozos_1'), makeEnv(420, { hyphenator }));
    assert.equal(layout.geometry.narrow, true);
    assert.equal(layout.notes.length, 0);
    for (const { line } of textLines(layout)) {
        assert.ok(line.x >= 16 - 1e-6 && line.x + line.width <= 420 - 16 + 1e-6);
    }
    const wide = layoutDocument(parseCard('llms_for_bozos_1'), makeEnv(1280, { hyphenator }));
    assert.ok(layout.height > wide.height, 'narrow page is taller');
});

test('a drop cap reserves space and the paragraph wraps beside it', () => {
    const doc = parseText('[[drop(I)]]n my time creating this site I found the above quote incredibly true. '.repeat(6));
    const layout = layoutDocument(doc, makeEnv(1000, { hyphenator }));
    const cap = layout.blocks.find(b => b.type === 'dropcap');
    assert.ok(cap);
    const para = layout.blocks.find(b => b.type === 'paragraph');
    const beside = para.lines.filter(l => l.y < cap.y + cap.height);
    assert.equal(beside.length, 3);
    assert.ok(beside.every(l => l.x >= cap.x + cap.width - 1e-6));
    assert.equal(para.lines[3].x, layout.geometry.text.x);
});

test('a circular float pushes lines aside; no line box crosses its padded circle', () => {
    const doc = parseText([
        '[[image(a.png, place: right, width: 200, height: 200, wrap: circle)]]',
        '',
        'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(8),
    ].join('\n'));
    const layout = layoutDocument(doc, makeEnv(1100, { hyphenator }));
    const obj = layout.blocks.find(b => b.type === 'object');
    assert.ok(obj);
    const cx = obj.rect.x + obj.rect.width / 2;
    const cy = obj.rect.y + obj.rect.height / 2;
    const r = obj.rect.width / 2;
    const para = layout.blocks.find(b => b.type === 'paragraph');
    let narrowed = 0;
    for (const l of para.lines) {
        const yMid = l.y + para.lineHeight / 2;
        if (Math.abs(yMid - cy) < r - 4) {
            narrowed++;
            assert.ok(l.x + l.width <= cx + 1e-6 || l.x >= cx, 'slot is on one side of the circle centre');
            const dy = Math.max(0, Math.min(Math.abs(l.y - cy), Math.abs(l.y + para.lineHeight - cy)));
            const half = Math.sqrt(Math.max(0, r * r - dy * dy));
            assert.ok(l.x + l.width <= cx - half + 1e-6, `line ends at ${l.x + l.width}, circle starts at ${cx - half}`);
        }
    }
    assert.ok(narrowed >= 5);
});

test('two columns balance and a gutter figure splits text around the seam', () => {
    const body = 'The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly. '.repeat(14);
    const doc = parseText([
        '[[columns(2, gap: 40)]]',
        '{',
        '[[image(a.png, place: gutter, width: 160, height: 160, wrap: ellipse)]]',
        body,
        '}',
    ].join('\n'));
    const layout = layoutDocument(doc, makeEnv(1300, { hyphenator }));
    const obj = layout.blocks.find(b => b.type === 'object');
    const para = layout.blocks.find(b => b.type === 'paragraph');
    const cols = new Set(para.lines.map(l => l.column));
    assert.deepEqual([...cols].sort(), [0, 1]);
    const left = para.lines.filter(l => l.column === 0);
    const right = para.lines.filter(l => l.column === 1);
    assert.ok(Math.abs(left.length - right.length) <= 3, `${left.length} vs ${right.length}`);
    const seam = obj.rect.x + obj.rect.width / 2;
    const touched = [...left, ...right].filter(l => l.y + para.lineHeight > obj.rect.y && l.y < obj.rect.y + obj.rect.height);
    assert.ok(touched.length >= 4);
    assert.ok(touched.some(l => l.column === 0 && l.x + l.width < seam - 8));
    assert.ok(touched.some(l => l.column === 1 && l.x > seam + 8));
});

test('full-bleed objects span the page and displace notes', () => {
    const doc = parseText([
        'Intro paragraph with a note[[note(right)]]{here}{A note that wants to sit beside the intro paragraph.} and more text.',
        '',
        '[[image(a.png, place: full, height: 200)]]',
        '',
        'After the figure.',
    ].join('\n'));
    const layout = layoutDocument(doc, makeEnv(1300, { hyphenator }));
    const obj = layout.blocks.find(b => b.type === 'object');
    assert.equal(obj.rect.x, 0);
    assert.equal(obj.rect.width, 1300);
    for (const n of layout.notes) assert.ok(n.y + n.height <= obj.rect.y + 1e-6 || n.y >= obj.rect.y + obj.rect.height - 1e-6);
});

test('a region being edited becomes one reserved slot and the rest reflows around it', () => {
    const src = '# Title\n\nFirst paragraph here.\n\nSecond paragraph here.\n\nThird.\n';
    const doc = parseText(src);
    const second = doc.children.find(c => c.type === 'paragraph' && src.slice(c.start, c.end).startsWith('Second'));
    const plain = layoutDocument(doc, makeEnv(1280, { hyphenator }));
    const editing = { start: second.start, end: second.end, height: 140 };
    const editLayout = layoutDocument(doc, makeEnv(1280, { hyphenator, editing }));
    const slot = editLayout.blocks.find(b => b.type === 'editor');
    assert.ok(slot);
    assert.equal(slot.height, 140);
    assert.deepEqual([slot.start, slot.end], [second.start, second.end]);
    assert.ok(!editLayout.blocks.some(b => b.type === 'paragraph' && b.node === second), 'edited block is not laid out');
    const third = (l) => l.blocks.filter(b => b.type === 'paragraph').at(-1);
    const slotBottom = slot.y + slot.height;
    assert.ok(third(editLayout).top >= slotBottom - 1e-6, 'the next block starts below the slot');
    assert.ok(third(editLayout).top > third(plain).top, 'the page grew to make room');
});

test('an empty region at a block boundary reserves a slot between blocks', () => {
    const src = 'One.\n\nTwo.\n';
    const doc = parseText(src);
    const at = src.indexOf('Two.');
    const layout = layoutDocument(doc, makeEnv(1280, { hyphenator, editing: { start: at, end: at, height: 60 } }));
    const kinds = layout.blocks.map(b => b.type);
    assert.deepEqual(kinds.filter(k => k === 'editor' || k === 'paragraph'), ['paragraph', 'editor', 'paragraph']);
});

test('editing a paragraph inside a note body reserves the slot in the margin', () => {
    const src = 'Text with a note[[note(right)]]{}{Note body text that is editable.} after.\n';
    const doc = parseText(src);
    const at = src.indexOf('Note body');
    const layout = layoutDocument(doc, makeEnv(1280, { hyphenator, editing: { start: at, end: at + 'Note body text that is editable.'.length, height: 90 } }));
    const noteWithSlot = layout.notes.find(n => n.items.some(i => i.type === 'editor'));
    assert.ok(noteWithSlot, 'the slot lives in the note');
    assert.ok(noteWithSlot.height >= 90);
    assert.ok(!layout.blocks.some(b => b.type === 'editor'));
});

test('generated blocks (tags, date, summary, contents) never receive an editor slot', () => {
    const doc = parseCard('llms_for_bozos_1');
    const src = doc.source;
    const target = doc.children.filter(c => c.type === 'paragraph' && c.end - c.start > 400)[3];
    const layout = layoutDocument(doc, makeEnv(1280, { hyphenator, editing: { start: target.start, end: target.end, height: 200 } }));
    const slots = layout.blocks.filter(b => b.type === 'editor');
    assert.equal(slots.length, 1);
    const plain = layoutDocument(doc, makeEnv(1280, { hyphenator }));
    const was = plain.blocks.find(b => b.type === 'paragraph' && b.node === target);
    assert.ok(Math.abs(slots[0].y - was.top) < 40, `slot at ${slots[0].y}, paragraph was at ${was.top}`);
    assert.ok(src.length > 0);
});

test('a vertical note is turned onto its strip and fits the strip width', () => {
    const body = 'A fairly long side remark that needs a few lines of sideways text to say what it means.';
    for (const side of ['left', 'right']) {
        const doc = parseText(`Text with a note[[note(${side}, orient: vertical)]]{here}{${body}} and more.\n`);
        const layout = layoutDocument(doc, makeEnv(1300, { hyphenator }));
        const note = layout.notes[0];
        assert.equal(note.rotate, side === 'left' ? -90 : 90);
        assert.ok(note.width <= layout.geometry[side].width + 1e-6);
        assert.ok(note.height >= 96);
        assert.equal(note.box.width, note.height);
        assert.equal(note.box.height, note.width);
    }
});

test('a pinned note sits at its page offset, and other notes keep clear of it', () => {
    const doc = parseText([
        'First[[note(right)]]{a}{Anchored near the top.} paragraph.',
        '',
        'Second[[note(right, type: absolute, pos: 30)]]{b}{Pinned.} paragraph.',
    ].join('\n'));
    const layout = layoutDocument(doc, makeEnv(1300, { hyphenator }));
    const pinned = layout.notes.find(n => n.items.some(i => i.lines?.some(l => l.runs.some(r => /Pinned/.test(r.text ?? '')))));
    assert.ok(pinned);
    const other = layout.notes.find(n => n !== pinned);
    assert.ok(other.y + other.height <= pinned.y + 1e-6 || other.y >= pinned.y + pinned.height - 1e-6);
});

test('maxh caps a note until it is expanded', () => {
    const long = 'word '.repeat(120);
    const doc = parseText(`Text[[note(right, maxh: 90px)]]{x}{${long}} more.\n`);
    const capped = layoutDocument(doc, makeEnv(1300, { hyphenator })).notes[0];
    assert.equal(capped.height, 90);
    assert.equal(capped.clipped, true);
    const note = doc.children[0].children.find(c => c.type === 'directive');
    const open = layoutDocument(doc, makeEnv(1300, { hyphenator, expandedNotes: new Set([note.start]) })).notes[0];
    assert.ok(open.height > 90);
    assert.equal(open.clipped, false);
    assert.equal(open.overflow, true);
});

test('anchors inside a note resolve to the note position', () => {
    const doc = parseText('Text[[note(right)]]{x}{[[anchor(inside)]]A note with a target.} more.\n');
    const layout = layoutDocument(doc, makeEnv(1300, { hyphenator }));
    const at = layout.anchors.get('inside');
    assert.ok(at, 'anchor missing');
    assert.ok(at.y >= layout.notes[0].y && at.y <= layout.notes[0].y + layout.notes[0].height);
});
