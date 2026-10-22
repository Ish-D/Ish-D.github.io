/**
 * The line across the top of a page: the name of the site, then what can be done with the page (edit, publish and
 * backstage for the owner, the text settings, the list of pages). It is as wide as the text and goes with the page
 * when it scrolls. Rebuilt whenever the page or the unlock state changes.
 */

import { HOME_PAGE } from './urls.js';
import { PAGE } from '../layout/document.js';
import { createIndexPanel } from './index-panel.js';

export function createChrome(app) {
    const { state, settings, personal, document } = app;

    const el = (tag, props = {}, ...children) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children);
        return node;
    };
    const textButton = (text, title, onclick) => {
        const button = el('button', { textContent: text, title, onclick });
        button.setAttribute('aria-label', title);
        return button;
    };

    /** What the line that is there now can close; the keys and clicks outside it reach it through this. */
    let current = null;

    function settingsPanel() {
        const slider = (label, key, min, max) => {
            const input = el('input', { type: 'range', min, max, value: settings.values[key] });
            input.oninput = () => settings.set(key, Number(input.value));
            return el('label', {}, label, input);
        };
        const dark = el('input', { type: 'checkbox', checked: settings.values.theme === 'dark' });
        dark.onchange = () => settings.set('theme', dark.checked ? 'dark' : 'light');
        return el('div', { className: 'panel settings', hidden: true }, slider('Font size', 'fontSize', 14, 26), slider('Width', 'width', PAGE.width.min, PAGE.width.max), el('label', {}, 'Dark mode', dark));
    }

    function editButtons() {
        const pencil = textButton('Edit', 'Edit this page', () => {
            const on = !state.editor?.enabled;
            state.editor?.setEnabled(on);
            if (!on) app.selection?.clear();
            pencil.classList.toggle('on', on);
        });
        pencil.classList.toggle('on', !!state.editor?.enabled);
        const status = el('span', { className: 'status', textContent: state.saveStatus });
        const publish = state.vaultPage?.slug ? [textButton('Publish', 'Publish this page', () => personal.publish(state.vaultPage.id))] : [];
        return [status, ...publish, pencil];
    }

    /** The name of the site, which takes you home; on the home page the title says it. */
    function nameLink() {
        const link = el('a', { className: 'name', href: '/', textContent: 'ish', title: 'Home' });
        link.addEventListener('click', (e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            app.pages.open(HOME_PAGE);
        });
        return link;
    }

    function build() {
        document.querySelector('.chrome')?.remove();
        const pane = settingsPanel();
        const mark = (button, open) => {
            button.classList.toggle('on', open);
            button.setAttribute('aria-expanded', String(open));
        };
        let aa;
        let slash;
        const index = createIndexPanel(app, { onClose: () => mark(slash, false) });
        const closeAll = () => {
            pane.hidden = true;
            mark(aa, false);
            index.close();
        };
        const openIndex = () => {
            closeAll();
            index.open();
            mark(slash, true);
        };
        aa = textButton('Aa', 'Text and theme', () => {
            if (personal.consumeHold()) return;
            const opening = pane.hidden;
            closeAll();
            pane.hidden = !opening;
            mark(aa, opening);
        });
        slash = textButton('/', 'All pages', () => (index.isOpen() ? closeAll() : openIndex()));
        aa.setAttribute('aria-controls', 'settings-panel');
        pane.id = 'settings-panel';
        slash.setAttribute('aria-controls', 'page-index');
        mark(aa, false);
        mark(slash, false);
        personal.watchHold(aa);

        const bar = el('div', { className: 'bar' });
        if (state.page !== HOME_PAGE) bar.append(nameLink());
        bar.append(el('span', { className: 'space' }));
        if (state.canEdit) bar.append(...editButtons());
        if (personal.unlocked) bar.append(textButton('Backstage', 'Backstage', () => personal.openPanel()));
        bar.append(aa, slash);
        document.body.appendChild(el('header', { className: 'chrome' }, bar, pane, index.panel));
        current = { closeAll, openIndex };
        place(state.layout?.geometry);
    }

    /** Lines the bar up with the text column of the page. */
    function place(geometry) {
        const chrome = document.querySelector('.chrome');
        if (!chrome || !geometry) return;
        chrome.style.setProperty('--col-x', `${geometry.text.x}px`);
        chrome.style.setProperty('--col-w', `${geometry.text.width}px`);
    }

    const typing = (target) => !!target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || !!state.editor?.active;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') current?.closeAll();
        else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
            e.preventDefault();
            current?.openIndex();
        }
    });
    document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest?.('.chrome')) current?.closeAll();
    });

    return { build, place };
}
