/**
 * Shared type contracts for the core. No runtime code; import the typedefs from JSDoc:
 *   @typedef {import('../types.js').FontSpec} FontSpec
 */

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FontSpec
 * @property {string} family
 * @property {number} size                       px
 * @property {number|string} [weight]            400, 700, 'bold'
 * @property {'normal'|'italic'|'oblique'} [style]
 * @property {boolean} [smallCaps]
 * @property {boolean} [caps]                    set in capitals; the text is measured and drawn as capitals
 * @property {number} [tracking]                 letter spacing in em, added after every character
 */

/**
 * All values in px at the font's size.
 * @typedef {Object} FontMetrics
 * @property {number} ascent
 * @property {number} descent
 * @property {number} xHeight
 * @property {number} capHeight
 * @property {number} spaceWidth
 */

/**
 * @typedef {Object} Measurer
 * @property {(text: string, font: FontSpec) => number} width    advance width in px, kerning inside `text` included
 * @property {(font: FontSpec) => FontMetrics} metrics
 */

// ---------------------------------------------------------------------------
// Line breaking (Knuth-Plass)
// ---------------------------------------------------------------------------

/** @typedef {{ kind: 'box', width: number }} BoxItem */
/** @typedef {{ kind: 'glue', width: number, stretch: number, shrink: number }} GlueItem */
/**
 * `width` is added to the line only if the break is taken here (a hyphen glyph).
 * `soft` marks breaks inserted by hyphenation; the first pass ignores them.
 * @typedef {{ kind: 'penalty', width: number, penalty: number, flagged: boolean, soft?: boolean, relaxedTo?: number }} PenaltyItem
 */
/** @typedef {BoxItem | GlueItem | PenaltyItem} Item */

// ---------------------------------------------------------------------------
// Document tree
//
// Every node carries [start, end): UTF-16 offsets into the source string, so
// source.slice(start, end) is the node's exact text. Siblings are ordered and
// disjoint; children lie inside their parent.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} NodeBase
 * @property {string} type
 * @property {number} start
 * @property {number} end
 */

/** @typedef {{ severity: 'error' | 'warning', message: string, start: number, end: number }} Diagnostic */

/**
 * `entries` keeps source ranges so a value can be patched in place.
 * @typedef {Object} Frontmatter
 * @property {number} start
 * @property {number} end
 * @property {Record<string, { value: string, keyStart: number, valueStart: number, valueEnd: number }>} entries
 */

/**
 * @typedef {NodeBase & {
 *   type: 'doc',
 *   source: string,
 *   frontmatter: Frontmatter | null,
 *   children: Block[],
 *   diagnostics: Diagnostic[],
 * }} Doc
 */

// Blocks --------------------------------------------------------------------

/** @typedef {NodeBase & { type: 'heading', level: number, id: string, children: Inline[] }} Heading */
/** @typedef {NodeBase & { type: 'paragraph', centered: boolean, flush?: boolean, children: Inline[] }} Paragraph  `flush` sets a generated paragraph flush left instead of justified */
/** @typedef {NodeBase & { type: 'item', children: Inline[] }} ListItem */
/** @typedef {NodeBase & { type: 'list', ordered: boolean, items: ListItem[] }} List */
/** @typedef {NodeBase & { type: 'blockquote', children: Block[] }} Blockquote */
/** @typedef {NodeBase & { type: 'code', lang: string | null, text: string }} CodeBlock */
/** @typedef {NodeBase & { type: 'math', tex: string }} MathBlock */
/**
 * @typedef {NodeBase & {
 *   type: 'table',
 *   align: Array<'left' | 'right' | 'center' | null>,
 *   header: Inline[][],
 *   rows: Inline[][][],
 * }} Table
 */
/** @typedef {NodeBase & { type: 'rule' }} Rule */
/** @typedef {NodeBase & { type: 'raw', text: string }} RawBlock  encrypted bodies and anything unparseable */

/** @typedef {Heading | Paragraph | List | Blockquote | CodeBlock | MathBlock | Table | Rule | RawBlock | Directive} Block */

// Inlines -------------------------------------------------------------------

/** @typedef {NodeBase & { type: 'text', value: string }} Text */
/** @typedef {NodeBase & { type: 'emph', children: Inline[] }} Emph */
/** @typedef {NodeBase & { type: 'strong', children: Inline[] }} Strong */
/** @typedef {NodeBase & { type: 'codespan', value: string }} CodeSpan */
/** @typedef {NodeBase & { type: 'mathinline', tex: string }} MathInline */
/** @typedef {NodeBase & { type: 'link', href: string, children: Inline[] }} Link */
/** @typedef {NodeBase & { type: 'image', src: string, alt: string }} Image */

/** @typedef {Text | Emph | Strong | CodeSpan | MathInline | Link | Image | Directive} Inline */

// Directives: [[name(args)]]{group}{group}... -------------------------------

/**
 * One comma-separated entry inside the parens. `key` is null for positional
 * entries. Ranges point at the trimmed value text.
 * @typedef {Object} Arg
 * @property {string | null} key
 * @property {string} value
 * @property {number} keyStart
 * @property {number} valueStart
 * @property {number} valueEnd
 */

/**
 * A `{...}` group after a directive. `inner*` exclude the braces.
 * `children` is null for `raw` groups; `text` is always the raw inner slice.
 * @typedef {Object} Group
 * @property {number} start
 * @property {number} end
 * @property {number} innerStart
 * @property {number} innerEnd
 * @property {'inline' | 'blocks' | 'raw'} kind
 * @property {Inline[] | Block[] | null} children
 * @property {string} text
 */

/**
 * `block` is true when the directive stands alone on its line(s).
 * `args` is null when there are no parens.
 * @typedef {NodeBase & {
 *   type: 'directive',
 *   name: string,
 *   block: boolean,
 *   args: { start: number, end: number, items: Arg[] } | null,
 *   groups: Group[],
 * }} Directive
 */

export {};
