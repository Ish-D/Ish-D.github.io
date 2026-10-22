import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMan, gazeToward, hitTest, rimTips, EXTENT } from '../../core/figures/umbrella-man.js';
import { createDocument } from '../render/fakedom.js';

const document = createDocument();
const near = (a, b, tolerance = 0.2) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

test('a point is the umbrella, the man, or nothing', () => {
    const tips = rimTips();
    assert.equal(hitTest(tips[2].x, tips[2].y - 20), 'canopy', 'above the middle of the rim');
    assert.equal(hitTest(tips[2].x, EXTENT.top - 10), null, 'above the umbrella');
    assert.equal(hitTest(0, -176), 'body', 'his face');
    assert.equal(hitTest(0, -160), 'body', 'his beard');
    assert.equal(hitTest(0, -120), 'body', 'his coat');
    assert.equal(hitTest(-12, -30), 'body', 'a leg');
    assert.equal(hitTest(-34, -120), 'body', 'an arm');
    assert.equal(hitTest(37, -106), 'body', 'the arm that holds the umbrella');
    assert.equal(hitTest(-48, -120), null, 'beside his arm');
    assert.equal(hitTest(0, -30), null, 'between his legs');
    assert.equal(hitTest(170, -100), null);
});

test('the near rim has five points of runoff, left to right, the end ones at the edges of the umbrella', () => {
    const tips = rimTips();
    assert.equal(tips.length, 5);
    assert.ok(tips.every((t, i) => i === 0 || t.x > tips[i - 1].x));
    assert.ok(tips[0].x - EXTENT.left < 6 && EXTENT.right - tips[4].x < 6);
    assert.ok(EXTENT.top < -240 && EXTENT.left < -40 && EXTENT.right > 60, 'he fits under it, and it is bigger than he is');
});

test('he looks toward the pointer, harder the further it is, and not at all from on top of him', () => {
    const head = { x: 100, y: 100 };
    assert.deepEqual(gazeToward(head, { x: 100, y: 100 }), { x: 0, y: 0 });
    assert.deepEqual(gazeToward(head, { x: 500, y: 100 }), { x: 1, y: 0 });
    assert.deepEqual(gazeToward(head, { x: 100, y: -300 }), { x: 0, y: -1 });
    const nearer = gazeToward(head, { x: 140, y: 100 });
    near(nearer.x, 0.25, 1e-9);
    assert.equal(nearer.y, 0);
    const diagonal = gazeToward(head, { x: 600, y: 600 });
    near(Math.hypot(diagonal.x, diagonal.y), 1, 1e-9);
    assert.ok(diagonal.x > 0 && diagonal.y > 0);
});

test('placing him moves and scales what the rain sees', () => {
    const parent = document.createElement('svg');
    const man = createMan(document, parent);
    man.place({ x: 200, y: 400, scale: 2 });
    assert.match(parent.children[0].getAttribute('transform'), /^translate\(200 400\) scale\(2\)$/);
    const head = man.headCenter();
    assert.equal(head.x, 200);
    assert.ok(head.y < 400 - 2 * 150, 'the head is high above his feet');
    assert.equal(man.hit(200, 400 - 2 * 120), 'body');
    const tips = man.tips();
    assert.equal(tips.length, 5);
    assert.ok(tips.every(t => t.y < 400 - 2 * 190), 'the rim is above his head');
    assert.equal(man.hit(tips[2].x, tips[2].y - 40), 'canopy');
});

test('smoke stops a little below the near rim, across the width of the umbrella', () => {
    const parent = document.createElement('svg');
    const man = createMan(document, parent);
    man.place({ x: 200, y: 400, scale: 2 });
    const roof = man.underside();
    assert.ok(roof.left < roof.centre && roof.centre < roof.right);
    assert.equal(roof.at(roof.left - 5), -Infinity);
    assert.equal(roof.at(roof.right + 5), -Infinity);
    const middle = roof.at(roof.centre);
    assert.ok(Number.isFinite(middle));
    assert.ok(middle > man.tips()[0].y, 'the near rim sags below the ends');
    assert.ok(middle < 400 - 2 * 190, 'and is still above his head');
});

test('the pipe goes with his head when it turns', () => {
    const parent = document.createElement('svg');
    const man = createMan(document, parent);
    man.place({ x: 200, y: 400, scale: 2 });
    man.look({ x: 0, y: 0 });
    const still = man.bowl();
    assert.ok(still.x < 200 && still.y < 400 - 2 * 150, 'the bowl is by his face, to his left');
    man.look({ x: 1, y: 0 });
    assert.ok(man.bowl().x > still.x, 'it follows the turn');
});

test('looking moves the eyes the way he looks, and a blink shuts them', () => {
    const parent = document.createElement('svg');
    const man = createMan(document, parent);
    const eyes = parent.querySelectorAll('.eye');
    assert.equal(eyes.length, 2);

    man.look({ x: 1, y: 0 });
    const right = eyes.map(e => Number(e.getAttribute('cx')));
    man.look({ x: -1, y: 0 });
    const left = eyes.map(e => Number(e.getAttribute('cx')));
    assert.ok(right[0] > left[0] && right[1] > left[1]);
    man.look({ x: 0, y: -1 });
    const up = Number(eyes[0].getAttribute('cy'));
    man.look({ x: 0, y: 1 });
    assert.ok(Number(eyes[0].getAttribute('cy')) > up);

    man.look({ x: 5, y: 0 });
    assert.deepEqual(eyes.map(e => Number(e.getAttribute('cx'))), right, 'a look is clamped to the extremes');

    man.look({ x: 0, y: 0 }, 0);
    const open = eyes.map(e => Number(e.getAttribute('ry')));
    assert.ok(open.every(r => r === Number(eyes[0].getAttribute('rx'))), 'an open eye is a round dot');
    man.look({ x: 0, y: 0 }, 1);
    assert.ok(eyes.every((e, i) => Number(e.getAttribute('ry')) < open[i] / 4), 'a shut eye is a thin line');
    man.look({ x: 0, y: 0 }, 0);
    assert.deepEqual(eyes.map(e => Number(e.getAttribute('ry'))), open, 'and open again');
});
