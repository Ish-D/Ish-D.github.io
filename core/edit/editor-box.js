/**
 * The text box used for editing a block's source. It is set in the block's own
 * typeface, size, line height and alignment, so it reads like the page, with
 * the markup (directives, braces, heading marks, emphasis) dimmed behind the
 * prose. A transparent textarea sits over a mirror that carries the colors.
 */

const SYNTAX = /\[\[[^\]\n]*\]\]|^#{1,6}[ \t]|\*{1,3}|[{}]|\$\$?|`+/gm;

/**
 * Splits source into prose and markup runs; joining the texts gives the source back.
 * @returns {Array<{ text: string, syntax: boolean }>}
 */
export function highlightSource(source) {
    const out = [];
    let last = 0;
    for (const m of source.matchAll(SYNTAX)) {
        if (m.index > last) out.push({ text: source.slice(last, m.index), syntax: false });
        out.push({ text: m[0], syntax: true });
        last = m.index + m[0].length;
    }
    if (last < source.length) out.push({ text: source.slice(last), syntax: false });
    return out;
}

const BODY_FALLBACK = { fontFamily: 'inherit', fontSize: '16px', fontWeight: 'normal', fontStyle: 'normal', lineHeight: '1.5', textAlign: 'left' };

/**
 * Typography of the rendered block `el` (or of the page's body text when the
 * element is not a text block).
 * @param {Element | null} el
 * @param {Window} view
 */
export function typographyOf(el, view) {
    const block = el?.closest?.('.blk, .codeblock, aside.note') ?? null;
    // a note's type is that of the lines inside it
    const source = block?.querySelector?.('.blk') ?? block ?? el?.ownerDocument?.querySelector('.blk-paragraph') ?? null;
    if (!source) return BODY_FALLBACK;
    const cs = view.getComputedStyle(source);
    const align = source?.dataset?.align;
    return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        lineHeight: cs.lineHeight,
        textAlign: align === 'center' ? 'center' : align === 'right' ? 'right' : source?.classList?.contains('blk-paragraph') && !block?.matches?.('aside.note') ? 'justify' : 'left',
    };
}

/**
 * @param {{ document: Document, text: string, typography: ReturnType<typeof typographyOf> }} options
 */
export function createEditorBox({ document, text, typography }) {
    const box = document.createElement('div');
    box.className = 'editor-box';
    const mirror = document.createElement('div');
    mirror.className = 'editor-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-input';
    textarea.spellcheck = true;
    textarea.value = text;
    box.append(mirror, textarea);
    Object.assign(box.style, typography);

    const paint = () => {
        mirror.replaceChildren();
        for (const run of highlightSource(textarea.value)) {
            if (run.syntax) {
                const span = document.createElement('span');
                span.className = 'ed-syntax';
                span.textContent = run.text;
                mirror.appendChild(span);
            } else {
                mirror.appendChild(document.createTextNode(run.text));
            }
        }
        // a final newline would otherwise collapse and shorten the mirror
        mirror.appendChild(document.createTextNode('\u200b'));
    };
    paint();
    textarea.addEventListener('input', paint);

    return { box, textarea, repaint: paint };
}
