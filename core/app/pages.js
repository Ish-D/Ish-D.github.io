/**
 * Opening pages: finding their source (public file, vault page, or a draft of
 * a public page), starting an editing session, and showing messages.
 */

import { parse } from '../doc/parse.js';
import { createSession } from '../edit/session.js';
import { createEditor } from '../edit/editor.js';
import { createStore } from '../runtime/store.js';
import { attachScrub } from '../runtime/scrub.js';
import { disposeFigures } from '../runtime/figures.js';
import { pageUrl } from './urls.js';

/** Pages with a script that runs after they are drawn. */
const PAGE_SCRIPTS = new Set(['llms_for_bozos_1']);

const messageDoc = (title, body) => parse(`# ${title}\n\n${body}\n`);
const isOldEncrypted = (source) => /^encrypted:\s*true\s*$/m.test(source.slice(0, 600));

export function createPages(app) {
    const { state, root, document, personal, settings } = app;
    const wantsEdit = () => new URLSearchParams(location.search).has('edit');

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

    function endEditing() {
        state.editor?.dispose();
        state.editor = null;
        state.session = null;
    }

    function startEditing(source) {
        state.editor?.dispose();
        state.session = createSession(source, { parse, onChange: () => app.view.relayout() });
        state.fallbackDoc = null;
        state.lastSaved = source;
        state.editing = null;
        state.editor = createEditor({
            document,
            session: state.session,
            getLayout: () => state.layout,
            setEditing: (editing) => { state.editing = editing; app.view.relayout(); },
            onSourceChange: () => app.saver.scheduleSave(),
        });
        state.editor.setEnabled(state.canEdit && wantsEdit());
    }

    /** Shows a short page in place of the open one. */
    function showMessage(title, body) {
        endEditing();
        state.fallbackDoc = messageDoc(title, body);
        app.view.render();
    }

    async function runPageScript(name) {
        if (state.scriptRan || !PAGE_SCRIPTS.has(name)) return;
        state.scriptRan = true;
        try {
            const mod = await import(`/cards/${name}.js`);
            await mod.init?.(state.docEl, { getSetting: (k) => settings.values[k], setSetting: () => {} });
        } catch (err) {
            console.warn(`script for ${name} failed`, err);
        }
    }

    async function open(name, { push = true, hash = '', keepScroll = false } = {}) {
        const { source, vaultPage = null } = await loadSource(name);
        if (state.docEl) disposeFigures(state.docEl);
        app.persist.clear();
        state.scriptRan = false;
        state.page = name;
        state.vaultPage = vaultPage;
        state.publicSource = vaultPage ? '' : (source ?? '');
        state.store = createStore();
        state.detachScrub?.();
        state.detachScrub = attachScrub(root, state.store);
        app.math.invalidate();

        if (source === null) {
            endEditing();
            state.fallbackDoc = messageDoc('Not found', name.startsWith('~') ? 'There is nothing here.' : `There is no page called "${name}".`);
        } else if (isOldEncrypted(source)) {
            endEditing();
            state.fallbackDoc = messageDoc('Private page', 'This page is encrypted with the old scheme.');
        } else {
            startEditing(source);
        }

        const title = app.view.currentDoc().frontmatter?.entries?.name?.value;
        document.title = title ? `${title} · ish` : 'ish';
        if (push) history.pushState({ page: name }, '', pageUrl(name, hash));
        if (!keepScroll) window.scrollTo(0, 0);
        app.chrome.build();
        app.view.render();
        runPageScript(name);
        if (hash) app.nav.scrollToAnchor(hash.slice(1), false);
    }

    async function fetchManifest() {
        try {
            const res = await fetch('/cards/manifest.json', { cache: 'no-cache' });
            state.manifest = res.ok ? await res.json() : null;
        } catch {
            state.manifest = null;
        }
    }

    return { open, showMessage, fetchManifest };
}
