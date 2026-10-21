/**
 * Three-way merge of text by lines, for when two devices edited the same page.
 *
 * Changes on the two sides merge cleanly when they touch different lines.
 * Changes that overlap or sit on adjacent lines are a conflict, unless both
 * sides made exactly the same change.
 */

const MAX_EDITS = 2000;

const splitLines = (text) => (text === '' ? [] : text.split(/(?<=\n)/));

/**
 * Pairs [i, j] of equal elements, increasing in both, from a shortest edit
 * script (Myers). Null when the sequences differ by more than `maxEdits`.
 */
function matchPairs(a, b, maxEdits) {
    const n = a.length;
    const m = b.length;
    const max = Math.min(n + m, maxEdits);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let total = -1;
    for (let d = 0; d <= max && total < 0; d++) {
        trace.push(v.slice(off - d - 1, off + d + 2));
        for (let k = -d; k <= d; k += 2) {
            let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) { x++; y++; }
            v[off + k] = x;
            if (x >= n && y >= m) { total = d; break; }
        }
    }
    if (total < 0) return null;

    const pairs = [];
    let x = n;
    let y = m;
    for (let d = total; d >= 0; d--) {
        const snap = trace[d];
        const at = (k) => snap[k + d + 1];
        const k = x - y;
        const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
        const prevX = at(prevK);
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) { x--; y--; pairs.push([x, y]); }
        x = prevX;
        y = prevY;
    }
    return pairs.reverse();
}

/** Where `side` differs from `base`: base[start, end) became `lines`. */
function changes(base, side) {
    let head = 0;
    while (head < base.length && head < side.length && base[head] === side[head]) head++;
    let tail = 0;
    while (tail < base.length - head && tail < side.length - head && base[base.length - 1 - tail] === side[side.length - 1 - tail]) tail++;
    const midBase = base.slice(head, base.length - tail);
    const midSide = side.slice(head, side.length - tail);
    const pairs = matchPairs(midBase, midSide, MAX_EDITS);
    if (!pairs) return null;

    const out = [];
    let pi = -1;
    let pj = -1;
    for (const [i, j] of [...pairs, [midBase.length, midSide.length]]) {
        if (i - pi > 1 || j - pj > 1) out.push({ start: head + pi + 1, end: head + i, lines: midSide.slice(pj + 1, j) });
        pi = i;
        pj = j;
    }
    return out;
}

const sameLines = (p, q) => p.length === q.length && p.every((line, i) => line === q[i]);

/**
 * @returns {{ clean: boolean, text: string }} the merged text, or `ours` when it is not clean
 */
export function merge3(base, ours, theirs) {
    if (ours === theirs) return { clean: true, text: ours };
    if (base === ours) return { clean: true, text: theirs };
    if (base === theirs) return { clean: true, text: ours };

    // Lines compare as small integers; `texts` maps them back.
    const ids = new Map();
    const texts = [];
    const intern = (lines) => lines.map(line => {
        let id = ids.get(line);
        if (id === undefined) { id = texts.length; ids.set(line, id); texts.push(line); }
        return id;
    });
    const baseIds = intern(splitLines(base));
    const ourChanges = changes(baseIds, intern(splitLines(ours)));
    const theirChanges = changes(baseIds, intern(splitLines(theirs)));
    if (!ourChanges || !theirChanges) return { clean: false, text: ours };

    const all = [
        ...ourChanges.map(h => ({ ...h, side: 0 })),
        ...theirChanges.map(h => ({ ...h, side: 1 })),
    ].sort((p, q) => p.start - q.start || p.end - q.end);

    const out = [];
    let pos = 0;
    for (let i = 0; i < all.length;) {
        const cluster = [all[i++]];
        let end = cluster[0].end;
        while (i < all.length && all[i].start <= end) {
            cluster.push(all[i]);
            end = Math.max(end, all[i].end);
            i++;
        }
        const lines = cluster[0].lines;
        if (cluster.length > 1) {
            const [p, q] = cluster;
            if (cluster.length !== 2 || p.side === q.side || p.start !== q.start || p.end !== q.end || !sameLines(p.lines, q.lines)) {
                return { clean: false, text: ours };
            }
        }
        out.push(...baseIds.slice(pos, cluster[0].start), ...lines);
        pos = end;
    }
    out.push(...baseIds.slice(pos));
    return { clean: true, text: out.map(id => texts[id]).join('') };
}
