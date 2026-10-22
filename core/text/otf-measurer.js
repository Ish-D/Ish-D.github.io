/**
 * Measurer backed by parsed OpenType fonts: widths are shaped advances (kerning and ligatures)
 * scaled by font.size / unitsPerEm.
 *
 * Weight and style are ignored, so synthetic bold and italic measure like the regular face.
 * Synthetic bold widening is NOT modeled, and neither is smallCaps. Capitals are shaped as
 * capitals and tracking adds `tracking` em after every character.
 */

/** @typedef {import('../types.js').FontSpec} FontSpec */
/** @typedef {import('../types.js').FontMetrics} FontMetrics */
/** @typedef {import('../types.js').Measurer} Measurer */
/** @typedef {import('./otf.js').OpenTypeFont} OpenTypeFont */

/**
 * `descent` is positive (distance below the baseline). Without OS/2 values or TrueType outlines,
 * xHeight falls back to 0.5em and capHeight to the ascent (the CSS fallbacks for `ex` and `cap`).
 * @param {Record<string, OpenTypeFont> | Map<string, OpenTypeFont>} fonts  FontSpec.family -> parsed font
 * @returns {Measurer}
 */
export function createOtfMeasurer(fonts) {
    const byFamily = fonts instanceof Map ? fonts : new Map(Object.entries(fonts));

    /** @param {FontSpec} spec */
    function fontFor(spec) {
        const font = byFamily.get(spec.family);
        if (font === undefined) throw new Error(`No OpenType font registered for family "${spec.family}"`);
        return font;
    }

    return {
        width(text, spec) {
            const font = fontFor(spec);
            const shown = spec.caps ? text.toUpperCase() : text;
            let total = 0;
            for (const advance of font.shape(shown).advances) total += advance;
            const width = (total * spec.size) / font.unitsPerEm;
            return spec.tracking ? width + spec.tracking * spec.size * [...shown].length : width;
        },
        metrics(spec) {
            const font = fontFor(spec);
            const scale = spec.size / font.unitsPerEm;
            return {
                ascent: font.ascender * scale,
                descent: -font.descender * scale,
                xHeight: (font.xHeight ?? font.unitsPerEm / 2) * scale,
                capHeight: (font.capHeight ?? font.ascender) * scale,
                spaceWidth: font.advance(font.glyphId(0x20)) * scale,
            };
        },
    };
}
