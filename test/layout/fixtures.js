import { readFileSync } from 'node:fs';
import { parse } from '../../core/doc/parse.js';

export const measurer = {
    width: (text, font) => [...text].length * font.size * 0.5,
    metrics: (font) => ({
        ascent: font.size * 0.8, descent: font.size * 0.2, xHeight: font.size * 0.5,
        capHeight: font.size * 0.7, spaceWidth: font.size * 0.5,
    }),
};

export const atoms = {
    inlineMath: (tex) => ({ width: tex.length * 5, height: 24, ascent: 18 }),
    displayMath: (tex, width) => ({ width: Math.min(width, tex.length * 10), height: 48 }),
    image: () => ({ width: 100, height: 60 }),
    widget: () => ({ width: 80, height: 26 }),
};

export const objects = {
    natural: () => ({ width: 400, height: 300 }),
    mask: () => null,
};

export function makeEnv(width, over = {}) {
    return { width, measurer, atoms, objects, ...over };
}

export const card = (name) => readFileSync(new URL(`../../cards/${name}.md`, import.meta.url), 'utf8');
export const parseCard = (name) => parse(card(name));
export const parseText = (text) => parse(text);

export const hyphenator = {
    points(word) {
        const out = [];
        for (let i = 3; i <= word.length - 3; i += 3) out.push(i);
        return out;
    },
};
