import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../../core/app/settings.js';

const memory = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data };
};
const doc = () => ({ documentElement: { dataset: {} } });

test('defaults follow the system theme and settings persist', () => {
    const storage = memory();
    const d = doc();
    const s = createSettings({ document: d, storage, prefersDark: true });
    assert.equal(s.values.theme, 'dark');
    s.set('fontSize', 22);
    assert.equal(createSettings({ document: doc(), storage }).values.fontSize, 22);
});

test('setting the theme applies it and listeners hear every change', () => {
    const d = doc();
    const s = createSettings({ document: d, storage: memory() });
    const heard = [];
    s.subscribe((k, v) => heard.push([k, v]));
    s.set('theme', 'dark');
    assert.equal(d.documentElement.dataset.theme, 'dark');
    s.set('width', 28);
    s.reset();
    assert.deepEqual(heard, [['theme', 'dark'], ['width', 28], ['*', null]]);
    assert.equal(d.documentElement.dataset.theme, 'light');
});

test('a preview changes this visit only', () => {
    const storage = memory();
    const s = createSettings({ document: doc(), storage });
    s.preview('theme', 'dark');
    assert.equal(s.values.theme, 'dark');
    assert.equal(storage.data.size, 0);
});

test('bad stored data falls back to defaults', () => {
    const storage = memory();
    storage.setItem('v2-settings', '{nope');
    assert.equal(createSettings({ document: doc(), storage }).values.fontSize, 20);
});
