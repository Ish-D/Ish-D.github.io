/**
 * Minimal OpenType reader (CFF or TrueType outlines) over ArrayBuffer/Uint8Array/DataView, for Node
 * and browsers. Reads metrics, cmap, advances, GPOS 'kern' pair positioning and GSUB 'liga'
 * ligatures, and shapes left-to-right Latin text with them the way HarfBuzz does.
 */

/**
 * Glyph run in font units. `advances` include kerning.
 * @typedef {{ glyphs: number[], advances: number[] }} ShapedText
 */

/**
 * Values are in font units. `descender` is negative (below the baseline).
 * @typedef {Object} OpenTypeFont
 * @property {number} unitsPerEm
 * @property {number} ascender
 * @property {number} descender
 * @property {number | null} xHeight      OS/2 value, else yMax of 'x' from glyf, else null
 * @property {number | null} capHeight    OS/2 value, else yMin + yMax of 'O' from glyf, else null
 * @property {(codePoint: number) => number} glyphId     0 (.notdef) when unmapped
 * @property {(glyphId: number) => number} advance
 * @property {(leftGlyph: number, rightGlyph: number) => number} kern   total advance change for the adjacent pair
 * @property {(text: string) => ShapedText} shape
 */

const TAG_OTTO = 0x4f54544f;
const TAG_TRUE = 0x74727565;
const TAG_TTCF = 0x74746366;
const TAG_WOFF = 0x774f4646;
const TAG_WOF2 = 0x774f4632;

// Unicode cmap subtables by preference (platform, encoding), as HarfBuzz picks them.
const CMAP_PREFERENCE = [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]];

const GPOS_PAIR = 2;
const GPOS_EXTENSION = 9;
const GSUB_LIGATURE = 4;
const GSUB_EXTENSION = 7;

const IGNORE_FLAGS = 0x000e; // IgnoreBaseGlyphs | IgnoreLigatures | IgnoreMarks
const USE_MARK_FILTERING_SET = 0x0010;
const MARK_ATTACHMENT_TYPE = 0xff00;

// Glyph properties, using the bits of the lookup flags that skip them.
const BASE = 0x2;
const LIGATURE = 0x4;
const MARK = 0x8;

// Run record kinds. Ignorables are invisible and zero-width; ZWNJ also blocks ligatures.
const VISIBLE = 0;
const IGNORABLE = 1;
const ZWNJ = 2;

const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const NONSPACING_MARK = /^\p{Mn}$/u;
const COMBINING_MARK = /^\p{M}$/u;

const isMark = codePoint => codePoint >= 0x300 && COMBINING_MARK.test(String.fromCodePoint(codePoint));
const codePointLength = codePoint => (codePoint > 0xffff ? 2 : 1);

/**
 * @param {ArrayBuffer | ArrayBufferView} data  .otf/.ttf bytes
 * @returns {OpenTypeFont}
 */
export function parseOpenType(data) {
    const view = ArrayBuffer.isView(data)
        ? new DataView(data.buffer, data.byteOffset, data.byteLength)
        : new DataView(data);
    const tables = readTableDirectory(view);
    const required = tag => {
        const table = tables.get(tag);
        if (table === undefined) throw new Error(`Font has no '${tag}' table`);
        return table.offset;
    };

    const head = required('head');
    const hhea = required('hhea');
    const unitsPerEm = view.getUint16(head + 18);
    if (unitsPerEm < 16 || unitsPerEm > 16384) throw new Error(`Invalid unitsPerEm ${unitsPerEm}`);
    const numGlyphs = view.getUint16(required('maxp') + 4);
    const advances = readAdvances(view, hhea, required('hmtx'), numGlyphs);
    const lookupGlyph = readCmap(view, required('cmap'));
    const glyphId = codePoint => {
        const glyph = lookupGlyph(codePoint);
        return glyph < numGlyphs ? glyph : 0;
    };
    const advance = glyph => (glyph < numGlyphs ? advances[glyph] : 0);

    const os2 = tables.get('OS/2');
    let ascender = view.getInt16(hhea + 4);
    let descender = view.getInt16(hhea + 6);
    if (os2 && os2.length >= 78 && view.getUint16(os2.offset + 62) & 0x80) {
        ascender = view.getInt16(os2.offset + 68);
        descender = view.getInt16(os2.offset + 70);
    }

    let xHeight = null;
    let capHeight = null;
    if (os2 && os2.length >= 90 && view.getUint16(os2.offset) >= 2) {
        xHeight = view.getInt16(os2.offset + 86) || null;
        capHeight = view.getInt16(os2.offset + 88) || null;
    }
    const glyf = tables.get('glyf');
    const loca = tables.get('loca');
    if (glyf && loca) {
        const longOffsets = view.getInt16(head + 50) === 1;
        const bounds = glyph => glyfBounds(view, glyf.offset, loca.offset, longOffsets, glyph);
        if (xHeight === null) xHeight = bounds(glyphId(0x78))?.yMax ?? null;
        if (capHeight === null) {
            const o = bounds(glyphId(0x4f));
            capHeight = o ? o.yMin + o.yMax : null;
        }
    }

    const gdef = readGdef(view, tables.get('GDEF')?.offset);
    const gpos = tables.get('GPOS');
    const gsub = tables.get('GSUB');
    const pairLookups = gpos
        ? readFeatureLookups(view, gpos.offset, 'kern', GPOS_EXTENSION).filter(l => l.type === GPOS_PAIR)
        : [];
    const ligatureLookups = gsub
        ? readFeatureLookups(view, gsub.offset, 'liga', GSUB_EXTENSION).filter(l => l.type === GSUB_LIGATURE)
        : [];
    const spaceGlyph = glyphId(0x20);
    const pair = { first: 0, second: 0, consumesSecond: false };

    /** GDEF class as glyph properties; marks carry their attachment class in the high byte. */
    function gdefProps(glyph) {
        switch (gdef?.glyphClass(glyph)) {
            case 1: return BASE;
            case 2: return LIGATURE;
            case 3: return MARK | (gdef.markAttachClass(glyph) << 8);
            default: return 0;
        }
    }

    /** Without GDEF glyph classes, nonspacing marks (Mn) are marks and everything else is a base. */
    function initialProps(glyph, codePoint) {
        if (gdef?.hasGlyphClasses) return gdefProps(glyph);
        return codePoint >= 0x300 && NONSPACING_MARK.test(String.fromCodePoint(codePoint)) ? MARK : BASE;
    }

    /** True when the lookup's flags skip a glyph with these properties. */
    function ignoredBy(lookup, props, glyph) {
        if (props & lookup.flag & IGNORE_FLAGS) return true;
        if (!(props & MARK)) return false;
        if (lookup.flag & USE_MARK_FILTERING_SET) return !gdef?.inMarkSet(lookup.markSet, glyph);
        const attachType = lookup.flag & MARK_ATTACHMENT_TYPE;
        if (attachType) return attachType !== (props & MARK_ATTACHMENT_TYPE);
        return false;
    }

    /** First subtable of the lookup that positions (left, right); fills `pair`. */
    function pairInLookup(lookup, left, right) {
        for (const subtable of lookup.subtables) if (pairAdjustment(view, subtable, left, right, pair)) return true;
        return false;
    }

    /** Advance for a Unicode space the font lacks, drawn with the space glyph; null if not one. */
    function spaceFallbackAdvance(codePoint) {
        switch (codePoint) {
            case 0x00a0: return advance(spaceGlyph);
            case 0x2000: case 0x2002: return unitsPerEm / 2;
            case 0x2001: case 0x2003: case 0x3000: return unitsPerEm;
            case 0x2004: return unitsPerEm / 3;
            case 0x2005: return unitsPerEm / 4;
            case 0x2006: return unitsPerEm / 6;
            case 0x2007: {
                for (let digit = 0x30; digit <= 0x39; digit++) if (glyphId(digit)) return advance(glyphId(digit));
                return null;
            }
            case 0x2008: {
                const punctuation = glyphId(0x2e) || glyphId(0x2c);
                return punctuation ? advance(punctuation) : null;
            }
            case 0x2009: return unitsPerEm / 5;
            case 0x200a: return unitsPerEm / 16;
            case 0x202f: return advance(spaceGlyph) / 2;
            case 0x205f: return (unitsPerEm * 4) / 18;
            default: return null;
        }
    }

    /**
     * A base with its marks (or an unmapped base) as NFC if the font maps all of it, else
     * decomposed and recomposed pair by pair against the font, else the base with its marks in
     * canonical order.
     */
    function fontForm(cluster) {
        const mapsAll = s => {
            for (const char of s) if (glyphId(char.codePointAt(0)) === 0) return false;
            return true;
        };
        const composed = cluster.normalize('NFC');
        if (mapsAll(composed)) return composed;
        const recomposed = recompose(cluster);
        if (mapsAll(recomposed)) return recomposed;
        const baseLength = codePointLength(cluster.codePointAt(0));
        return cluster.slice(0, baseLength) + cluster.slice(baseLength).normalize('NFD');
    }

    /** Canonical decomposition, then each unblocked mark joins the base if the font has the composite. */
    function recompose(cluster) {
        const [base, ...marks] = cluster.normalize('NFD');
        let starter = base;
        const kept = [];
        for (const mark of marks) {
            const previous = kept[kept.length - 1];
            // NFD reorders (mark, previous) exactly when previous has a lower nonzero combining class.
            const unblocked = previous === undefined || (mark + previous).normalize('NFD') !== mark + previous;
            const composite = unblocked ? (starter + mark).normalize('NFC') : '';
            const single = composite !== '' && composite.length === codePointLength(composite.codePointAt(0));
            if (single && glyphId(composite.codePointAt(0)) !== 0) starter = composite;
            else kept.push(mark);
        }
        return starter + kept.join('');
    }

    /** @param {Run} run */
    function pushCodePoint(run, codePoint) {
        if (codePoint >= 0xad && DEFAULT_IGNORABLE.test(String.fromCodePoint(codePoint))) {
            run.glyphs.push(spaceGlyph);
            run.kinds.push(codePoint === 0x200c ? ZWNJ : IGNORABLE);
            run.props.push(BASE);
            run.fixed.push(0);
            return;
        }
        let glyph = glyphId(codePoint);
        let fixed = -1;
        if (glyph === 0 && spaceGlyph !== 0) {
            const fallback = spaceFallbackAdvance(codePoint);
            if (fallback !== null) {
                glyph = spaceGlyph;
                fixed = fallback;
            }
        }
        run.glyphs.push(glyph);
        run.kinds.push(VISIBLE);
        run.props.push(initialProps(glyph, codePoint));
        run.fixed.push(fixed);
    }

    /** @param {Run} run */
    function applyLigatures(lookup, run) {
        const { glyphs, kinds, props, fixed } = run;
        const skippable = j =>
            kinds[j] === IGNORABLE || (kinds[j] === VISIBLE && ignoredBy(lookup, props[j], glyphs[j]));
        const components = [];
        for (let i = 0; i < glyphs.length; i++) {
            if (kinds[i] !== VISIBLE || ignoredBy(lookup, props[i], glyphs[i])) continue;
            for (const subtable of lookup.subtables) {
                const ligature = matchLigature(view, subtable, run, i, skippable, components);
                if (ligature < 0) continue;
                glyphs[i] = ligature;
                props[i] = gdef?.hasGlyphClasses ? gdefProps(ligature) : LIGATURE;
                fixed[i] = -1;
                for (let k = components.length - 1; k >= 0; k--) {
                    for (const column of [glyphs, kinds, props, fixed]) column.splice(components[k], 1);
                }
                break;
            }
        }
    }

    /** @param {Run} run @param {number[]} positions */
    function applyPairs(lookup, { glyphs, kinds, props }, positions) {
        const skipped = j => kinds[j] !== VISIBLE || ignoredBy(lookup, props[j], glyphs[j]);
        for (let i = 0; i < glyphs.length; i++) {
            if (skipped(i)) continue;
            let j = i + 1;
            while (j < glyphs.length && skipped(j)) j++;
            if (j === glyphs.length) return;
            if (!pairInLookup(lookup, glyphs[i], glyphs[j])) continue;
            positions[i] += pair.first;
            positions[j] += pair.second;
            if (pair.consumesSecond) i = j;
        }
    }

    return {
        unitsPerEm,
        ascender: Math.abs(ascender),
        descender: -Math.abs(descender),
        xHeight,
        capHeight,
        glyphId,
        advance,
        kern(leftGlyph, rightGlyph) {
            let total = 0;
            for (const lookup of pairLookups) {
                if (pairInLookup(lookup, leftGlyph, rightGlyph)) total += pair.first + pair.second;
            }
            return total;
        },
        shape(text) {
            /** @type {Run} */
            const run = { glyphs: [], kinds: [], props: [], fixed: [] };
            for (let start = 0; start < text.length; ) {
                const codePoint = text.codePointAt(start);
                const baseEnd = start + codePointLength(codePoint);
                let end = baseEnd;
                while (end < text.length && isMark(text.codePointAt(end))) {
                    end += codePointLength(text.codePointAt(end));
                }
                if (end === baseEnd && glyphId(codePoint) !== 0) pushCodePoint(run, codePoint);
                else for (const char of fontForm(text.slice(start, end))) pushCodePoint(run, char.codePointAt(0));
                start = end;
            }

            for (const lookup of ligatureLookups) applyLigatures(lookup, run);
            const { glyphs, kinds, props, fixed } = run;
            const positions = glyphs.map((glyph, k) => (fixed[k] >= 0 ? fixed[k] : advance(glyph)));
            for (const lookup of pairLookups) applyPairs(lookup, run, positions);
            for (let k = 0; k < glyphs.length; k++) if (props[k] & MARK) positions[k] = 0;

            if (spaceGlyph === 0) {
                const keep = kinds.map(kind => kind === VISIBLE);
                return { glyphs: glyphs.filter((_, k) => keep[k]), advances: positions.filter((_, k) => keep[k]) };
            }
            return { glyphs, advances: positions };
        },
    };
}

/**
 * Glyph run being shaped, as parallel columns. `fixed` overrides the advance (-1: the glyph's own).
 * @typedef {{ glyphs: number[], kinds: number[], props: number[], fixed: number[] }} Run
 */

/** @param {DataView} view @param {number} offset */
function tagAt(view, offset) {
    const byte = k => view.getUint8(offset + k);
    return String.fromCharCode(byte(0), byte(1), byte(2), byte(3));
}

/** @param {DataView} view @returns {Map<string, { offset: number, length: number }>} */
function readTableDirectory(view) {
    const version = view.getUint32(0);
    if (version === TAG_TTCF) throw new Error('Font collections (.ttc) are not supported');
    if (version === TAG_WOFF || version === TAG_WOF2) {
        throw new Error('WOFF/WOFF2 is not supported; pass the .otf/.ttf bytes');
    }
    if (version !== 0x00010000 && version !== TAG_OTTO && version !== TAG_TRUE) throw new Error('Not an OpenType font');
    const tables = new Map();
    for (let i = 0, count = view.getUint16(4); i < count; i++) {
        const record = 12 + 16 * i;
        const tag = tagAt(view, record);
        const offset = view.getUint32(record + 8);
        const length = view.getUint32(record + 12);
        if (offset + length > view.byteLength) throw new Error(`Font table '${tag}' runs past the end of the data`);
        tables.set(tag, { offset, length });
    }
    return tables;
}

/** Advance per glyph; glyphs past numberOfHMetrics repeat the last advance. */
function readAdvances(view, hhea, hmtx, numGlyphs) {
    const metricCount = Math.min(view.getUint16(hhea + 34), numGlyphs);
    if (metricCount === 0) throw new Error('Font has no horizontal metrics');
    const advances = new Uint16Array(numGlyphs);
    for (let glyph = 0; glyph < metricCount; glyph++) advances[glyph] = view.getUint16(hmtx + 4 * glyph);
    advances.fill(advances[metricCount - 1], metricCount);
    return advances;
}

/** @returns {(codePoint: number) => number} */
function readCmap(view, cmap) {
    const subtables = new Map();
    for (let i = 0, count = view.getUint16(cmap + 2); i < count; i++) {
        const record = cmap + 4 + 8 * i;
        subtables.set(`${view.getUint16(record)}/${view.getUint16(record + 2)}`, cmap + view.getUint32(record + 4));
    }
    for (const [platform, encoding] of CMAP_PREFERENCE) {
        const offset = subtables.get(`${platform}/${encoding}`);
        if (offset === undefined) continue;
        switch (view.getUint16(offset)) {
            case 4: return cmapFormat4(view, offset);
            case 6: return cmapFormat6(view, offset);
            case 12: return cmapFormat12(view, offset, false);
            case 13: return cmapFormat12(view, offset, true);
        }
    }
    return () => 0;
}

function cmapFormat4(view, table) {
    const segments = view.getUint16(table + 6) >> 1;
    const ends = table + 14;
    const starts = ends + 2 * segments + 2;
    const deltas = starts + 2 * segments;
    const rangeOffsets = deltas + 2 * segments;
    return codePoint => {
        if (codePoint > 0xffff) return 0;
        let lo = 0;
        let hi = segments - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (view.getUint16(ends + 2 * mid) < codePoint) lo = mid + 1;
            else hi = mid;
        }
        const start = view.getUint16(starts + 2 * lo);
        if (codePoint < start || codePoint > view.getUint16(ends + 2 * lo)) return 0;
        const delta = view.getUint16(deltas + 2 * lo);
        const rangeOffsetAt = rangeOffsets + 2 * lo;
        const rangeOffset = view.getUint16(rangeOffsetAt);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyph = view.getUint16(rangeOffsetAt + rangeOffset + 2 * (codePoint - start));
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    };
}

function cmapFormat6(view, table) {
    const first = view.getUint16(table + 6);
    const count = view.getUint16(table + 8);
    return codePoint =>
        codePoint >= first && codePoint < first + count ? view.getUint16(table + 10 + 2 * (codePoint - first)) : 0;
}

/** Format 12 maps ranges to consecutive glyphs; format 13 maps each range to one glyph. */
function cmapFormat12(view, table, oneGlyphPerRange) {
    const groups = table + 16;
    const count = view.getUint32(table + 12);
    return codePoint => {
        let lo = 0;
        let hi = count - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const group = groups + 12 * mid;
            const start = view.getUint32(group);
            if (codePoint < start) hi = mid - 1;
            else if (codePoint > view.getUint32(group + 4)) lo = mid + 1;
            else return view.getUint32(group + 8) + (oneGlyphPerRange ? 0 : codePoint - start);
        }
        return 0;
    };
}

/** Outline bounds from the glyf header; null for empty glyphs and .notdef lookups. */
function glyfBounds(view, glyf, loca, longOffsets, glyph) {
    if (glyph === 0) return null;
    const start = longOffsets ? view.getUint32(loca + 4 * glyph) : 2 * view.getUint16(loca + 2 * glyph);
    const end = longOffsets ? view.getUint32(loca + 4 * glyph + 4) : 2 * view.getUint16(loca + 2 * glyph + 2);
    if (end <= start) return null;
    return { yMin: view.getInt16(glyf + start + 4), yMax: view.getInt16(glyf + start + 8) };
}

function readGdef(view, gdef) {
    if (gdef === undefined) return null;
    const glyphClassDef = view.getUint16(gdef + 4);
    const markAttachClassDef = view.getUint16(gdef + 10);
    const markGlyphSets = view.getUint16(gdef + 2) >= 2 ? view.getUint16(gdef + 12) : 0;
    return {
        hasGlyphClasses: glyphClassDef !== 0,
        glyphClass: glyph => (glyphClassDef ? classOf(view, gdef + glyphClassDef, glyph) : 0),
        markAttachClass: glyph => (markAttachClassDef ? classOf(view, gdef + markAttachClassDef, glyph) : 0),
        inMarkSet(set, glyph) {
            if (!markGlyphSets) return false;
            const sets = gdef + markGlyphSets;
            if (set >= view.getUint16(sets + 2)) return false;
            return coverageIndex(view, sets + view.getUint32(sets + 4 + 4 * set), glyph) >= 0;
        },
    };
}

/**
 * Lookups for `featureTag` (plus the required feature) under script latn, DFLT or dflt, in
 * LookupList order. Extension subtables are resolved to their real type.
 * @returns {Array<{ type: number, flag: number, markSet: number, subtables: number[] }>}
 */
function readFeatureLookups(view, table, featureTag, extensionType) {
    const langSys = findLangSys(view, table + view.getUint16(table + 4));
    if (langSys === null) return [];
    const featureList = table + view.getUint16(table + 6);
    const lookupList = table + view.getUint16(table + 8);
    const featureCount = view.getUint16(featureList);
    const requiredFeature = view.getUint16(langSys + 2);
    const featureIndices = [requiredFeature];
    for (let i = 0, count = view.getUint16(langSys + 4); i < count; i++) {
        featureIndices.push(view.getUint16(langSys + 6 + 2 * i));
    }

    const lookupIndices = new Set();
    for (const index of featureIndices) {
        if (index >= featureCount) continue;
        const record = featureList + 2 + 6 * index;
        if (index !== requiredFeature && tagAt(view, record) !== featureTag) continue;
        const feature = featureList + view.getUint16(record + 4);
        for (let k = 0, count = view.getUint16(feature + 2); k < count; k++) {
            lookupIndices.add(view.getUint16(feature + 4 + 2 * k));
        }
    }

    const lookupCount = view.getUint16(lookupList);
    return [...lookupIndices]
        .filter(index => index < lookupCount)
        .sort((a, b) => a - b)
        .map(index => {
            const lookup = lookupList + view.getUint16(lookupList + 2 + 2 * index);
            let type = view.getUint16(lookup);
            const flag = view.getUint16(lookup + 2);
            const count = view.getUint16(lookup + 4);
            const subtables = [];
            const isExtension = type === extensionType;
            for (let k = 0; k < count; k++) {
                let subtable = lookup + view.getUint16(lookup + 6 + 2 * k);
                if (isExtension) {
                    type = view.getUint16(subtable + 2);
                    subtable += view.getUint32(subtable + 4);
                }
                subtables.push(subtable);
            }
            const markSet = flag & USE_MARK_FILTERING_SET ? view.getUint16(lookup + 6 + 2 * count) : 0;
            return { type, flag, markSet, subtables };
        });
}

/** LangSys for latn, DFLT or dflt: its 'dflt' LangSysRecord if any, else the default LangSys. */
function findLangSys(view, scriptList) {
    const count = view.getUint16(scriptList);
    for (const want of ['latn', 'DFLT', 'dflt']) {
        for (let i = 0; i < count; i++) {
            const record = scriptList + 2 + 6 * i;
            if (tagAt(view, record) !== want) continue;
            const script = scriptList + view.getUint16(record + 4);
            for (let j = 0, langCount = view.getUint16(script + 2); j < langCount; j++) {
                const langRecord = script + 4 + 6 * j;
                if (tagAt(view, langRecord) === 'dflt') return script + view.getUint16(langRecord + 4);
            }
            const defaultLangSys = view.getUint16(script);
            return defaultLangSys ? script + defaultLangSys : null;
        }
    }
    return null;
}

function coverageIndex(view, coverage, glyph) {
    const format = view.getUint16(coverage);
    let lo = 0;
    let hi = view.getUint16(coverage + 2) - 1;
    if (format === 1) {
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const value = view.getUint16(coverage + 4 + 2 * mid);
            if (value < glyph) lo = mid + 1;
            else if (value > glyph) hi = mid - 1;
            else return mid;
        }
    } else if (format === 2) {
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const range = coverage + 4 + 6 * mid;
            const start = view.getUint16(range);
            if (glyph < start) hi = mid - 1;
            else if (glyph > view.getUint16(range + 2)) lo = mid + 1;
            else return view.getUint16(range + 4) + glyph - start;
        }
    }
    return -1;
}

function classOf(view, classDef, glyph) {
    const format = view.getUint16(classDef);
    if (format === 1) {
        const start = view.getUint16(classDef + 2);
        const inRange = glyph >= start && glyph < start + view.getUint16(classDef + 4);
        return inRange ? view.getUint16(classDef + 6 + 2 * (glyph - start)) : 0;
    }
    if (format === 2) {
        let lo = 0;
        let hi = view.getUint16(classDef + 2) - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const range = classDef + 4 + 6 * mid;
            if (glyph < view.getUint16(range)) hi = mid - 1;
            else if (glyph > view.getUint16(range + 2)) lo = mid + 1;
            else return view.getUint16(range + 4);
        }
    }
    return 0;
}

const valueRecordSize = format => 2 * popcount(format & 0xff);
const xAdvance = (view, record, format) => (format & 0x4 ? view.getInt16(record + 2 * popcount(format & 0x3)) : 0);

function popcount(bits) {
    let count = 0;
    for (; bits; bits &= bits - 1) count++;
    return count;
}

/**
 * PairPos subtable lookup. Writes x-advance changes for both glyphs to `out` and returns true when
 * the subtable applies: format 1 needs the exact pair, format 2 only needs the first glyph covered.
 */
function pairAdjustment(view, subtable, left, right, out) {
    const format = view.getUint16(subtable);
    const coverage = coverageIndex(view, subtable + view.getUint16(subtable + 2), left);
    if (coverage < 0) return false;
    const format1 = view.getUint16(subtable + 4);
    const format2 = view.getUint16(subtable + 6);
    const size1 = valueRecordSize(format1);
    const size2 = valueRecordSize(format2);
    let record = -1;
    if (format === 1) {
        if (coverage >= view.getUint16(subtable + 8)) return false;
        const pairSet = subtable + view.getUint16(subtable + 10 + 2 * coverage);
        const stride = 2 + size1 + size2;
        let lo = 0;
        let hi = view.getUint16(pairSet) - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const at = pairSet + 2 + stride * mid;
            const second = view.getUint16(at);
            if (second < right) lo = mid + 1;
            else if (second > right) hi = mid - 1;
            else {
                record = at + 2;
                break;
            }
        }
    } else if (format === 2) {
        const class2 = classOf(view, subtable + view.getUint16(subtable + 10), right);
        const class1 = classOf(view, subtable + view.getUint16(subtable + 8), left);
        const class2Count = view.getUint16(subtable + 14);
        if (class1 < view.getUint16(subtable + 12) && class2 < class2Count) {
            record = subtable + 16 + (class1 * class2Count + class2) * (size1 + size2);
        }
    }
    if (record < 0) return false;
    out.first = xAdvance(view, record, format1);
    out.second = xAdvance(view, record + size1, format2);
    out.consumesSecond = format2 !== 0;
    return true;
}

/**
 * Tries the LigatureSubst subtable at glyphs[start]. Returns the ligature glyph, or -1, and lists
 * the matched component positions (after the first) in `components`.
 */
function matchLigature(view, subtable, { glyphs, kinds }, start, skippable, components) {
    if (view.getUint16(subtable) !== 1) return -1;
    const coverage = coverageIndex(view, subtable + view.getUint16(subtable + 2), glyphs[start]);
    if (coverage < 0 || coverage >= view.getUint16(subtable + 4)) return -1;
    const ligatureSet = subtable + view.getUint16(subtable + 6 + 2 * coverage);
    for (let l = 0, count = view.getUint16(ligatureSet); l < count; l++) {
        const ligature = ligatureSet + view.getUint16(ligatureSet + 2 + 2 * l);
        const componentCount = view.getUint16(ligature + 2);
        components.length = 0;
        let j = start;
        for (let c = 1; c < componentCount; c++) {
            j++;
            while (j < glyphs.length && skippable(j)) j++;
            const component = view.getUint16(ligature + 4 + 2 * (c - 1));
            if (j === glyphs.length || kinds[j] === ZWNJ || glyphs[j] !== component) break;
            components.push(j);
        }
        if (components.length === componentCount - 1) return view.getUint16(ligature);
    }
    components.length = 0;
    return -1;
}
