/**
 * Browser harness for driving the backstage UI against an in-memory GitHub.
 * Load it from a page with: import('/test/vault/browser-harness.js').then(m => m.install())
 */

import { createFakeGitHub } from './fake-github.js';

export function install() {
    const fake = createFakeGitHub({ owner: 'me', repo: 'site', token: 'tok' });
    const real = window.fetch.bind(window);
    window.fetch = async (url, init = {}) => {
        const href = String(url);
        if (href.startsWith('https://api.github.com')) return fake.fetch(href, init);
        if (href.endsWith('/vault.json')) {
            const text = fake.text('master', 'vault.json');
            return text === null ? new Response('not found', { status: 404 }) : new Response(text, { status: 200 });
        }
        return real(url, init);
    };

    const h = {
        fake,
        knock() {
            for (const key of 'backstage') document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        },
        inputs: () => [...document.querySelectorAll('.vault-dialog input')],
        fill(values) {
            const inputs = h.inputs();
            values.forEach((value, i) => {
                if (value == null) return;
                if (inputs[i].type === 'checkbox') inputs[i].click();
                else { inputs[i].value = value; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); }
            });
        },
        submit() { document.querySelector('.vault-dialog form').requestSubmit(); },
        click(label) { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click(); },
        text: (selector) => document.querySelector(selector)?.textContent ?? null,
        log(label, value) { console.log(`H ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`); },
        /** Types `append` onto the first block through the real editor. */
        async edit(append) {
            const pencil = document.querySelector('.chrome button[title="Edit this page"]');
            if (!window.__v2.state.editor.enabled) pencil.click();
            const block = document.querySelector('#root [data-start]');
            block.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }));
            const box = document.querySelector('.editor-box');
            box.value += append;
            box.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400));
            box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 900));
        },
        summary() {
            h.log('dialog', h.text('.vault-dialog'));
            h.log('toast', h.text('.toast'));
            h.log('status', h.text('.chrome .status'));
            h.log('chrome buttons', [...document.querySelectorAll('.chrome button')].map(b => b.title));
            h.log('private files', fake.paths('private'));
            h.log('master files', fake.paths('master'));
        },
    };
    window.__h = h;
    return 1;
}
