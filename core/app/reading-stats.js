/**
 * Reading stats in the corner of a page: word count, read time and scroll
 * progress, each switched on by the page's front matter (wordCount, readTime,
 * progressBar).
 */

import { walk } from '../doc/walk.js';

const WORDS_PER_MINUTE = 200;

/** Words in the prose of a document (directive arguments and markup do not count). */
export function countWords(doc) {
    let words = 0;
    walk(doc, (node) => {
        if (node.type === 'text' && typeof node.value === 'string') {
            words += node.value.split(/\s+/).filter(Boolean).length;
        }
    });
    return words;
}

export const flagsOf = (doc) => {
    const entries = doc?.frontmatter?.entries ?? {};
    const on = (key) => entries[key]?.value === 'true';
    return { wordCount: on('wordCount'), readTime: on('readTime'), progressBar: on('progressBar') };
};

/** "1200 words | 6m | 42%" for the enabled parts. */
export function statsText({ flags, words, progress }) {
    const parts = [];
    if (flags.wordCount) parts.push(`${words} words`);
    if (flags.readTime) parts.push(`${Math.max(1, Math.round(words / WORDS_PER_MINUTE))}m`);
    if (flags.progressBar) parts.push(`${Math.round(progress * 100)}%`);
    return parts.join(' | ');
}

/** @param {{ document: Document, window: Window }} deps */
export function createReadingStats({ document, window }) {
    const el = document.createElement('div');
    el.className = 'reading-stats';
    el.hidden = true;
    document.body.appendChild(el);
    let current = { flags: {}, words: 0 };

    const progress = () => {
        const room = document.documentElement.scrollHeight - window.innerHeight;
        return room <= 0 ? 1 : Math.min(1, Math.max(0, window.scrollY / room));
    };
    const render = () => {
        const text = statsText({ ...current, progress: progress() });
        el.textContent = text;
        el.hidden = text === '';
    };
    window.addEventListener('scroll', render, { passive: true });

    return {
        /** Call after a page opens or is edited. */
        update(doc) {
            current = { flags: flagsOf(doc), words: doc ? countWords(doc) : 0 };
            render();
        },
        dispose() {
            window.removeEventListener('scroll', render);
            el.remove();
        },
    };
}
