/**
 * Flattens inline nodes into the spans the line breaker consumes.
 *
 * Styling is carried as data on each span's `ref` so a renderer can decorate
 * runs without re-deriving anything from the tree. Directives that produce
 * margin content (notes) are collected on `ctx.notes` and leave a marker at
 * their anchor.
 */

/** @typedef {import('../types.js').Inline} Inline */
/** @typedef {import('../text/items.js').Span} Span */

const EM_SPACE = '\u2003';

/**
 * @typedef {Object} InlineContext
 * @property {ReturnType<import('./style.js').createStyles>} styles
 * @property {{ inlineMath(tex: string, size?: number): { width: number, height: number, ascent?: number },
 *             image(node: any): { width: number, height: number },
 *             widget(node: any): { width: number, height: number } }} atoms
 * @property {Array<{ node: any, marker: object }>} notes        collects note directives
 * @property {Array<{ message: string, start: number, end: number }>} diagnostics
 * @property {import('../doc/refs.js').References} [refs]
 * @property {(node: any, ctx: InlineContext, flags: object) => Span[] | null} [extend]  handler for additional directives
 */

/**
 * @param {Inline[]} nodes
 * @param {InlineContext} ctx
 * @param {{ italic?: boolean, bold?: boolean, code?: boolean, sup?: boolean, link?: object, css?: string, underline?: string, font?: object }} [flags]
 * @returns {Span[]}
 */
export function flattenInline(nodes, ctx, flags = {}) {
    const spans = [];
    nodes.forEach((node, i) => {
        if (isBareCite(node) && isBareCite(nodes[i - 1])) spans.push(textSpan(',', ctx, { ...flags, sup: true }, node));
        spans.push(...flattenNode(node, ctx, flags));
    });
    return spans;
}

const isBareCite = (node) =>
    !!node && node.type === 'directive' && node.name === 'cite' && !(node.groups[0] && node.groups[0].children?.length);

function superscript(node, ctx, flags, number, target) {
    if (number === undefined) return [];
    return [textSpan(String(number), ctx, { ...flags, sup: true, link: { type: 'jump', target } }, node)];
}

export function fontFor(styles, flags) {
    if (flags.font) return flags.font;
    if (flags.code) return styles.codeInline;
    let font = flags.italic && flags.bold ? styles.strongEmph
        : flags.italic ? styles.emph
            : flags.bold ? styles.strong
                : styles.body;
    if (flags.sup) font = { ...font, size: font.size * 0.7 };
    return font;
}

function textSpan(text, ctx, flags, node) {
    const ref = { node };
    if (flags.link) ref.link = flags.link;
    if (flags.css) ref.css = flags.css;
    if (flags.underline) ref.underline = flags.underline;
    if (flags.code) ref.code = true;
    if (flags.sup) ref.sup = true;
    if (flags.hl) ref.hl = flags.hl;
    return { kind: 'text', text, font: fontFor(ctx.styles, flags), noHyphen: !!flags.code || !!flags.link?.noHyphen, ref };
}

function flattenNode(node, ctx, flags) {
    switch (node.type) {
        case 'text':
            return [textSpan(node.value, ctx, flags, node)];
        case 'emph':
            return flattenInline(node.children, ctx, { ...flags, italic: !flags.italic });
        case 'strong':
            return flattenInline(node.children, ctx, { ...flags, bold: true });
        case 'codespan':
            return [textSpan(node.value, ctx, { ...flags, code: true }, node)];
        case 'link':
            return flattenInline(node.children, ctx, {
                ...flags, link: { type: 'external', href: node.href }, underline: 'solid',
            });
        case 'mathinline': {
            const m = ctx.atoms.inlineMath(node.tex, fontFor(ctx.styles, flags).size);
            return [{ kind: 'atom', width: m.width, height: m.height, ref: { type: 'math', tex: node.tex, ascent: m.ascent, node } }];
        }
        case 'image': {
            const size = ctx.atoms.image(node);
            return [{ kind: 'atom', width: size.width, height: size.height, ref: { type: 'image', node } }];
        }
        case 'directive':
            return flattenDirective(node, ctx, flags);
        default:
            return [];
    }
}

function groupInline(node, index, ctx, flags) {
    const group = node.groups[index];
    if (!group || !group.children) return [];
    return flattenInline(group.children, ctx, flags);
}

const argValue = (node, key) => node.args?.items.find(a => a.key === key)?.value;
const positional = (node, i = 0) => node.args?.items.filter(a => a.key === null)[i]?.value;

function flattenDirective(node, ctx, flags) {
    switch (node.name) {
        case 'tab':
            return [textSpan(EM_SPACE.repeat(ctx.styles.indentEm), ctx, flags, node)];

        case 'note': {
            const marker = { type: 'note', node };
            ctx.notes.push({ node, marker });
            const anchor = groupInline(node, 0, ctx, { ...flags, underline: 'dotted' });
            return [{ kind: 'marker', ref: marker }, ...anchor];
        }

        case 'anchor': {
            const id = positional(node);
            const jumps = ctx.refs?.jumps.get(id) ?? [];
            const backRefs = jumps.length
                ? [textSpan(jumps.map(j => j.number).join(','), ctx, { ...flags, sup: true }, node)]
                : [];
            return [{ kind: 'marker', ref: { type: 'anchor', id, node } }, ...backRefs, ...groupInline(node, 0, ctx, flags)];
        }

        case 'jump': {
            const target = positional(node);
            const number = ctx.refs?.numberOf.get(node);
            const body = node.groups.length ? groupInline(node, 0, ctx, { ...flags, link: { type: 'jump', target }, underline: 'dotted' }) : [];
            const label = body.length ? body : [textSpan(target ?? '', ctx, { ...flags, link: { type: 'jump', target } }, node)];
            return [...label, ...superscript(node, ctx, flags, number, target)];
        }

        case 'cite': {
            const url = positional(node);
            const number = ctx.refs?.numberOf.get(node);
            const body = groupInline(node, 0, ctx, { ...flags, link: { type: 'external', href: url, cite: true }, underline: 'dotted' });
            const refTarget = number === undefined ? undefined : `ref-${number}`;
            return [...body, ...superscript(node, ctx, flags, number, refTarget)];
        }

        case 'link': {
            const target = positional(node);
            const display = argValue(node, 'display') ?? positional(node, 1) ?? target;
            const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target ?? '');
            const shown = stripQuotes(display ?? '');
            return [textSpan(shown, ctx, {
                ...flags, link: { type: isUrl ? 'external' : 'card', href: target, node, noHyphen: shown.includes('://') }, underline: isUrl ? 'solid' : 'solid',
            }, node)];
        }

        case 'style':
            return groupInline(node, 0, ctx, { ...flags, css: positional(node) ?? '' });

        case 'var':
        case 'ref': {
            const name = positional(node);
            const box = ctx.atoms.variable?.(name, node.name === 'var');
            if (!box) return [textSpan(name ?? '', ctx, flags, node)];
            return [{ kind: 'atom', width: box.width, height: box.height, ref: { type: 'var', name, readonly: node.name === 'ref', node } }];
        }

        case 'hl': {
            const name = positional(node);
            return groupInline(node, 0, ctx, { ...flags, hl: name });
        }

        case 'toggle': case 'slider': case 'button': case 'input': case 'textarea': {
            const size = ctx.atoms.widget(node);
            return [{ kind: 'atom', width: size.width, height: size.height, ref: { type: 'widget', node } }];
        }

        case 'break':
            return [{ kind: 'break' }];
        default:
            break;
    }
    const extended = ctx.extend?.(node, ctx, flags);
    if (extended) return extended;
    ctx.diagnostics.push({ message: `Unknown inline directive: ${node.name}`, start: node.start, end: node.end });
    return [textSpan(`[[${node.name}]]`, ctx, flags, node)];
}

const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url ?? ''; }
};

const stripQuotes = (s) => s.replace(/^["']|["']$/g, '');
