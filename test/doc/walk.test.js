import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../core/doc/parse.js';
import { blockAt, childrenOf, isBlock, nodeAt, walk } from '../../core/doc/walk.js';

const source = [
    '# Title',
    '',
    'Some *em* text [[note(right)]]{word}{body **b**}',
    '',
    '| x | y |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '- item',
    '',
    '> quoted',
].join('\n');
const doc = parse(source);
const at = (text, delta = 0) => source.indexOf(text) + delta;

describe('childrenOf', () => {
    it('returns block and inline children in source order', () => {
        assert.deepEqual(childrenOf(doc).map((n) => n.type), ['heading', 'paragraph', 'table', 'list', 'blockquote']);
        assert.deepEqual(childrenOf(doc.children[1]).map((n) => n.type), ['text', 'emph', 'text', 'directive']);
    });

    it('flattens table cells, list items and directive groups', () => {
        assert.deepEqual(childrenOf(doc.children[2]).map((n) => n.value), ['x', 'y', '1', '2']);
        assert.deepEqual(childrenOf(doc.children[3]).map((n) => n.type), ['item']);
        const note = doc.children[1].children[3];
        assert.deepEqual(childrenOf(note).map((n) => n.type), ['text', 'paragraph']);
    });

    it('returns an empty list for leaves', () => {
        assert.deepEqual(childrenOf(doc.children[1].children[0]), []);
    });
});

describe('walk', () => {
    it('visits nodes depth first in source order', () => {
        const seen = [];
        walk(doc, (node) => {
            seen.push(node);
        });
        assert.deepEqual(seen.map((n) => n.type), [
            'doc', 'heading', 'text',
            'paragraph', 'text', 'emph', 'text', 'text', 'directive', 'text', 'paragraph', 'text', 'strong', 'text',
            'table', 'text', 'text', 'text', 'text',
            'list', 'item', 'text',
            'blockquote', 'paragraph', 'text',
        ]);
        for (let i = 1; i < seen.length; i++) assert.ok(seen[i].start >= seen[i - 1].start);
    });

    it('skips the children of a node when the visitor returns false', () => {
        const seen = [];
        walk(doc, (node, parent) => {
            seen.push(node.type);
            if (parent === doc) return false;
        });
        assert.deepEqual(seen, ['doc', 'heading', 'paragraph', 'table', 'list', 'blockquote']);
    });
});

describe('nodeAt', () => {
    it('returns the chain from the doc to the innermost node', () => {
        const chain = nodeAt(doc, at('**b**', 3));
        assert.deepEqual(chain.map((n) => n.type), ['doc', 'paragraph', 'directive', 'paragraph', 'strong', 'text']);
        assert.equal(chain[chain.length - 1].value, 'b');
    });

    it('keeps a caret at the end of a word in that word', () => {
        const chain = nodeAt(doc, at('Title', 5));
        assert.deepEqual(chain.map((n) => n.type), ['doc', 'heading', 'text']);
    });

    it('prefers the node that starts at the offset', () => {
        const chain = nodeAt(doc, at('*em*'));
        assert.equal(chain[chain.length - 1].type, 'emph');
    });

    it('returns only the doc between blocks and nothing outside it', () => {
        assert.deepEqual(nodeAt(doc, at('# Title') + 8).map((n) => n.type), ['doc']);
        assert.deepEqual(nodeAt(doc, -1), []);
        assert.deepEqual(nodeAt(doc, source.length + 1), []);
    });
});

describe('blockAt', () => {
    it('returns the innermost block', () => {
        assert.equal(blockAt(doc, at('em')).type, 'paragraph');
        const inNote = blockAt(doc, at('body'));
        assert.equal(source.slice(inNote.start, inNote.end), 'body **b**');
        assert.equal(blockAt(doc, at('quoted')).type, 'paragraph');
        assert.equal(blockAt(doc, at('item')).type, 'list');
        assert.equal(blockAt(doc, at('1 |')).type, 'table');
    });

    it('returns null where no block is', () => {
        assert.equal(blockAt(doc, at('# Title') + 8), null);
    });

    it('treats only block directives as blocks', () => {
        const d = parse('[[break]]\ntext [[break]] text');
        assert.equal(isBlock(d.children[0]), true);
        assert.equal(isBlock(d.children[1].children[1]), false);
    });
});
