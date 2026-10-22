import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftHang, rightHang } from '../../core/text/protrusion.js';

test('opening quotes and brackets hang on the left, and nothing else does', () => {
    for (const ch of ['“', '‘', '(', '[']) assert.equal(leftHang(`${ch}word`), 1, ch);
    for (const ch of ['”', ')', ',', '.', 'a', '-', '—', '?']) assert.equal(leftHang(`${ch}word`), 0, ch);
    assert.equal(leftHang(''), 0);
});

test('closing quotes, brackets, commas, full stops and hyphens hang on the right, and nothing else does', () => {
    for (const ch of ['”', '’', ')', ']', ',', '.', ';', ':', '-']) assert.equal(rightHang(`word${ch}`), 1, ch);
    for (const ch of ['“', '(', 'd', '—', '–', '?', '!']) assert.equal(rightHang(`word${ch}`), 0, ch);
    assert.equal(rightHang(''), 0);
});

test('only the character at the edge counts', () => {
    assert.equal(leftHang('a“b'), 0);
    assert.equal(rightHang('a.b'), 0);
    assert.equal(rightHang('end.”'), 1);
});
