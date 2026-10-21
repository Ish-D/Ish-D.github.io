/**
 * Personal mode: the hidden way in, unlocking (or first setting up) the vault,
 * and a panel with the private pages and drafts.
 *
 * The vault file is public (vault.json at the site root). Nothing here is
 * shown to visitors: there is no button, and the site makes no request for the
 * vault until the knock or a remembered device asks for it.
 */

import { createVault, unlockVault, unlockWithKey, VaultError } from '../vault/vault.js';
import { AuthError, createGitHub, GitHubError, NetworkError } from '../vault/github.js';
import { createPrivateStore, PublishConflict } from '../vault/store.js';
import { createIdbKV } from '../vault/kv.js';
import { slugify } from '../vault/pages.js';
import { decryptLegacyCard, isLegacyEncrypted } from '../vault/legacy.js';

const KNOCK_WORD = 'backstage';
const KNOCK_HASH = '#backstage';
const HOLD_MS = 1200;
const DEFAULT_REPO = 'Ish-D/Ish-D.github.io';
const VAULT_PATH = 'vault.json';
const MIN_PASSWORD = 12;

function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k in el) el[k] = v;
        else el.setAttribute(k, v);
    }
    for (const child of children.flat()) if (child != null && child !== false) el.append(child);
    return el;
}

const note = (text) => h('p', { class: 'vault-note' }, text);
const button = (label, onclick, { primary = false, submit = false } = {}) =>
    h('button', { type: submit ? 'submit' : 'button', class: primary ? 'vault-button primary' : 'vault-button', onclick }, label);

/** Shows progress under a form and locks its controls. */
function working(form, text) {
    const line = form.querySelector('.vault-status') ?? form.appendChild(h('p', { class: 'vault-status' }));
    line.textContent = text;
    line.classList.remove('error');
    for (const el of form.querySelectorAll('input, button')) el.disabled = true;
}

function failed(form, text) {
    const line = form.querySelector('.vault-status') ?? form.appendChild(h('p', { class: 'vault-status' }));
    line.textContent = text;
    line.classList.add('error');
    for (const el of form.querySelectorAll('input, button')) el.disabled = false;
}

const when = (ms) => {
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * @param {{
 *   toast: (text: string) => void,
 *   onChange: () => void,
 *   openPage: (name: string) => void,
 *   fetchImpl?: typeof fetch,
 * }} host
 */
export function createPersonal(host) {
    const fetchImpl = host.fetchImpl ?? ((...args) => fetch(...args));
    const device = createIdbKV('v2-vault-device');
    let vaultFile = null;
    let session = null;
    let store = null;
    let layer = null;

    const api = {
        get unlocked() { return !!store; },
        get store() { return store; },
        get session() { return session; },
    };

    // -----------------------------------------------------------------------
    // Dialog shell
    // -----------------------------------------------------------------------

    function close() {
        layer?.remove();
        layer = null;
    }

    function show(title, ...content) {
        close();
        layer = h('div', { class: 'vault-backdrop', onmousedown: (e) => { if (e.target === layer) close(); } },
            h('div', { class: 'vault-dialog', role: 'dialog', 'aria-label': title },
                h('div', { class: 'vault-title' }, title),
                ...content));
        document.body.append(layer);
        layer.querySelector('input')?.focus();
        return layer;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && layer) close();
    });

    const field = (label, props) => {
        const input = h('input', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', ...props });
        return { input, row: h('label', { class: 'vault-field' }, h('span', {}, label), input) };
    };
    const describe = (e) => {
        if (e instanceof VaultError) return e.code === 'wrong-password' ? 'That password does not open the vault.' : e.message;
        if (e instanceof AuthError || e instanceof GitHubError || e instanceof NetworkError) return e.message;
        return e?.message ?? String(e);
    };

    // -----------------------------------------------------------------------
    // Vault file and device key
    // -----------------------------------------------------------------------

    async function loadVaultFile() {
        try {
            const res = await fetchImpl(`/${VAULT_PATH}`, { cache: 'no-cache' });
            if (!res.ok) return null;
            const file = await res.json();
            return file?.v === 1 ? file : null;
        } catch {
            return null;
        }
    }

    async function start(unlocked, remember) {
        session = unlocked;
        const { token, owner, repo, branch } = session.secrets;
        const github = createGitHub({ token, owner, repo });
        store = createPrivateStore({ session, github, branch: branch ?? 'private', setTimer: (...a) => setTimeout(...a), clearTimer: (...a) => clearTimeout(...a) });
        await store.init();
        store.onChange((event) => {
            if (event.type === 'conflict') host.toast('Edited somewhere else too. Your version is saved as a conflicted copy.');
            if (event.type === 'merged') host.toast('Merged changes from another device.');
            host.onChange(event);
        });
        if (remember) await device.set('master', { vaultId: session.vaultId, key: session.masterKey });
        close();
        host.onChange({ type: 'unlocked' });
    }

    /** Opens silently on a device that was told to remember the key. */
    api.restore = async () => {
        let record;
        try { record = await device.get('master'); } catch { return false; }
        if (!record) return false;
        vaultFile = await loadVaultFile();
        if (!vaultFile || vaultFile.wrap.ct.slice(0, 16) !== record.vaultId) return false;
        try {
            await start(await unlockWithKey(vaultFile, record.key), false);
            return true;
        } catch {
            await device.delete('master').catch(() => {});
            return false;
        }
    };

    api.lock = async ({ forget = false } = {}) => {
        store?.flush().catch(() => {});
        store?.dispose();
        store = null;
        session = null;
        if (forget) await device.delete('master').catch(() => {});
        close();
        host.onChange({ type: 'locked' });
    };

    // -----------------------------------------------------------------------
    // Unlock and first-time setup
    // -----------------------------------------------------------------------

    function unlockDialog() {
        const password = field('Password', { type: 'password', autocomplete: 'current-password' });
        const remember = h('input', { type: 'checkbox' });
        const form = h('form', { class: 'vault-form', onsubmit: async (e) => {
            e.preventDefault();
            working(form, 'Opening…');
            try {
                const unlocked = await unlockVault(vaultFile, password.input.value, {
                    onProgress: (f) => working(form, `Opening… ${Math.round(f * 100)}%`),
                });
                await start(unlocked, remember.checked);
            } catch (err) {
                failed(form, describe(err));
            }
        } },
        password.row,
        h('label', { class: 'vault-check' }, remember, ' Keep this device unlocked'),
        h('div', { class: 'vault-actions' }, button('Open', null, { primary: true, submit: true })));
        show('Backstage', form);
        password.input.focus();
    }

    function setupDialog() {
        const token = field('GitHub token', { type: 'password', placeholder: 'github_pat_…' });
        const repo = field('Repository', { type: 'text', value: DEFAULT_REPO });
        const password = field(`Password (${MIN_PASSWORD}+ characters)`, { type: 'password', autocomplete: 'new-password' });
        const again = field('Password again', { type: 'password', autocomplete: 'new-password' });
        const form = h('form', { class: 'vault-form', onsubmit: async (e) => {
            e.preventDefault();
            const [owner, name] = repo.input.value.trim().split('/');
            if (!token.input.value.trim() || !owner || !name) return failed(form, 'Enter a token and a repository like owner/name.');
            if (password.input.value.length < MIN_PASSWORD) return failed(form, `Use at least ${MIN_PASSWORD} characters.`);
            if (password.input.value !== again.input.value) return failed(form, 'The passwords do not match.');
            try {
                working(form, 'Checking the token…');
                const secrets = { token: token.input.value.trim(), owner, repo: name, branch: 'private' };
                const github = createGitHub(secrets);
                const info = await github.whoami();
                if (info.canPush === false) throw new Error('That token cannot write to the repository.');
                if (await github.getFile(VAULT_PATH, { ref: info.defaultBranch })) {
                    throw new Error('A vault already exists in this repository. If you just made it, wait for the site to redeploy and open it again.');
                }
                const { file, session: created } = await createVault({
                    password: password.input.value, secrets,
                    onProgress: (f) => working(form, `Making the vault… ${Math.round(f * 100)}%`),
                });
                working(form, 'Saving the vault file…');
                await github.putFile(VAULT_PATH, `${JSON.stringify(file, null, 2)}\n`, { branch: info.defaultBranch, message: 'Add vault' });
                vaultFile = file;
                await start(created, true);
                host.toast('Vault created. Other devices can open it once the site has redeployed.');
            } catch (err) {
                failed(form, describe(err));
            }
        } },
        note('This keeps private pages and drafts encrypted in your repository. The token needs read and write access to Contents on that repository only.'),
        token.row, repo.row, password.row, again.row,
        note('The vault file is public, so anyone can try passwords against it offline. Use a long passphrase, such as four or more random words.'),
        h('div', { class: 'vault-actions' }, button('Create', null, { primary: true, submit: true })));
        show('Set up backstage', form);
        token.input.focus();
    }

    /** Called by the knock. Opens whatever is needed: the panel, the unlock prompt, or setup. */
    api.knock = async () => {
        if (store) return api.openPanel();
        if (layer) return;
        vaultFile ??= await loadVaultFile();
        if (vaultFile) unlockDialog(); else setupDialog();
    };

    // -----------------------------------------------------------------------
    // The knock: a typed word, #backstage in the address, or holding the gear
    // -----------------------------------------------------------------------

    let typed = '';
    document.addEventListener('keydown', (e) => {
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key.length !== 1) return;
        typed = (typed + e.key.toLowerCase()).slice(-KNOCK_WORD.length);
        if (typed === KNOCK_WORD) { typed = ''; api.knock(); }
    });

    if (location.hash === KNOCK_HASH) {
        history.replaceState(history.state, '', location.pathname + location.search);
        queueMicrotask(() => api.knock());
    }

    let held = false;
    /** True once for the click that ends a hold, so the held button can ignore it. */
    api.consumeHold = () => { const was = held; held = false; return was; };

    /** Opens the way in when `target` is held down. */
    api.watchHold = (target) => {
        let timer = 0;
        const cancel = () => { clearTimeout(timer); timer = 0; };
        target.addEventListener('pointerdown', () => {
            cancel();
            timer = setTimeout(() => { timer = 0; held = true; api.knock(); }, HOLD_MS);
        });
        for (const type of ['pointerup', 'pointerleave', 'pointercancel']) target.addEventListener(type, cancel);
    };

    // -----------------------------------------------------------------------
    // Pages panel
    // -----------------------------------------------------------------------

    function newPageForm() {
        const title = field('Title', { type: 'text', placeholder: 'Untitled' });
        const slug = field('Public name', { type: 'text', placeholder: 'made-from-the-title' });
        const isPublic = h('input', { type: 'checkbox', onchange: () => { slug.row.hidden = !isPublic.checked; } });
        slug.row.hidden = true;
        let slugEdited = false;
        slug.input.addEventListener('input', () => { slugEdited = true; });
        title.input.addEventListener('input', () => { if (!slugEdited) slug.input.value = slugify(title.input.value); });
        const form = h('form', { class: 'vault-form', onsubmit: async (e) => {
            e.preventDefault();
            const name = title.input.value.trim() || 'Untitled';
            const publicName = isPublic.checked ? (slug.input.value.trim() || slugify(name)) : undefined;
            if (publicName && store.findBySlug(publicName)) return failed(form, 'You already have a page with that public name.');
            const id = await store.create({ title: name, slug: publicName });
            close();
            host.openPage(`~${id}`);
        } },
        title.row,
        h('label', { class: 'vault-check' }, isPublic, ' Will be published as a public page'),
        slug.row,
        h('div', { class: 'vault-actions' }, button('Back', openPanel), button('Create', null, { primary: true, submit: true })));
        show('New page', form);
        title.input.focus();
    }

    /** Brings a card encrypted by the old site into the vault, re-encrypted. */
    function importForm() {
        const name = field('Old card name', { type: 'text', placeholder: 'journal' });
        const password = field('Its old password', { type: 'password' });
        const form = h('form', { class: 'vault-form', onsubmit: async (e) => {
            e.preventDefault();
            try {
                working(form, 'Decrypting…');
                const res = await fetchImpl(`/cards/${encodeURIComponent(name.input.value.trim())}.md`, { cache: 'no-cache' });
                const source = res.ok ? await res.text() : '';
                if (!isLegacyEncrypted(source)) throw new Error('There is no encrypted card with that name.');
                const text = await decryptLegacyCard(source, password.input.value);
                const id = await store.create({ text });
                close();
                host.openPage(`~${id}`);
                host.toast('Imported. The old file is still public; delete it once you are happy with the copy.');
            } catch (err) {
                failed(form, describe(err));
            }
        } },
        name.row, password.row,
        h('div', { class: 'vault-actions' }, button('Back', openPanel), button('Import', null, { primary: true, submit: true })));
        show('Import an old private page', form);
        name.input.focus();
    }

    /** Publishes a page to the public site, asking before it overwrites something it did not write. */
    api.publish = async (id) => {
        try {
            host.toast('Publishing…');
            await store.publish(id);
            host.toast('Published. It goes live once the site redeploys, a minute or two.');
        } catch (err) {
            if (err instanceof PublishConflict && confirm(`${err.message}. Overwrite the public page?`)) {
                await store.publish(id, { force: true });
                host.toast('Published.');
            } else {
                host.toast(describe(err));
            }
        }
    };

    function openPanel() {
        if (!store) return api.knock();
        const rows = store.list().map((entry) => {
            const meta = [entry.slug ? `/${entry.slug}` : 'private', when(entry.updated)];
            const row = h('div', { class: 'vault-row' },
                h('a', { class: 'vault-open', href: `?page=~${entry.id}`, onclick: (e) => { e.preventDefault(); close(); host.openPage(`~${entry.id}`); } },
                    h('span', { class: 'vault-name' }, entry.title),
                    h('span', { class: 'vault-meta' }, meta.join(' · '))),
                entry.slug && h('button', { class: 'vault-mini', title: 'Publish', onclick: async () => { await api.publish(entry.id); openPanel(); } }, 'Publish'),
                h('button', { class: 'vault-mini', title: 'Delete', onclick: async () => {
                    if (!confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
                    await store.remove(entry.id);
                    openPanel();
                } }, 'Delete'));
            return row;
        });
        const state = store.status();
        const stateText = { saved: 'All saved', pending: 'Unsaved changes', saving: 'Saving…', offline: 'Offline, will retry', error: state.message || 'Could not save' }[state.state];
        show('Backstage',
            h('div', { class: 'vault-list' }, rows.length ? rows : h('p', { class: 'vault-note' }, 'No pages yet.')),
            h('div', { class: 'vault-actions' },
                button('New page', newPageForm, { primary: true }),
                button('Import old page', importForm),
                button('Lock', () => api.lock()),
                button('Forget this device', () => api.lock({ forget: true }))),
            h('p', { class: 'vault-status' }, stateText));
    }
    api.openPanel = openPanel;
    api.closePanel = close;

    return api;
}
