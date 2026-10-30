import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDocument, PAGE, COVER_FIT } from '../../core/layout/document.js';
import { COVER, TITLE } from '../../core/layout/style.js';
import { makeEnv, parseText, hyphenator, objects } from './fixtures.js';

// a drawing like October's: taller than wide, the type's corner a quarter of its width and half its height
const ROOM = [0.25, 0.54];
const ASPECT = 0.66;
const LINKS = '## [[link(about, display: "About")]]\n\n## [[link(writing, display: "Writing")]]\n\n## [[link(photography, display: "Photography")]]\n\n## [[link(tags, display: "Tags")]]\n';
const COVER_PAGE = `---\nname: ish\ncover: true\n---\n\n[[viz(type: october, place: cover)]]\n\n# ish\n\n${LINKS}`;

function lay(text, width, height, over = {}) {
    const fontSize = width < 600 ? 18 : 20;
    const cover = (node) => (node.args?.items.find(a => a.key === 'type')?.value === 'october' ? { room: ROOM, aspect: ASPECT } : null);
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

/** Checks a cover's drawing keeps clear of its type: under it, or beside it with the type in the drawing's empty corner. */
function clearOfType(layout, cover) {
    const { x, y, width: w, height: h } = cover.rect;
    const text = layout.geometry.text;
    for (const line of textLines(layout)) {
        assert.ok(line.right <= text.x + text.width + 0.5, 'the type keeps inside the column too');
        if (line.bottom <= y || line.top >= y + h || line.right <= x) continue;
        assert.ok(line.right <= x + ROOM[0] * w && line.bottom <= y + ROOM[1] * h, 'every line of type is in the drawing\'s empty corner');
    }
}

for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]]) {
    test(`at ${width} by ${height} the drawing stands beside the type, with the type in its corner, and nothing scrolls`, () => {
        const layout = lay(COVER_PAGE, width, height);
        const { cover, typeFoot, fits } = parts(layout, height);
        const { x, y, width: w, height: h } = cover.rect;
        const text = layout.geometry.text;
        assert.ok(y < typeFoot, 'beside the type, not under it');
        assert.ok(x >= text.x - 0.5 && x + w <= text.x + text.width + 0.5, 'inside the text column');
        assert.ok(y >= PAGE.topPad - 0.5 && y + h <= height - COVER_FIT.bottom + 0.5, 'on the first screen');
        assert.ok(fits, 'the page is no taller than the screen');
        assert.ok(Math.abs(w / h - ASPECT) < 1e-9, 'in its own shape');
        clearOfType(layout, cover);
    });
}

for (const [width, height] of [[390, 844], [360, 740], [430, 932], [320, 640]]) {
    test(`on a ${width} by ${height} phone the drawing stands with the type, clear of it, and nothing scrolls`, () => {
        const layout = lay(COVER_PAGE, width, height);
        const { cover, fits } = parts(layout, height);
        const { x, y, width: w, height: h } = cover.rect;
        const text = layout.geometry.text;
        clearOfType(layout, cover);
        assert.ok(x >= text.x - 0.5 && x + w <= text.x + text.width + 0.5, 'inside the column');
        assert.ok(y + h <= height - COVER_FIT.bottom + 0.5 && fits, 'on the first screen');
        assert.ok(Math.abs(w / h - ASPECT) < 1e-9);
    });
}

test('on paper a cover is set as any page is, its drawing leading it', () => {
    const layout = lay(COVER_PAGE, 600, 800, { print: { notes: false }, settings: { fontSize: 15, titleScale: 2.4 } });
    assert.equal(layout.styles.heading[1].font.size, 15 * 2.4);
    assert.equal(layout.blocks.find(b => b.type === 'object').place.kind, 'block');
});
