/**
 * Resolved typography and spacing for layout. Sizes are px.
 *
 * Everything scales from the body size: 20px text on a 1.4 line, 12px paragraph
 * gap, 8/32px breaks. The font ships one weight, so hierarchy comes from size,
 * capitals with tracking, and rules.
 */

/**
 * @typedef {Object} StyleSettings
 * @property {number} [fontSize]          body size, default 20
 * @property {number} [lineHeight]        multiple of fontSize, default 1.4
 * @property {number} [titleScale]        page title size as a multiple of fontSize, default TITLE.desktop
 * @property {'left' | 'center'} [titleAlign]   where the title block sits in the column, default 'left'
 * @property {string} [family]
 * @property {string} [monoFamily]
 */

/** The page title is `phone` times the body size up to `from` px of window, `desktop` times from `to` px, and grows between. */
export const TITLE = Object.freeze({ phone: 2, desktop: 2.8, from: 400, to: 1100 });

/** Title size, as a multiple of the body size, for a window `viewportWidth` px wide. */
export function titleScaleFor(viewportWidth) {
    const t = Math.min(1, Math.max(0, (viewportWidth - TITLE.from) / (TITLE.to - TITLE.from)));
    return TITLE.phone + (TITLE.desktop - TITLE.phone) * t;
}

/** The least width, in em, of text beside a floated figure or contents box; with less room it sits on its own line. */
export const MIN_TEXT_BESIDE = 12;

export function createStyles(settings = {}) {
    const size = settings.fontSize ?? 20;
    const family = settings.family ?? 'MonotypeModern';
    const mono = settings.monoFamily ?? 'Courier New';
    const lineHeight = Math.round(size * (settings.lineHeight ?? 1.4));
    /** A height in px as a whole number of lines, at least one, so blocks sit on the grid of lines. */
    const lines = (px) => Math.max(1, Math.round(px / lineHeight)) * lineHeight;
    const noteSize = size * 0.85;
    const titleScale = settings.titleScale ?? TITLE.desktop;
    const titleAlign = settings.titleAlign ?? 'left';

    const text = (extra = {}, scale = 1) => ({ family, size: size * scale, ...extra });

    return {
        size,
        lineHeight,
        family,
        titleAlign,

        body: text(),
        emph: text({ style: 'italic' }),
        /** The font ships one weight, so strong text is set in capitals instead of a faked bold. */
        strong: text({ caps: true, tracking: 0.04 }, 0.88),
        strongEmph: text({ style: 'italic', caps: true, tracking: 0.04 }, 0.88),
        codeInline: { family: mono, size: size * 0.65 },

        /** Paragraphs are a blank line apart and never indented; every block starts and ends on a line of the grid. */
        paragraphGap: lineHeight,
        smallBreak: 0,
        bigBreak: lineHeight,

        /** Em-spaces inserted by [[tab]] inside a paragraph. */
        indentEm: 2,

        heading: {
            1: { font: text({}, titleScale), lineHeight: lines(size * titleScale * 1.1), align: titleAlign, before: 0, after: lineHeight },
            2: { font: text({}, 1.6), lineHeight: 2 * lineHeight, align: 'left', before: 0, after: 0 },
            3: { font: text({ caps: true, tracking: 0.1 }, 0.8), lineHeight, align: 'left', before: 0, after: 0 },
            4: { font: text({ style: 'italic' }, 1), lineHeight, align: 'left', before: 0, after: 0 },
            5: { font: text({ style: 'italic' }, 0.9), lineHeight, align: 'left', before: 0, after: 0 },
            6: { font: text({ style: 'italic' }, 0.85), lineHeight, align: 'left', before: 0, after: 0 },
        },

        list: { indent: 24, itemGap: 0, after: lineHeight, bulletGap: 8 },
        quote: { rule: 2, pad: 16, before: 0, after: lineHeight },
        code: {
            font: { family: mono, size: size * 0.65 },
            lineHeight: Math.round(size * 0.65 * 1.5),
            pad: 16,
            before: 0,
            after: lineHeight,
        },
        /** A rule takes one line: the hairline sits in the middle of it. */
        rule: { before: Math.floor((lineHeight - 1) / 2), after: Math.ceil((lineHeight - 1) / 2) },
        table: {
            cellPadX: 12, cellPadY: 6, ruleWidth: 1, headRuleWidth: 2, before: 0, after: lineHeight,
            head: text({ caps: true, tracking: 0.06 }, 0.78),
        },

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
