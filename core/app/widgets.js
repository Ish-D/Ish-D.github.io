/**
 * Form controls a page can place: theme and size settings, text fields, and
 * the contact form. Field values are kept in `state.formValues` so a relayout
 * does not clear what someone typed.
 */

const CONTACT_ENDPOINT = 'https://formspree.io/f/mgokjyon';

export function createWidgets(app) {
    const { state, settings, document, root } = app;

    const make = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className }, props);

    function slider(get, key) {
        const input = make('input', '', { type: 'range', min: get('min') ?? 12, max: get('max') ?? 22, step: get('step') ?? 1 });
        input.value = settings.values[key];
        input.oninput = () => settings.set(key, Number(input.value));
        return input;
    }

    function field(node, get) {
        const el = make(node.name === 'input' ? 'input' : 'textarea', 'w-field', { placeholder: get('placeholder') ?? '' });
        if (node.name === 'textarea') el.rows = Number(get('rows') ?? 5);
        const name = get('name');
        if (name) {
            el.name = name;
            el.value = state.formValues.get(name) ?? '';
            el.addEventListener('input', () => state.formValues.set(name, el.value));
        }
        return el;
    }

    function button(get) {
        const b = make('button', 'w-button', { textContent: get('label') ?? 'OK' });
        const action = get('action');
        if (action === 'submitContactForm') b.onclick = () => submitContact(b);
        else if (action === 'resetSettings') b.onclick = () => settings.reset();
        else b.disabled = true;
        return b;
    }

    async function submitContact(sendButton) {
        const { formValues } = state;
        const name = formValues.get('name')?.trim();
        const message = formValues.get('message')?.trim();
        if (!name || !message) {
            for (const key of ['name', 'message']) {
                const el = root.querySelector(`[name="${key}"]`);
                if (el && !formValues.get(key)?.trim()) {
                    el.style.borderColor = '#c4452c';
                    setTimeout(() => { el.style.borderColor = ''; }, 2000);
                }
            }
            return;
        }
        sendButton.disabled = true;
        sendButton.textContent = 'Sending…';
        try {
            const res = await fetch(CONTACT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ name, _subject: formValues.get('_subject') || 'Contact Form', message }),
            });
            if (!res.ok) throw new Error(String(res.status));
            formValues.clear();
            app.pages.showMessage('Sent', 'Thanks, your message is on its way.');
        } catch {
            sendButton.textContent = 'Error, retry';
            sendButton.disabled = false;
        }
    }

    /** The control for a toggle, slider, field or button node, or null. */
    function build(node) {
        const get = (k) => node.args?.items.find(a => a.key === k)?.value;
        const bind = get('bind');
        if (node.name === 'toggle' && bind === 'theme') {
            return make('button', 'w-toggle', {
                textContent: get('label') ?? 'dark mode',
                onclick: () => settings.set('theme', settings.values.theme === 'dark' ? 'light' : 'dark'),
            });
        }
        if (node.name === 'slider' && bind === 'fontSize') return slider(get, 'fontSize');
        if (node.name === 'slider' && bind === 'marginSize') return slider(get, 'marginPercent');
        if (node.name === 'input' || node.name === 'textarea') return field(node, get);
        if (node.name === 'button') return button(get);
        return null;
    }

    return { build };
}
