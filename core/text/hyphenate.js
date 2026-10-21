/**
 * Liang's hyphenation algorithm (as in TeX) over a pattern trie.
 */

import { createBoundedCache } from './cache.js';
import { patterns as englishPatterns, exceptions as englishExceptions } from './patterns-en-us.js';

/**
 * `points` results are cached, shared, and frozen.
 * @typedef {{ points(word: string): number[] }} Hyphenator
 */

/** @type {number[]} */
const NO_POINTS = Object.freeze([]);
const EDGE = 0; // trie symbol for '.', the word boundary in patterns
const CACHE_LIMIT = 50_000;
const PATTERN_SYNTAX = /^\.?(?:\d?[^\d.])+\d?\.?$/;

/**
 * `points(word)` returns sorted indices i with minLeft <= i <= word.length - minRight where a
 * hyphen may go before word[i]. Matching is case-insensitive. A word containing any character
 * the patterns don't use (digits, apostrophes, punctuation, letters outside the alphabet) gets no
 * points. Exceptions replace pattern results; minLeft/minRight still apply to them.
 *
 * @param {{ patterns: string, exceptions?: Record<string, string>, minLeft?: number, minRight?: number }} options
 *   `patterns` is whitespace-separated Liang patterns; `exceptions` maps word -> form with '-' at breaks.
 * @returns {Hyphenator}
 */
export function createHyphenator({ patterns, exceptions = {}, minLeft = 2, minRight = 3 }) {
    for (const [name, value] of [['minLeft', minLeft], ['minRight', minRight]]) {
        if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be an integer >= 1, got ${value}`);
    }

    const trie = buildTrie(patterns);
    const exceptionPoints = new Map();
    for (const [word, hyphenated] of Object.entries(exceptions)) {
        const lower = word.toLowerCase();
        if (hyphenated.replaceAll('-', '').toLowerCase() !== lower) {
            throw new Error(`Hyphenation exception "${hyphenated}" does not spell "${word}"`);
        }
        const points = [];
        for (let i = 0, letters = 0; i < hyphenated.length; i++) {
            if (hyphenated[i] === '-') points.push(letters);
            else letters++;
        }
        exceptionPoints.set(lower, Object.freeze(points.filter(i => i >= minLeft && i <= lower.length - minRight)));
    }

    const cache = createBoundedCache(CACHE_LIMIT);
    let symbols = new Int32Array(64);
    let levels = new Uint8Array(64);

    /** @param {string} word */
    function compute(word) {
        const lower = word.toLowerCase();
        const n = word.length;
        if (lower.length !== n) return NO_POINTS;
        const exception = exceptionPoints.get(lower);
        if (exception !== undefined) return exception;
        if (n < minLeft + minRight) return NO_POINTS;

        const m = n + 2;
        if (symbols.length < m + 1) {
            symbols = new Int32Array(2 * m);
            levels = new Uint8Array(2 * m);
        }
        symbols[0] = EDGE;
        symbols[m - 1] = EDGE;
        for (let i = 0; i < n; i++) {
            const symbol = trie.symbolOf.get(lower.charCodeAt(i));
            if (symbol === undefined) return NO_POINTS;
            symbols[i + 1] = symbol;
        }

        // levels[b] is the max pattern value at boundary b, just before symbols[b].
        const { next, width, valueStart, valueLength, pool } = trie;
        levels.fill(0, 0, m + 1);
        for (let i = 0; i < m; i++) {
            let node = 0;
            for (let j = i; j < m; j++) {
                node = next[node * width + symbols[j]];
                if (node === 0) break;
                const start = valueStart[node];
                if (start < 0) continue;
                const end = start + valueLength[node];
                for (let k = start, b = i; k < end; k++, b++) if (pool[k] > levels[b]) levels[b] = pool[k];
            }
        }

        const points = [];
        for (let i = minLeft; i <= n - minRight; i++) if (levels[i + 1] & 1) points.push(i);
        return points.length === 0 ? NO_POINTS : Object.freeze(points);
    }

    return {
        points(word) {
            let points = cache.get(word);
            if (points === undefined) {
                points = compute(word);
                cache.set(word, points);
            }
            return points;
        },
    };
}

let defaultEnglish;

/** @type {Hyphenator} US English (Knuth's hyphen.tex), built on first use. */
export const english = {
    points(word) {
        defaultEnglish ??= createHyphenator({ patterns: englishPatterns, exceptions: englishExceptions });
        return defaultEnglish.points(word);
    },
};

/**
 * Dense transition table: next[node * width + symbol] is the child node, 0 when absent (the root
 * is never a child). A pattern ending at a node stores its values at pool[valueStart[node]...].
 * @param {string} source
 */
function buildTrie(source) {
    const parsed = [];
    const symbolOf = new Map();
    for (const pattern of source.split(/\s+/)) {
        if (pattern === '') continue;
        if (!PATTERN_SYNTAX.test(pattern)) throw new Error(`Invalid hyphenation pattern "${pattern}"`);
        let letters = '';
        const values = [0];
        for (let i = 0; i < pattern.length; i++) {
            const code = pattern.charCodeAt(i);
            if (code >= 48 && code <= 57) {
                values[values.length - 1] = code - 48;
                continue;
            }
            letters += pattern[i];
            values.push(0);
            if (pattern[i] !== '.' && !symbolOf.has(code)) symbolOf.set(code, symbolOf.size + 1);
        }
        parsed.push({ letters, values, pattern });
    }

    const width = symbolOf.size + 1;
    let next = new Int32Array(width * 1024);
    let nodeCount = 1;
    const valueStart = [-1];
    const valueLength = [0];
    const pool = [];
    for (const { letters, values, pattern } of parsed) {
        let node = 0;
        for (let i = 0; i < letters.length; i++) {
            const symbol = letters[i] === '.' ? EDGE : symbolOf.get(letters.charCodeAt(i));
            const slot = node * width + symbol;
            if (next[slot] === 0) {
                if ((nodeCount + 1) * width > next.length) {
                    const grown = new Int32Array(next.length * 2);
                    grown.set(next);
                    next = grown;
                }
                next[slot] = nodeCount++;
                valueStart.push(-1);
                valueLength.push(0);
            }
            node = next[slot];
        }
        if (valueStart[node] >= 0) throw new Error(`Duplicate hyphenation pattern "${pattern}"`);
        valueStart[node] = pool.length;
        valueLength[node] = values.length;
        pool.push(...values);
    }

    const Table = nodeCount <= 0xffff ? Uint16Array : Int32Array;
    return {
        symbolOf,
        width,
        next: new Table(next.subarray(0, nodeCount * width)),
        valueStart: Int32Array.from(valueStart),
        valueLength: Int32Array.from(valueLength),
        pool: Uint8Array.from(pool),
    };
}
