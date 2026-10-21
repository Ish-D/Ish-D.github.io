/**
 * GitHub repository-contents client for the browser.
 *
 * Reads and writes files through the REST API, so the site can be edited from
 * any device with no git. Updates are optimistic: the caller passes the blob
 * `sha` it last saw, and a stale one raises ConflictError.
 */

import { utf8 } from './crypto.js';

export class GitHubError extends Error {
    /** @param {number} status 0 when the request never reached GitHub */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** The file changed on GitHub since the caller last read it. */
export class ConflictError extends GitHubError {
    constructor(message = 'The file changed on GitHub since it was loaded') {
        super(409, message);
    }
}

/** The token is missing, expired, or lacks access to the repository. */
export class AuthError extends GitHubError {
    constructor(status) {
        super(status, status === 401 ? 'GitHub rejected the token' : 'The token cannot do that on this repository');
    }
}

/** No connection (or GitHub unreachable). Worth retrying later. */
export class NetworkError extends GitHubError {
    constructor(message = 'Could not reach GitHub') {
        super(0, message);
    }
}

export class RateLimitError extends GitHubError {
    constructor() {
        super(429, 'GitHub rate limit reached; try again shortly');
    }
}

function toBase64(content) {
    const bytes = typeof content === 'string' ? utf8.encode(content) : content;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

function fromBase64(text) {
    const binary = atob(text.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/**
 * @param {{ token: string, owner: string, repo: string, fetch?: typeof fetch, api?: string }} options
 */
export function createGitHub({ token, owner, repo, fetch: fetchImpl = (...args) => globalThis.fetch(...args), api = 'https://api.github.com' }) {
    const base = `${api}/repos/${owner}/${repo}`;

    // GitHub rejects overlapping writes to one branch, so writes go one at a time.
    let writes = Promise.resolve();
    const serialized = (job) => {
        const run = writes.then(job);
        writes = run.catch(() => {});
        return run;
    };

    /** Reads may be missing (data is null); a missing target on any other method is an error. */
    async function call(method, path, { body, query } = {}) {
        const url = new URL(`${base}${path}`);
        for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
        const headers = {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        let res;
        try {
            // no-cache: revalidate every read (the API allows 60s of caching) and let a 304 be free
            res = await fetchImpl(url.toString(), { method, headers, cache: 'no-cache', body: body === undefined ? undefined : JSON.stringify(body) });
        } catch {
            throw new NetworkError();
        }
        if (res.status === 404) {
            if (method === 'GET') return { status: 404, data: null };
            throw new GitHubError(404, 'Not found: the repository, branch or file does not exist');
        }
        if (res.status === 401) throw new AuthError(401);
        if (res.status === 403 || res.status === 429) {
            if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) throw new RateLimitError();
            throw new AuthError(403);
        }
        if (res.status === 409 || res.status === 422) {
            const info = await res.json().catch(() => ({}));
            // 422 means the sha was missing or wrong; 409 means the file or branch moved
            if (res.status === 409 || /\bsha\b/i.test(info.message ?? '')) throw new ConflictError(info.message);
            throw new GitHubError(res.status, info.message ?? 'GitHub rejected the request');
        }
        if (!res.ok) throw new GitHubError(res.status, `GitHub error ${res.status}`);
        return { status: res.status, data: res.status === 204 ? null : await res.json() };
    }

    async function blobBytes(sha) {
        const { data } = await call('GET', `/git/blobs/${sha}`);
        return fromBase64(data?.content ?? '');
    }

    return {
        owner,
        repo,

        /** @returns {Promise<{ sha: string, bytes: Uint8Array, text: string } | null>} null when missing */
        async getFile(path, { ref } = {}) {
            const { status, data } = await call('GET', `/contents/${encodePath(path)}`, { query: { ref } });
            if (status === 404 || !data || Array.isArray(data)) return null;
            // files over 1 MB come back without content
            const bytes = data.content ? fromBase64(data.content) : await blobBytes(data.sha);
            return { sha: data.sha, bytes, text: utf8.decode(bytes) };
        },

        /** @returns {Promise<Array<{ name: string, path: string, sha: string, type: string }>>} */
        async listDir(path, { ref } = {}) {
            const { status, data } = await call('GET', `/contents/${encodePath(path)}`, { query: { ref } });
            if (status === 404 || !Array.isArray(data)) return [];
            return data.map(({ name, path: p, sha, type }) => ({ name, path: p, sha, type }));
        },

        /** Creates or updates a file; pass the last seen `sha` to update. */
        putFile(path, content, { message, branch, sha } = {}) {
            return serialized(async () => {
                const { data } = await call('PUT', `/contents/${encodePath(path)}`, {
                    body: { message: message ?? `Update ${path}`, content: toBase64(content), branch, sha },
                });
                return { sha: data.content.sha, commit: data.commit?.sha };
            });
        },

        deleteFile(path, { message, branch, sha }) {
            return serialized(async () => {
                await call('DELETE', `/contents/${encodePath(path)}`, { body: { message: message ?? `Delete ${path}`, branch, sha } });
            });
        },

        /** Makes sure `branch` exists, branching from `from` if needed. Returns true when it created it. */
        ensureBranch(branch, from) {
            return serialized(async () => {
                const existing = await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
                if (existing.status !== 404) return false;
                const source = await call('GET', `/git/ref/heads/${encodeURIComponent(from)}`);
                if (!source.data) throw new GitHubError(404, `Branch ${from} not found`);
                await call('POST', '/git/refs', { body: { ref: `refs/heads/${branch}`, sha: source.data.object.sha } });
                return true;
            });
        },

        /** Checks the token reaches the repository. */
        async whoami() {
            const { status, data } = await call('GET', '');
            if (status === 404) throw new GitHubError(404, 'Repository not found, or the token has no access to it');
            return { fullName: data.full_name, defaultBranch: data.default_branch, canPush: data.permissions?.push };
        },
    };
}
