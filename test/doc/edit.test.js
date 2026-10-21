import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../core/doc/parse.js';
import { applyEdit, removeArg, setArg } from '../../core/doc/edit.js';

/** The first directive of a one-directive document. */
function directive(source) {
    const [first] = parse(source).children;
    return first.type === 'directive' ? first : first.children.find((n) => n.type === 'directive');
}

/** Applies a directive edit to `source` and returns the new source. */
function apply(source, edit) {
    assert.notEqual(edit, null);
    return applyEdit(source, edit).source;
}

describe('applyEdit', () => {
    it('replaces a range and maps offsets across it', () => {
        const { source, map } = applyEdit('hello world', { start: 6, end: 11, text: 'there!' });
        assert.equal(source, 'hello there!');
        assert.deepEqual([map(0), map(6), map(8), map(8, 1), map(11)], [0, 6, 6, 12, 12]);
    });

    it('maps an insertion point by assoc', () => {
        const { source, map } = applyEdit('abc', { start: 1, end: 1, text: 'XY' });
        assert.equal(source, 'aXYbc');
        assert.deepEqual([map(0), map(1), map(1, 1), map(2), map(3)], [0, 1, 3, 4, 5]);
    });

    it('clamps ranges into the source', () => {
        assert.equal(applyEdit('abc', { start: -5, end: 99, text: 'z' }).source, 'z');
        assert.equal(applyEdit('abc', { start: 2, end: 1, text: null }).source, 'abc');
    });
});

describe('setArg', () => {
    const link = '[[link(contact, display: "Contact Me", size: 400x480)]]';

    it('replaces a value and keeps the rest of the argument text', () => {
        assert.equal(apply(link, setArg(directive(link), 'size', '300x300')), '[[link(contact, display: "Contact Me", size: 300x300)]]');
        const spaced = '[[viz(type: a ,size:small , h:1)]]';
        assert.equal(apply(spaced, setArg(directive(spaced), 'size', 'large')), '[[viz(type: a ,size:large , h:1)]]');
    });

    it('appends a missing argument, adding parentheses when needed', () => {
        assert.equal(apply(link, setArg(directive(link), 'rel', '0:0')), '[[link(contact, display: "Contact Me", size: 400x480, rel: 0:0)]]');
        assert.equal(apply('[[break]]', setArg(directive('[[break]]'), 'size', '2')), '[[break(size: 2)]]');
        assert.equal(apply('[[x()]]', setArg(directive('[[x()]]'), 'a', '1')), '[[x(a: 1)]]');
    });

    it('fills an empty value after its colon', () => {
        assert.equal(apply('[[t(a:, b: 2)]]', setArg(directive('[[t(a:, b: 2)]]'), 'a', '1')), '[[t(a: 1, b: 2)]]');
    });

    it('replaces positional values by index, including short links', () => {
        const image = '[[image(a.png, scale: 50%)]]\n{\ncap\n}';
        assert.equal(apply(image, setArg(directive(image), 0, 'b.png')), '[[image(b.png, scale: 50%)]]\n{\ncap\n}');
        assert.equal(apply('[[About|Click]]', setArg(directive('[[About|Click]]'), 1, 'Read')), '[[About|Read]]');
        assert.equal(setArg(directive('[[About]]'), 1, 'x'), null);
    });

    it('returns null for named arguments on short links and macros', () => {
        assert.equal(setArg(directive('[[About|Click]]'), 'display', 'x'), null);
        assert.equal(setArg(directive('{{tags}}'), 'x', '1'), null);
    });

    it('removes the argument when the value is null', () => {
        assert.equal(apply(link, setArg(directive(link), 'display', null)), '[[link(contact, size: 400x480)]]');
    });

    it('produces edits that round-trip through the parser', () => {
        const source = `# Card\n\nSee ${link} here.\n`;
        const d = parse(source).children[1].children[1];
        const next = parse(apply(source, setArg(d, 'display', '"Say hi, please"')));
        const items = next.children[1].children[1].args.items;
        assert.deepEqual(items.map((a) => [a.key, a.value]), [[null, 'contact'], ['display', '"Say hi, please"'], ['size', '400x480']]);
    });
});

describe('removeArg', () => {
    const t = '[[t(a: 1, b: 2, c: 3)]]';

    it('removes an argument together with its comma', () => {
        assert.equal(apply(t, removeArg(directive(t), 'a')), '[[t(b: 2, c: 3)]]');
        assert.equal(apply(t, removeArg(directive(t), 'b')), '[[t(a: 1, c: 3)]]');
        assert.equal(apply(t, removeArg(directive(t), 'c')), '[[t(a: 1, b: 2)]]');
    });

    it('removes the parentheses with the last argument', () => {
        assert.equal(apply('[[t(a: 1)]]{x}', removeArg(directive('[[t(a: 1)]]{x}'), 'a')), '[[t]]{x}');
    });

    it('removes positional arguments by index', () => {
        assert.equal(apply('[[cite(u, Title)]]', removeArg(directive('[[cite(u, Title)]]'), 1)), '[[cite(u)]]');
    });

    it('returns null when there is nothing to remove', () => {
        assert.equal(removeArg(directive(t), 'zzz'), null);
        assert.equal(removeArg(directive('[[break]]'), 'a'), null);
        assert.equal(removeArg(directive('[[About|Click]]'), 0), null);
    });
});
