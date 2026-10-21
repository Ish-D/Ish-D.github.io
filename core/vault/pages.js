/**
 * What the vault needs to know about a page's source text.
 */

import { b64u, utf8 } from './crypto.js';

const FRONT = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Front-matter entries as a plain object. */
export function frontMatter(text) {
    const match = FRONT.exec(text);
    const out = {};
    if (!match) return out;
    for (const line of match[1].split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon > 0) out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    return out;
}

/** Title from `name:` in the front matter, else the first heading. */
export function titleOf(text) {
    const entries = frontMatter(text);
    if (entries.name) return entries.name;
    const heading = /^#[ \t]+(.+)$/m.exec(text.replace(FRONT, ''));
    return heading ? heading[1].trim() : 'Untitled';
}

/** The manifest fields a page declares. */
export function manifestEntry(text) {
    const { name, date, tags } = frontMatter(text);
    const out = {};
    if (name) out.name = name;
    if (date) out.date = date;
    if (tags) out.tags = tags;
    return out;
}

/** A page with a title and room to start writing. */
export function scaffold(title) {
    return `---\nname: ${title}\n---\n\n# ${title}\n\n`;
}

/** Short stable fingerprint of a text. */
export async function contentHash(text) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', utf8.encode(text));
    return b64u.encode(new Uint8Array(digest)).slice(0, 22);
}

/** `Lab notes!` → `lab-notes`, usable as a file name under cards/. */
export function slugify(title) {
    return title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}
