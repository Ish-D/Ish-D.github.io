/**
 * Typesetting lint: the ways a laid-out page can look wrong that a test of geometry does not
 * see. It reads the lines the layout produced (spaces pulled too wide, a last line that is one
 * word, hyphens stacked down the edge) and reports each with the text it is about.
 */

/**
 * Ratios are glue stretch (positive) or shrink (negative) as a share of what the spaces allow:
 * 1 is the badness TeX calls 100, and the numbers here are the ones TeX uses.
 */
export const LIMITS = Object.freeze({
    /** A line stretched past this is looser than the optimizer's tolerance (TeX's badness 200). */
    loose: 1.26,
    /** Past this the spaces are plainly wrong (TeX's badness 1000, where it warns). */
    veryLoose: 2.15,
    /** A line shrunk past this is cramped. */
    tight: -0.9,
    /** Hyphens on this many lines in a row; the second is allowed, the third is not. */
    stacked: 3,
    /** A last line narrower than this many ems is a stub. */
    stub: 3,
    /** A last line of one word narrower than this share of the line is a stub too. */
    stubShare: 0.4,
});

/**
 * @typedef {Object} Issue
 * @property {'loose' | 'tight' | 'overfull' | 'one-word-last-line' | 'stub-last-line' | 'stacked-hyphens' | 'hyphen-before-last-line'} kind
 * @property {'note' | 'warn' | 'bad'} level
 * @property {number} block      index in the layout's blocks
 * @property {number} line       index of the first line concerned
 * @property {string} text       the line (or lines) as set
 * @property {number} [amount]   the ratio for loose and tight lines, the number of lines for a run of hyphens
 */

const lineText = (line) => line.runs.map(r => (r.kind === 'hyphen' ? '-' : r.text ?? '')).join('');
const wordsIn = (line) => lineText(line).trim().split(/\s+/).filter(Boolean).length;

/**
 * @param {Array<any>} blocks   `layout.blocks`
 * @param {Partial<typeof LIMITS>} [limits]
 * @returns {Issue[]}
 */
export function lintBlocks(blocks, limits = {}) {
    const limit = { ...LIMITS, ...limits };
    const issues = [];
    blocks.forEach((block, index) => {
        if ((block.type !== 'paragraph' && block.type !== 'heading') || !block.lines) return;
        const lines = block.lines.filter(l => !l.overflow);
        const size = block.spans?.find(s => s.kind === 'text')?.font.size ?? 16;
        const add = (kind, level, from, to, extra = {}) => {
            issues.push({ kind, level, block: index, line: from, text: lines.slice(from, to + 1).map(lineText).join(' / '), ...extra });
        };

        lines.forEach((line, i) => {
            if (line.natural > line.width + 0.5 && line.ratio <= -1) add('overfull', 'bad', i, i);
            else if (!line.last && line.ratio > limit.veryLoose) add('loose', 'bad', i, i, { amount: line.ratio });
            else if (!line.last && line.ratio > limit.loose) add('loose', 'warn', i, i, { amount: line.ratio });
            else if (!line.last && line.ratio < limit.tight) add('tight', 'note', i, i, { amount: line.ratio });
        });

        let run = 0;
        lines.forEach((line, i) => {
            run = line.hyphenated ? run + 1 : 0;
            if (line.hyphenated && !lines[i + 1]?.hyphenated && run >= 2) {
                add('stacked-hyphens', run >= limit.stacked ? 'bad' : 'note', i - run + 1, i, { amount: run });
            }
        });

        if (lines.length > 1) {
            const last = lines[lines.length - 1];
            const before = lines[lines.length - 2];
            if (wordsIn(last) === 1 && last.natural < limit.stubShare * last.width) add('one-word-last-line', 'warn', lines.length - 1, lines.length - 1);
            else if (last.natural < limit.stub * size) add('stub-last-line', 'note', lines.length - 1, lines.length - 1);
            if (before.hyphenated) add('hyphen-before-last-line', 'note', lines.length - 2, lines.length - 1);
        }
    });
    return issues;
}

/** Counts of each kind of issue, for a summary line. */
export function tally(issues) {
    const counts = {};
    for (const { kind, level } of issues) {
        const key = `${kind}:${level}`;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}
