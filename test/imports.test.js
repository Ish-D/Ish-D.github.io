import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Every module has to at least load: a missing import breaks the whole page, and most are only reached from the browser.
const root = new URL('../core/', import.meta.url).pathname;
const SKIP = new Set(['app/main.js']);   // runs the app on load

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : name.endsWith('.js') ? [path] : [];
    });
}

for (const file of walk(root)) {
    const name = relative(root, file);
    if (SKIP.has(name)) continue;
    test(`core/${name} loads`, async () => {
        const mod = await import(pathToFileURL(file).href);
        assert.ok(mod);
    });
}
