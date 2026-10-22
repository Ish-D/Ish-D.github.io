import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slack } from '../slack.js';
import {
    box, glue, penalty, finishParagraph, breakLines, splitLines, displayRatio,
    badness, fitnessClass, defaults, INF_BAD,
} from '../../core/text/kp.js';

const INF = Infinity;

function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Random paragraph: words as boxes, spaces as glue, optional hyphen penalties inside words. */
function randomParagraph(rand, { words, hyphens }) {
    const items = [];
    for (let w = 0; w < words; w++) {
        const parts = hyphens && rand() < 0.5 ? 2 + Math.floor(rand() * 2) : 1;
        for (let p = 0; p < parts; p++) {
            items.push(box(6 + Math.floor(rand() * 24)));
            if (p < parts - 1) items.push(penalty(3, 50, true, true));
        }
        if (w < words - 1) items.push(glue(5, 3, 2));
    }
    return finishParagraph(items);
}

/** Exhaustive search over break subsets; mirrors the optimizer's line and demerit rules. */
function bruteForce(items, widthOf, o, pass) {
    const n = items.length;
    const legal = [];
    for (let i = 0; i < n - 1; i++) {
        const it = items[i];
        if (it.kind === 'glue' && i > 0 && items[i - 1].kind === 'box') legal.push(i);
        else if (it.kind === 'penalty' && it.penalty < INF && (pass.soft || !it.soft)) legal.push(i);
    }
    const prefix = { w: [0], y: [0], z: [0] };
    for (const it of items) {
        const isGlue = it.kind === 'glue';
        const isBox = it.kind === 'box';
        prefix.w.push(prefix.w.at(-1) + (isBox || isGlue ? it.width : 0));
        prefix.y.push(prefix.y.at(-1) + (isGlue ? it.stretch : 0));
        prefix.z.push(prefix.z.at(-1) + (isGlue ? it.shrink : 0));
    }
    const startAfter = (b) => {
        let s = b + 1;
        while (s < n && items[s].kind !== 'box') {
            if (items[s].kind === 'penalty' && items[s].penalty === -INF) break;
            s++;
        }
        return s;
    };

    let bestTotal = INF;
    const count = legal.length;
    for (let mask = 0; mask < (1 << count); mask++) {
        const chosen = [];
        for (let k = 0; k < count; k++) if (mask & (1 << k)) chosen.push(legal[k]);
        chosen.push(n - 1);

        let start = 0, line = 0, total = 0, prevFit = 2, prevFlag = false, run = 0, ok = true;
        for (const b of chosen) {
            const it = items[b];
            const pen = it.kind === 'penalty' ? it.penalty : 0;
            const flagged = it.kind === 'penalty' ? it.flagged : false;
            const extra = it.kind === 'penalty' ? it.width : 0;
            const width = widthOf(Math.min(line, o.uniformFromLine));
            const natural = prefix.w[b] - prefix.w[start] + extra;
            const stretch = prefix.y[b] - prefix.y[start] + pass.extraStretch + o.lineStretch;
            const shrink = prefix.z[b] - prefix.z[start];
            let ratio;
            if (natural < width) ratio = stretch > 0 ? (width - natural) / stretch : INF;
            else if (natural > width) ratio = shrink > 0 ? (width - natural) / shrink : -INF;
            else ratio = 0;
            if (ratio < -1) { ok = false; break; }
            const bad = badness(ratio);
            if (bad > pass.threshold) { ok = false; break; }
            let d = o.linePenalty + bad;
            d = d >= INF_BAD ? 1e8 : d * d;
            if (pen > 0) d += pen * pen;
            else if (pen > -INF) d -= pen * pen;
            const isFinal = b === n - 1;
            if (prevFlag && (isFinal || flagged)) d += isFinal ? o.finalHyphenDemerits : o.doubleHyphenDemerits;
            if (flagged && run >= 2) d += o.tripleHyphenDemerits;
            const fit = fitnessClass(ratio, bad);
            if (Math.abs(fit - prevFit) > 1) d += o.adjDemerits;
            total += d;
            prevFit = fit;
            prevFlag = flagged;
            run = flagged ? Math.min(2, run + 1) : 0;
            start = startAfter(b);
            line++;
        }
        if (ok && total < bestTotal) bestTotal = total;
    }
    return bestTotal;
}

function passesFor(items, o) {
    const hasSoft = items.some(it => it.kind === 'penalty' && it.soft);
    const list = [];
    if (hasSoft && o.pretolerance >= 0) list.push({ name: 'pretolerance', threshold: o.pretolerance, soft: false, extraStretch: 0 });
    list.push({ name: 'tolerance', threshold: o.tolerance, soft: true, extraStretch: 0 });
    if (o.emergencyStretch > 0) list.push({ name: 'emergency', threshold: o.tolerance, soft: true, extraStretch: o.emergencyStretch });
    list.push({ name: 'desperate', threshold: INF_BAD, soft: true, extraStretch: o.emergencyStretch });
    return list;
}

test('optimizer matches exhaustive search on random paragraphs (uniform width)', () => {
    const o = { ...defaults };
    let compared = 0;
    for (let seed = 1; seed <= 120; seed++) {
        const rand = rng(seed);
        const items = randomParagraph(rand, { words: 5 + Math.floor(rand() * 4), hyphens: seed % 2 === 0 });
        const width = 60 + Math.floor(rand() * 80);
        const result = breakLines(items, width);
        const passes = passesFor(items, o);
        let expected = INF;
        let expectedPass = '';
        for (const pass of passes) {
            const t = bruteForce(items, () => width, o, pass);
            if (t < INF) { expected = t; expectedPass = pass.name; break; }
        }
        if (expected === INF) continue;
        assert.equal(result.feasible, true, `seed ${seed}`);
        assert.equal(result.pass, expectedPass, `pass, seed ${seed}`);
        const got = result.breaks.at(-1).demerits;
        assert.ok(Math.abs(got - expected) < 1e-6, `seed ${seed}: got ${got}, exhaustive ${expected}`);
        compared++;
    }
    assert.ok(compared > 70, `compared ${compared}`);
});

test('optimizer matches exhaustive search with per-line widths', () => {
    const o = { ...defaults };
    let compared = 0;
    for (let seed = 200; seed < 300; seed++) {
        const rand = rng(seed);
        const items = randomParagraph(rand, { words: 5 + Math.floor(rand() * 3), hyphens: seed % 3 !== 0 });
        const base = 70 + Math.floor(rand() * 40);
        const widthOf = (line) => base - [0, 18, 18, 0, 30][Math.min(line, 4)];
        const result = breakLines(items, widthOf, { uniformFromLine: 4 });
        const passes = passesFor(items, o);
        let expected = INF;
        for (const pass of passes) {
            const t = bruteForce(items, widthOf, { ...o, uniformFromLine: 4 }, pass);
            if (t < INF) { expected = t; break; }
        }
        if (expected === INF) continue;
        const got = result.breaks.at(-1).demerits;
        assert.ok(Math.abs(got - expected) < 1e-6, `seed ${seed}: got ${got}, exhaustive ${expected}`);
        compared++;
    }
    assert.ok(compared > 60, `compared ${compared}`);
});

test('emergency stretch rescues a paragraph the normal passes reject', () => {
    const items = finishParagraph([box(40), glue(5, 1, 1), box(40), glue(5, 1, 1), box(40)]);
    const without = breakLines(items, 70);
    const withRescue = breakLines(items, 70, { emergencyStretch: 80 });
    assert.equal(without.pass, 'desperate');
    assert.equal(withRescue.pass, 'emergency');
    assert.ok(withRescue.breaks.at(-1).demerits < without.breaks.at(-1).demerits);
});

test('an unbreakable box wider than the line yields an overfull line, not a failure', () => {
    const items = finishParagraph([box(20), glue(5, 3, 2), box(200), glue(5, 3, 2), box(20)]);
    const result = breakLines(items, 100);
    assert.equal(result.feasible, true);
    assert.equal(result.pass, 'overfull');
    assert.ok(result.breaks.some(b => b.natural > b.width));
});

test('last item must be a forced break', () => {
    assert.throws(() => breakLines([box(10), glue(5, 1, 1), box(10)], 50), /forced break/);
});

test('empty paragraph is infeasible, not an error', () => {
    assert.deepEqual(breakLines([], 50).breaks, []);
});

test('hyphenation points are used only when the first pass fails', () => {
    const words = [];
    for (let i = 0; i < 6; i++) { words.push(box(30), glue(6, 3, 2)); }
    words.push(box(30));
    const plain = breakLines(finishParagraph(words), 100);
    assert.equal(plain.pass, 'tolerance');
    assert.ok(plain.breaks.every(b => !b.flagged));
});

test('hyphen penalty width counts toward the line only when the break is taken', () => {
    // 30 + hyphen(10) fits exactly in 40; without the hyphen the line would be underfull.
    const items = finishParagraph([box(30), penalty(10, 50, true, true), box(30)]);
    const result = breakLines(items, 40);
    const first = result.breaks[0];
    assert.equal(first.flagged, true);
    assert.equal(first.natural, 40);
});

test('splitLines skips discardable items after each break', () => {
    const items = finishParagraph([box(30), glue(5, 3, 2), box(30), glue(5, 3, 2), box(30)]);
    const result = breakLines(items, 36);
    const lines = splitLines(items, result.breaks);
    assert.equal(lines.length, result.breaks.length);
    for (const line of lines.slice(1)) assert.equal(items[line.start].kind, 'box');
});

test('displayRatio ignores lines closed by fill glue', () => {
    assert.equal(displayRatio({ natural: 10, width: 100, stretch: 1e9, shrink: 2 }), 0);
});

test('displayRatio stretches within the cap and shrinks within -1', () => {
    assert.equal(displayRatio({ natural: 90, width: 100, stretch: 5, shrink: 2 }), 2);
    assert.equal(displayRatio({ natural: 90, width: 100, stretch: 1, shrink: 2 }), 3);
    assert.equal(displayRatio({ natural: 105, width: 100, stretch: 5, shrink: 2 }), -1);
    assert.equal(displayRatio({ natural: 100, width: 100, stretch: 5, shrink: 2 }), 0);
});

test('optimal breaking is never worse than first-fit on total demerits', () => {
    const o = { ...defaults };
    let better = 0;
    for (let seed = 400; seed < 460; seed++) {
        const rand = rng(seed);
        const items = randomParagraph(rand, { words: 40, hyphens: false });
        const width = 120;
        const result = breakLines(items, width);
        const greedyBreaks = firstFit(items, width);
        const greedyDemerits = demeritsOf(items, greedyBreaks, width, o);
        if (greedyDemerits === null) continue;
        assert.ok(result.breaks.at(-1).demerits <= greedyDemerits + 1e-6, `seed ${seed}`);
        if (result.breaks.at(-1).demerits < greedyDemerits - 1e-6) better++;
    }
    assert.ok(better > 5, `optimal beat first-fit in ${better} cases`);
});

test('throughput: 2,000-item paragraph breaks quickly', () => {
    const rand = rng(7);
    const items = randomParagraph(rand, { words: 700, hyphens: true });
    const t0 = performance.now();
    const result = breakLines(items, 420);
    const ms = performance.now() - t0;
    assert.equal(result.feasible, true);
    assert.ok(ms < 250 * slack, `took ${ms.toFixed(1)}ms`);
});

function firstFit(items, width) {
    const breaks = [];
    let w = 0, lastGlue = -1, wAtGlue = 0, lineStart = 0;
    for (let i = 0; i < items.length - 2; i++) {
        const it = items[i];
        if (it.kind === 'glue') {
            lastGlue = i; wAtGlue = w; w += it.width;
        } else if (it.kind === 'box') {
            if (w + it.width > width && lastGlue >= lineStart) {
                breaks.push(lastGlue);
                lineStart = lastGlue + 1;
                w = w - wAtGlue - items[lastGlue].width + it.width;
                lastGlue = -1;
                continue;
            }
            w += it.width;
        }
    }
    breaks.push(items.length - 1);
    return breaks;
}

function demeritsOf(items, breaks, width, o) {
    let start = 0, total = 0, prevFit = 2;
    for (const b of breaks) {
        let natural = 0, stretch = 0, shrink = 0;
        for (let i = start; i < b; i++) {
            const it = items[i];
            if (it.kind === 'box') natural += it.width;
            if (it.kind === 'glue') { natural += it.width; stretch += it.stretch; shrink += it.shrink; }
        }
        let ratio;
        if (natural < width) ratio = stretch > 0 ? (width - natural) / stretch : INF;
        else if (natural > width) ratio = shrink > 0 ? (width - natural) / shrink : -INF;
        else ratio = 0;
        if (ratio < -1) return null;
        const bad = badness(ratio);
        let d = o.linePenalty + bad;
        d = d >= INF_BAD ? 1e8 : d * d;
        const fit = fitnessClass(ratio, bad);
        if (Math.abs(fit - prevFit) > 1) d += o.adjDemerits;
        total += d;
        prevFit = fit;
        start = b + 1;
        while (start < items.length && items[start].kind !== 'box') start++;
    }
    return total;
}

test('a line may hang past the edges of its slot, and the target width grows by what hangs', () => {
    // "aaa bbb-" fills 68 of 66 only if the hyphen stands out in the margin
    const items = finishParagraph([box(30), glue(5, 2.5, 5 / 3), box(30), penalty(5, 50, true, true), box(20)]);
    const without = breakLines(items, 66, { pretolerance: -1 });
    assert.notEqual(without.breaks[0].index, 3, 'the hyphen does not fit by itself');

    const protrusion = { lead: () => 0, trail: (line, index) => (index === 3 ? 5 : 0) };
    const hung = breakLines(items, 66, { pretolerance: -1, protrusion });
    assert.equal(hung.breaks[0].index, 3);
    assert.equal(hung.breaks[0].width, 71);
    assert.equal(hung.breaks[0].trail, 5);
    assert.equal(hung.breaks[0].lead, 0);
    assert.equal(hung.breaks.at(-1).trail, 0, 'the last line hangs nothing on the right');
});

test('the left edge of a line is asked about the box the line starts with', () => {
    const items = finishParagraph([box(30), glue(5, 2.5, 5 / 3), box(30), glue(5, 2.5, 5 / 3), box(30), glue(5, 2.5, 5 / 3), box(30)]);
    const asked = [];
    const protrusion = { lead: (line, first) => { asked.push([line, first]); return first === 4 ? 4 : 0; }, trail: () => 0 };
    const result = breakLines(items, 70, { protrusion });
    assert.ok(asked.some(([line, first]) => line === 0 && first === 0), 'the first line starts at the first box');
    const second = result.breaks.find(b => b.line === 1);
    assert.equal(second.lead, result.breaks[0].index === 3 ? 4 : 0);
    for (const b of result.breaks) assert.equal(b.width, 70 + b.lead + b.trail);
});

test('a third hyphen in a row costs far more than a second', () => {
    // a paragraph of mostly split words, where setting the hyphens in runs of four fits slightly better
    const rand = rng(53);
    const words = [];
    for (let w = 0; w < 40; w++) {
        const parts = rand() < 0.8 ? 2 + Math.floor(rand() * 2) : 1;
        for (let k = 0; k < parts; k++) {
            words.push(box(5 + Math.floor(rand() * 14)));
            if (k < parts - 1) words.push(penalty(3, 50, true, true));
        }
        if (w < 39) words.push(glue(4, 2, 1.3));
    }
    const items = finishParagraph(words);
    const longest = (result) => {
        let run = 0;
        let most = 0;
        for (const b of result.breaks) {
            run = b.flagged ? run + 1 : 0;
            most = Math.max(most, run);
        }
        return most;
    };
    assert.ok(longest(breakLines(items, 55, { tripleHyphenDemerits: 0 })) >= 3, 'without the rule the hyphens stack');
    assert.ok(longest(breakLines(items, 55)) <= 2, 'with it they do not');
});

test('a break forbidden only as a preference is used when the paragraph cannot be set without it', () => {
    // the last box is too wide to share a line with the one before it, and the two are tied together
    const set = (tie, last = 90) => finishParagraph([box(20), glue(5, 3, 2), box(20), tie, glue(5, 3, 2), box(last)]);
    const hard = breakLines(set(penalty(0, INF, false)), 100);
    assert.ok(hard.breaks.some(b => b.natural > b.width), 'a hard tie leaves an overfull line');
    const preferred = breakLines(set(penalty(0, INF, false, false, 1000)), 100);
    assert.equal(preferred.pass, 'relaxed');
    assert.ok(preferred.breaks.every(b => b.natural <= b.width + 1e-6), 'no line is overfull');
    // when the paragraph can be set without the break, the break is not used
    const roomy = breakLines(set(penalty(0, INF, false, false, 1000), 40), 100);
    assert.notEqual(roomy.pass, 'relaxed');
});

test('when every line overflows the paragraph is broken from the best line, not the last one', () => {
    const words = [];
    for (let w = 0; w < 30; w++) { words.push(box(30)); if (w < 29) words.push(glue(5, 3, 2)); }
    words.push(penalty(0, INF, false), glue(5, 3, 2), box(120));
    const result = breakLines(finishParagraph(words), 100, { pretolerance: -1 });
    assert.equal(result.pass, 'overfull');
    assert.ok(result.breaks.length < 25, `${result.breaks.length} lines for 31 words`);
});
