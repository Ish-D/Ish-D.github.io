/**
 * Schema table for known directives.
 *
 * `block`: a directive that stands alone on its line(s) becomes a block node.
 * When false the directive always stays inline, so `[[tab]]` alone on a line
 * still indents the paragraph that follows it.
 *
 * `groups[i]` is the content kind of the i-th `{...}` group. A directive takes
 * at most that many groups unless `rest` gives the kind of any further ones;
 * a `{` past the limit is plain text. Unknown directives take any number of
 * groups, 'blocks' on a block directive and 'inline' otherwise.
 *
 * Short links (`[[target]]`, `[[target|display]]`) parse as `link` and the
 * `{{name}}` embeds parse as `macro`.
 *
 * @typedef {'inline' | 'blocks' | 'raw'} GroupKind
 * @typedef {{ block: boolean, groups: readonly GroupKind[], rest?: GroupKind }} DirectiveSpec
 */

/**
 * @param {boolean} block
 * @param {GroupKind[]} [groups]
 * @param {GroupKind} [rest]
 * @returns {DirectiveSpec}
 */
const spec = (block, groups = [], rest) => Object.freeze(rest ? { block, groups: Object.freeze(groups), rest } : { block, groups: Object.freeze(groups) });

/** @type {Readonly<Record<string, DirectiveSpec>>} */
export const directives = Object.freeze({
    // Containers
    quote: spec(true, ['blocks']),
    center: spec(true, ['blocks']),
    margin: spec(true, ['blocks']),
    columns: spec(true, ['blocks'], 'blocks'),
    note: spec(true, ['inline', 'blocks']),
    style: spec(true, ['inline']),
    image: spec(true, ['inline']),
    summary: spec(true, ['inline']),
    code: spec(true, ['raw']),
    gallery: spec(true, ['raw']),

    // Widgets, links and placeholders
    viz: spec(true),
    toggle: spec(true),
    slider: spec(true),
    button: spec(true),
    input: spec(true),
    textarea: spec(true),
    link: spec(true),
    card: spec(true),
    macro: spec(true),
    tags: spec(true),
    date: spec(true),
    toc: spec(true),
    bibliography: spec(true),
    break: spec(true),
    bigbreak: spec(true),

    // Always inline
    tab: spec(false),
    drop: spec(false),
    cite: spec(false, ['inline']),
    jump: spec(false, ['inline']),
    anchor: spec(false, ['inline']),
});
