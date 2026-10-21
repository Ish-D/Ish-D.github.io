import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marginPercentFor } from '../../core/app/margin-resize.js';

test('dragging the left handle sets the margin to its distance from the left edge', () => {
    assert.equal(marginPercentFor('left', 280, 1000), 28);
});

test('dragging the right handle measures from the right edge', () => {
    assert.equal(marginPercentFor('right', 700, 1000), 30);
});

test('the margin stays between none and 40 percent', () => {
    assert.equal(marginPercentFor('left', -50, 1000), 0);
    assert.equal(marginPercentFor('left', 900, 1000), 40);
    assert.equal(marginPercentFor('right', 2000, 1000), 0);
});
