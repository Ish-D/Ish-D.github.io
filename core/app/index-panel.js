/**
 * The list of pages behind the "/" in the top line: type to narrow it, arrows and Enter to go, Escape to close.
 */

import { formatDate } from '../layout/generated.js';
import { parseDate } from './page-lists.js';
import { HOME_PAGE } from './urls.js';

/**
 * The pages to list, from the manifest: pages without a date A to Z, then posts, newest first. The pages that
 * are private or kept out of the lists are left out unless `all` is set.
 * @returns {Array<{ name: string, title: string, date: string, tags: string }>}
 */
export function pageEntries(manifest, { all = false } = {}) {
    const meta = manifest?.metadata ?? {};
    const entries = (manifest?.cards ?? [])
        .filter(name => name !== HOME_PAGE)
        .map(name => ({ name, title: meta[name]?.name ?? name, date: meta[name]?.date ?? '', tags: meta[name]?.tags ?? '', hidden: !!(meta[name]?.encrypted || meta[name]?.unlisted) }))
        .filter(e => all || !e.hidden);
    const posts = entries.filter(e => e.date).sort((a, b) => parseDate(b.date) - parseDate(a.date));
    const pages = entries.filter(e => !e.date).sort((a, b) => a.title.localeCompare(b.title));
    return [...pages, ...posts];
}

/** The entries that have every word of `query` in their title, name or tags; titles that start with it come first. */
export function matchPages(entries, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return entries;
    const first = words[0];
    const rank = (e) => (e.title.toLowerCase().startsWith(first) ? 0 : e.title.toLowerCase().includes(first) ? 1 : 2);
    return entries
        .map((entry, index) => ({ entry, index, haystack: `${entry.title} ${entry.name} ${entry.tags}`.toLowerCase() }))
        .filter(({ haystack }) => words.every(w => haystack.includes(w)))
        .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
        .map(({ entry }) => entry);
}

/**
 * @param {Record<string, any>} app
 * @param {{ onClose?: () => void }} [hooks]
 */
export function createIndexPanel(app, { onClose = () => {} } = {}) {
    const { document, state } = app;
    const el = (tag, props = {}, ...children) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children);
        return node;
    };

    const input = el('input', { type: 'text', placeholder: 'Go to a page', spellcheck: false, autocomplete: 'off' });
    input.setAttribute('aria-label', 'Go to a page');
    const list = el('ul', { id: 'page-index', role: 'listbox' });
    const panel = el('div', { className: 'panel index', hidden: true }, input, list);
    let shown = [];
    let active = 0;

    function draw() {
        list.replaceChildren(...shown.map((entry, i) => {
            const row = el('li', { role: 'option', id: `page-index-${i}` }, el('span', { textContent: entry.title }));
            if (entry.date) row.append(el('span', { className: 'when', textContent: formatDate(entry.date) }));
            row.setAttribute('aria-selected', String(i === active));
            row.addEventListener('pointerdown', (e) => { e.preventDefault(); go(entry); });
            row.addEventListener('pointermove', () => { if (active !== i) { active = i; mark(); } });
            return row;
        }));
        if (shown.length === 0) list.append(el('li', { className: 'none', textContent: 'No page by that name' }));
        input.setAttribute('aria-activedescendant', shown.length ? `page-index-${active}` : '');
    }

    function mark() {
        [...list.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === active)));
        input.setAttribute('aria-activedescendant', shown.length ? `page-index-${active}` : '');
        list.children[active]?.scrollIntoView?.({ block: 'nearest' });
    }

    function refresh() {
        shown = matchPages(pageEntries(state.manifest, { all: state.canEdit }), input.value);
        active = 0;
        draw();
    }

    function go(entry) {
        close();
        app.pages.open(entry.name);
    }

    function open() {
        input.value = '';
        refresh();
        panel.hidden = false;
        input.focus();
    }

    function close() {
        if (panel.hidden) return;
        panel.hidden = true;
        onClose();
    }

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (shown.length) { active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; mark(); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (shown[active]) go(shown[active]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    });

    return { panel, open, close, toggle: () => (panel.hidden ? open() : close()), isOpen: () => !panel.hidden };
}
