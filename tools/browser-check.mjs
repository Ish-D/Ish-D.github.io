#!/usr/bin/env node
/**
 * Loads the built site in a real browser (Chromium, Firefox or WebKit, through Playwright) and checks it the way a
 * reader meets it: pages open without script errors at the address they are shared at, a missing page lands on the
 * app, links move between pages, lines are drawn where the layout put them, and a page prints: every sheet comes out
 * (in Chromium, as a PDF) with the end of the page on paper and the figures in it.
 *
 *   node tools/browser-check.mjs --browser chromium --site _site --out report
 *
 * Needs `playwright` installed and, for the PDF checks, poppler (pdfinfo, pdftotext, pdfimages, pdftoppm).
 * Prints a table, writes report.json, and writes the pictures it took into the report folder.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStaticServer } from './serve.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const browserName = flag('--browser', 'chromium');
const site = resolve(flag('--site', '_site'));
const out = resolve(flag('--out', join('report', browserName)));
mkdirSync(out, { recursive: true });

const playwright = await import('playwright');
const engine = playwright[browserName];
if (!engine) throw new Error(`no browser called ${browserName}`);

const results = [];
/** `hard` checks fail the run; the others are measurements worth seeing. */
function record(page, check, ok, detail = '', hard = true) {
    results.push({ page, check, ok, detail, hard });
    const mark = ok ? 'ok  ' : hard ? 'FAIL' : 'warn';
    console.log(`${mark} ${browserName} ${page} ${check}${detail ? `  ${detail}` : ''}`);
    if (!ok) console.log(`::${hard ? 'error' : 'warning'} title=${browserName} ${page}: ${check}::${String(detail).replace(/\n/g, ' ').slice(0, 900)}`);
}

const have = (command) => { try { execFileSync('which', [command], { stdio: 'ignore' }); return true; } catch { return false; } };
const poppler = have('pdfinfo') && have('pdftotext') && have('pdfimages') && have('pdftoppm');
const run = (command, ...argv) => execFileSync(command, argv, { encoding: 'utf8', maxBuffer: 1 << 26 });

const server = createStaticServer({ root: site, pages: true });
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;

const launchArgs = browserName === 'chromium' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [];
const browser = await engine.launch({ args: launchArgs });
console.log(`${browserName} ${browser.version()} against ${origin}`);

/** What the page was meant to be called, read from the HTML the server sent. */
const titleOf = (html) => /<title>([\s\S]*?)<\/title>/.exec(html)?.[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"');

const APP_PARTS = ['selection', 'snapper', 'hover', 'hoverOutline', 'inserter', 'toolbar', 'prefs', 'view', 'pages', 'saver', 'print'];

async function open(path, { width = 1280, height = 800, scale = 1, theme = 'light', locale = 'en-US' } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale });
    const page = await context.newPage();
    const errors = [];
    const logged = [];
    page.on('pageerror', (err) => errors.push(String(err.message ?? err)));
    page.on('console', (msg) => { if (msg.type() === 'error') logged.push(msg.text()); });
    page.on('response', (res) => { if (res.status() >= 400) logged.push(`${res.status()} ${res.url().replace(origin, '')}`); });
    const response = await page.goto(`${origin}${path}${path.includes('?') ? '&' : '?'}theme=${theme}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.querySelector('.doc .ln'), null, { timeout: 45000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForTimeout(1200);
    return { context, page, errors, logged, response };
}

const INK_DPI = 48;

/** The share of a rectangle (in CSS px on the page) that is dark in a grayscale PGM of the page. */
function darkShare(pgmPath, rect, dpi) {
    const buf = readFileSync(pgmPath);
    let pos = 0;
    const token = () => {
        while (/\s/.test(String.fromCharCode(buf[pos]))) pos++;
        let text = '';
        while (!/\s/.test(String.fromCharCode(buf[pos]))) text += String.fromCharCode(buf[pos++]);
        return text;
    };
    token();
    const [w, h] = [Number(token()), Number(token())];
    token();
    pos++;
    const k = dpi / 96;
    let dark = 0;
    let total = 0;
    for (let y = Math.floor(rect.y * k); y < Math.min(h, Math.ceil((rect.y + rect.h) * k)); y++) {
        for (let x = Math.floor(rect.x * k); x < Math.min(w, Math.ceil((rect.x + rect.w) * k)); x++) {
            total++;
            if (buf[pos + y * w + x] < 110) dark++;
        }
    }
    return total ? dark / total : 0;
}

const shot = (page, name, options = {}) => page.screenshot({ path: join(out, `${name}.png`), ...options });

// ---------------------------------------------------------------------------
// Pages open
// ---------------------------------------------------------------------------

const PAGES = [
    { path: '/', name: 'home' },
    { path: '/about/', name: 'about' },
    { path: '/writing/', name: 'writing' },
    { path: '/lab/', name: 'lab' },
    { path: '/layout-test/', name: 'layout-test' },
    { path: '/margin-test/', name: 'margin-test' },
    { path: '/photography/', name: 'photography' },
    { path: '/umbrella/', name: 'umbrella' },
    { path: '/llms_for_bozos_1/', name: 'llms', long: true },
];

/** Justified lines are drawn at their natural width and compared with the width the layout gave them. */
const fidelity = () => {
    const lines = [...document.querySelectorAll('.ln.just')];
    for (const l of lines) { l.style.textAlign = 'left'; l.style.textAlignLast = 'left'; }
    let bad = 0;
    for (const l of lines) {
        const k = [...l.children].filter(c => !c.classList.contains('mk') && !c.classList.contains('sp')).pop();
        if (k && Math.abs(k.getBoundingClientRect().right - l.getBoundingClientRect().left - parseFloat(l.style.width)) > 0.5) bad++;
    }
    return { lines: lines.length, bad };
};

/** A word split by a hyphen, and a phrase that wraps at a space, are looked for with the browser's own find. */
const findText = () => {
    const ln = [...document.querySelectorAll('.ln')];
    let word = '';
    let phrase = '';
    for (let i = 0; i < ln.length - 1 && !(word && phrase); i++) {
        const hd = ln[i].querySelector('.hd');
        const tl = hd && hd.parentNode.querySelector('.tl');
        if (!word && tl) word = hd.textContent + tl.textContent;
        const sp = ln[i].querySelector('.sp');
        if (!phrase && sp && sp.textContent === ' ') {
            const a = ln[i].textContent.trim().split(/\s+/).slice(-2);
            const b = ln[i + 1].textContent.trim().split(/\s+/).slice(0, 2);
            if (a.length === 2 && b.length === 2) phrase = a.concat(b).join(' ');
        }
    }
    const found = (t) => { getSelection().removeAllRanges(); return t && typeof window.find === 'function' ? window.find(t, false, false, true) : false; };
    return { word, phrase, foundWord: found(word), foundPhrase: found(phrase) };
};

/** Runs one part of the check; if it throws, that is the result. */
async function part(label, check, body) {
    try {
        await body();
    } catch (err) {
        record(label, check, false, String(err.message ?? err).split('\n')[0]);
    }
}

for (const spec of PAGES) {
    const label = spec.name;
    let session;
    try {
        session = await open(spec.path);
    } catch (err) {
        record(label, 'opens', false, String(err.message ?? err).split('\n')[0]);
        continue;
    }
    const { context, page, errors, logged, response } = session;
    record(label, 'served', response.status() === 200, `status ${response.status()}`);
    record(label, 'no script errors', errors.length === 0, errors.slice(0, 3).join(' | '), true);
    record(label, 'nothing logged as an error', logged.length === 0, logged.slice(0, 3).join(' | '), false);

    const expected = titleOf(await response.text());
    const state = await page.evaluate((parts) => {
        const app = window.__v2?.app;
        return {
            title: document.title,
            missing: parts.filter(k => !app || !app[k]),
            blocks: app?.state.layout?.blocks.length ?? 0,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
    }, APP_PARTS);
    record(label, 'the app is whole', state.missing.length === 0 && state.blocks > 0, `missing: ${state.missing.join(',') || 'none'}; ${state.blocks} blocks`);
    record(label, 'tab title is the page title', state.title === expected, `"${state.title}" against "${expected}"`);
    record(label, 'no sideways scroll', state.overflow <= 1, `${state.overflow}px over`, false);

    if (spec.long || spec.name === 'about') {
        const f = await page.evaluate(fidelity);
        record(label, 'lines are drawn as laid out', f.lines === 0 || f.bad <= f.lines * 0.1, `${f.bad} of ${f.lines} justified lines differ`, false);
    }
    if (spec.long) {
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => !!document.querySelector('.doc .ln'), null, { timeout: 45000 });
        await page.waitForTimeout(800);
        const f = await page.evaluate(findText);
        record(label, 'find reaches a split word and a wrapped phrase', f.foundWord && f.foundPhrase, `word "${f.word}" ${f.foundWord}; phrase "${f.phrase}" ${f.foundPhrase}`, false);
    }
    await shot(page, `${label}-desktop`);
    await context.close();

    const phone = await open(spec.path, { width: 390, height: 844, scale: 2 });
    record(label, 'phone: no script errors', phone.errors.length === 0, phone.errors.slice(0, 3).join(' | '));
    await shot(phone.page, `${label}-phone`);
    await phone.context.close();

    if (['home', 'llms', 'umbrella'].includes(label)) {
        const dark = await open(spec.path, { theme: 'dark' });
        record(label, 'dark: no script errors', dark.errors.length === 0, dark.errors.slice(0, 3).join(' | '));
        await shot(dark.page, `${label}-dark`);
        await dark.context.close();
    }
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

await part('home', 'links open pages', async () => {
    const { context, page } = await open('/');
    const first = await page.evaluate(() => [...document.querySelectorAll('a[data-card]')].map(a => a.getAttribute('href')));
    record('home', 'links are clean paths', first.length >= 3 && first.every(h => /^\/[\w-]+\/$/.test(h)), first.join(' '));
    await page.click('a[data-card="about"]');
    await page.waitForFunction(() => window.__v2.app.state.page === 'about', null, { timeout: 15000 }).catch(() => {});
    const moved = await page.evaluate(() => ({ path: location.pathname, title: document.title, page: window.__v2.app.state.page }));
    record('home', 'a link opens its page at its path', moved.path === '/about/' && moved.page === 'about' && moved.title === 'About · ish', JSON.stringify(moved));
    await page.goBack();
    await page.waitForFunction(() => window.__v2.app.state.page === 'menu', null, { timeout: 15000 }).catch(() => {});
    const back = await page.evaluate(() => ({ path: location.pathname, page: window.__v2.app.state.page }));
    record('home', 'back returns to the home page', back.path === '/' && back.page === 'menu', JSON.stringify(back));
    await context.close();
});

await part('no-such-page', 'a missing address', async () => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err.message ?? err)));
    const response = await page.goto(`${origin}/no-such-page/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__v2?.app?.state, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const landed = await page.evaluate(() => ({ search: location.search, text: document.querySelector('.doc')?.textContent ?? '' }));
    record('no-such-page', 'a missing address lands on the app and says so', /page=no-such-page/.test(landed.search) && /no page called/i.test(landed.text), JSON.stringify(landed).slice(0, 200));
    record('no-such-page', 'no script errors', errors.length === 0, errors.join(' | '));
    void response;
    await context.close();
});

await part('llms', 'an address without its slash', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(`${origin}/llms_for_bozos_1`, { waitUntil: 'load' });
    record('llms', 'an address without its slash is moved to the one with', new URL(page.url()).pathname === '/llms_for_bozos_1/' && response.status() === 200, page.url());
    await context.close();
});

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const PRINTED = [
    { name: 'llms', path: '/llms_for_bozos_1/', notes: 10, tail: true },
    { name: 'umbrella', path: '/umbrella/', pictures: 2 },
    { name: 'layout-test', path: '/layout-test/', notes: 1 },
    { name: 'lab', path: '/lab/', notes: 1 },
];

for (const spec of PRINTED) await part(spec.name, 'prints', async () => {
    const { context, page, errors } = await open(spec.path);
    await page.evaluate(() => {
        window.__printEvents = [];
        window.addEventListener('beforeprint', () => window.__printEvents.push('before'));
        window.addEventListener('afterprint', () => window.__printEvents.push('after'));
    });
    const made = await page.evaluate(() => {
        const tail = [...document.querySelectorAll('.doc > .blk')].pop()?.textContent.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(-30) ?? '';
        window.__v2.app.print.prepare();
        const root = document.querySelector('.print-root');
        const sheets = [...root.querySelectorAll('.sheet')];
        return {
            tail,
            sheets: sheets.length,
            notes: root.querySelectorAll('aside.note').length,
            pictures: root.querySelectorAll('.viz-container canvas, .viz-container img, .viz-container svg').length,
            missing: root.querySelectorAll('.figure-missing').length,
            shownOnScreen: getComputedStyle(root).display,
            sheetWidth: sheets[0]?.style.width,
        };
    });
    record(spec.name, 'sheets are made', made.sheets > 0, `${made.sheets} sheets, ${made.notes} notes, ${made.pictures} pictures, ${made.missing} figures missing`);
    record(spec.name, 'the sheets are not shown on screen', made.shownOnScreen === 'none', made.shownOnScreen);
    if (spec.notes) record(spec.name, 'notes are in the margins', made.notes >= spec.notes, `${made.notes} of at least ${spec.notes}`);
    if (spec.pictures) record(spec.name, 'the figure is pictured', made.pictures >= spec.pictures && made.missing === 0, `${made.pictures} pictures, ${made.missing} missing`);

    await page.emulateMedia({ media: 'print' });
    const shown = await page.evaluate(() => ({
        root: getComputedStyle(document.querySelector('.print-root')).display,
        page: getComputedStyle(document.querySelector('#root')).display,
        sheet: Math.round(document.querySelector('.sheet')?.getBoundingClientRect().width ?? 0),
        has: document.documentElement.classList.contains('has-sheets'),
        // where the first figure sits on its sheet, to look for ink there on paper
        figure: (() => {
            const figure = document.querySelector('.print-root .viz-container');
            const sheet = figure?.closest('.sheet');
            if (!figure || !sheet) return null;
            const a = figure.getBoundingClientRect();
            const b = sheet.getBoundingClientRect();
            return { sheet: [...sheet.parentNode.children].indexOf(sheet), x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
        })(),
    }));
    record(spec.name, 'in print only the sheets are shown', shown.root === 'block' && shown.page === 'none' && shown.has, JSON.stringify(shown));
    for (const n of [1, 2]) {
        const sheet = page.locator('.print-root .sheet').nth(n - 1);
        if (await sheet.count()) await sheet.screenshot({ path: join(out, `print-${spec.name}-${n}.png`) });
    }

    if (browserName === 'chromium') {
        const pdfPath = join(out, `print-${spec.name}.pdf`);
        writeFileSync(pdfPath, await page.pdf({ preferCSSPageSize: true, printBackground: false }));
        const events = await page.evaluate(() => window.__printEvents);
        record(spec.name, 'the print events fire', events.includes('before'), `events: ${events.join(',') || 'none'}`, false);
        if (poppler) {
            const pages = Number(/^Pages:\s+(\d+)/m.exec(run('pdfinfo', pdfPath))?.[1]);
            record(spec.name, 'every sheet is a page', pages === made.sheets, `${pages} pages for ${made.sheets} sheets`);
            if (spec.tail && made.tail) {
                const text = run('pdftotext', pdfPath, '-').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
                record(spec.name, 'the end of the page is on paper', text.includes(made.tail), made.tail);
            }
            const images = run('pdfimages', '-list', '-f', '1', '-l', '1', pdfPath).split('\n').slice(2).filter(Boolean).length;
            if (spec.pictures) record(spec.name, 'the figure is on the first page', images >= spec.pictures, `${images} pictures on page 1`);
            if (spec.pictures && shown.figure) {
                const n = shown.figure.sheet + 1;
                run('pdftoppm', '-r', String(INK_DPI), '-gray', '-f', String(n), '-l', String(n), '-singlefile', pdfPath, join(out, `ink-${spec.name}`));
                const ink = darkShare(join(out, `ink-${spec.name}.pgm`), shown.figure, INK_DPI);
                record(spec.name, 'the figure has ink on paper', ink > 0.03, `${(ink * 100).toFixed(1)}% of its box is dark`);
            }
            run('pdftoppm', '-r', '60', '-png', '-f', '1', '-l', '3', pdfPath, join(out, `pdf-${spec.name}`));
        } else {
            record(spec.name, 'the pdf was looked at', false, 'poppler is not installed', false);
        }
    }
    record(spec.name, 'no script errors while printing', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
});

await browser.close();
server.close();

const failed = results.filter(r => !r.ok && r.hard);
const warned = results.filter(r => !r.ok && !r.hard);
writeFileSync(join(out, 'report.json'), JSON.stringify({ browser: browserName, origin, results }, null, 2));
console.log(`\n${browserName}: ${results.length} checks, ${failed.length} failed, ${warned.length} to look at`);
process.exit(failed.length ? 1 : 0);
