import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseInline } from '../../core/doc/parse.js';
import { checkDoc } from './validate.js';

/** Parses and asserts the range contract holds. */
function doc(source, options) {
    const d = parse(source, options);
    assert.deepEqual(checkDoc(d), []);
    return d;
}

function only(source) {
    const { children } = doc(source);
    assert.equal(children.length, 1, `expected one block, got ${children.map((b) => b.type)}`);
    return children[0];
}

const types = (nodes) => nodes.map((n) => n.type);
const messages = (d) => d.diagnostics.map((x) => `${x.severity}: ${x.message}`);
const slice = (d, n) => d.source.slice(n.start, n.end);

describe('front matter', () => {
    it('keeps raw values with exact ranges', () => {
        const d = doc('---\nname: Why Weird?\ntags: [LLMs, technical], [C++, technical]\n---\n# Hi\n');
        const { tags, name } = d.frontmatter.entries;
        assert.equal(tags.value, '[LLMs, technical], [C++, technical]');
        assert.equal(d.source.slice(tags.valueStart, tags.valueEnd), tags.value);
        assert.equal(d.source.slice(tags.keyStart, tags.keyStart + 4), 'tags');
        assert.equal(name.value, 'Why Weird?');
        assert.equal(d.frontmatter.start, 0);
        assert.equal(d.source.slice(d.frontmatter.end - 3, d.frontmatter.end), '---');
        assert.deepEqual(types(d.children), ['heading']);
    });

    it('parses an unclosed block as body with a warning', () => {
        const d = doc('---\nname: x\n# Title\n');
        assert.equal(d.frontmatter, null);
        assert.deepEqual(types(d.children), ['rule', 'paragraph', 'heading']);
        assert.deepEqual(messages(d), ["warning: front matter has no closing '---'; parsed as body"]);
    });

    it('keeps an encrypted body as one raw block', () => {
        const d = doc('---\nencrypted: true\nsalt: abc==\n---\n\nU2FsdGVk*not*[[markdown]]\n');
        assert.deepEqual(types(d.children), ['raw']);
        assert.equal(d.children[0].text, 'U2FsdGVk*not*[[markdown]]');
    });
});

describe('blocks', () => {
    it('splits paragraphs on blank lines and joins single newlines with a space', () => {
        const d = doc('one\ntwo\n\nthree');
        assert.deepEqual(types(d.children), ['paragraph', 'paragraph']);
        assert.equal(d.children[0].children[0].value, 'one two');
    });

    it('centers a whole paragraph written ->text<-', () => {
        const p = only('->Browse all\n*tags*<-');
        assert.equal(p.centered, true);
        assert.deepEqual(types(p.children), ['text', 'emph']);
        assert.equal(p.children[0].value, 'Browse all ');
        assert.equal(only('-> not centered').centered, false);
    });

    it('reads headings up to level 6 and needs a space after the hashes', () => {
        const d = doc('# One\n###### Six\n####### seven\n#tag');
        assert.deepEqual(d.children.map((b) => b.level ?? b.type), [1, 6, 'paragraph']);
    });

    it('builds heading ids with the legacy slug and a duplicate counter', () => {
        const d = doc('### [[anchor(mind)]]{The Mind}\n## Design & Features\n## Design & Features\n## **Bold** `code`\n#  \n## Claude.com');
        assert.deepEqual(d.children.map((h) => h.id), ['anchormindthe-mind', 'design-features', 'design-features-1', 'bold-code', 'section', 'claudecom']);
    });

    it('reads a rule only from dashes alone on a line', () => {
        const d = doc('text\n---\n--- not a rule');
        assert.deepEqual(types(d.children), ['paragraph', 'rule', 'paragraph']);
    });

    it('reads lists; a change of marker type or a blank line ends the list', () => {
        const d = doc('- a\n* b\n1. c\n2. d\n\n- e');
        assert.deepEqual(d.children.map((l) => `${l.ordered}:${l.items.length}`), ['false:2', 'true:2', 'false:1']);
        assert.equal(d.children[0].items[1].children[0].value, 'b');
    });

    it('reads tables with alignment and protects pipes inside links, code and math', () => {
        const t = only('| a | b | c | d |\n|---|:--|:-:|--:|\n| [[About|Card]] | x \\| y | `p|q` | $r|s$ |');
        assert.deepEqual(t.align, [null, 'left', 'center', 'right']);
        assert.equal(t.rows[0].length, 4);
        assert.deepEqual(t.rows[0].map((cell) => cell[0].type), ['directive', 'text', 'codespan', 'mathinline']);
        assert.equal(t.rows[0][1][0].value, 'x | y');
        assert.deepEqual(t.rows[0][0][0].args.items.map((a) => a.value), ['About', 'Card']);
    });

    it('reads blockquotes without putting the > prefixes in text nodes', () => {
        const d = doc('> first *line*\n> second line\n>\n> - item');
        const q = d.children[0];
        assert.equal(q.type, 'blockquote');
        assert.deepEqual(types(q.children), ['paragraph', 'list']);
        for (const n of q.children[0].children.filter((c) => c.type === 'text')) {
            assert.ok(!slice(d, n).includes('>'), slice(d, n));
        }
        assert.equal(q.children[0].children.map((n) => n.value ?? '*').join(''), 'first * second line');
    });

    it('keeps blockquote children inside the quote when a group runs to its end', () => {
        const q = only('>[[e()]]{ ');
        assert.equal(q.end, 10);
        assert.equal(q.children[0].end, 10);
    });

    it('puts a group inner end on its closing brace across quote lines', () => {
        const d = doc('>[[e()]]{\n>}');
        const g = d.children[0].children[0].groups[0];
        assert.deepEqual([g.innerEnd, g.end, g.text], [11, 12, '\n>']);
    });

    it('reads fenced code with a language and keeps braces', () => {
        const c = only('```js\nif (a) { b({}); }\n```');
        assert.equal(c.type, 'code');
        assert.equal(c.lang, 'js');
        assert.equal(c.text, 'if (a) { b({}); }');
    });

    it('ends an unclosed fence at the next blank line', () => {
        const d = doc('```py\nx = 1\n\nafter');
        assert.deepEqual(types(d.children), ['code', 'paragraph']);
        assert.equal(d.children[0].text, 'x = 1');
        assert.deepEqual(messages(d), ['error: unclosed code fence']);
    });

    it('reads $$...$$ alone on its line(s) as a math block', () => {
        const d = doc('$$\na = b\n$$\nThen $$x$$ inline.');
        assert.deepEqual(types(d.children), ['math', 'paragraph']);
        assert.equal(d.children[0].tex, '\na = b\n');
        assert.deepEqual(types(d.children[1].children), ['text', 'mathinline', 'text']);
    });

    it('lets headings, rules, lists and block directives interrupt a paragraph', () => {
        const d = doc('text\n### H\ntext\n---\ntext\n- item\ntext\n[[break]]\ntext');
        assert.deepEqual(types(d.children), ['paragraph', 'heading', 'paragraph', 'rule', 'paragraph', 'list', 'paragraph', 'directive', 'paragraph']);
    });
});

describe('inline', () => {
    it('reads strong and emphasis with nesting; underscores are not emphasis', () => {
        const p = only('**bold *in* bold** and *a **b** c* and llms_for_bozos_2 _x_');
        assert.deepEqual(types(p.children), ['strong', 'text', 'emph', 'text']);
        assert.deepEqual(types(p.children[0].children), ['text', 'emph', 'text']);
        assert.equal(p.children[3].value, ' and llms_for_bozos_2 _x_');
    });

    it('never applies emphasis inside math', () => {
        const p = only('$a*b*c$ and $$x**2**$$ but *d*');
        assert.deepEqual(types(p.children), ['mathinline', 'text', 'mathinline', 'text', 'emph']);
        assert.equal(p.children[0].tex, 'a*b*c');
        assert.equal(p.children[2].tex, 'x**2**');
    });

    it('follows the KaTeX delimiter rules for math', () => {
        assert.equal(only('$\\text{a $ b}$').children[0].tex, '\\text{a $ b}');
        assert.equal(only('$x\\$y$').children[0].tex, 'x\\$y');
        assert.deepEqual(types(only('\\$5 and $6').children), ['text']);
    });

    it('reports an unclosed $ and keeps it as text', () => {
        const d = doc('costs $5 total');
        assert.deepEqual(types(d.children[0].children), ['text']);
        assert.deepEqual(messages(d), ["warning: unclosed '$'"]);
    });

    it('keeps code span content untouched', () => {
        const p = only('see `*x* [[y]] $z$` here');
        assert.deepEqual(types(p.children), ['text', 'codespan', 'text']);
        assert.equal(p.children[1].value, '*x* [[y]] $z$');
    });

    it('reads links and images', () => {
        const p = only('![a cat](img/cat.png) and [the *docs*](https://x.org/a_(b))');
        assert.deepEqual(types(p.children), ['image', 'text', 'link']);
        assert.deepEqual([p.children[0].src, p.children[0].alt], ['img/cat.png', 'a cat']);
        assert.equal(p.children[2].href, 'https://x.org/a_(b)');
        assert.deepEqual(types(p.children[2].children), ['text', 'emph']);
        assert.deepEqual(types(only('[sub-tag, main-tag] list').children), ['text']);
    });

    it('resolves backslash escapes for punctuation', () => {
        const p = only('\\*a\\* \\$ \\[[b]] \\{ \\} \\\\ \\q');
        assert.deepEqual(types(p.children), ['text']);
        assert.equal(p.children[0].value, '*a* $ [[b]] { } \\ \\q');
    });
});

describe('directive arguments', () => {
    it('splits on top-level commas, respecting quotes and parens', () => {
        const d = doc('[[style(clip-path: polygon(0 0, 1 0, 1 1), display: "Contact, Me", rel: 300:0, it\'s)]]');
        const items = d.children[0].args.items;
        assert.deepEqual(items.map((a) => [a.key, a.value]), [
            ['clip-path', 'polygon(0 0, 1 0, 1 1)'],
            ['display', '"Contact, Me"'],
            ['rel', '300:0'],
            [null, "it's"],
        ]);
        for (const a of items) {
            assert.equal(d.source.slice(a.valueStart, a.valueEnd), a.value);
            if (a.key !== null) assert.equal(d.source.slice(a.keyStart, a.keyStart + a.key.length), a.key);
        }
    });

    it('keeps URLs and nested directives as positional values', () => {
        const [cite] = only('[[cite(https://gwern.net/about#the-content, Gwern)]]').children;
        assert.deepEqual(cite.args.items.map((a) => [a.key, a.value]), [[null, 'https://gwern.net/about#the-content'], [null, 'Gwern']]);
        const quote = only('[[quote([[cite(https://x.y/a, T)]]{Gwern, Branwen}, anchor: q)]]\n{\nbody\n}');
        assert.deepEqual(quote.args.items.map((a) => [a.key, a.value]), [[null, '[[cite(https://x.y/a, T)]]{Gwern, Branwen}'], ['anchor', 'q']]);
    });

    it('does not apply emphasis inside arguments', () => {
        const [toggle] = only('[[toggle(label: *x*, on: **y**)]] after').children;
        assert.deepEqual(toggle.args.items.map((a) => a.value), ['*x*', '**y**']);
    });

    it('parses markup inside an argument value with parseInline', () => {
        const source = '[[quote([[cite(https://x.y)]]{Gwern Branwen})]]\n{\nq\n}';
        const author = parse(source).children[0].args.items[0];
        const { children, diagnostics } = parseInline(source, author.valueStart, author.valueEnd);
        assert.deepEqual(diagnostics, []);
        assert.equal(children[0].name, 'cite');
        assert.equal(source.slice(children[0].groups[0].innerStart, children[0].groups[0].innerEnd), 'Gwern Branwen');
    });
});

describe('directives', () => {
    it('makes a directive alone on its line a block and keeps the rest inline', () => {
        const d = doc('[[tab]] Indented [[drop(L)]]arge\n\n[[break]]\n\n[[tab]]\nfollows the tab');
        assert.deepEqual(types(d.children), ['paragraph', 'directive', 'paragraph']);
        assert.deepEqual(d.children[0].children.map((n) => n.name ?? n.value), ['tab', ' Indented ', 'drop', 'arge']);
        assert.equal(d.children[1].block, true);
        assert.equal(d.children[2].children[0].name, 'tab');
        assert.equal(d.children[2].children[0].block, false);
        assert.equal(d.children[2].children[1].value, ' follows the tab');
    });

    it('keeps text after a directive on the same line inline', () => {
        const p = only('[[note(right)]]{word}{margin} and more.');
        assert.deepEqual(types(p.children), ['directive', 'text']);
        assert.equal(p.children[0].block, false);
        assert.equal(p.children[1].value, ' and more.');
    });

    it('takes a group on the next line in the block form', () => {
        const q = only('[[quote(Ada)]]\n{\nfirst\n[[break]]\nsecond\n}');
        assert.equal(q.block, true);
        assert.equal(q.groups[0].kind, 'blocks');
        assert.deepEqual(types(q.groups[0].children), ['paragraph', 'directive', 'paragraph']);
        assert.equal(q.groups[0].children[1].block, true);
    });

    it('uses the schema for group kinds', () => {
        const d = doc('A [[note(left)]]{[[anchor(a)]]{word}}{Body with $x^2$, [l](u) and [[cite(u)]]{c}.} B\n\n[[image(koi.jpg)]]\n{\nA *koi*\n}\n\n[[gallery]]\n{\na.png | b\n}');
        const note = d.children[0].children[1];
        assert.deepEqual(note.groups.map((g) => g.kind), ['inline', 'blocks']);
        assert.equal(note.groups[0].children[0].name, 'anchor');
        assert.deepEqual(types(note.groups[1].children[0].children), ['text', 'mathinline', 'text', 'link', 'text', 'directive', 'text']);
        const image = d.children[1];
        assert.deepEqual([image.groups[0].kind, ...types(image.groups[0].children)], ['inline', 'text', 'emph']);
        const gallery = d.children[2];
        assert.deepEqual([gallery.groups[0].kind, gallery.groups[0].children], ['raw', null]);
        assert.equal(gallery.groups[0].text, '\na.png | b\n');
    });

    it('matches nested braces in raw code groups', () => {
        const d = doc('[[code(cpp)]]\n{\nauto f = [](T& r) { return {1, {2}}; };\n}\nafter');
        assert.deepEqual(types(d.children), ['directive', 'paragraph']);
        assert.equal(d.children[0].groups[0].text, '\nauto f = [](T& r) { return {1, {2}}; };\n');
    });

    it('gives unknown directives blocks or inline groups by placement', () => {
        const d = doc('[[box]]\n{\npara\n}\n\ntext [[chip]]{*x*} text');
        assert.equal(d.children[0].groups[0].kind, 'blocks');
        assert.equal(d.children[1].children[1].groups[0].kind, 'inline');
        assert.deepEqual(messages(d), ["warning: unknown directive 'box'", "warning: unknown directive 'chip'"]);
    });

    it('takes no more groups than the schema allows', () => {
        assert.deepEqual(only('[[tab]]{x}').children.map((n) => n.value ?? n.groups.length), [0, '{x}']);
        assert.deepEqual(only('[[cite(u)]]{a}{b}').children.map((n) => n.value ?? n.groups.length), [1, '{b}']);
        assert.equal(only('[[columns]]\n{\nleft\n}\n{\nright\n}').groups.length, 2);
    });

    it('reads short links and macros as link and macro directives', () => {
        const p = only('[[About]], [[about|Read more]], [[https://x.com|X]] and {{tags}}');
        const [a, b, c, m] = p.children.filter((n) => n.type === 'directive');
        assert.deepEqual([a, b, c, m].map((n) => n.name), ['link', 'link', 'link', 'macro']);
        assert.deepEqual(b.args.items.map((x) => x.value), ['about', 'Read more']);
        assert.deepEqual(c.args.items.map((x) => x.value), ['https://x.com', 'X']);
        assert.deepEqual(m.args.items.map((x) => x.value), ['tags']);
        assert.equal(only('{{writing}}').block, true);
    });

    it('ends an unclosed group at the end of its paragraph', () => {
        const d = doc('Text [[note(right)]]{a}{still typing\nmore\n## Next\nafter');
        assert.deepEqual(types(d.children), ['paragraph', 'heading', 'paragraph']);
        const body = d.children[0].children[1].groups[1];
        assert.equal(body.text, 'still typing\nmore');
        assert.deepEqual(messages(d), ["error: unclosed '{'"]);
    });

    it('ends an unclosed block-form group at the next blank line', () => {
        const d = doc('[[quote(x)]]\n{\nline\n# kept in the quote\n\nnext paragraph');
        assert.deepEqual(types(d.children), ['directive', 'paragraph']);
        assert.deepEqual(types(d.children[0].groups[0].children), ['paragraph', 'heading']);
    });

    it('keeps an unclosed [[ as text', () => {
        const d = doc('see [[cite(https://x\nnext');
        assert.equal(d.children[0].children[0].value, 'see [[cite(https://x next');
        assert.deepEqual(messages(d), ["warning: unclosed '[['"]);
    });

    it('accepts a custom directive table', () => {
        const options = { directives: { box: { block: true, groups: ['raw'] } } };
        const d = doc('[[box]]\n{\n*raw*\n}\n\n[[quote]]', options);
        assert.deepEqual([d.children[0].groups[0].kind, d.children[0].groups[0].text], ['raw', '\n*raw*\n']);
        assert.deepEqual(messages(d), []);
        const link = d.children[1];
        assert.deepEqual([link.name, link.args.items[0].value], ['link', 'quote']);
    });
});

describe('totality', () => {
    it('returns a doc for any input', () => {
        for (const input of [undefined, null, 42, '', '\n\n', '[[', '{', '$$', '```', '---', '> ', '|a|\n|-|']) {
            const d = doc(input);
            assert.equal(d.type, 'doc');
        }
    });

    it('caps nesting depth instead of recursing without bound', () => {
        const d = doc('[[quote]]{'.repeat(500) + '}'.repeat(500));
        assert.ok(d.diagnostics.some((x) => x.message.startsWith('nesting too deep')));
        const e = doc('*'.repeat(3000) + 'x' + '*'.repeat(3000));
        assert.ok(e.diagnostics.some((x) => x.message.startsWith('emphasis nested too deep')));
    });
});
