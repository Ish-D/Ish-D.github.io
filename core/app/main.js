/**
 * App shell: loads a page, lays it out with the engine, renders it, and keeps
 * it laid out as the window, font size and margins change.
 */

import { parse } from '../doc/parse.js';
import { layoutDocument } from '../layout/document.js';
import { formatDate } from '../layout/generated.js';
import { renderLayout, selectionText } from '../render/dom.js';
import { loadFonts, createMathService, createImageSizes, createSvgAssets } from '../render/browser.js';
import { createCanvasMeasurer } from '../text/measure.js';
import { english } from '../text/hyphenate.js';
import { createSession } from '../edit/session.js';
import { createEditor } from '../edit/editor.js';
import { createStore, formatNumber } from '../runtime/store.js';
import { attachScrub, bindVars } from '../runtime/scrub.js';
import { mountFigures, disposeFigures, hasFigure } from '../runtime/figures.js';
import { collectVars } from '../doc/refs.js';
import { createTocRail } from './toc.js';
import { createPersonal } from './personal.js';
import '../figures/index.js';

const root = document.getElementById('root');

const DEFAULTS = { fontSize: 20, marginPercent: 28, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
const CARD_SCRIPTS = new Set(['llms_for_bozos_1']);

const state = {
    page: null,
    session: null,
    fallbackDoc: null,
    editor: null,
    editing: null,
    canEdit: false,
    canSave: false,
    saveStatus: '',
    lastSaved: '',
    layout: null,
    store: createStore(),
    liveStops: [],
    unbindVars: null,
    detachScrub: null,
    docEl: null,
    manifest: null,
    settings: loadSettings(),
    scriptRan: false,
    toc: null,
    vaultPage: null,
    expandedNotes: new Set(),
    publicSource: '',
};
const persist = new Map();

function toast(text) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
}

const SAVE_TEXT = { saved: 'saved', pending: 'unsaved', saving: 'saving…', offline: 'offline, will retry' };

const personal = createPersonal({
    toast,
    openPage: (name) => openPage(name),
    onChange(event) {
        if (event.type === 'status') {
            if (state.vaultPage) setStatus(event.state === 'error' ? (event.message || 'could not save') : SAVE_TEXT[event.state]);
        } else if (event.type === 'unlocked' || event.type === 'locked') {
            state.canEdit = state.canSave || personal.unlocked || new URLSearchParams(location.search).has('edit');
            if (!personal.unlocked) state.editor?.setEnabled(false);
            // a draft may exist for the page on screen, and a private page may now be readable
            if (state.page && (state.page.startsWith('~') || personal.unlocked)) openPage(state.page, { push: false, keepScroll: true });
            else buildChrome();
        } else if ((event.type === 'merged' || event.type === 'conflict') && event.id === state.vaultPage?.id) {
            state.session?.reset(event.text);
        }
    },
});
const measurer = createCanvasMeasurer();
const math = createMathService({ document, katex: window.katex, fontSize: state.settings.fontSize });
const images = createImageSizes(() => scheduleLayout());
const drawings = createSvgAssets(() => scheduleLayout());
const drawingUrl = (node) => assetUrl(node.args?.items.find(a => a.key === null)?.value ?? node.args?.items.find(a => a.key === 'src')?.value ?? '');

const varText = (name) => {
    const spec = state.store.spec(name);
    return spec ? formatNumber(state.store.peek(name), spec) : '';
};
math.setValues({ widest: varText, current: varText });

/** Math that shows a variable is retypeset (and the page relaid out) when the variable changes. */
function liveMath(_inner, tex) {
    const names = [...tex.matchAll(/\\val\{(\w+)\}/g)].map(m => m[1]);
    let first = true;
    state.liveStops.push(state.store.watch(names, () => {
        if (first) { first = false; return; }
        scheduleLayout();
    }));
}

function syncVars(doc) {
    for (const spec of collectVars(doc)) state.store.define(spec);
}

function loadSettings() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('v2-settings') ?? '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

function saveSettings() {
    try { localStorage.setItem('v2-settings', JSON.stringify(state.settings)); } catch { /* storage unavailable */ }
}

function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme;
}

// ---------------------------------------------------------------------------
// Environment for the layout engine
// ---------------------------------------------------------------------------

const assetUrl = (path) => (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('/') ? path : `/${path}`);

/** Photographs have web-sized copies in images/photography/web/; the page shows those and links to the original. */
const WEB_VARIANT = /^\/?images\/photography\/(?!web\/)([^/]+)\.[A-Za-z0-9]+$/;
const displayUrl = (path) => {
    const m = WEB_VARIANT.exec(path);
    return m ? `/images/photography/web/${m[1]}.jpg` : assetUrl(path);
};

function imageSrc(node) {
    if (node.type === 'image') return node.src;
    return node.args?.items.find(a => a.key === null)?.value ?? node.args?.items.find(a => a.key === 'src')?.value ?? '';
}

function parseDate(text) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text ?? '');
    return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime() : 0;
}

function syntheticLink(name, display, at) {
    const arg = (key, value) => ({ key, value, keyStart: 0, valueStart: 0, valueEnd: 0 });
    return {
        type: 'directive', name: 'link', block: false, groups: [], start: at.start, end: at.end,
        args: { start: at.start, end: at.end, items: [arg(null, name), arg('display', display)] },
    };
}

/** Blocks for `{{writing}}`: dated posts, newest first. */
function writingBlocks(node) {
    const meta = state.manifest?.metadata ?? {};
    const entries = (state.manifest?.cards ?? [])
        .map(name => ({ name, meta: meta[name] ?? {} }))
        .filter(e => e.meta.date && !e.meta.encrypted)
        .sort((a, b) => parseDate(b.meta.date) - parseDate(a.meta.date));
    return entries.map(e => ({
        type: 'paragraph', start: node.start, end: node.end,
        children: [
            syntheticLink(e.name, e.meta.name ?? e.name, node),
            { type: 'text', value: `  ${formatDate(e.meta.date)}`, start: node.start, end: node.end },
        ],
    }));
}

function buildEnv() {
    const narrow = document.documentElement.clientWidth < 600;
    const { marginPercent } = state.settings;
    const fontSize = narrow ? Math.min(state.settings.fontSize, 18) : state.settings.fontSize;
    math.setFontSize(fontSize);
    return {
        width: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        expandedNotes: state.expandedNotes,
        measurer,
        hyphenator: english,
        settings: { fontSize, marginPercent },
        editing: state.editing,
        atoms: {
            inlineMath: (tex) => math.render(tex, false) ?? { width: tex.length * fontSize * 0.5, height: fontSize * 1.2, ascent: fontSize },
            displayMath: (tex) => math.render(tex, true) ?? { width: 0, height: fontSize * 2.5 },
            image: (node) => {
                const size = images.get(displayUrl(node.src)) ?? { width: fontSize * 6, height: fontSize * 4 };
                const height = Math.min(size.height, fontSize * 1.4);
                return { width: size.width * (height / size.height), height };
            },
            widget: () => ({ width: fontSize * 5, height: fontSize * 1.3 }),
            variable: (name) => {
                if (!state.store.has(name)) return null;
                const text = state.store.widest(name, formatNumber);
                return { width: measurer.width(text, { family: 'MonotypeModern', size: fontSize }) + 14, height: fontSize * 1.4 };
            },
        },
        objects: {
            natural: (node) => {
                if (node.name === 'image') return images.get(displayUrl(imageSrc(node)));
                if (node.name === 'drawing') return drawings.get(drawingUrl(node));
                return null;
            },
            mask: () => null,
        },
        generate: (node) => {
            if (node.name === 'macro' && node.args?.items[0]?.value === 'writing') return writingBlocks(node);
            return null;
        },
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderContext() {
    return {
        document,
        measurer,
        math: (tex, display) => math.render(tex, display),
        highlight: (el, lang) => { if (window.Prism && lang) window.Prism.highlightElement(el); },
        resolveAsset: displayUrl,
        fullAsset: assetUrl,
        persist,
        widget: buildWidget,
        formatVar: varText,
        liveMath,
        isFigure: hasFigure,
        drawing: (src) => drawings.get(assetUrl(src)) ?? null,
    };
}

function buildWidget(node) {
    const get = (k) => node.args?.items.find(a => a.key === k)?.value;
    const bind = get('bind');
    if (node.name === 'toggle' && bind === 'theme') {
        const b = document.createElement('button');
        b.className = 'w-toggle';
        b.textContent = get('label') ?? 'dark mode';
        b.onclick = () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); };
        return b;
    }
    if (node.name === 'slider' && (bind === 'fontSize' || bind === 'marginSize')) {
        const key = bind === 'fontSize' ? 'fontSize' : 'marginPercent';
        const input = document.createElement('input');
        input.type = 'range';
        input.min = get('min') ?? 12;
        input.max = get('max') ?? 22;
        input.step = get('step') ?? 1;
        input.value = state.settings[key];
        input.oninput = () => { state.settings[key] = Number(input.value); saveSettings(); scheduleLayout(); };
        return input;
    }
    if (node.name === 'input' || node.name === 'textarea') {
        const field = document.createElement(node.name === 'input' ? 'input' : 'textarea');
        field.className = 'w-field';
        field.placeholder = get('placeholder') ?? '';
        if (node.name === 'textarea') field.rows = Number(get('rows') ?? 5);
        return field;
    }
    if (node.name === 'button') {
        const b = document.createElement('button');
        b.className = 'w-button';
        b.textContent = get('label') ?? 'OK';
        const action = get('action');
        if (action === 'resetSettings') b.onclick = () => { state.settings = { ...DEFAULTS }; saveSettings(); applyTheme(); scheduleLayout(); };
        else b.disabled = true;
        return b;
    }
    return null;
}

function captureScroll() {
    const layout = state.layout;
    if (!layout) return null;
    const y = window.scrollY;
    const block = layout.blocks.find(b => (b.type === 'paragraph' || b.type === 'heading') && b.node && b.bottom > y);
    return block ? { start: block.node.start, offset: y - block.top } : null;
}

function restoreScroll(anchor) {
    if (!anchor || !state.layout) return;
    const block = state.layout.blocks.find(b => b.node && b.node.start === anchor.start && (b.type === 'paragraph' || b.type === 'heading'));
    if (block) window.scrollTo(0, block.top + anchor.offset);
}

const currentDoc = () => (state.session ? state.session.doc : state.fallbackDoc);

function layoutAndRender() {
    const doc = currentDoc();
    if (!doc) return;
    const anchor = captureScroll();
    syncVars(doc);
    state.liveStops.forEach(stop => stop());
    state.liveStops = [];
    state.unbindVars?.();
    const t0 = performance.now();
    const layout = layoutDocument(doc, buildEnv());
    const t1 = performance.now();
    state.layout = layout;
    state.docEl = renderLayout(root, layout, renderContext());
    state.unbindVars = bindVars(state.docEl, state.store, formatNumber);
    const tocBox = layout.blocks.find(b => b.type === 'toc');
    state.toc ??= createTocRail({ document, window, goTo: (id) => scrollToAnchor(id) });
    state.toc.update({ outline: layout.outline, anchors: layout.anchors, tocRect: tocBox ? tocBox.rect : null, isNarrow: layout.geometry.narrow });
    mountFigures(state.docEl, { document, store: state.store });
    const t2 = performance.now();
    state.timing = { layoutMs: Math.round(t1 - t0), renderMs: Math.round(t2 - t1), count: (state.timing?.count ?? 0) + 1 };
    restoreScroll(anchor);
    state.editor?.afterLayout();
    if (layout.diagnostics.length) console.debug('layout diagnostics', layout.diagnostics);
}

/** Runs `fn` on the next frame, or after a short delay when frames are not being produced (hidden tab). */
function nextFrame(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    requestAnimationFrame(run);
    setTimeout(run, 60);
}

let layoutQueued = false;
function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    nextFrame(() => { layoutQueued = false; layoutAndRender(); });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

async function fetchManifest() {
    try {
        const res = await fetch('/cards/manifest.json', { cache: 'no-cache' });
        state.manifest = res.ok ? await res.json() : null;
    } catch {
        state.manifest = null;
    }
}

function messageDoc(title, body) {
    return parse(`# ${title}\n\n${body}\n`);
}

function setEditing(editing) {
    state.editing = editing;
    scheduleLayout();
}

function onSessionChange() {
    scheduleLayout();
}

function useSession(source) {
    state.editor?.dispose();
    state.session = createSession(source, { parse, onChange: onSessionChange });
    state.fallbackDoc = null;
    state.lastSaved = source;
    state.editing = null;
    state.editor = createEditor({
        document,
        session: state.session,
        getLayout: () => state.layout,
        setEditing,
        onSourceChange: scheduleSave,
    });
    state.editor.setEnabled(state.canEdit && new URLSearchParams(location.search).has('edit'));
}

/** Source for a page: a vault page, a draft of a public page, or the public file. */
async function loadSource(name) {
    if (name.startsWith('~')) {
        if (!personal.unlocked) return { source: null };
        try {
            const page = await personal.store.open(name.slice(1));
            return { source: page.text, vaultPage: { id: page.id, slug: page.meta.slug } };
        } catch {
            return { source: null };
        }
    }
    if (personal.unlocked) {
        const id = personal.store.findBySlug(name);
        if (id) {
            try {
                const page = await personal.store.open(id);
                return { source: page.text, vaultPage: { id, slug: name } };
            } catch { /* fall back to the public page */ }
        }
    }
    try {
        const res = await fetch(`/cards/${name}.md`, { cache: 'no-cache' });
        return { source: res.ok ? await res.text() : null };
    } catch {
        return { source: null };
    }
}

async function openPage(name, { push = true, hash = '', keepScroll = false } = {}) {
    const { source, vaultPage = null } = await loadSource(name);
    if (state.docEl) disposeFigures(state.docEl);
    persist.clear();
    state.scriptRan = false;
    state.page = name;
    state.vaultPage = vaultPage;
    state.publicSource = vaultPage ? '' : (source ?? '');
    state.store = createStore();
    state.detachScrub?.();
    state.detachScrub = attachScrub(root, state.store);
    math.invalidate();
    if (source === null || /^encrypted:\s*true\s*$/m.test(source.slice(0, 600))) {
        state.editor?.dispose();
        state.editor = null;
        state.session = null;
        state.fallbackDoc = source === null
            ? messageDoc('Not found', name.startsWith('~') ? 'There is nothing here.' : `There is no page called "${name}".`)
            : messageDoc('Private page', 'This page is encrypted with the old scheme.');
    } else {
        useSession(source);
    }
    const title = currentDoc().frontmatter?.entries?.name?.value;
    document.title = title ? `${title} · ish` : 'ish';
    if (push) history.pushState({ page: name }, '', `?page=${encodeURIComponent(name)}${hash}`);
    if (!keepScroll) window.scrollTo(0, 0);
    buildChrome();
    layoutAndRender();
    runCardScript(name);
    if (hash) scrollToAnchor(hash.slice(1), false);
}

// ---------------------------------------------------------------------------
// Saving and live reload (dev server only)
// ---------------------------------------------------------------------------

let saveTimer = 0;
let vaultTimer = 0;

function setStatus(text) {
    state.saveStatus = text;
    const el = document.querySelector('.chrome .status');
    if (el) el.textContent = text;
}

/** Edits go to the vault, not the dev server, for vault pages and for public pages when not running locally. */
const savesToVault = () => !!state.vaultPage || (!state.canSave && personal.unlocked);

async function pushToVault() {
    const source = state.session?.source;
    if (source == null || !personal.unlocked) return;
    if (!state.vaultPage) {
        const slug = state.page;
        state.vaultPage = { id: await personal.store.adopt(slug, state.publicSource), slug };
        buildChrome();
    }
    personal.store.edit(state.vaultPage.id, source);
}

function scheduleSave() {
    if (savesToVault()) {
        setStatus('unsaved');
        clearTimeout(vaultTimer);
        vaultTimer = setTimeout(pushToVault, 300);
        return;
    }
    if (!state.canSave) return;
    setStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
}

async function save() {
    if (!state.session) return;
    const body = state.session.source;
    setStatus('saving…');
    try {
        const res = await fetch(`/cards/${state.page}.md`, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/markdown', 'X-Requested-With': 'v2-editor' },
            body,
        });
        if (res.ok) { state.lastSaved = body; setStatus('saved'); } else setStatus(`save failed (${res.status})`);
    } catch {
        setStatus('save failed');
    }
}

async function probeDev() {
    try {
        const res = await fetch('/api/dev', { cache: 'no-cache' });
        const info = res.ok ? await res.json() : null;
        state.canSave = !!info?.save;
    } catch {
        state.canSave = false;
    }
    state.canEdit = state.canSave || new URLSearchParams(location.search).has('edit');
}

setInterval(async () => {
    if (!state.canSave || !state.session || state.editor?.active) return;
    try {
        const res = await fetch(`/cards/${state.page}.md`, { cache: 'no-cache' });
        if (!res.ok) return;
        const text = await res.text();
        if (text !== state.session.source && text !== state.lastSaved) { state.lastSaved = text; state.session.reset(text); }
    } catch { /* offline */ }
}, 1000);

async function runCardScript(name) {
    if (state.scriptRan || !CARD_SCRIPTS.has(name)) return;
    state.scriptRan = true;
    try {
        const mod = await import(`/cards/${name}.js`);
        await mod.init?.(state.docEl, { getSetting: (k) => state.settings[k], setSetting: () => {} });
    } catch (err) {
        console.warn(`card script for ${name} failed`, err);
    }
}

function scrollToAnchor(id, smooth = true) {
    const pos = state.layout?.anchors.get(id);
    if (!pos) return;
    window.scrollTo({ top: Math.max(0, pos.y - 90), behavior: smooth ? 'smooth' : 'auto' });
    const flash = document.createElement('div');
    flash.className = 'flash';
    flash.style.cssText = `position:absolute;left:${state.layout.geometry.text.x - 8}px;top:${pos.y - 4}px;width:${state.layout.geometry.text.width + 16}px;height:${state.layout.styles.lineHeight + 8}px;pointer-events:none`;
    state.docEl.appendChild(flash);
    setTimeout(() => flash.remove(), 1500);
}

function pageFromLocation() {
    return new URLSearchParams(location.search).get('page') ?? 'writing';
}

// ---------------------------------------------------------------------------
// Events and chrome
// ---------------------------------------------------------------------------

root.addEventListener('click', (e) => {
    if (state.editor?.enabled && !e.metaKey && !e.ctrlKey && state.editor.handleClick(e.target, { x: e.clientX, y: e.clientY })) {
        e.preventDefault();
        return;
    }
    const heading = e.target.closest('.heading-link');
    if (heading) {
        e.preventDefault();
        const url = `${location.origin}${location.pathname}?page=${encodeURIComponent(state.page)}#${heading.dataset.anchor}`;
        navigator.clipboard?.writeText(url).catch(() => {});
        return;
    }
    const full = e.target.closest('img[data-full]');
    if (full && !state.editor?.enabled) {
        window.open(full.dataset.full, '_blank', 'noopener');
        return;
    }
    const toggle = e.target.closest('[data-toggle-note]');
    if (toggle) {
        const key = Number(toggle.dataset.toggleNote);
        if (!state.expandedNotes.delete(key)) state.expandedNotes.add(key);
        scheduleLayout();
        return;
    }
    const card = e.target.closest('a[data-card]');
    if (card) {
        e.preventDefault();
        openPage(card.dataset.card);
        return;
    }
    const jump = e.target.closest('a[data-jump]');
    if (jump) {
        e.preventDefault();
        scrollToAnchor(jump.dataset.jump);
    }
});

/** Hovering a note or its marker highlights the other. */
function linkNotes(e, on) {
    const index = (e.target.closest?.('.mk[data-note]') ?? e.target.closest?.('aside.note'))?.dataset.note;
    if (index === undefined) return;
    state.docEl?.querySelectorAll(`[data-note="${index}"]`).forEach(el => el.classList.toggle('on', on));
}
root.addEventListener('mouseover', (e) => linkNotes(e, true));
root.addEventListener('mouseout', (e) => linkNotes(e, false));

addEventListener('popstate', () => {
    openPage(pageFromLocation(), { push: false, hash: location.hash });
});

let resizeTimer = 0;
addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(scheduleLayout, 80);
});

document.addEventListener('copy', (e) => {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const text = selectionText(selection.getRangeAt(0).cloneContents());
    if (text) {
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
    }
});

document.addEventListener('keydown', (e) => {
    if (!state.session || e.target?.tagName === 'TEXTAREA' || e.target?.tagName === 'INPUT') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        state.editor?.close();
        if (e.shiftKey) state.session.redo(); else state.session.undo();
        scheduleSave();
    }
});

function buildChrome() {
    document.querySelector('.chrome')?.remove();
    const chrome = document.createElement('div');
    chrome.className = 'chrome';
    const row = document.createElement('div');
    row.className = 'row';
    const button = document.createElement('button');
    button.textContent = '⚙︎';
    button.title = 'Settings';
    const panel = document.createElement('div');
    panel.className = 'panel';

    const slider = (label, key, min, max) => {
        const line = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.value = state.settings[key];
        input.oninput = () => { state.settings[key] = Number(input.value); saveSettings(); scheduleLayout(); };
        line.append(label, input);
        return line;
    };
    const theme = document.createElement('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = state.settings.theme === 'dark';
    toggle.onchange = () => { state.settings.theme = toggle.checked ? 'dark' : 'light'; saveSettings(); applyTheme(); };
    theme.append('Dark mode', toggle);

    panel.append(slider('Font size', 'fontSize', 14, 26), slider('Margins', 'marginPercent', 0, 40), theme);
    personal.watchHold(button);
    button.onclick = () => { if (!personal.consumeHold()) panel.classList.toggle('open'); };

    if (state.canEdit) {
        const status = document.createElement('span');
        status.className = 'status';
        status.textContent = state.saveStatus;
        const pencil = document.createElement('button');
        pencil.textContent = '✎︎';
        pencil.title = 'Edit this page';
        pencil.classList.toggle('on', !!state.editor?.enabled);
        pencil.onclick = () => {
            const on = !state.editor?.enabled;
            state.editor?.setEnabled(on);
            pencil.classList.toggle('on', on);
        };
        row.append(status);
        if (state.vaultPage?.slug) {
            const publish = document.createElement('button');
            publish.textContent = '↑';
            publish.title = 'Publish this page';
            publish.onclick = () => personal.publish(state.vaultPage.id);
            row.append(publish);
        }
        row.append(pencil);
    }
    if (personal.unlocked) {
        const pages = document.createElement('button');
        pages.textContent = '≡';
        pages.title = 'Backstage';
        pages.onclick = () => personal.openPanel();
        row.append(pages);
    }
    row.append(button);
    chrome.append(row, panel);
    document.body.appendChild(chrome);
}

document.addEventListener('visibilitychange', async () => {
    if (!personal.unlocked) return;
    if (document.hidden) {
        personal.store.flush().catch(() => {});
        return;
    }
    if (state.vaultPage && !state.editor?.active) {
        const fresh = await personal.store.refresh(state.vaultPage.id).catch(() => null);
        if (fresh && fresh.text !== state.session?.source) state.session.reset(fresh.text);
    }
});
addEventListener('pagehide', () => personal.store?.flush().catch(() => {}));
addEventListener('online', () => personal.store?.retry().catch(() => {}));

async function start() {
    const themeParam = new URLSearchParams(location.search).get('theme');
    if (themeParam === 'light' || themeParam === 'dark') state.settings.theme = themeParam;
    applyTheme();
    await Promise.all([loadFonts(document, undefined, { katex: !!window.katex }), fetchManifest(), probeDev()]);
    document.fonts.addEventListener('loadingdone', () => { math.invalidate(); scheduleLayout(); });
    await openPage(pageFromLocation(), { push: false, hash: location.hash });
    personal.restore();
}

window.__v2 = { state, relayout: scheduleLayout, openPage, personal };
start();
