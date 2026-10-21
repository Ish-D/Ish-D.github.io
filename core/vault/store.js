/**
 * Private store: pages kept encrypted on a branch of the repository and saved
 * as you type, so writing can pick up on any device with no git.
 *
 * Layout on the branch:
 *   store/index.json         sealed list of pages (title, slug, times)
 *   store/items/<id>.json    sealed page source
 *
 * Each page can be published, which commits its plain source to
 * cards/<slug>.md on the public branch.
 *
 * Edits are written to the local cache at once and to GitHub after a pause,
 * at most once per `minInterval` per page. A save that finds the file changed
 * on another device keeps both versions: the remote one stays, and what was
 * being written goes to a new page titled "(conflicted copy)".
 */

import { AuthError, ConflictError, NetworkError } from './github.js';
import { randomId } from './crypto.js';
import { createMemoryKV } from './kv.js';
import { merge3 } from './merge.js';
import { contentHash, scaffold, titleOf, withTitle } from './pages.js';

const INDEX_ID = 'index';
const INDEX_PATH = 'store/index.json';
const itemPath = (id) => `store/items/${id}.json`;

/** The index is rewritten for a stale "updated" time only after this long. */
const INDEX_REFRESH_MS = 10 * 60 * 1000;

const newer = (a, b) => a.rev > b.rev || (a.rev === b.rev && a.updated > b.updated);

export class PublishConflict extends Error {
    constructor(message) {
        super(message);
        this.name = 'PublishConflict';
    }
}

/**
 * @typedef {object} Meta
 * @property {string} title
 * @property {string} [slug]            set when the page has a public counterpart
 * @property {number} created
 * @property {number} updated
 * @property {number} rev               bumped on every change; the higher one wins a merge
 * @property {boolean} [deleted]
 * @property {string} [publishedHash]   fingerprint of the text last published
 * @property {number} [publishedAt]
 */

/**
 * @param {{
 *   session: ReturnType<typeof import('./vault.js').unlockVault> extends Promise<infer S> ? S : never,
 *   github: ReturnType<typeof import('./github.js').createGitHub>,
 *   kv?: ReturnType<typeof createMemoryKV>,
 *   branch?: string, publicBranch?: string,
 *   clock?: () => number,
 *   saveDelay?: number, minInterval?: number, retryDelay?: number,
 *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout,
 * }} options
 */
export function createPrivateStore({
    session, github, kv: backing = createMemoryKV(), branch = 'private', publicBranch = 'master',
    clock = Date.now, saveDelay = 4000, minInterval = 30000, retryDelay = 8000,
    setTimer = setTimeout, clearTimer = clearTimeout,
}) {
    const prefix = `${session.vaultId}:`;
    const kv = {
        get: (key) => backing.get(prefix + key),
        set: (key, value) => backing.set(prefix + key, value),
        delete: (key) => backing.delete(prefix + key),
        keys: async (p) => (await backing.keys(prefix + p)).map(k => k.slice(prefix.length)),
    };

    /** @type {Map<string, Meta>} */
    const metas = new Map();
    /** @type {Map<string, { id: string, text: string, base: { sha: string, text: string | null } | null, sent: string[], dirty: boolean, notBefore: number }>} */
    const docs = new Map();
    /** id → sha of the item file to remove, or null when unknown */
    const deletions = new Map();
    const listeners = new Set();

    let indexSha = null;
    let indexDirty = false;
    let branchReady = false;
    let timer = null;
    let timerAt = 0;
    let retryTimer = null;
    let saving = false;
    let offline = false;
    let failure = null;
    let tail = Promise.resolve();

    const serial = (job) => {
        const run = tail.then(job);
        tail = run.catch(() => {});
        return run;
    };

    function status() {
        const pending = [...docs.values()].filter(d => d.dirty).length + (indexDirty ? 1 : 0) + deletions.size;
        let state = 'saved';
        if (failure) state = 'error';
        else if (offline) state = 'offline';
        else if (saving) state = 'saving';
        else if (pending) state = 'pending';
        return { type: 'status', state, pending, message: failure?.message ?? '' };
    }

    const emit = (event = status()) => { for (const fn of listeners) fn(event); };

    // -----------------------------------------------------------------------
    // Local cache
    // -----------------------------------------------------------------------

    async function persistIndex() {
        const sealed = await session.sealJson(INDEX_ID, { v: 1, items: Object.fromEntries(metas) });
        await kv.set('index', { sealed, sha: indexSha, dirty: indexDirty });
    }

    async function persistPending(doc) {
        if (!doc.dirty) return;
        const seal = (text) => session.sealText(doc.id, text);
        await kv.set(`pending:${doc.id}`, {
            sealed: await seal(doc.text),
            baseSha: doc.base?.sha ?? null,
            sealedBase: doc.base?.text != null ? await seal(doc.base.text) : null,
            sealedSent: await Promise.all(doc.sent.map(seal)),
        });
    }

    // -----------------------------------------------------------------------
    // Index
    // -----------------------------------------------------------------------

    /** Reads the remote index and merges it into the local one. */
    async function pullIndex() {
        const remote = await github.getFile(INDEX_PATH, { ref: branch });
        if (!remote) { indexSha = null; return; }
        const incoming = await session.openJson(INDEX_ID, JSON.parse(remote.text));
        indexSha = remote.sha;
        for (const [id, meta] of Object.entries(incoming.items)) {
            const mine = metas.get(id);
            if (!mine || newer(meta, mine)) metas.set(id, meta);
        }
        for (const [id, mine] of metas) {
            const theirs = incoming.items[id];
            if (!theirs || newer(mine, theirs)) indexDirty = true;
        }
        await persistIndex();
    }

    async function saveIndex() {
        for (let attempt = 0; ; attempt++) {
            const sealed = await session.sealJson(INDEX_ID, { v: 1, items: Object.fromEntries(metas) });
            try {
                const res = await github.putFile(INDEX_PATH, JSON.stringify(sealed), { branch, sha: indexSha ?? undefined, message: 'Update index' });
                indexSha = res.sha;
                indexDirty = false;
                await persistIndex();
                return;
            } catch (e) {
                if (!(e instanceof ConflictError) || attempt >= 4) throw e;
                await pullIndex();
            }
        }
    }

    // -----------------------------------------------------------------------
    // Saving
    // -----------------------------------------------------------------------

    async function ready() {
        if (branchReady) return;
        await github.ensureBranch(branch, publicBranch);
        branchReady = true;
    }

    /** Keeps both versions: the remote text stays, and what was being written becomes a new page. */
    async function keepBoth(doc, remoteText) {
        const copyId = randomId();
        const now = clock();
        const title = `${titleOf(doc.text)} (conflicted copy)`;
        metas.set(copyId, { title, created: now, updated: now, rev: 1, indexedAt: now });
        const copy = { id: copyId, text: withTitle(doc.text, title), base: null, sent: [], dirty: true, notBefore: 0 };
        docs.set(copyId, copy);
        await persistPending(copy);
        indexDirty = true;
        doc.text = remoteText;
        doc.dirty = false;
        doc.sent = [];
        await kv.delete(`pending:${doc.id}`);
        emit({ type: 'conflict', id: doc.id, copyId, text: remoteText });
    }

    /**
     * A write was refused because the file changed. Looks at what is there now.
     * @returns {Promise<'saved' | 'copied' | 'retry'>}
     */
    async function resolveConflict(doc, sentSha) {
        const remote = await github.getFile(itemPath(doc.id), { ref: branch });
        if (!remote) { doc.base = null; return 'retry'; }
        // The file did not change; the branch moved under the request.
        if (remote.sha === sentSha) return 'retry';

        const sealed = JSON.parse(remote.text);
        const remoteText = await session.openText(doc.id, sealed);
        const adopt = async () => {
            doc.base = { sha: remote.sha, text: remoteText };
            await kv.set(`blob:${doc.id}`, { sha: remote.sha, sealed });
        };

        if (remoteText === doc.text) { await adopt(); return 'saved'; }
        // An earlier write of ours that went through but never got an answer.
        if (doc.sent.includes(remoteText)) { await adopt(); return 'retry'; }

        const merged = doc.base?.text != null ? merge3(doc.base.text, doc.text, remoteText) : null;
        if (merged?.clean) {
            await adopt();
            if (merged.text !== doc.text) {
                doc.text = merged.text;
                emit({ type: 'merged', id: doc.id, text: merged.text });
            }
            return merged.text === remoteText ? 'saved' : 'retry';
        }
        await keepBoth(doc, remoteText);
        await kv.set(`blob:${doc.id}`, { sha: remote.sha, sealed });
        doc.base = { sha: remote.sha, text: remoteText };
        return 'copied';
    }

    async function finishSave(doc, text) {
        doc.notBefore = clock() + minInterval;
        doc.sent = [];
        const meta = metas.get(doc.id);
        if (meta) {
            const title = titleOf(text);
            if (title !== meta.title || clock() - (meta.indexedAt ?? 0) > INDEX_REFRESH_MS) {
                meta.title = title;
                meta.indexedAt = clock();
                indexDirty = true;
            }
        }
        if (doc.text === text) {
            doc.dirty = false;
            await kv.delete(`pending:${doc.id}`);
        }
    }

    async function saveDoc(doc) {
        for (let attempt = 0; ; attempt++) {
            const text = doc.text;
            const sealed = await session.sealText(doc.id, text);
            const sha = doc.base?.sha;
            if (!doc.sent.includes(text)) doc.sent = [...doc.sent, text].slice(-3);
            await persistPending(doc);
            try {
                const res = await github.putFile(itemPath(doc.id), JSON.stringify(sealed), { branch, sha, message: `Update ${doc.id}` });
                doc.base = { sha: res.sha, text };
                await kv.set(`blob:${doc.id}`, { sha: res.sha, sealed });
                await finishSave(doc, text);
                return;
            } catch (e) {
                if (!(e instanceof ConflictError) || attempt >= 6) throw e;
                const outcome = await resolveConflict(doc, sha);
                if (outcome === 'copied') return;
                if (outcome === 'saved') { await finishSave(doc, doc.text); return; }
            }
        }
    }

    async function removeRemote(id, knownSha) {
        let sha = knownSha;
        if (!sha) sha = (await github.getFile(itemPath(id), { ref: branch }))?.sha;
        if (sha) {
            try {
                await github.deleteFile(itemPath(id), { branch, sha, message: `Delete ${id}` });
            } catch (e) {
                if (!(e instanceof ConflictError)) throw e;
                const fresh = await github.getFile(itemPath(id), { ref: branch });
                if (fresh) await github.deleteFile(itemPath(id), { branch, sha: fresh.sha, message: `Delete ${id}` });
            }
        }
        deletions.delete(id);
    }

    /** Writes everything that is waiting. `force` ignores the per-page minimum interval. */
    async function drain(force) {
        clearTimer(timer);
        timer = null;
        clearTimer(retryTimer);
        retryTimer = null;
        saving = true;
        failure = null;
        emit();
        try {
            await ready();
            for (;;) {
                const now = clock();
                const doc = [...docs.values()].find(d => d.dirty && (force || d.notBefore <= now));
                if (doc) { await saveDoc(doc); continue; }
                const gone = deletions.entries().next();
                if (!gone.done) { await removeRemote(gone.value[0], gone.value[1]); indexDirty = true; continue; }
                if (indexDirty && (force || ![...docs.values()].some(d => d.dirty))) { await saveIndex(); continue; }
                break;
            }
            offline = false;
        } catch (e) {
            if (e instanceof NetworkError) offline = true;
            else failure = e;
            if (!(e instanceof AuthError)) retryTimer = setTimer(() => serial(() => drain(true)), retryDelay);
        } finally {
            saving = false;
        }
        const waiting = [...docs.values()].filter(d => d.dirty).map(d => d.notBefore);
        if (waiting.length && !offline && !failure) schedule(Math.max(saveDelay, Math.min(...waiting) - clock()));
        emit();
    }

    function schedule(delay = saveDelay) {
        const at = clock() + delay;
        if (timer && timerAt <= at) return;
        clearTimer(timer);
        timerAt = at;
        timer = setTimer(() => serial(() => drain(false)), delay);
    }

    // -----------------------------------------------------------------------
    // Public interface
    // -----------------------------------------------------------------------

    async function loadDoc(id) {
        const meta = metas.get(id);
        if (!meta || meta.deleted) throw new Error('There is no such page');
        const existing = docs.get(id);
        if (existing?.dirty) return { doc: existing, stale: false };
        try {
            const remote = await github.getFile(itemPath(id), { ref: branch });
            if (!remote) {
                if (existing) return { doc: existing, stale: false };
                throw new Error('The page file is missing on GitHub');
            }
            offline = false;
            if (existing?.base?.sha === remote.sha) return { doc: existing, stale: false };
            const sealed = JSON.parse(remote.text);
            const text = await session.openText(id, sealed);
            const doc = { id, text, base: { sha: remote.sha, text }, sent: [], dirty: false, notBefore: 0 };
            docs.set(id, doc);
            await kv.set(`blob:${id}`, { sha: remote.sha, sealed });
            return { doc, stale: false, changed: !!existing };
        } catch (e) {
            if (!(e instanceof NetworkError)) throw e;
            offline = true;
            if (existing) return { doc: existing, stale: true };
            const cached = await kv.get(`blob:${id}`);
            if (!cached) throw e;
            const text = await session.openText(id, cached.sealed);
            const doc = { id, text, base: { sha: cached.sha, text }, sent: [], dirty: false, notBefore: 0 };
            docs.set(id, doc);
            return { doc, stale: true };
        } finally {
            emit();
        }
    }

    return {
        /** Loads the cache, finishes any writes that were interrupted, then reads the remote index. */
        async init() {
            const cached = await kv.get('index');
            if (cached) {
                try {
                    const incoming = await session.openJson(INDEX_ID, cached.sealed);
                    for (const [id, meta] of Object.entries(incoming.items)) metas.set(id, meta);
                    indexSha = cached.sha;
                    indexDirty = !!cached.dirty;
                } catch { /* cache from another vault */ }
            }
            for (const key of await kv.keys('pending:')) {
                const id = key.slice('pending:'.length);
                const record = await kv.get(key);
                try {
                    const text = await session.openText(id, record.sealed);
                    const baseText = record.sealedBase ? await session.openText(id, record.sealedBase) : null;
                    const sent = await Promise.all((record.sealedSent ?? []).map(sealed => session.openText(id, sealed)));
                    docs.set(id, {
                        id, text, base: record.baseSha ? { sha: record.baseSha, text: baseText } : null,
                        sent, dirty: true, notBefore: 0,
                    });
                } catch { await kv.delete(key); }
            }
            try {
                await pullIndex();
                offline = false;
            } catch (e) {
                if (e instanceof NetworkError) offline = true;
                else if (e instanceof AuthError) failure = e;
                else throw e;
            }
            if ([...docs.values()].some(d => d.dirty) || indexDirty) schedule(0);
            emit();
        },

        /** Pages that exist, newest first. */
        list() {
            return [...metas.entries()]
                .filter(([, m]) => !m.deleted)
                .map(([id, m]) => ({ id, ...m }))
                .sort((a, b) => b.updated - a.updated);
        },

        meta: (id) => metas.get(id),
        findBySlug: (slug) => [...metas.entries()].find(([, m]) => !m.deleted && m.slug === slug)?.[0] ?? null,

        /** The page's latest text. Reads GitHub unless there are unsaved edits here. */
        async open(id) {
            const { doc, stale } = await loadDoc(id);
            return { id, text: doc.text, meta: metas.get(id), stale };
        },

        /** Re-reads a page that has no unsaved edits. Resolves with the new text when it changed elsewhere. */
        async refresh(id) {
            const { doc, changed } = await loadDoc(id);
            return changed ? { id, text: doc.text } : null;
        },

        /** New page. `slug` makes it publishable at cards/<slug>.md. */
        async create({ title = 'Untitled', slug, text } = {}) {
            const id = randomId();
            const body = text ?? scaffold(title);
            const now = clock();
            const meta = { title: titleOf(body), created: now, updated: now, rev: 1, indexedAt: now };
            if (slug) meta.slug = slug;
            metas.set(id, meta);
            const doc = { id, text: body, base: null, sent: [], dirty: true, notBefore: 0 };
            docs.set(id, doc);
            indexDirty = true;
            await serial(async () => { await persistPending(doc); await persistIndex(); });
            schedule();
            emit();
            return id;
        },

        /** A working copy of a public page, so edits stay private until published. */
        async adopt(slug, text) {
            const existing = this.findBySlug(slug);
            if (existing) return existing;
            const id = await this.create({ slug, text });
            metas.get(id).publishedHash = await contentHash(text);
            return id;
        },

        /** Records new source text for a page. Saved after a pause. */
        edit(id, text) {
            const doc = docs.get(id);
            const meta = metas.get(id);
            if (!doc || !meta) throw new Error('Open the page before editing it');
            if (doc.text === text) return;
            doc.text = text;
            doc.dirty = true;
            meta.updated = clock();
            meta.rev++;
            serial(() => persistPending(doc)).catch(() => {});
            schedule();
            emit();
        },

        /** Sets a page's public name. Pass null to make it private again (an existing public file stays). */
        async setSlug(id, slug) {
            const meta = metas.get(id);
            if (slug) meta.slug = slug; else delete meta.slug;
            meta.rev++;
            meta.updated = clock();
            indexDirty = true;
            await serial(() => persistIndex());
            schedule();
            emit();
        },

        async remove(id) {
            const meta = metas.get(id);
            if (!meta) return;
            meta.deleted = true;
            meta.rev++;
            meta.updated = clock();
            deletions.set(id, docs.get(id)?.base?.sha ?? null);
            docs.delete(id);
            indexDirty = true;
            await serial(async () => {
                await kv.delete(`pending:${id}`);
                await kv.delete(`blob:${id}`);
                await persistIndex();
            });
            schedule();
            emit();
        },

        /** Writes everything now, ignoring the pause and the per-page interval. */
        async flush() {
            clearTimer(timer);
            timer = null;
            await serial(() => drain(true));
            return status();
        },

        /**
         * Commits the page's plain source to cards/<slug>.md on the public branch.
         * Refuses to overwrite a public file that changed since it was last published, unless `force`.
         */
        async publish(id, { force = false } = {}) {
            const meta = metas.get(id);
            if (!meta?.slug) throw new Error('Give the page a public name first');
            const { doc } = await loadDoc(id);
            const path = `cards/${meta.slug}.md`;
            const current = await github.getFile(path, { ref: publicBranch });
            if (current && !force) {
                const currentHash = await contentHash(current.text);
                if (!meta.publishedHash) throw new PublishConflict(`There is already a public page called ${meta.slug}`);
                if (currentHash !== meta.publishedHash && currentHash !== await contentHash(doc.text)) {
                    throw new PublishConflict('The public page was changed somewhere else since you last published it');
                }
            }
            const res = await github.putFile(path, doc.text, { branch: publicBranch, sha: current?.sha, message: `Publish ${meta.slug}` });
            meta.publishedHash = await contentHash(doc.text);
            meta.publishedAt = clock();
            meta.rev++;
            indexDirty = true;
            await this.flush();
            return { slug: meta.slug, commit: res.commit };
        },

        /** True when the page differs from what is public. */
        async hasUnpublishedChanges(id) {
            const meta = metas.get(id);
            const doc = docs.get(id);
            if (!meta?.slug || !doc) return false;
            return (await contentHash(doc.text)) !== meta.publishedHash;
        },

        status,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

        /** Retry now (for example when the browser comes back online). */
        retry() { return this.flush(); },

        dispose() {
            clearTimer(timer);
            clearTimer(retryTimer);
            timer = retryTimer = null;
            listeners.clear();
            docs.clear();
            metas.clear();
        },
    };
}
