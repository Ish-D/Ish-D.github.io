import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, AuthError, ConflictError, GitHubError, NetworkError, RateLimitError } from '../../core/vault/github.js';
import { createFakeGitHub } from './fake-github.js';

function setup(options) {
    const fake = createFakeGitHub(options);
    const gh = createGitHub({ token: 'tok', owner: 'me', repo: 'site', fetch: fake.fetch, api: 'https://api.test' });
    return { fake, gh };
}

test('getFile returns null for a missing file', async () => {
    const { gh } = setup();
    assert.equal(await gh.getFile('nope.txt'), null);
});

test('putFile creates, getFile reads it back', async () => {
    const { gh, fake } = setup();
    const { sha } = await gh.putFile('cards/a.md', 'héllo ✓', { branch: 'master', message: 'add' });
    const file = await gh.getFile('cards/a.md', { ref: 'master' });
    assert.equal(file.text, 'héllo ✓');
    assert.equal(file.sha, sha);
    assert.equal(fake.text('master', 'cards/a.md'), 'héllo ✓');
});

test('binary content survives the base64 round trip', async () => {
    const { gh } = setup();
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) & 255);
    await gh.putFile('b.bin', bytes, { branch: 'master' });
    const file = await gh.getFile('b.bin', { ref: 'master' });
    assert.deepEqual(file.bytes, bytes);
});

test('updating needs the current sha', async () => {
    const { gh } = setup();
    const { sha } = await gh.putFile('a.txt', 'one', { branch: 'master' });
    await assert.rejects(() => gh.putFile('a.txt', 'two', { branch: 'master' }), ConflictError);
    await assert.rejects(() => gh.putFile('a.txt', 'two', { branch: 'master', sha: 'deadbeef' }), ConflictError);
    const next = await gh.putFile('a.txt', 'two', { branch: 'master', sha });
    assert.notEqual(next.sha, sha);
    assert.equal((await gh.getFile('a.txt', { ref: 'master' })).text, 'two');
});

test('a write from another device makes the old sha stale', async () => {
    const { gh, fake } = setup();
    const { sha } = await gh.putFile('a.txt', 'mine', { branch: 'master' });
    fake.write('master', 'a.txt', 'theirs');
    await assert.rejects(() => gh.putFile('a.txt', 'mine 2', { branch: 'master', sha }), ConflictError);
});

test('deleteFile removes the file and checks the sha', async () => {
    const { gh } = setup();
    const { sha } = await gh.putFile('a.txt', 'one', { branch: 'master' });
    await assert.rejects(() => gh.deleteFile('a.txt', { branch: 'master', sha: 'nope' }), ConflictError);
    await gh.deleteFile('a.txt', { branch: 'master', sha });
    assert.equal(await gh.getFile('a.txt', { ref: 'master' }), null);
});

test('listDir lists files and subfolders, empty for a missing folder', async () => {
    const { gh } = setup();
    await gh.putFile('d/a.md', 'a', { branch: 'master' });
    await gh.putFile('d/b.md', 'b', { branch: 'master' });
    await gh.putFile('d/sub/c.md', 'c', { branch: 'master' });
    const entries = await gh.listDir('d', { ref: 'master' });
    assert.deepEqual(entries.map(e => [e.name, e.type]).sort(), [['a.md', 'file'], ['b.md', 'file'], ['sub', 'dir']]);
    assert.deepEqual(await gh.listDir('missing', { ref: 'master' }), []);
});

test('ensureBranch branches from the source once', async () => {
    const { gh, fake } = setup();
    await gh.putFile('a.txt', 'one', { branch: 'master' });
    assert.equal(await gh.ensureBranch('private', 'master'), true);
    assert.equal(await gh.ensureBranch('private', 'master'), false);
    assert.equal(fake.text('private', 'a.txt'), 'one');
    await gh.putFile('p.txt', 'secret', { branch: 'private' });
    assert.equal(fake.read('master', 'p.txt'), null);
});

test('writing to a missing branch is an error', async () => {
    const { gh } = setup();
    await assert.rejects(() => gh.putFile('a.txt', 'x', { branch: 'private' }), (e) => e instanceof GitHubError && e.status === 404);
});

test('a wrong token is an AuthError', async () => {
    const fake = createFakeGitHub();
    const gh = createGitHub({ token: 'bad', owner: 'me', repo: 'site', fetch: fake.fetch, api: 'https://api.test' });
    await assert.rejects(() => gh.getFile('a.txt'), AuthError);
});

test('403 with no quota left is a RateLimitError, other 403 is an AuthError', async () => {
    const { gh, fake } = setup();
    fake.failures.push({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    await assert.rejects(() => gh.getFile('a.txt'), RateLimitError);
    fake.failures.push({ status: 403 });
    await assert.rejects(() => gh.getFile('a.txt'), AuthError);
});

test('an unreachable network is a NetworkError', async () => {
    const { gh, fake } = setup();
    fake.offline = true;
    await assert.rejects(() => gh.getFile('a.txt'), NetworkError);
});

test('files too big to inline come through the blob endpoint', async () => {
    const { gh } = setup({ inlineLimit: 10 });
    await gh.putFile('big.txt', 'this is longer than ten bytes', { branch: 'master' });
    assert.equal((await gh.getFile('big.txt', { ref: 'master' })).text, 'this is longer than ten bytes');
});

test('overlapping writes are sent one at a time', async () => {
    const { gh, fake } = setup();
    await Promise.all(['a', 'b', 'c', 'd'].map(n => gh.putFile(`${n}.txt`, n, { branch: 'master' })));
    assert.equal(fake.maxInFlight, 1);
    assert.deepEqual(fake.paths('master'), ['a.txt', 'b.txt', 'c.txt', 'd.txt']);
});

test('a failed write does not block the ones queued behind it', async () => {
    const { gh } = setup();
    const bad = gh.putFile('a.txt', 'x', { branch: 'nope' });
    const good = gh.putFile('b.txt', 'y', { branch: 'master' });
    await assert.rejects(() => bad, GitHubError);
    await good;
    assert.equal((await gh.getFile('b.txt', { ref: 'master' })).text, 'y');
});

test('whoami reports the repository', async () => {
    const { gh } = setup();
    const info = await gh.whoami();
    assert.equal(info.fullName, 'me/site');
    assert.equal(info.defaultBranch, 'master');
});
