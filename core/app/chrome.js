/**
 * The buttons in the top right corner: settings, home, edit, publish and
 * backstage. Rebuilt whenever the page or the unlock state changes.
 */

import { HOME_PAGE } from './urls.js';

export function createChrome(app) {
    const { state, settings, personal, document } = app;

    const el = (tag, props = {}, ...children) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children);
        return node;
    };
    const iconButton = (text, title, onclick) => el('button', { textContent: text, title, onclick });

    function settingsPanel() {
        const slider = (label, key, min, max) => {
            const input = el('input', { type: 'range', min, max, value: settings.values[key] });
            input.oninput = () => settings.set(key, Number(input.value));
            return el('label', {}, label, input);
        };
        const dark = el('input', { type: 'checkbox', checked: settings.values.theme === 'dark' });
        dark.onchange = () => settings.set('theme', dark.checked ? 'dark' : 'light');
        return el('div', { className: 'panel' }, slider('Font size', 'fontSize', 14, 26), slider('Margins', 'marginPercent', 0, 40), el('label', {}, 'Dark mode', dark));
    }

    function editButtons() {
        const pencil = iconButton('✎︎', 'Edit this page', () => {
            const on = !state.editor?.enabled;
            state.editor?.setEnabled(on);
            if (!on) app.selection?.clear();
            pencil.classList.toggle('on', on);
        });
        pencil.classList.toggle('on', !!state.editor?.enabled);
        const status = el('span', { className: 'status', textContent: state.saveStatus });
        const publish = state.vaultPage?.slug ? [iconButton('↑', 'Publish this page', () => personal.publish(state.vaultPage.id))] : [];
        return [status, ...publish, pencil];
    }

    function build() {
        document.querySelector('.chrome')?.remove();
        const panel = settingsPanel();
        const gear = iconButton('⚙︎', 'Settings', () => { if (!personal.consumeHold()) panel.classList.toggle('open'); });
        personal.watchHold(gear);

        const row = el('div', { className: 'row' });
        if (state.canEdit) row.append(...editButtons());
        if (personal.unlocked) row.append(iconButton('≡', 'Backstage', () => personal.openPanel()));
        if (state.page && state.page !== HOME_PAGE) row.append(iconButton('⌂', 'Home', () => app.pages.open(HOME_PAGE)));
        row.append(gear);
        document.body.appendChild(el('div', { className: 'chrome' }, row, panel));
    }

    return { build };
}
