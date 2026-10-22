import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildManifest, frontMatter, build, describe, renderPage, rssFeed, sitemap, isoDate } from '../../tools/build-site.js';
import { staticHandler } from '../../tools/serve.js';
import { parse } from '../../core/doc/parse.js';
import { titleOf } from '../../core/doc/title.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
let out;
let built;

before(() => {
    out = mkdtempSync(join(tmpdir(), 'site-'));
    built = build({ out, source: repo });
});
after(() => rmSync(out, { recursive: true, force: true }));

const read = (path) => readFileSync(join(out, path), 'utf8');

test('the list of cards reads front matter as the manifest always has', () => {
    const card = (name, front, body = 'Text.') => ({ name, source: `---\n${front}\n---\n${body}` });
    const manifest = buildManifest([
        card('b', 'name: Bee\ntags: [x, y]\ndate: 04-14-2026'),
        card('a', 'name: Ay\nencrypted: true'),
        card('hidden', 'name: Hidden\nvisible: false'),
        { name: 'plain', source: 'No front matter here.' },
        card('badDate', 'name: Bad\ndate: 2026-04-14'),
    ]);
    assert.deepEqual(manifest.cards, ['a', 'b', 'badDate', 'plain']);
    assert.deepEqual(manifest.metadata.b, { name: 'Bee', tags: '[x, y]', date: '04-14-2026' });
    assert.deepEqual(manifest.metadata.a, { name: 'Ay', encrypted: true });
    assert.deepEqual(manifest.metadata.badDate, { name: 'Bad' });
    assert.equal(manifest.metadata.hidden, undefined);
    assert.equal(frontMatter('no front matter'), null);
    assert.equal(isoDate('04-14-2026'), '2026-04-14');
});

test('the built list of cards has every card that is shown, and the committed one is no worse', () => {
    const manifest = JSON.parse(read('cards/manifest.json'));
    const files = readdirSync(join(repo, 'cards')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
    assert.deepEqual(manifest.cards, files.filter(n => !/visible:\s*false/.test(readFileSync(join(repo, 'cards', `${n}.md`), 'utf8'))).sort());
    const committed = JSON.parse(readFileSync(join(repo, 'cards', 'manifest.json'), 'utf8'));
    for (const name of committed.cards) assert.ok(manifest.cards.includes(name), `${name} is still a card`);
});

test('a card has a page of its own with its title, a preview and its text', () => {
    const html = read('llms_for_bozos_1/index.html');
    assert.match(html, /<title>LLM Inference for Bozos, Part 1 · ish<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/ishandarji\.com\/llms_for_bozos_1\/">/);
    assert.match(html, /<meta property="og:title" content="LLM Inference for Bozos, Part 1">/);
    assert.match(html, /<meta property="og:type" content="article">/);
    assert.match(html, /<meta property="article:published_time" content="2026-04-14">/);
    assert.match(html, /<meta name="description" content="First post in a series/);
    assert.match(html, /<div id="root"><\/div>\s*<noscript><main>/);
    assert.match(html, /<h2>Prologue<\/h2>/);
    assert.match(html, /Large language models/, 'the drop cap is part of the first word');
    assert.doesNotMatch(html, /<meta name="robots"/);
    assert.match(html, /<script type="module" src="\/core\/app\/main\.js">/, 'it is the app');
});

test('nothing of the markup leaks into the text of a page', () => {
    for (const name of ['llms_for_bozos_1', 'llms_for_bozos_2', 'about', 'writing', 'photography', 'tags', 'bookmarks', 'contact', 'koi']) {
        const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(read(`${name}/index.html`))[1];
        assert.doesNotMatch(noscript, /\[\[|\{\{\w+\}\}/, name);
        assert.match(noscript, /<h1>/, `${name} has its title`);
    }
});

test('the writing page lists the posts, newest first, with links', () => {
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(read('writing/index.html'))[1];
    const first = noscript.indexOf('/llms_for_bozos_2/');
    const second = noscript.indexOf('/llms_for_bozos_1/');
    assert.ok(first > 0 && second > first);
});

test('private pages have no page of their own and are not listed', () => {
    for (const name of ['journal', 'math']) {
        assert.equal(existsSync(join(out, name)), false, name);
        assert.doesNotMatch(read('sitemap.xml'), new RegExp(`/${name}/`));
        assert.ok(existsSync(join(out, 'cards', `${name}.md`)), 'the card is still served to the app');
    }
});

test('a page kept out of the lists still opens, and says not to index it', () => {
    const html = read('lab/index.html');
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(read('sitemap.xml'), /\/lab\//);
    assert.doesNotMatch(read('feed.xml'), /\/lab\//);
});

test('the feed has the dated posts, newest first, and the sitemap has the listed pages', () => {
    const feed = read('feed.xml');
    assert.equal((feed.match(/<item>/g) ?? []).length, built.posts);
    assert.ok(feed.indexOf('Part 2') < feed.indexOf('Part 1'));
    assert.match(feed, /<pubDate>Thu, 30 Apr 2026 12:00:00 GMT<\/pubDate>/);
    const map = read('sitemap.xml');
    assert.match(map, /<loc>https:\/\/ishandarji\.com\/<\/loc>/);
    assert.match(map, /<loc>https:\/\/ishandarji\.com\/llms_for_bozos_1\/<\/loc><lastmod>2026-04-14<\/lastmod>/);
    assert.match(read('robots.txt'), /Sitemap: https:\/\/ishandarji\.com\/sitemap\.xml/);
});

test('the home page has a description, and lists the pages for those who cannot run it', () => {
    const html = read('index.html');
    assert.match(html, /<title>ish<\/title>/);
    assert.match(html, /<meta name="description" content="Ishan Darji/);
    assert.match(html, /<noscript>[\s\S]*href="\/writing\/"/);
});

test('the site has what the browser needs and nothing that is only for working on it', () => {
    for (const path of ['index.html', '404.html', 'CNAME', 'core/app/main.js', 'core/render/doc.css', 'fonts/MonotypeModern.otf', 'theme.css', 'cards/llms_for_bozos_1.md', 'cards/llms_for_bozos_1.js', 'Visualizations3D.js']) {
        assert.ok(existsSync(join(out, path)), path);
    }
    for (const path of ['test', 'tools', '.github', '.git', 'package.json', 'core/README.md', 'server.py']) {
        assert.equal(existsSync(join(out, path)), false, path);
    }
});

test('every file a page points at from the root is in the site', () => {
    const html = read('llms_for_bozos_1/index.html');
    const wanted = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map(m => m[1]).filter(p => !p.endsWith('/'));
    assert.ok(wanted.length >= 6);
    for (const path of wanted) assert.ok(existsSync(join(out, path)), path);
});

test('a template that has lost the parts a page is made from is an error, not a page without a preview', () => {
    assert.throws(() => renderPage('<html></html>', { title: 'x', description: 'y', url: 'z', site: { origin: 'https://a.b', title: 't', image: '/i.png' }, body: '' }), /no longer has/);
});

test('text is escaped in the head and in the feed', () => {
    const site = { origin: 'https://a.b', title: 'A & "B"', description: 'x <y>', image: '/i.png' };
    const page = renderPage('<title>ish</title><div id="root"></div>', { title: 'Q & "A"', description: 'a < b', url: 'https://a.b/q/', site, body: '<p>x</p>' });
    assert.match(page, /<title>Q &amp; &quot;A&quot;<\/title>/);
    assert.match(page, /content="a &lt; b"/);
    assert.match(rssFeed(site, [{ name: 'q', title: 'T & U', date: '01-02-2026', description: '<b>' }]), /<title>T &amp; U<\/title>[\s\S]*&lt;b&gt;/);
    assert.match(sitemap(site, [{ path: '/q/' }]), /<loc>https:\/\/a\.b\/q\/<\/loc>/);
});

test('a description is the summary, cut at a word', () => {
    const doc = parse(`[[summary]]{${'word '.repeat(80)}}\n\nBody.\n`);
    const text = describe(doc);
    assert.ok(text.length <= 201 && text.endsWith('…') && !text.includes('  '), text);
    assert.equal(describe(parse('# Title\n\nJust a paragraph here.\n')), 'Just a paragraph here.');
    assert.equal(describe(parse('# Only a title\n'), 'fallback'), 'fallback');
});

/** What the handler answers for an address: status, headers and body text. */
async function ask(handler, url) {
    const answer = { status: 200, headers: {}, body: '' };
    const res = {
        writeHead(status, headers = {}) { answer.status = status; answer.headers = headers; return res; },
        end(body = '') { answer.body = String(body); return res; },
    };
    await handler({ url }, res);
    return answer;
}

test('served as GitHub Pages serves it, a page is found with its slash, and the rest is a 404 page', async () => {
    const pages = staticHandler({ root: out, pages: true });
    const page = await ask(pages, '/llms_for_bozos_1/');
    assert.equal(page.status, 200);
    assert.match(page.body, /<title>LLM Inference for Bozos, Part 1/);
    const moved = await ask(pages, '/llms_for_bozos_1');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.location, '/llms_for_bozos_1/');
    const missing = await ask(pages, '/no-such-page/');
    assert.equal(missing.status, 404);
    assert.match(missing.body, /location\.replace/);
    assert.equal((await ask(pages, '/feed.xml')).headers['content-type'], 'application/xml; charset=utf-8');
});

test('served for working on it, any address that is not a file is the app', async () => {
    const dev = staticHandler({ root: out });
    const res = await ask(dev, '/a-page-that-is-not-built/');
    assert.equal(res.status, 200);
    assert.match(res.body, /<div id="root">/);
    assert.equal((await ask(dev, '/missing.png')).status, 404);
});

test('a page is called by its name, else by its first heading, and the home page is just the site', () => {
    assert.equal(titleOf(parse('---\nname: Named\n---\n# Heading\n')), 'Named');
    assert.equal(titleOf(parse('# A *styled* heading\n')), 'A styled heading');
    assert.equal(titleOf(parse('No heading at all.\n')), '');
    assert.match(read('image-test/index.html'), /<title>Image Block Testing · ish<\/title>/);
});

test('the site can be built into a folder inside the repository, and never over it', () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'));
    try {
        mkdirSync(join(src, 'cards'));
        writeFileSync(join(src, 'index.html'), '<title>ish</title><div id="root"></div>');
        writeFileSync(join(src, '404.html'), 'x');
        writeFileSync(join(src, 'site.json'), JSON.stringify({ origin: 'https://a.b', title: 'ish', description: 'd' }));
        writeFileSync(join(src, 'cards', 'a.md'), '---\nname: A\n---\n# A\n\nText.\n');
        build({ out: join(src, '_site'), source: src });
        build({ out: join(src, '_site'), source: src });
        assert.ok(existsSync(join(src, '_site', 'a', 'index.html')));
        assert.equal(existsSync(join(src, '_site', '_site')), false);
        assert.throws(() => build({ out: src, source: src }), /refusing/);
        assert.throws(() => build({ out: join(src, '..'), source: src }), /refusing/);
        assert.ok(existsSync(join(src, 'cards', 'a.md')), 'the source is untouched');
    } finally {
        rmSync(src, { recursive: true, force: true });
    }
});
