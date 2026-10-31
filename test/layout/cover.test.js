import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDocument, PAGE, COVER_FIT } from '../../core/layout/document.js';
import { COVER, TITLE } from '../../core/layout/style.js';
import { makeEnv, parseText, hyphenator, objects } from './fixtures.js';

// a drawing like October's, taller than wide: the type's corner a quarter of its width and half its height as drawn;
// for a phone half its width, narrower beside the type's top lines, or plain
const ROOMS = [[[0.25, 0.54]], [[0.34, 0.28], [0.5, 0.57]], [[0.5, 0.57]]];
const ASPECT = 0.66;
const LINKS = '## [[link(about, display: "About")]]\n\n## [[link(writing, display: "Writing")]]\n\n## [[link(photography, display: "Photography")]]\n\n## [[link(tags, display: "Tags")]]\n';
const COVER_PAGE = `---\nname: ish\ncover: true\n---\n\n[[viz(type: october, place: cover)]]\n\n# ish\n\n${LINKS}`;

function lay(text, width, height, over = {}) {
    const fontSize = width < 600 ? 18 : 20;
    const cover = (node) => (node.args?.items.find(a => a.key === 'type')?.value === 'october' ? { rooms: ROOMS, aspect: ASPECT } : null);
    return layoutDocument(parseText(text), makeEnv(width, { hyphenator, settings: { fontSize }, viewportHeight: height, objects: { ...objects, cover }, ...over }));
}

const textLines = (layout) => layout.blocks
    .filter(b => (b.type === 'heading' || b.type === 'paragraph') && b.lines)
    .flatMap(b => b.lines.filter(l => !l.overflow).map(l => ({ top: l.y, bottom: l.y + b.lineHeight, right: l.x + l.hung.left + l.natural })));

/** The drawing, the foot of the type, and whether the whole page is on the first screen. */
function parts(layout, height) {
    const cover = layout.blocks.find(b => b.type === 'object');
    const typeFoot = Math.max(...layout.blocks.filter(b => b.type === 'heading').map(b => b.bottom));
    return { cover, typeFoot, fits: layout.height <= height + 0.5 };
}

test('a cover sets its title and the headings under it large, and a page that is not one keeps its usual type', () => {
    const cover = lay(COVER_PAGE, 1280, 800);
    assert.equal(cover.styles.heading[1].font.size, 20 * COVER.title.desktop);
    assert.equal(cover.styles.heading[2].font.size, 20 * COVER.heading.desktop);
    const plain = lay(COVER_PAGE.replace('cover: true\n', ''), 1280, 800);
    assert.equal(plain.styles.heading[1].font.size, 20 * TITLE.desktop);
    assert.equal(plain.styles.heading[2].font.size, 20 * 1.6);
});

/** Checks a cover's drawing keeps clear of its type: under it, or beside it with every line in the steps of its corner. */
function clearOfType(layout, cover) {
    const { x, y, width: w, height: h } = cover.rect;
    const steps = cover.room == null ? [[0, 1]] : ROOMS[cover.room];
    const text = layout.geometry.text;
    for (const line of textLines(layout)) {
        assert.ok(line.right <= text.x + text.width + 0.5, 'the type keeps inside the column too');
        if (line.bottom <= y || line.top >= y + h || line.right <= x) continue;
        let from = y;
        for (const [sx, sy] of steps) {
            const to = y + sy * h;
            if (line.top < to && line.bottom > from) assert.ok(line.right <= x + sx * w + 0.5, 'every line of type is in the drawing\'s empty corner');
            from = to;
        }
        assert.ok(line.bottom <= from + 0.5, 'and above its foot');
    }
}

for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]]) {
    test(`at ${width} by ${height} the drawing stands beside the type, with the type in its corner, and nothing scrolls`, () => {
        const layout = lay(COVER_PAGE, width, height);
        const { cover, typeFoot, fits } = parts(layout, height);
        const { x, y, width: w, height: h } = cover.rect;
        const text = layout.geometry.text;
        assert.ok(y < typeFoot, 'beside the type, not under it');
        // with whichever corner lets it stand largest, the drawing as drawn where they come to the same
        const alone = ROOMS.map(room => parts(lay(COVER_PAGE, width, height, { objects: { ...objects, cover: () => ({ rooms: [room], aspect: ASPECT }) } }), height).cover.rect.width);
        const largest = Math.max(...alone);
        assert.equal(cover.room, alone.findIndex(w => w > largest - 0.5));
        assert.ok(Math.abs(w - largest) < 0.5, 'as large as the largest');
        assert.ok(x >= text.x - 0.5 && x + w <= text.x + text.width + 0.5, 'inside the text column');
        assert.ok(y >= PAGE.topPad - 0.5 && y + h <= height - COVER_FIT.bottom + 0.5, 'on the first screen');
        assert.ok(fits, 'the page is no taller than the screen');
        assert.ok(Math.abs(w / h - ASPECT) < 1e-9, 'in its own shape');
        clearOfType(layout, cover);
    });
}

for (const [width, height] of [[390, 844], [393, 660], [375, 667], [360, 740], [430, 932]]) {
    test(`on a ${width} by ${height} phone the drawing spans the column beside the type, which stands in its narrower phone corner, and nothing scrolls`, () => {
        const layout = lay(COVER_PAGE, width, height);
        const { cover, typeFoot, fits } = parts(layout, height);
        const { x, y, width: w, height: h } = cover.rect;
        const text = layout.geometry.text;
        assert.equal(cover.room, 1);
        assert.ok(y < typeFoot, 'beside the type, not under it');
        assert.ok(Math.abs(x - text.x) < 0.5 && Math.abs(w - text.width) < 0.5, 'as wide as the column');
        assert.ok(y + h <= height - COVER_FIT.bottom + 0.5 && fits, 'on the first screen');
        assert.ok(Math.abs(w / h - ASPECT) < 1e-9);
        clearOfType(layout, cover);
    });
}

test('a top line too long for the narrower step stands the type in the plain phone corner, the drawing as wide', () => {
    const layout = lay(COVER_PAGE.replace('display: "Writing"', 'display: "Writing too"'), 393, 660);
    const { cover, fits } = parts(layout, 660);
    const text = layout.geometry.text;
    assert.equal(cover.room, 2);
    assert.ok(Math.abs(cover.rect.width - text.width) < 0.5 && fits);
    clearOfType(layout, cover);
});

test('on a phone too narrow for the type beside the drawing, the drawing stands under the type, clear of it, and nothing scrolls', () => {
    const layout = lay(COVER_PAGE, 320, 640);
    const { cover, typeFoot, fits } = parts(layout, 640);
    const text = layout.geometry.text;
    assert.equal(cover.room, null);
    assert.ok(cover.rect.y >= typeFoot, 'under the type');
    assert.ok(cover.rect.x >= text.x - 0.5 && cover.rect.x + cover.rect.width <= text.x + text.width + 0.5, 'inside the column');
    assert.ok(fits);
    clearOfType(layout, cover);
});

test('on paper a cover is set as any page is, its drawing leading it', () => {
    const layout = lay(COVER_PAGE, 600, 800, { print: { notes: false }, settings: { fontSize: 15, titleScale: 2.4 } });
    assert.equal(layout.styles.heading[1].font.size, 15 * 2.4);
    assert.equal(layout.blocks.find(b => b.type === 'object').place.kind, 'block');
});
