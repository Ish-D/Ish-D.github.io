/** Just enough DOM for render smoke tests: elements, classes, data attributes, simple selectors. */

class Text {
    constructor(value) { this.nodeType = 3; this.textContent = value; this.parentNode = null; }
}

class ClassList {
    constructor(el) { this.el = el; }
    get set() { return new Set(String(this.el._class).split(/\s+/).filter(Boolean)); }
    add(...names) { const s = this.set; names.forEach(n => s.add(n)); this.el._class = [...s].join(' '); }
    remove(...names) { const s = this.set; names.forEach(n => s.delete(n)); this.el._class = [...s].join(' '); }
    contains(name) { return this.set.has(name); }
    toggle(name, force) {
        const on = force === undefined ? !this.contains(name) : !!force;
        if (on) this.add(name); else this.remove(name);
        return on;
    }
}

export class Element {
    constructor(tag) {
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.style = { cssText: '', props: {}, setProperty(k, v) { this.props[k] = v; } };
        this.dataset = {};
        this._class = '';
        this.attributes = {};
        this.classList = new ClassList(this);
        this._html = null;
        this.id = '';
    }

    get className() { return this._class; }
    set className(v) { this._class = String(v); }

    appendChild(child) {
        if (child.parentNode) {
            const at = child.parentNode.children.indexOf(child);
            if (at !== -1) child.parentNode.children.splice(at, 1);
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    append(...nodes) { nodes.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }

    replaceChildren(...nodes) {
        this.children.forEach(c => { c.parentNode = null; });
        this.children = [];
        nodes.forEach(n => this.appendChild(n));
    }

    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }

    addEventListener(type, fn) { (this._listeners ??= {})[type] = [...((this._listeners ?? {})[type] ?? []), fn]; }
    removeEventListener(type, fn) { if (this._listeners?.[type]) this._listeners[type] = this._listeners[type].filter(f => f !== fn); }
    dispatch(type, event = {}) { for (const fn of this._listeners?.[type] ?? []) fn({ preventDefault() {}, ...event }); }

    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this._class = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }

    get textContent() {
        if (this._text !== undefined) return this._text;
        return this.children.map(c => c.textContent).join('');
    }
    set textContent(v) {
        this.children.forEach(c => { c.parentNode = null; });
        this.children = [];
        this._text = String(v);
    }

    get innerHTML() { return this._html ?? ''; }
    set innerHTML(v) {
        this.children.forEach(c => { c.parentNode = null; });
        this._html = String(v);
        this.children = [];
    }

    matches(selector) {
        return selector.split(',').some(part => {
            const m = /^\s*([a-z0-9]*)((?:\.[\w-]+)*)(?:\[(data-[\w-]+)\])?\s*$/i.exec(part);
            if (!m) return false;
            const [, tag, classes, attr] = m;
            if (tag && this.tagName !== tag.toUpperCase()) return false;
            for (const c of classes.split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
            if (attr) {
                const key = attr.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                if (this.dataset[key] === undefined) return false;
            }
            return true;
        });
    }

    closest(selector) {
        for (let el = this; el; el = el.parentNode) if (el.nodeType === 1 && el.matches(selector)) return el;
        return null;
    }

    querySelectorAll(selector) {
        const out = [];
        const walk = (el) => {
            for (const c of el.children) {
                if (c.nodeType !== 1) continue;
                if (c.matches(selector)) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }

    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

export function createDocument() {
    return {
        createElement: (tag) => new Element(tag),
        createTextNode: (v) => new Text(v),
    };
}
