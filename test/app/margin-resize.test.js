import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widthFor } from '../../core/app/margin-resize.js';

test('dragging a handle sets the column to the space between the two edges, in em', () => {
    // 1000px window, 20px text: handles at 180 and 820 leave 640px, which is 32em
    assert.equal(widthFor('left', 180, 1000, 20), 32);
    assert.equal(widthFor('right', 820, 1000, 20), 32);
});

test('the width stays within the range readers can choose', () => {
    assert.equal(widthFor('left', 0, 1000, 20), 44);
    assert.equal(widthFor('left', 600, 1000, 20), 24);
    assert.equal(widthFor('right', 700, 1000, 20), 24);
});

test('the same drag is fewer em at a larger text size', () => {
    assert.equal(widthFor('left', 200, 1200, 24), 33);
    assert.equal(widthFor('left', 200, 1200, 20), 40);
});
