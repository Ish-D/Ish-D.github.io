import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlockVault } from '../../core/vault/vault.js';
import { createGitHub } from '../../core/vault/github.js';
import { createPrivateStore, PublishConflict } from '../../core/vault/store.js';
import { createMemoryKV } from '../../core/vault/kv.js';
import { createFakeGitHub } from './fake-github.js';

const KDF = { name: 'scrypt', N: 1024, r: 8, p: 1 };

async function world() {
    const fake = createFakeGitHub();
    const { file, session } = await createVault({ password: 'correct horse battery', secrets: { token: 'tok' }, kdf: KDF });
    return { fake, file, session };
}

/** One device: its own client, cache and store. Timers never fire by themselves. */
function device({ fake, session }, { kv = createMemoryKV(), clock } = {}) {
    const github = createGitHub({ token: 'tok', owner: 'me', repo: 'site', fetch: fake.fetch, api: 'https://api.test' });
    const events = [];
    let time = 1_000_000;
    const store = createPrivateStore({
        session, github, kv,
        clock: clock ?? (() => (time += 1000)),
        setTimer: () => 0, clearTimer: () => {},
    });
    store.onChange(e => events.push(e));
    return { store, github, kv, events };
}

const page = (title, body) => `---\nname: ${title}\n---\n\n${body}`;
const putsTo = (fake, fragment) => fake.calls.filter(c => c.method === 'PUT' && c.path.includes(fragment));

test('a new page is saved encrypted on the private branch', async () => {
    const w = await world();
    const { store } = device(w);
    await store.init();
    const id = await store.create({ title: 'Secret Diary', text: '---\nname: Secret Diary\n---\n\nmy deepest thoughts\n' });
    await store.flush();

    assert.equal(store.status().state, 'saved');
    const paths = w.fake.paths('private');
    assert.ok(paths.includes('store/index.json'));
    assert.ok(paths.includes(`store/items/${id}.json`));
    for (const path of paths) {
        const raw = w.fake.text('private', path);
        assert.ok(!raw.includes('deepest'), `${path} leaks text`);
        assert.ok(!raw.includes('Diary'), `${path} leaks the title`);
    }
    assert.equal(w.fake.paths('master').length, 0);
});

test('a second device sees the page and its latest text', async () => {
    const w = await world();
    const a = device(w);
    await a.store.init();
    const id = await a.store.create({ text: page('Notes', 'first draft\n') });
    await a.store.flush();

    const session = await unlockVault(w.file, 'correct horse battery');
    const b = device({ ...w, session });
    await b.store.init();
    assert.deepEqual(b.store.list().map(p => [p.id, p.title]), [[id, 'Notes']]);
    assert.equal((await b.store.open(id)).text, page('Notes', 'first draft\n'));

    await a.store.open(id);
    a.store.edit(id, page('Notes', 'second draft\n'));
    await a.store.flush();
    assert.equal((await b.store.refresh(id)).text, page('Notes', 'second draft\n'));
});

test('rapid edits are coalesced into one write per flush', async () => {
    const w = await world();
    const { store } = device(w);
    await store.init();
    const id = await store.create({ title: 'T', text: 'v0\n' });
    await store.flush();
    const before = putsTo(w.fake, `items/${id}`).length;
    for (let i = 1; i <= 20; i++) store.edit(id, `v${i}\n`);
    await store.flush();
    assert.equal(putsTo(w.fake, `items/${id}`).length - before, 1);
    assert.equal((await store.open(id)).text, 'v20\n');
});

test('commit messages do not carry titles', async () => {
    const w = await world();
    const { store } = device(w);
    await store.init();
    const id = await store.create({ title: 'Very Private Title', text: '---\nname: Very Private Title\n---\nx\n' });
    await store.flush();
    store.edit(id, '---\nname: Very Private Title\n---\ny\n');
    await store.flush();
    for (const path of w.fake.paths('private')) assert.ok(!path.includes('Private'));
});

test('edits made offline survive a reload and are sent when the network returns', async () => {
    const w = await world();
    const kv = createMemoryKV();
    const first = device(w, { kv });
    await first.store.init();
    const id = await first.store.create({ title: 'Offline', text: 'saved\n' });
    await first.store.flush();

    w.fake.offline = true;
    first.store.edit(id, 'typed on the train\n');
    const status = await first.store.flush();
    assert.equal(status.state, 'offline');

    // reload: same local cache, new store, still offline
    const second = device(w, { kv });
    await second.store.init();
    assert.equal(second.store.status().state, 'offline');
    assert.equal((await second.store.open(id)).text, 'typed on the train\n');

    w.fake.offline = false;
    await second.store.flush();
    assert.equal(second.store.status().state, 'saved');

    const session = await unlockVault(w.file, 'correct horse battery');
    const third = device({ ...w, session });
    await third.store.init();
    assert.equal((await third.store.open(id)).text, 'typed on the train\n');
});

test('a page can be read from the cache while offline', async () => {
    const w = await world();
    const kv = createMemoryKV();
    const a = device(w, { kv });
    await a.store.init();
    const id = await a.store.create({ title: 'Cached', text: 'body\n' });
    await a.store.flush();

    const b = device(w, { kv });
    w.fake.offline = true;
    await b.store.init();
    const page = await b.store.open(id);
    assert.equal(page.text, 'body\n');
    assert.equal(page.stale, true);
});

test('edits to different parts on two devices merge', async () => {
    const w = await world();
    const base = ['intro', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'outro'].map(l => `${l}\n`).join('');
    const a = device(w);
    await a.store.init();
    const id = await a.store.create({ title: 'Shared', text: base });
    await a.store.flush();

    const b = device({ ...w, session: await unlockVault(w.file, 'correct horse battery') });
    await b.store.init();
    await b.store.open(id);

    a.store.edit(id, base.replace('intro', 'INTRO'));
    await a.store.flush();
    b.store.edit(id, base.replace('outro', 'OUTRO'));
    await b.store.flush();

    const merged = (await b.store.open(id)).text;
    assert.equal(merged, base.replace('intro', 'INTRO').replace('outro', 'OUTRO'));
    assert.ok(b.events.some(e => e.type === 'merged' && e.text === merged));
    assert.equal(b.store.list().length, 1);

    await a.store.refresh(id);
    assert.equal((await a.store.open(id)).text, merged);
});

test('edits to the same lines keep both versions', async () => {
    const w = await world();
    const a = device(w);
    await a.store.init();
    const id = await a.store.create({ text: page('Clash', 'one\ntwo\nthree\n') });
    await a.store.flush();

    const b = device({ ...w, session: await unlockVault(w.file, 'correct horse battery') });
    await b.store.init();
    await b.store.open(id);

    a.store.edit(id, page('Clash', 'one\nTWO from a\nthree\n'));
    await a.store.flush();
    b.store.edit(id, page('Clash', 'one\nTWO from b\nthree\n'));
    await b.store.flush();

    const conflict = b.events.find(e => e.type === 'conflict');
    assert.ok(conflict);
    assert.equal(conflict.text, page('Clash', 'one\nTWO from a\nthree\n'));
    assert.equal((await b.store.open(id)).text, page('Clash', 'one\nTWO from a\nthree\n'));
    assert.equal((await b.store.open(conflict.copyId)).text, page('Clash (conflicted copy)', 'one\nTWO from b\nthree\n'));
    assert.equal(b.store.meta(conflict.copyId).title, 'Clash (conflicted copy)');
    assert.equal(b.store.status().state, 'saved');

    const c = device({ ...w, session: await unlockVault(w.file, 'correct horse battery') });
    await c.store.init();
    assert.equal(c.store.list().length, 2);
});

test('a write whose answer was lost is not mistaken for a conflict', async () => {
    const w = await world();
    const { store, events } = device(w);
    await store.init();
    const id = await store.create({ title: 'Lost', text: 'v0\n' });
    await store.flush();

    // the server applies the write, but the client never hears back
    const realFetch = w.fake.fetch;
    let drop = true;
    w.fake.fetch = async (url, init = {}) => {
        const res = await realFetch(url, init);
        if (drop && init.method === 'PUT' && String(url).includes(`items/${id}`)) { drop = false; throw new TypeError('connection lost'); }
        return res;
    };
    const github = createGitHub({ token: 'tok', owner: 'me', repo: 'site', fetch: (u, i) => w.fake.fetch(u, i), api: 'https://api.test' });
    const flaky = createPrivateStore({ session: w.session, github, kv: createMemoryKV(), setTimer: () => 0, clearTimer: () => {} });
    flaky.onChange(e => events.push(e));
    await flaky.init();
    await flaky.open(id);
    flaky.edit(id, 'v1\n');
    assert.equal((await flaky.flush()).state, 'offline');
    flaky.edit(id, 'v1 and more\n');
    assert.equal((await flaky.flush()).state, 'saved');

    assert.ok(!events.some(e => e.type === 'conflict'));
    assert.equal(flaky.list().length, 1);
    assert.equal(w.fake.text('private', `store/items/${id}.json`).includes('v1'), false);
    assert.equal((await flaky.open(id)).text, 'v1 and more\n');
});

test('pages created on two devices both appear everywhere', async () => {
    const w = await world();
    const a = device(w);
    const b = device({ ...w, session: await unlockVault(w.file, 'correct horse battery') });
    await a.store.init();
    await b.store.init();
    const ida = await a.store.create({ text: page('From A', 'a\n') });
    const idb = await b.store.create({ text: page('From B', 'b\n') });
    await a.store.flush();
    await b.store.flush();
    await a.store.flush();

    const titles = (store) => store.list().map(p => p.title).sort();
    await b.store.flush();
    assert.deepEqual(titles(b.store), ['From A', 'From B']);
    const c = device({ ...w, session: await unlockVault(w.file, 'correct horse battery') });
    await c.store.init();
    assert.deepEqual(titles(c.store), ['From A', 'From B']);
    assert.notEqual(ida, idb);
});

test('removing a page deletes its file and hides it on other devices', async () => {
    const w = await world();
    const a = device(w);
    await a.store.init();
    const id = await a.store.create({ title: 'Gone', text: 'x\n' });
    await a.store.flush();
    assert.ok(w.fake.read('private', `store/items/${id}.json`));

    await a.store.remove(id);
    await a.store.flush();
    assert.equal(w.fake.read('private', `store/items/${id}.json`), null);
    assert.equal(a.store.list().length, 0);

    const b = device({ ...w, session: await unlockVault(w.file, 'correct horse battery') });
    await b.store.init();
    assert.equal(b.store.list().length, 0);
});

test('a different vault cannot read the store', async () => {
    const w = await world();
    const a = device(w);
    await a.store.init();
    await a.store.create({ title: 'Mine', text: 'x\n' });
    await a.store.flush();

    const other = await createVault({ password: 'another long password', secrets: {}, kdf: KDF });
    const b = device({ ...w, session: other.session });
    await assert.rejects(() => b.store.init(), /Could not decrypt/);
});

test('publish writes plain source to cards/ on master, once the page has a name', async () => {
    const w = await world();
    const { store } = device(w);
    await store.init();
    const id = await store.create({ title: 'Hello', text: '---\nname: Hello\n---\n\nbody\n' });
    await assert.rejects(() => store.publish(id), /public name/);

    await store.setSlug(id, 'hello');
    const { commit } = await store.publish(id);
    assert.ok(commit);
    assert.equal(w.fake.text('master', 'cards/hello.md'), '---\nname: Hello\n---\n\nbody\n');
    assert.equal(await store.hasUnpublishedChanges(id), false);

    store.edit(id, '---\nname: Hello\n---\n\nbody, changed\n');
    assert.equal(await store.hasUnpublishedChanges(id), true);
    await store.publish(id);
    assert.equal(w.fake.text('master', 'cards/hello.md'), '---\nname: Hello\n---\n\nbody, changed\n');
});

test('publish refuses to overwrite a public page it did not write', async () => {
    const w = await world();
    w.fake.write('master', 'cards/taken.md', 'someone else\n');
    const { store } = device(w);
    await store.init();
    const id = await store.create({ title: 'Taken', text: 'mine\n', slug: 'taken' });
    await assert.rejects(() => store.publish(id), PublishConflict);
    assert.equal(w.fake.text('master', 'cards/taken.md'), 'someone else\n');
    await store.publish(id, { force: true });
    assert.equal(w.fake.text('master', 'cards/taken.md'), 'mine\n');
});

test('publish notices a public page edited elsewhere since the last publish', async () => {
    const w = await world();
    const { store } = device(w);
    await store.init();
    const id = await store.create({ title: 'P', text: 'v1\n', slug: 'p' });
    await store.publish(id);
    w.fake.write('master', 'cards/p.md', 'edited with git\n');
    store.edit(id, 'v2\n');
    await assert.rejects(() => store.publish(id), PublishConflict);
});

test('adopting a public page makes a private working copy that starts in sync', async () => {
    const w = await world();
    w.fake.write('master', 'cards/post.md', '---\nname: Post\n---\n\nlive text\n');
    const { store } = device(w);
    await store.init();
    const id = await store.adopt('post', '---\nname: Post\n---\n\nlive text\n');
    assert.equal(await store.adopt('post', 'ignored'), id);
    assert.equal(await store.hasUnpublishedChanges(id), false);
    store.edit(id, '---\nname: Post\n---\n\ndraft text\n');
    await store.flush();
    assert.equal(await store.hasUnpublishedChanges(id), true);
    assert.equal(w.fake.text('master', 'cards/post.md'), '---\nname: Post\n---\n\nlive text\n');
    await store.publish(id);
    assert.equal(w.fake.text('master', 'cards/post.md'), '---\nname: Post\n---\n\ndraft text\n');
});

test('a bad token shows as an error, not as offline', async () => {
    const w = await world();
    const github = createGitHub({ token: 'wrong', owner: 'me', repo: 'site', fetch: w.fake.fetch, api: 'https://api.test' });
    const store = createPrivateStore({ session: w.session, github, setTimer: () => 0, clearTimer: () => {} });
    await store.init();
    assert.equal(store.status().state, 'error');
});
