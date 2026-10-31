import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widthFor } from '../../core/app/margin-resize.js';
import { PAGE } from '../../core/layout/document.js';

test('dragging a handle sets the column to the space between the two edges', () => {
    // 1400px window: handles at 380 and 1020 leave 640px
    assert.equal(widthFor('left', 380, 1400), 640);
    assert.equal(widthFor('right', 1020, 1400), 640);
});

test('the width stays within the range readers can choose and the window allows', () => {
    assert.equal(widthFor('left', 0, 1400), 1400 - 2 * (24 + 16 + 150));
    assert.equal(widthFor('left', 690, 1400), PAGE.width.min);
    assert.equal(widthFor('left', 0, 3000), PAGE.width.max);
});
