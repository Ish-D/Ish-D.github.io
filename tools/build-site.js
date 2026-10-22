#!/usr/bin/env node
/**
 * Builds the site as it is served: the files the browser needs, the list of cards, a page of its own for each card
 * (so a shared link has a title and a preview, and a crawler gets a 200 and the text), a feed, a sitemap and robots.txt.
 *
 *   node tools/build-site.js [--out _site] [--manifest-only]
 *
 * Settings are in site.json. `--manifest-only` writes cards/manifest.json in place and nothing else.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../core/doc/parse.js';
import { titleOf } from '../core/doc/title.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Things in the repository that are not part of the site. */
const LEFT_OUT = new Set(['.git', '.github', '.gitignore', 'node_modules', 'test', 'tools', 'venv', 'rectangle-editor', 'old_site_full', '__pycache__', '.history', 'server.py', 'package.json', 'package-lock.json', 'README.md']);

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Every card under `dir`, as `{ name, file }`, in order. A card in a folder is named `folder/card`. */
export function listCards(dir) {
    const found = [];
    const walk = (folder) => {
        for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.')) walk(path);
            } else if (entry.name.endsWith('.md')) {
                found.push({ name: relative(dir, path).split(sep).join('/').slice(0, -3), file: path });
            }
        }
    };
    walk(dir);
    return found;
}

/** The front matter lines of a card, as the manifest has always read them. */
export function frontMatter(source) {
    const match = /^---\s*\n([\s\S]*?)\n---/.exec(source);
    if (!match) return null;
    const text = match[1];
    const read = (key) => new RegExp(`^${key}:\\s*(.+)`, 'm').exec(text)?.[1].trim();
    return {
        name: read('name'),
        tags: read('tags'),
        date: /^date:\s*(\d{2}-\d{2}-\d{4})/m.exec(text)?.[1],
        encrypted: text.includes('encrypted: true'),
        hidden: /^visible:\s*false/m.test(text),
    };
}

/**
 * The list of cards and what is known about each, as `cards/manifest.json` has it. A card marked `visible: false`
 * is not in it.
 */
export function buildManifest(cards) {
    const names = [];
    const metadata = {};
    for (const { name, source } of cards) {
        names.push(name);
        const fm = frontMatter(source);
        if (!fm) continue;
        if (fm.hidden) { names.pop(); continue; }
        const meta = {};
        if (fm.name) meta.name = fm.name;
        if (fm.tags) meta.tags = fm.tags;
        if (fm.date) meta.date = fm.date;
        if (fm.encrypted) meta.encrypted = true;
        if (Object.keys(meta).length) metadata[name] = meta;
    }
    return { cards: names.sort(), metadata };
}

// ---------------------------------------------------------------------------
// Text of a card
// ---------------------------------------------------------------------------

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unquote = (value) => String(value ?? '').replace(/^"([\s\S]*)"$/, '$1');
const argsOf = (node) => node.args?.items ?? [];
const argOf = (node, key) => unquote(argsOf(node).find(a => a.key === key)?.value);
const positionalOf = (node, i = 0) => unquote(argsOf(node).filter(a => a.key === null)[i]?.value);

/** Directives that leave nothing in the text. */
const SILENT = new Set(['tab', 'break', 'bigbreak', 'toc', 'tags', 'date', 'viz', 'figure', 'drawing', 'gallery', 'embed', 'var', 'slider', 'toggle', 'button', 'input', 'textarea', 'columns-break']);

const isUrl = (text) => /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
const pagePath = (name) => `/${name.split('/').map(encodeURIComponent).join('/')}/`;

function inlineHtml(nodes = [], page) {
    return nodes.map((node) => {
        switch (node.type) {
            case 'text': return escapeHtml(node.value).replace(/\{\{\w+\}\}/g, '');
            case 'emph': return `<em>${inlineHtml(node.children, page)}</em>`;
            case 'strong': return `<strong>${inlineHtml(node.children, page)}</strong>`;
            case 'codespan': return `<code>${escapeHtml(node.value)}</code>`;
            case 'mathinline': return `<code>${escapeHtml(node.tex)}</code>`;
            case 'link': return `<a href="${escapeHtml(node.href)}">${inlineHtml(node.children, page)}</a>`;
            case 'image': return node.alt ? escapeHtml(node.alt) : '';
            case 'directive': return directiveHtml(node, page);
            default: return '';
        }
    }).join('');
}

function directiveHtml(node, page) {
    if (SILENT.has(node.name)) return '';
    const inline = node.groups?.find(g => g.kind === 'inline');
    switch (node.name) {
        case 'drop': return escapeHtml(positionalOf(node));
        case 'cite': {
            const target = positionalOf(node);
            const text = inlineHtml(inline?.children, page);
            return isUrl(target) ? `<a href="${escapeHtml(target)}">${text || escapeHtml(target)}</a>` : text;
        }
        case 'link':
        case 'card': {
            const target = positionalOf(node);
            const shown = argOf(node, 'display') || inlineHtml(inline?.children, page) || target;
            const href = isUrl(target) ? target : pagePath(target);
            return `<a href="${escapeHtml(href)}">${isUrl(target) || !argOf(node, 'display') ? shown : escapeHtml(shown)}</a>`;
        }
        case 'note':
        case 'margin': return '';
        default: return (node.groups ?? []).map(g => (g.kind === 'inline' ? inlineHtml(g.children, page) : blocksHtml(g.children, page))).join(' ');
    }
}

/** The blocks of a card as plain HTML, for those who cannot run the page. */
function blocksHtml(blocks = [], page) {
    return blocks.map((block) => {
        switch (block.type) {
            case 'heading': return `<h${Math.min(6, block.level)}>${inlineHtml(block.children, page)}</h${Math.min(6, block.level)}>`;
            case 'paragraph': return `<p>${inlineHtml(block.children, page)}</p>`;
            case 'list': {
                const tag = block.ordered ? 'ol' : 'ul';
                return `<${tag}>${block.items.map(item => `<li>${inlineHtml(item.children, page)}</li>`).join('')}</${tag}>`;
            }
            case 'blockquote': return `<blockquote>${blocksHtml(block.children, page)}</blockquote>`;
            case 'code': return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
            case 'math': return `<p><code>${escapeHtml(block.tex.trim())}</code></p>`;
            case 'table': {
                const row = (cells, tag) => `<tr>${cells.map(c => `<${tag}>${inlineHtml(c, page)}</${tag}>`).join('')}</tr>`;
                return `<table>${row(block.header, 'th')}${block.rows.map(r => row(r, 'td')).join('')}</table>`;
            }
            case 'directive': {
                if (SILENT.has(block.name)) return '';
                if (block.name === 'note' || block.name === 'margin') {
                    const body = block.groups?.find(g => g.kind === 'blocks')?.children;
                    return body?.length ? `<aside>${blocksHtml(body, page)}</aside>` : '';
                }
                if (block.name === 'summary') return `<p>${inlineHtml(block.groups?.[0]?.children, page)}</p>`;
                if (block.name === 'image') {
                    const caption = inlineHtml(block.groups?.find(g => g.kind === 'inline')?.children, page);
                    return caption ? `<p>${caption}</p>` : '';
                }
                if (block.name === 'link' || block.name === 'card' || block.name === 'cite') return `<p>${directiveHtml(block, page)}</p>`;
                return (block.groups ?? []).map(g => (g.kind === 'inline' ? `<p>${inlineHtml(g.children, page)}</p>` : blocksHtml(g.children, page))).join('');
            }
            default: return '';
        }
    }).filter(Boolean).join('\n');
}

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** About a sentence or two of a card, to say what it is. */
export function describe(doc, fallback = '') {
    const summary = doc.children.find(b => b.type === 'directive' && b.name === 'summary');
    const paragraph = doc.children.find(b => b.type === 'paragraph');
    const html = summary ? inlineHtml(summary.groups?.[0]?.children) : paragraph ? inlineHtml(paragraph.children) : '';
    const text = stripTags(html);
    if (!text) return fallback;
    if (text.length <= 200) return text;
    return `${text.slice(0, 200).replace(/\s+\S*$/, '')}…`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** `04-14-2026` as `2026-04-14`. */
export const isoDate = (date) => (date ? date.replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$1-$2') : null);

function pageMeta({ title, description, url, site, article, noindex, feed = true }) {
    const image = `${site.origin}${site.image}`;
    return [
        `<meta name="description" content="${escapeHtml(description)}">`,
        `<link rel="canonical" href="${escapeHtml(url)}">`,
        noindex ? '<meta name="robots" content="noindex">' : '',
        `<meta property="og:site_name" content="${escapeHtml(site.title)}">`,
        `<meta property="og:type" content="${article ? 'article' : 'website'}">`,
        `<meta property="og:title" content="${escapeHtml(title)}">`,
        `<meta property="og:description" content="${escapeHtml(description)}">`,
        `<meta property="og:url" content="${escapeHtml(url)}">`,
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        article ? `<meta property="article:published_time" content="${escapeHtml(article)}">` : '',
        '<meta name="twitter:card" content="summary">',
        `<meta name="twitter:title" content="${escapeHtml(title)}">`,
        `<meta name="twitter:description" content="${escapeHtml(description)}">`,
        feed ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="/feed.xml">` : '',
    ].filter(Boolean).join('\n    ');
}

const TITLE = '<title>ish</title>';
const ROOT = '<div id="root"></div>';

/**
 * The shell of the app (index.html) made into the page for one address: its title and previews in the head, and the
 * text of the page where a browser that does not run the page can read it.
 */
export function renderPage(shell, { title, tab = title, description, url, site, body, article, noindex }) {
    if (!shell.includes(TITLE) || !shell.includes(ROOT)) throw new Error(`index.html no longer has ${TITLE} and ${ROOT}, which the pages are made from`);
    const head = `<title>${escapeHtml(tab)}</title>\n    ${pageMeta({ title, description, url, site, article, noindex })}`;
    const text = `${ROOT}\n    <noscript><main>\n${body}\n</main></noscript>`;
    return shell.replace(TITLE, head).replace(ROOT, text);
}

/** A list of cards as links, newest first when they have dates. */
function linkList(entries) {
    return `<ul>${entries.map(e => `<li><a href="${pagePath(e.name)}">${escapeHtml(e.title)}</a>${e.date ? ` <time datetime="${isoDate(e.date)}">${isoDate(e.date)}</time>` : ''}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

const rfc822 = (date) => new Date(`${isoDate(date)}T12:00:00Z`).toUTCString();

export function rssFeed(site, posts) {
    const newest = posts[0] ? rfc822(posts[0].date) : null;
    const items = posts.map(p => `    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${site.origin}${pagePath(p.name)}</link>
      <guid isPermaLink="true">${site.origin}${pagePath(p.name)}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${escapeHtml(p.description)}</description>
    </item>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(site.title)}</title>
    <link>${site.origin}/</link>
    <description>${escapeHtml(site.description)}</description>
    <language>en</language>
    <atom:link href="${site.origin}/feed.xml" rel="self" type="application/rss+xml"/>
${newest ? `    <lastBuildDate>${newest}</lastBuildDate>\n` : ''}${items}
  </channel>
</rss>
`;
}

export function sitemap(site, pages) {
    const urls = pages.map(p => `  <url><loc>${site.origin}${p.path}</loc>${p.date ? `<lastmod>${isoDate(p.date)}</lastmod>` : ''}</url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

export function readSite(dir = root) {
    const site = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8'));
    return { image: '/images/higuchi.png', home: 'menu', unlisted: [], ...site, origin: site.origin.replace(/\/$/, '') };
}

/** Copies what the browser needs, leaving out what is only for working on the site. */
function copySite(from, to) {
    cpSync(from, to, {
        recursive: true,
        filter: (path) => {
            const rel = relative(from, path);
            if (!rel) return true;
            if (resolve(path) === resolve(to)) return false;
            return !rel.split(sep).some(part => LEFT_OUT.has(part) || part === '_site');
        },
    });
}

export function build({ out, source = root, log = () => {} }) {
    const site = readSite(source);
    const cardsDir = join(source, 'cards');
    const cards = listCards(cardsDir).map(c => ({ ...c, source: readFileSync(c.file, 'utf8') }));
    const manifest = buildManifest(cards);

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    copySite(source, out);
    writeFileSync(join(out, 'cards', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const shell = readFileSync(join(source, 'index.html'), 'utf8');
    const entries = [];
    for (const card of cards) {
        if (!manifest.cards.includes(card.name)) continue;
        const fm = frontMatter(card.source) ?? {};
        const doc = parse(card.source);
        const title = titleOf(doc) || card.name;
        entries.push({ name: card.name, title, date: fm.date, encrypted: !!fm.encrypted, doc, listed: !fm.encrypted && !site.unlisted.includes(card.name) });
    }
    for (const e of entries) e.description = describe(e.doc, site.description);

    const dated = entries.filter(e => e.listed && e.date).sort((a, b) => (isoDate(a.date) < isoDate(b.date) ? 1 : -1));
    const pageList = (name) => (name === 'writing' ? `\n${linkList(dated)}` : '');

    let written = 0;
    for (const e of entries) {
        if (e.encrypted || e.name === site.home) continue;
        const target = join(out, ...e.name.split('/'));
        if (existsSync(target)) throw new Error(`the card "${e.name}" has the name of a folder that is part of the site`);
        mkdirSync(target, { recursive: true });
        const titled = e.doc.children.some(b => b.type === 'heading' && b.level === 1);
        const body = `${titled ? '' : `<h1>${escapeHtml(e.title)}</h1>\n`}${blocksHtml(e.doc.children, e.name)}${pageList(e.name)}\n<p><a href="/">${escapeHtml(site.title)}</a></p>`;
        writeFileSync(join(target, 'index.html'), renderPage(shell, {
            title: e.title, tab: `${e.title} · ${site.title}`, description: e.description, url: `${site.origin}${pagePath(e.name)}`,
            site, body, article: e.date && e.listed ? isoDate(e.date) : undefined, noindex: !e.listed,
        }));
        written++;
    }

    const links = entries.filter(e => e.listed && e.name !== site.home);
    writeFileSync(join(out, 'index.html'), renderPage(shell, {
        title: site.title, description: site.description, url: `${site.origin}/`, site,
        body: `<h1>${escapeHtml(site.title)}</h1>\n<p>${escapeHtml(site.description)}</p>\n${linkList(links)}`,
    }));

    writeFileSync(join(out, 'feed.xml'), rssFeed(site, dated.map(e => ({ name: e.name, title: e.title, date: e.date, description: e.description }))));
    writeFileSync(join(out, 'sitemap.xml'), sitemap(site, [{ path: '/' }, ...entries.filter(e => e.listed && e.name !== site.home).map(e => ({ path: pagePath(e.name), date: e.date }))]));
    writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);
    log(`${manifest.cards.length} cards, ${written} pages, ${dated.length} in the feed`);
    return { manifest, written, posts: dated.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
    const out = resolve(flag('--out') ?? join(root, '_site'));
    if (args.includes('--manifest-only')) {
        const cards = listCards(join(root, 'cards')).map(c => ({ ...c, source: readFileSync(c.file, 'utf8') }));
        writeFileSync(join(root, 'cards', 'manifest.json'), `${JSON.stringify(buildManifest(cards), null, 2)}\n`);
        console.log('wrote cards/manifest.json');
    } else {
        if (!statSync(root).isDirectory()) throw new Error('no repository');
        build({ out, log: (line) => console.log(`${line} in ${relative(process.cwd(), out) || '.'}`) });
    }
}
