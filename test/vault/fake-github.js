/**
 * In-memory stand-in for the parts of the GitHub contents API the vault uses.
 * `fetch` is injected into createGitHub; `files`/`write` let a test play a
 * second device that changes the repository behind the client's back.
 */

/** Content hash standing in for git's blob id (cyrb53 over the bytes, plus the length). */
function blobSha(bytes) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (const b of bytes) {
        h1 = Math.imul(h1 ^ b, 2654435761);
        h2 = Math.imul(h2 ^ b, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
    return `${hex(h2)}${hex(h1)}${bytes.length.toString(16).padStart(8, '0')}`;
}

const asBytes = (content) => (typeof content === 'string' ? new TextEncoder().encode(content) : content);

function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

const wrap60 = (b64) => b64.replace(/(.{60})/g, '$1\n');

export function createFakeGitHub({ owner = 'me', repo = 'site', token = 'tok', inlineLimit = 1_000_000 } = {}) {
    /** @type {Map<string, Map<string, { sha: string, bytes: Uint8Array }>>} */
    const branches = new Map([['master', new Map()]]);
    const heads = new Map([['master', 'c0']]);
    const fake = {
        token,
        calls: [],
        offline: false,
        /** Responses to hand out before behaving normally: [{ status, body?, headers? }] */
        failures: [],
        inFlight: 0,
        maxInFlight: 0,
        commits: 0,
        branches,

        write(branch, path, content) {
            const bytes = asBytes(content);
            const files = branches.get(branch);
            const sha = blobSha(bytes);
            files.set(path, { sha, bytes });
            heads.set(branch, `c${++fake.commits}`);
            return sha;
        },
        read: (branch, path) => branches.get(branch)?.get(path) ?? null,
        text: (branch, path) => {
            const file = branches.get(branch)?.get(path);
            return file ? new TextDecoder().decode(file.bytes) : null;
        },
        paths: (branch) => [...(branches.get(branch)?.keys() ?? [])].sort(),
    };

    const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

    async function handle(url, init) {
        const method = init.method ?? 'GET';
        const headers = new Headers(init.headers);
        if (headers.get('authorization') !== `Bearer ${fake.token}`) return json(401, { message: 'Bad credentials' });

        const u = new URL(url);
        const prefix = `/repos/${owner}/${repo}`;
        if (!u.pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
        const rest = u.pathname.slice(prefix.length);
        const body = init.body ? JSON.parse(init.body) : {};
        fake.calls.push({ method, path: decodeURIComponent(rest), branch: u.searchParams.get('ref') ?? body.branch });

        if (fake.failures.length) {
            const f = fake.failures.shift();
            return json(f.status, f.body ?? { message: 'injected failure' }, f.headers);
        }

        if (rest === '' && method === 'GET') {
            return json(200, { full_name: `${owner}/${repo}`, default_branch: 'master', permissions: { push: true } });
        }

        let m;
        if ((m = /^\/contents\/(.+)$/.exec(rest))) {
            const path = decodeURIComponent(m[1]);
            const branch = (method === 'GET' ? u.searchParams.get('ref') : body.branch) ?? 'master';
            const files = branches.get(branch);
            if (!files) return json(404, { message: 'No commit found for the ref' });

            if (method === 'GET') {
                const file = files.get(path);
                if (file) {
                    return json(200, {
                        type: 'file', name: path.split('/').pop(), path, sha: file.sha, size: file.bytes.length,
                        encoding: 'base64',
                        content: file.bytes.length > inlineLimit ? '' : wrap60(toBase64(file.bytes)),
                    });
                }
                const dir = `${path.replace(/\/$/, '')}/`;
                const children = new Map();
                for (const [p, f] of files) {
                    if (!p.startsWith(dir)) continue;
                    const name = p.slice(dir.length).split('/')[0];
                    const isDir = p.slice(dir.length).includes('/');
                    children.set(name, { name, path: dir + name, sha: isDir ? `tree-${name}` : f.sha, type: isDir ? 'dir' : 'file' });
                }
                return children.size ? json(200, [...children.values()]) : json(404, { message: 'Not Found' });
            }

            const existing = files.get(path);
            if (method === 'PUT') {
                if (existing && !body.sha) return json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
                if (existing && body.sha !== existing.sha) return json(409, { message: `${path} does not match ${body.sha}` });
                if (!existing && body.sha) return json(422, { message: 'Invalid request.\n\n"sha" is not needed for a new file.' });
                fake.inFlight++;
                fake.maxInFlight = Math.max(fake.maxInFlight, fake.inFlight);
                await new Promise(r => setTimeout(r, 2));
                fake.inFlight--;
                const bytes = fromBase64(body.content);
                const sha = fake.write(branch, path, bytes);
                return json(existing ? 200 : 201, { content: { sha, path }, commit: { sha: heads.get(branch) } });
            }
            if (method === 'DELETE') {
                if (!existing) return json(404, { message: 'Not Found' });
                if (body.sha !== existing.sha) return json(409, { message: `${path} does not match ${body.sha}` });
                files.delete(path);
                heads.set(branch, `c${++fake.commits}`);
                return json(200, { commit: { sha: heads.get(branch) } });
            }
        }

        if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(rest)) && method === 'GET') {
            const name = decodeURIComponent(m[1]);
            return branches.has(name) ? json(200, { object: { sha: heads.get(name) } }) : json(404, { message: 'Not Found' });
        }
        if (rest === '/git/refs' && method === 'POST') {
            const name = body.ref.replace(/^refs\/heads\//, '');
            const source = [...heads].find(([, sha]) => sha === body.sha)?.[0];
            if (!source) return json(422, { message: 'Object does not exist' });
            branches.set(name, new Map(branches.get(source)));
            heads.set(name, body.sha);
            return json(201, { ref: body.ref, object: { sha: body.sha } });
        }
        if ((m = /^\/git\/blobs\/(.+)$/.exec(rest)) && method === 'GET') {
            for (const files of branches.values()) {
                for (const f of files.values()) {
                    if (f.sha === m[1]) return json(200, { encoding: 'base64', content: wrap60(toBase64(f.bytes)) });
                }
            }
            return json(404, { message: 'Not Found' });
        }
        return json(404, { message: 'Not Found' });
    }

    fake.fetch = async (url, init = {}) => {
        if (fake.offline) throw new TypeError('network down');
        await Promise.resolve();
        return handle(url, init);
    };
    return fake;
}
