/**
 * Typographic punctuation for display: curly quotes and apostrophes, ellipses, dashes.
 *
 * The source keeps what was typed. This runs on the spans a paragraph is set from, one
 * character for one character where it can, so the text the reader sees is the only thing
 * that changes. Code is never touched.
 */

/** @typedef {import('./items.js').Span} Span */

const LEFT_SINGLE = '‘';
const RIGHT_SINGLE = '’';
const LEFT_DOUBLE = '“';
const RIGHT_DOUBLE = '”';
const ELLIPSIS = '…';
const EN_DASH = '–';
const EM_DASH = '—';

/** A quote after one of these opens; after anything else it closes. */
const OPENS_AFTER = /[\s([{–—‘“]/;
/** Leading apostrophes that are elisions ('90s, 'tis), not opening quotes. */
const ELISION = /^(?:\d|(?:tis|twas|twere|em|cause|til|n)\b)/i;

/**
 * @param {string} text
 * @param {string} prev   the character before `text` in the paragraph, '' at its start
 */
export function typographicText(text, prev = '') {
    const marked = text
        .replace(/(?<!\.)\.{3}(?!\.)/g, ELLIPSIS)
        .replace(/(?<=\s)--(?=\s)|(?<=\d)--(?=\d)/g, EN_DASH)
        .replace(/(?<!-)---(?!-)/g, EM_DASH);
    let out = '';
    for (let i = 0; i < marked.length; i++) {
        const ch = marked[i];
        const before = i === 0 ? prev : marked[i - 1];
        if (ch === '"') {
            out += before === '' || OPENS_AFTER.test(before) ? LEFT_DOUBLE : RIGHT_DOUBLE;
        } else if (ch === "'") {
            const opens = before === '' || OPENS_AFTER.test(before);
            out += opens && !ELISION.test(marked.slice(i + 1)) ? LEFT_SINGLE : RIGHT_SINGLE;
        } else {
            out += ch;
        }
    }
    return out;
}

/**
 * The spans with typographic punctuation. Atoms and markers keep their places; an atom
 * counts as a word for deciding whether a quote opens or closes.
 * @param {Span[]} spans
 * @returns {Span[]}
 */
export function typographicSpans(spans) {
    let prev = '';
    return spans.map((span) => {
        if (span.kind === 'atom') {
            prev = 'x';
            return span;
        }
        if (span.kind === 'break') {
            prev = ' ';
            return span;
        }
        if (span.kind !== 'text' || span.text === '') return span;
        const text = span.ref?.code ? span.text : typographicText(span.text, prev);
        prev = text[text.length - 1];
        return text === span.text ? span : { ...span, text };
    });
}
