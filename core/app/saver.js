/**
 * Saving edits. Three destinations: the dev server (editing locally), the
 * vault (editing from the deployed site), or nowhere (read-only).
 */

const DEV_SAVE_DELAY = 700;
const VAULT_PUSH_DELAY = 300;
const RELOAD_POLL_MS = 1000;

export function createSaver(app) {
    const { state, personal } = app;
    let devTimer = 0;
    let vaultTimer = 0;
    /** True from an edit until the file on disk holds it. */
    let unsaved = false;
    let saving = false;

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
            // first edit of a public page: keep a private working copy until it is published
            const slug = state.page;
            state.vaultPage = { id: await personal.store.adopt(slug, state.publicSource), slug };
            app.chrome.build();
        }
        personal.store.edit(state.vaultPage.id, source);
    }

    async function saveToDevServer() {
        if (!state.session) return;
        const body = state.session.source;
        setStatus('saving…');
        saving = true;
        try {
            const res = await fetch(`/cards/${state.page}.md`, {
                method: 'PUT',
                headers: { 'Content-Type': 'text/markdown', 'X-Requested-With': 'v2-editor' },
                body,
            });
            if (res.ok) {
                state.lastSaved = body;
                unsaved = state.session?.source !== body;
                setStatus(unsaved ? 'unsaved' : 'saved');
            } else setStatus(`save failed (${res.status})`);
        } catch {
            setStatus('save failed');
        } finally {
            saving = false;
        }
    }

    function scheduleSave() {
        if (savesToVault()) {
            setStatus('unsaved');
            clearTimeout(vaultTimer);
            vaultTimer = setTimeout(pushToVault, VAULT_PUSH_DELAY);
        } else if (state.canSave) {
            unsaved = true;
            setStatus('unsaved');
            clearTimeout(devTimer);
            devTimer = setTimeout(saveToDevServer, DEV_SAVE_DELAY);
        }
    }

    /** A site served over https from a real host has no dev server behind it, so it is not asked. */
    const hosted = () => location.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

    /** Asks the server whether it accepts saves, which makes editing available. */
    async function probeDevServer() {
        state.canSave = false;
        if (!hosted()) {
            try {
                const res = await fetch('/api/dev', { cache: 'no-cache' });
                state.canSave = !!(res.ok && (await res.json())?.save);
            } catch {
                state.canSave = false;
            }
        }
        state.canEdit = state.canSave || new URLSearchParams(location.search).has('edit');
    }

    /** The editor is busy: text being typed, a drag in progress, or edits not yet written. */
    const busy = () => !!state.editor?.active || state.sketching || unsaved || saving || document.body.classList.contains('dragging-item');

    /** Picks up changes made to the file outside the editor while running locally. */
    function watchFile() {
        setInterval(async () => {
            if (!state.canSave || !state.session || savesToVault() || busy()) return;
            const before = state.session.source;
            try {
                const res = await fetch(`/cards/${state.page}.md`, { cache: 'no-cache' });
                if (!res.ok) return;
                const text = await res.text();
                // anything the user did while this was in flight wins
                if (busy() || state.session?.source !== before) return;
                if (text !== before && text !== state.lastSaved) { state.lastSaved = text; state.session.reset(text); }
            } catch { /* offline */ }
        }, RELOAD_POLL_MS);
    }

    return { scheduleSave, setStatus, probeDevServer, watchFile, savesToVault };
}
