import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenType } from '../../core/text/otf.js';
import { createOtfMeasurer } from '../../core/text/otf-measurer.js';

// A small font built in memory, covering the layout paths the repo fonts don't use: GSUB
// ligatures via Extension lookups, PairPos format 2 with ClassDefs and Coverage format 2, GPOS
// Extension lookups, GDEF classes and mark filters, and cmap format 12.

const u16 = v => [(v >> 8) & 0xff, v & 0xff];
const i16 = v => u16(v & 0xffff);
const u32 = v => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const tag = s => [...s].map(c => c.charCodeAt(0));

/**
 * Items are byte arrays or { off16 | off32: Item[] } children; children follow the header and
 * offsets are relative to the start of this node.
 */
function serialize(items) {
    let at = 0;
    for (const item of items) at += Array.isArray(item) ? item.length : item.off16 ? 2 : 4;
    const out = [];
    const children = [];
    for (const item of items) {
        if (Array.isArray(item)) {
            out.push(...item);
            continue;
        }
        const bytes = serialize(item.off16 ?? item.off32);
        out.push(...(item.off16 ? u16(at) : u32(at)));
        children.push(bytes);
        at += bytes.length;
    }
    for (const child of children) out.push(...child);
    return out;
}

const coverage1 = glyphs => [u16(1), u16(glyphs.length), ...glyphs.map(u16)];
const coverage2 = ranges => [u16(2), u16(ranges.length), ...ranges.map(r => r.flatMap(u16))];
const classDef1 = (start, classes) => [u16(1), u16(start), u16(classes.length), ...classes.map(u16)];
const classDef2 = ranges => [u16(2), u16(ranges.length), ...ranges.map(r => r.flatMap(u16))];
const lookup = (type, flag, subtables, markSet = 0) => [
    u16(type), u16(flag), u16(subtables.length), ...subtables.map(s => ({ off16: s })), ...(flag & 0x10 ? [u16(markSet)] : []),
];
const extension = (type, subtable) => [u16(1), u16(type), { off32: subtable }];

/** sets: [firstGlyph, [secondGlyph, xAdvance1, xAdvance2][]][], sorted; value formats are XAdvance or empty. */
const pairPos1 = (vf1, vf2, sets) => [
    u16(1), { off16: coverage1(sets.map(([first]) => first)) }, u16(vf1), u16(vf2), u16(sets.length),
    ...sets.map(([, pairs]) => ({
        off16: [u16(pairs.length), ...pairs.map(([second, a, b]) => [...u16(second), ...(vf1 ? i16(a) : []), ...(vf2 ? i16(b) : [])])],
    })),
];

/** values[class1][class2] is the first glyph's XAdvance change. */
const pairPos2 = (coverage, cd1, cd2, values) => [
    u16(2), { off16: coverage }, u16(4), u16(0), { off16: cd1 }, { off16: cd2 }, u16(values.length), u16(values[0].length),
    ...values.flat().map(i16),
];

/** sets: [firstGlyph, [ligatureGlyph, componentsAfterFirst[]][]][], sorted by first glyph. */
const ligatureSubst = sets => [
    u16(1), { off16: coverage1(sets.map(([first]) => first)) }, u16(sets.length),
    ...sets.map(([, ligatures]) => ({
        off16: [u16(ligatures.length), ...ligatures.map(([glyph, rest]) => ({ off16: [u16(glyph), u16(rest.length + 1), ...rest.map(u16)] }))],
    })),
];

/** GSUB/GPOS with one script (DFLT), one feature, and the given lookups. */
const layoutTable = (featureTag, lookups) => [
    u32(0x00010000),
    { off16: [u16(1), tag('DFLT'), { off16: [{ off16: [u16(0), u16(0xffff), u16(1), u16(0)] }, u16(0)] }] },
    { off16: [u16(1), tag(featureTag), { off16: [u16(0), u16(lookups.length), ...lookups.map((_, i) => u16(i))] }] },
    { off16: [u16(lookups.length), ...lookups.map(l => ({ off16: l }))] },
];

/** GDEF 1.2 with glyph classes, optional mark attachment classes, and optional mark glyph sets. */
const gdefTable = (glyphClassDef, markAttachClassDef, markGlyphSets = []) => [
    u16(1), u16(2), { off16: glyphClassDef }, u16(0), u16(0), markAttachClassDef ? { off16: markAttachClassDef } : u16(0),
    markGlyphSets.length ? { off16: [u16(1), u16(markGlyphSets.length), ...markGlyphSets.map(set => ({ off32: coverage1(set) }))] } : u16(0),
];

/** One segment per code point, plus one segment that maps through glyphIdArray. */
function cmapFormat4(map, rangeCodePoints) {
    const singles = [...map].filter(([cp]) => cp <= 0xffff && !rangeCodePoints.includes(cp));
    const segments = singles.map(([cp, glyph]) => ({ start: cp, end: cp, delta: glyph - cp, glyphs: null }));
    segments.push({ start: rangeCodePoints[0], end: rangeCodePoints.at(-1), delta: 0, glyphs: rangeCodePoints.map(cp => map.get(cp)) });
    segments.sort((a, b) => a.start - b.start);
    segments.push({ start: 0xffff, end: 0xffff, delta: 1, glyphs: null });
    const n = segments.length;
    const glyphArray = [];
    const rangeOffsets = segments.map((s, i) => {
        if (!s.glyphs) return 0;
        const offset = 2 * (n - i) + 2 * glyphArray.length;
        glyphArray.push(...s.glyphs);
        return offset;
    });
    const body = [
        ...segments.flatMap(s => u16(s.end)), ...u16(0), ...segments.flatMap(s => u16(s.start)),
        ...segments.flatMap(s => i16(s.delta)), ...rangeOffsets.flatMap(u16), ...glyphArray.flatMap(u16),
    ];
    return [...u16(4), ...u16(14 + body.length), ...u16(0), ...u16(2 * n), ...u16(0), ...u16(0), ...u16(0), ...body];
}

function cmapFormat12(map) {
    const groups = [];
    for (const [cp, glyph] of [...map].sort((a, b) => a[0] - b[0])) {
        const last = groups.at(-1);
        if (last && cp === last.end + 1 && glyph === last.glyph + cp - last.start) last.end = cp;
        else groups.push({ start: cp, end: cp, glyph });
    }
    return [...u16(12), ...u16(0), ...u32(16 + 12 * groups.length), ...u32(0), ...u32(groups.length),
        ...groups.flatMap(g => [...u32(g.start), ...u32(g.end), ...u32(g.glyph)])];
}

/** @param {Record<string, number[]>} tables */
function sfnt(tables) {
    const tags = Object.keys(tables).sort();
    let offset = 12 + 16 * tags.length;
    const directory = [];
    const data = [];
    for (const t of tags) {
        const bytes = tables[t];
        directory.push(...tag(t), ...u32(0), ...u32(offset), ...u32(bytes.length));
        const padded = [...bytes, ...new Array((4 - (bytes.length % 4)) % 4).fill(0)];
        data.push(...padded);
        offset += padded.length;
    }
    return Uint8Array.from([...u32(0x00010000), ...u16(tags.length), ...u16(0), ...u16(0), ...u16(0), ...directory, ...data]);
}

const GLYPHS = [
    ['.notdef', 500], ['space', 250], ['A', 600], ['V', 620], ['T', 580], ['o', 500], ['f', 300], ['i', 280],
    ['l', 270], ['W', 900], ['a', 480], ['f_i', 560], ['f_f_i', 840], ['f_l', 550], ['acutecomb', 50], ['grin', 1000], ['f_f', 590],
];
const G = Object.fromEntries(GLYPHS.map(([name], i) => [name, i]));
const CMAP = new Map([[0x20, G.space], [0x41, G.A], [0x56, G.V], [0x54, G.T], [0x6f, G.o], [0x66, G.f], [0x69, G.i],
    [0x6c, G.l], [0x57, G.W], [0x61, G.a], [0x301, G.acutecomb], [0x1f600, G.grin]]);

/**
 * Lookup 0 (flag `kernFlag`): A-V -80, T-o -70; V-A -50/+10 with a second value record.
 * Lookup 1 (Extension): class kerning T|W x o|a, class 0 column -5 for W; then W-i -30.
 * @param {{ cmap?: 4 | 12, kernFlag?: number, markGlyphSet?: number[], acuteAttachClass?: number }} [options]
 */
function buildTestFont({ cmap = 12, kernFlag = 0x8, markGlyphSet, acuteAttachClass } = {}) {
    const gsub = layoutTable('liga', [
        lookup(7, 0, [extension(4, ligatureSubst([[G.f, [[G.f_f_i, [G.f, G.i]], [G.f_f, [G.f]], [G.f_i, [G.i]], [G.f_l, [G.l]]]]]))]),
    ]);
    const gpos = layoutTable('kern', [
        lookup(2, kernFlag, [
            pairPos1(4, 0, [[G.A, [[G.V, -80]]], [G.T, [[G.o, -70]]]]),
            pairPos1(4, 4, [[G.V, [[G.A, -50, 10]]]]),
        ], 0),
        lookup(9, 0, [
            extension(2, pairPos2(
                coverage2([[G.T, G.T, 0], [G.W, G.W, 1]]),
                classDef2([[G.T, G.T, 1], [G.W, G.W, 2]]),
                classDef1(G.o, [1, 0, 0, 0, 0, 1]),
                [[0, 0], [0, -20], [-5, -60]],
            )),
            extension(2, pairPos1(4, 0, [[G.W, [[G.i, -30]]]])),
        ]),
    ]);
    const bmp = new Map([...CMAP].filter(([cp]) => cp <= 0xffff));
    const cmapRecords = cmap === 12
        ? [[3, 1, cmapFormat4(bmp, [0x61])], [3, 10, cmapFormat12(CMAP)]]
        : [[3, 1, cmapFormat4(bmp, [0x61])]];
    return sfnt({
        head: [...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0), ...u16(1000),
            ...new Array(16).fill(0), ...i16(0), ...i16(-200), ...i16(1000), ...i16(800), ...u16(0), ...u16(8), ...i16(2), ...i16(0), ...i16(0)],
        hhea: [...u32(0x00010000), ...i16(800), ...i16(-200), ...i16(0), ...u16(1000), ...i16(0), ...i16(0), ...i16(1000),
            ...i16(1), ...i16(0), ...i16(0), ...new Array(8).fill(0), ...i16(0), ...u16(GLYPHS.length)],
        maxp: [...u32(0x00005000), ...u16(GLYPHS.length)],
        hmtx: GLYPHS.flatMap(([, advance]) => [...u16(advance), ...i16(0)]),
        cmap: serialize([
            u16(0), u16(cmapRecords.length),
            ...cmapRecords.flatMap(([platform, encoding, bytes]) => [u16(platform), u16(encoding), { off32: [bytes] }]),
        ]),
        GSUB: serialize(gsub),
        GPOS: serialize(gpos),
        GDEF: serialize(gdefTable(
            classDef2([[G.space, G.a, 1], [G.f_i, G.f_l, 2], [G.acutecomb, G.acutecomb, 3], [G.grin, G.f_f, 1]]),
            acuteAttachClass === undefined ? null : classDef1(G.acutecomb, [acuteAttachClass]),
            markGlyphSet === undefined ? [] : [markGlyphSet],
        )),
    });
}

/** @param {ReturnType<typeof parseOpenType>} font @param {Array<[string, number[], number[]]>} cases */
function assertShapes(font, cases) {
    for (const [text, glyphs, advances] of cases) {
        const shaped = font.shape(text);
        assert.deepEqual(shaped.glyphs, glyphs, `${JSON.stringify(text)} glyphs`);
        assert.deepEqual(shaped.advances, advances, `${JSON.stringify(text)} advances`);
    }
}

const font = parseOpenType(buildTestFont());

// Expected values below match hb-shape --font-size=1000 on the same font bytes.

test('PairPos format 1, a second value record that consumes its glyph, and lookups adding up', () => {
    assertShapes(font, [
        ['AV', [2, 3], [520, 620]],
        ['VAV', [3, 2, 3], [570, 610, 620]],
        ['AVAV', [2, 3, 2, 3], [520, 570, 610, 620]],
        ['To', [4, 5], [490, 500]],
        ['TA', [4, 2], [580, 600]],
    ]);
    assert.equal(font.kern(G.A, G.V), -80);
    assert.equal(font.kern(G.V, G.A), -40);
    assert.equal(font.kern(G.T, G.o), -90);
});

test('PairPos format 2 applies its class 0 column and stops the lookup', () => {
    assertShapes(font, [
        ['Wa', [9, 10], [840, 480]],
        ['Wi', [9, 7], [895, 280]],
        ['Wf', [9, 6], [895, 300]],
        ['WA', [9, 2], [895, 600]],
    ]);
    assert.equal(font.kern(G.W, G.i), -5);
});

test('ligatures through an Extension lookup, in LigatureSet order', () => {
    assertShapes(font, [
        ['fi', [11], [560]],
        ['ffi', [12], [840]],
        ['ff', [16], [590]],
        ['fl', [13], [550]],
        ['ffl', [16, 8], [590, 270]],
        ['fffi', [16, 11], [590, 560]],
        ['Taffi', [4, 10, 12], [560, 480, 840]],
    ]);
});

test('ZWNJ blocks ligatures; other default ignorables are invisible and transparent', () => {
    assertShapes(font, [
        ['f\u200ci', [6, 1, 7], [300, 0, 280]],
        ['f\u00adi', [11, 1], [560, 0]],
        ['f\u200di', [11, 1], [560, 0]],
        ['W\u00ada', [9, 1, 10], [840, 0, 480]],
    ]);
});

test('IgnoreMarks kerns across GDEF marks, and marks get zero advance', () => {
    assertShapes(font, [
        ['A\u0301V', [2, 14, 3], [520, 0, 620]],
        ['\u00c1V', [2, 14, 3], [520, 0, 620]], // U+00C1 is unmapped, so it decomposes to A + U+0301
    ]);
});

test('mark filtering sets and mark attachment types decide which marks are skipped', () => {
    const kernedAcross = options => parseOpenType(buildTestFont(options)).shape('A\u0301V').advances[0] === 520;
    assert.equal(kernedAcross({ kernFlag: 0 }), false);
    assert.equal(kernedAcross({ kernFlag: 0x10, markGlyphSet: [] }), true);
    assert.equal(kernedAcross({ kernFlag: 0x10, markGlyphSet: [G.acutecomb] }), false);
    assert.equal(kernedAcross({ kernFlag: 0x100, acuteAttachClass: 1 }), false);
    assert.equal(kernedAcross({ kernFlag: 0x100, acuteAttachClass: 2 }), true);
});

test('cmap format 12 is preferred and maps astral code points; format 4 covers the BMP', () => {
    assertShapes(font, [['\u{1f600}', [15], [1000]], ['xyz', [0, 0, 0], [500, 500, 500]]]);
    const bmpOnly = parseOpenType(buildTestFont({ cmap: 4 }));
    assertShapes(bmpOnly, [['\u{1f600}a', [0, 10], [500, 480]], ['Wa', [9, 10], [840, 480]]]);
});

test('Unicode spaces the font lacks use the space glyph with their own widths', () => {
    assertShapes(font, [
        ['A\u00a0V', [2, 1, 3], [600, 250, 620]],
        ['A\u2009V', [2, 1, 3], [600, 200, 620]],
    ]);
});

test('missing OS/2 leaves x-height and cap height to the measurer fallbacks', () => {
    assert.equal(font.xHeight, null);
    assert.equal(font.capHeight, null);
    const metrics = createOtfMeasurer({ Test: font }).metrics({ family: 'Test', size: 10 });
    assert.deepEqual(metrics, { ascent: 8, descent: 2, xHeight: 5, capHeight: 8, spaceWidth: 2.5 });
});
