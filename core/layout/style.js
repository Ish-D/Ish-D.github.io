/**
 * Resolved typography and spacing for layout. Sizes are px.
 *
 * The scale follows theme.css at its defaults (20px text on a 1.4 line, 12px
 * paragraph gap, 8/32px breaks) so ported posts keep their rhythm.
 */

/**
 * @typedef {Object} StyleSettings
 * @property {number} [fontSize]          body size, default 20
 * @property {number} [lineHeight]        multiple of fontSize, default 1.4
 * @property {string} [family]
 * @property {string} [monoFamily]
 */

/** The least width, in em, of text beside a floated figure or contents box; with less room it sits on its own line. */
export const MIN_TEXT_BESIDE = 12;

export function createStyles(settings = {}) {
    const size = settings.fontSize ?? 20;
    const family = settings.family ?? 'MonotypeModern';
    const mono = settings.monoFamily ?? 'Courier New';
    const lineHeight = Math.round(size * (settings.lineHeight ?? 1.4));
    const noteSize = size * 0.85;

    const text = (extra = {}, scale = 1) => ({ family, size: size * scale, ...extra });

    return {
        size,
        lineHeight,
        family,

        body: text(),
        emph: text({ style: 'italic' }),
        strong: text({ weight: 'bold' }),
        strongEmph: text({ style: 'italic', weight: 'bold' }),
        codeInline: { family: mono, size: size * 0.65 },

        paragraphGap: 12,
        smallBreak: 8,
        bigBreak: 32,

        /** Em-spaces inserted by [[tab]] mid-paragraph; the first line of a paragraph uses indentEm instead. */
        indentEm: 2,

        heading: {
            1: { font: text({ weight: 'bold' }, 1.6), lineHeight: Math.round(size * 1.6 * 1.25), align: 'center', before: 0, after: 16 },
            2: { font: text({ weight: 'bold' }, 1.3), lineHeight: Math.round(size * 1.3 * 1.3), align: 'left', before: 0, after: 12 },
            3: { font: text({ weight: 'bold' }, 1), lineHeight, align: 'left', before: 0, after: 8 },
            4: { font: text({ weight: 'bold', style: 'italic' }, 1), lineHeight, align: 'left', before: 0, after: 8 },
            5: { font: text({ style: 'italic' }, 1), lineHeight, align: 'left', before: 0, after: 8 },
            6: { font: text({ style: 'italic' }, 0.9), lineHeight, align: 'left', before: 0, after: 8 },
        },

        list: { indent: 24, itemGap: 4, after: 12, bulletGap: 8 },
        quote: { rule: 2, pad: 16, before: 16, after: 16 },
        code: {
            font: { family: mono, size: size * 0.65 },
            lineHeight: Math.round(size * 0.65 * 1.5),
            pad: 16,
            before: 12,
            after: 12,
        },
        rule: { before: 12, after: 12 },
        table: { cellPadX: 12, cellPadY: 6, ruleWidth: 1, headRuleWidth: 2, before: 12, after: 12 },

        note: {
            font: text({}, 0.85),
            lineHeight: Math.round(noteSize * 1.5),
            gap: 8,
            variants: [
                { scale: 1, cost: 0 },
                { scale: 0.94, cost: 250 },
                { scale: 0.88, cost: 500 },
            ],
        },

        dropCap: { lines: 3, gap: 6, family: 'ImprintMTShadow' },
    };
}
