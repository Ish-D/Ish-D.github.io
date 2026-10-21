/**
 * The panel for a selected figure: every argument of the figure as a control.
 * Choices apply at once; sliders and number fields apply as you change them,
 * so the page re-flows live. The controls come from figure-props.js.
 */

import { argValue } from './args.js';
import { FIGURES, FIT_CHOICES, LAYER_CHOICES, PLACE_CHOICES, WRAP_CHOICES, controlsFor, joinLength, splitLength } from './figure-props.js';
import { parseValue } from '../layout/values.js';

const TITLES = { image: 'Image', drawing: 'Drawing', viz: 'Figure', figure: 'Figure', gallery: 'Gallery', embed: 'Embed' };
const PAD_MAX = 120;

/**
 * @param {{ document: Document, host: any }} deps   host: node(), apply(changes), live(changes), commit(), setGroupText(text), remove(), openSource(), defaultPad(), textWidth()
 */
export function createInspector({ document, host }) {
    const make = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className }, props);
    const panel = make('aside', 'inspector', { hidden: true });
    panel.setAttribute('aria-label', 'Figure properties');
    document.body.appendChild(panel);

    let builtFor = null;
    let controls = [];

    const argText = (node, key) => argValue(node, key);
    const padOf = (node) => {
        const value = parseValue(argText(node, 'pad'));
        return value?.type === 'number' ? value.value : host.defaultPad();
    };

    // ----- building blocks; each control returns { el, sync(node) } -----

    const row = (label, ...content) => {
        const el = make('div', 'insp-row');
        el.append(make('span', 'insp-label', { textContent: label }), ...content);
        return el;
    };

    function choice(label, key, choices, { none = null, fallback }) {
        const group = make('div', 'insp-choices');
        const buttons = choices.map(([value, text]) => {
            const b = make('button', '', { type: 'button', textContent: text });
            b.onclick = () => host.apply([{ key, value: value === none ? null : value }]);
            b.dataset.value = value;
            group.appendChild(b);
            return b;
        });
        return {
            el: row(label, group),
            sync(node) {
                const now = argText(node, key) ?? fallback;
                for (const b of buttons) b.classList.toggle('on', b.dataset.value === now);
            },
        };
    }

    function slider(label, key, { min, max, read }) {
        const input = make('input', '', { type: 'range', min, max, step: 1 });
        const value = make('span', 'insp-value');
        input.addEventListener('input', () => { value.textContent = input.value; host.live([{ key, value: String(input.value) }]); });
        input.addEventListener('change', () => host.commit());
        return {
            el: row(label, input, value),
            sync(node) {
                if (document.activeElement === input) return;
                const now = Math.round(read(node));
                input.value = String(now);
                value.textContent = String(now);
            },
        };
    }

    /** A number with a px / % choice; empty means "not set". */
    function length(label, key) {
        const number = make('input', '', { type: 'number', step: 1, min: 0, placeholder: 'auto' });
        const unit = make('select', '');
        for (const u of ['px', '%']) unit.appendChild(make('option', '', { value: u, textContent: u }));
        const send = (final) => {
            const changes = [{ key, value: number.value === '' ? null : joinLength(Number(number.value), unit.value) }];
            if (final) host.apply(changes); else host.live(changes);
        };
        number.addEventListener('input', () => send(false));
        number.addEventListener('change', () => { host.commit(); });
        unit.addEventListener('change', () => send(true));
        return {
            el: row(label, number, unit),
            sync(node) {
                const { value, unit: u } = splitLength(argText(node, key));
                if (document.activeElement !== number) number.value = value === null ? '' : String(value);
                unit.value = u === '%' ? '%' : 'px';
            },
        };
    }

    function offset() {
        const fields = ['dx', 'dy'].map((key) => {
            const input = make('input', '', { type: 'number', step: 1, title: key === 'dx' ? 'Across' : 'Down' });
            input.addEventListener('input', () => host.live([{ key, value: input.value === '' || Number(input.value) === 0 ? null : String(Math.round(Number(input.value))) }]));
            input.addEventListener('change', () => host.commit());
            return { key, input };
        });
        const reset = make('button', 'insp-small', { type: 'button', textContent: 'Reset', title: 'Back to where it is placed' });
        reset.onclick = () => host.apply([{ key: 'dx', value: null }, { key: 'dy', value: null }]);
        return {
            el: row('Nudge', ...fields.map(f => f.input), reset),
            sync(node) {
                for (const { key, input } of fields) {
                    if (document.activeElement !== input) input.value = String(Math.round(parseValue(argText(node, key))?.value ?? 0));
                }
            },
        };
    }

    function text(label, key, { placeholder = '' } = {}) {
        const input = make('input', 'insp-text', { type: 'text', placeholder, spellcheck: false });
        input.addEventListener('change', () => {
            if (input.value === '' && key === 0) return;   // a figure keeps its file
            host.apply([{ key, value: input.value === '' ? null : input.value }]);
        });
        return {
            el: row(label, input),
            sync(node) { if (document.activeElement !== input) input.value = argText(node, key) ?? ''; },
        };
    }

    /** The caption is the text in braces when the figure has them, else its caption: argument. */
    function caption() {
        const input = make('input', 'insp-text', { type: 'text', placeholder: 'None' });
        input.addEventListener('change', () => {
            const node = host.node();
            if (node?.groups?.[0]) host.setGroupText(input.value);
            else host.apply([{ key: 'caption', value: input.value === '' ? null : input.value }]);
        });
        return {
            el: row('Caption', input),
            sync(node) {
                if (document.activeElement === input) return;
                const group = node.groups?.[0];
                input.value = group ? host.session().source.slice(group.innerStart, group.innerEnd) : (argText(node, 'caption') ?? '');
            },
        };
    }

    const BUILDERS = {
        source: () => text('File', 0, { placeholder: 'images/…' }),
        place: () => choice('Place', 'place', PLACE_CHOICES, { fallback: 'block' }),
        wrap: () => choice('Text wraps', 'wrap', WRAP_CHOICES, { none: 'none', fallback: 'none' }),
        pad: () => slider('Space around', 'pad', { min: 0, max: PAD_MAX, read: padOf }),
        size: () => {
            const w = length('Width', 'width');
            const h = length('Height', 'height');
            return { el: Object.assign(make('div', 'insp-group'), {}), parts: [w, h], sync(node) { w.sync(node); h.sync(node); } };
        },
        offset,
        fit: () => choice('Image fit', 'fit', FIT_CHOICES, { fallback: 'contain' }),
        layer: () => choice('Layer', 'layer', LAYER_CHOICES, { none: 'over', fallback: 'over' }),
        caption,
    };

    function build(node) {
        panel.replaceChildren();
        const head = make('div', 'insp-head');
        head.append(make('span', 'insp-title', { textContent: TITLES[node.name] ?? 'Figure' }));
        const source = make('button', 'insp-small', { type: 'button', textContent: 'Source', title: 'Edit as text' });
        source.onclick = () => host.openSource();
        const remove = make('button', 'insp-small danger', { type: 'button', textContent: 'Delete', title: 'Remove the figure (undo brings it back)' });
        remove.onclick = () => host.remove();
        head.append(source, remove);
        panel.appendChild(head);

        controls = controlsFor(node.name).map((id) => BUILDERS[id]());
        for (const c of controls) {
            if (c.parts) c.el.append(...c.parts.map(p => p.el));
            panel.appendChild(c.el);
        }
        builtFor = node.name;
    }

    return {
        show() { panel.hidden = false; },
        hide() { panel.hidden = true; builtFor = null; },
        padOf,
        /** Brings every control in line with the figure's arguments. */
        sync(node) {
            if (panel.hidden || !FIGURES.includes(node.name)) return;
            if (builtFor !== node.name) build(node);
            for (const c of controls) c.sync(node);
        },
        dispose() { panel.remove(); },
    };
}
