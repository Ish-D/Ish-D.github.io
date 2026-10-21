/**
 * Article-scoped variables: named numbers declared in the prose with
 * [[var(name, value, min:, max:, step:)]] and shared with equations and figures.
 */

import { signal, effect, batch } from './signals.js';

/**
 * @typedef {Object} VarSpec
 * @property {string} name
 * @property {number} value
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {string} [unit]
 */

export function createStore() {
    /** @type {Map<string, { spec: VarSpec, value: ReturnType<typeof signal> }>} */
    const vars = new Map();

    const clamp = (spec, v) => {
        const snapped = Math.round((v - spec.min) / spec.step) * spec.step + spec.min;
        return Math.min(spec.max, Math.max(spec.min, Number(snapped.toFixed(10))));
    };

    return {
        /** Declares a variable; redeclaring keeps the current value if it still fits. */
        define(input) {
            const spec = {
                name: input.name,
                value: Number(input.value ?? 0),
                min: Number(input.min ?? 0),
                max: Number(input.max ?? Math.max(100, Number(input.value ?? 0) * 2)),
                step: Number(input.step ?? 1),
                unit: input.unit ?? '',
            };
            const existing = vars.get(spec.name);
            const value = existing ? clamp(spec, existing.value.peek()) : clamp(spec, spec.value);
            if (existing) {
                existing.spec = spec;
                existing.value.set(value);
            } else {
                vars.set(spec.name, { spec, value: signal(value) });
            }
            return vars.get(spec.name).value;
        },

        has: (name) => vars.has(name),
        spec: (name) => vars.get(name)?.spec ?? null,
        names: () => [...vars.keys()],

        /** Reactive read: inside an effect this subscribes. */
        get(name) { return vars.get(name)?.value(); },
        peek(name) { return vars.get(name)?.value.peek(); },

        set(name, v) {
            const entry = vars.get(name);
            if (!entry) return;
            entry.value.set(clamp(entry.spec, Number(v)));
        },

        setMany(values) {
            batch(() => { for (const [k, v] of Object.entries(values)) this.set(k, v); });
        },

        /** Calls fn(value) now and on every change; returns a disposer. */
        subscribe(name, fn) {
            const entry = vars.get(name);
            if (!entry) return () => {};
            return effect(() => fn(entry.value()));
        },

        /** Runs fn whenever any of the named variables change. */
        watch(names, fn) {
            return effect(() => fn(Object.fromEntries(names.map(n => [n, vars.get(n)?.value()]))));
        },

        /** Widest text a variable can show, for reserving space in a line. */
        widest(name, format = formatNumber) {
            const spec = vars.get(name)?.spec;
            if (!spec) return '0';
            return [spec.min, spec.max, spec.value].map(v => format(v, spec)).reduce((a, b) => (b.length > a.length ? b : a), '');
        },
    };
}

export function formatNumber(value, spec = null) {
    if (spec && spec.step >= 1) return String(Math.round(value));
    const decimals = spec ? Math.max(0, -Math.floor(Math.log10(spec.step))) : 2;
    return Number(value).toFixed(Math.min(decimals, 6));
}
