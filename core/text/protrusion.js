/**
 * Hanging punctuation. An opening quote or bracket may stand in the margin to the left of a
 * line, and a closing quote, bracket, comma, full stop or hyphen may stand in the margin to
 * the right, so the letters themselves line up with the edge of the text.
 *
 * `fraction` is how much of the character's own width hangs outside.
 */

const LEFT = new Map(Object.entries({
    '“': 1, '‘': 1, '"': 1, "'": 1, '«': 1, '(': 1, '[': 1, '{': 1,
}));

const RIGHT = new Map(Object.entries({
    '”': 1, '’': 1, '"': 1, "'": 1, '»': 1, ')': 1, ']': 1, '}': 1,
    ',': 1, '.': 1, ';': 1, ':': 1, '-': 1, '‐': 1, '‑': 1,
}));

/** Fraction of the first character of `text` that hangs past the left edge. */
export const leftHang = (text) => (text ? LEFT.get(text[0]) ?? 0 : 0);

/** Fraction of the last character of `text` that hangs past the right edge. */
export const rightHang = (text) => (text ? RIGHT.get(text[text.length - 1]) ?? 0 : 0);
