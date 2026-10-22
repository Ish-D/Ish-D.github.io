import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRain, createWind } from '../../core/figures/rain.js';

/** A canopy that is a box over x 100..200, y 100..150, and the ground at 400. */
const shapes = (over = {}) => ({
    ground: 400,
    hit: (x, y) => (x > 100 && x < 200 && y > 100 && y < 150 ? 'canopy' : null),
    tips: [{ x: 100, y: 150 }, { x: 200, y: 150 }],
    ...over,
});
const make = (over = {}) => createRain({ width: 300, height: 450, shapes: shapes(), density: 1, seed: 3, ...over });
const drop = (x, y) => ({ x, y, vy: 600, len: 10, drift: 1, land: 400, alpha: 1 });

test('drops fall to the ground, leave ripples, and none is left below the ground', () => {
    const rain = make();
    rain.warm(3);
    assert.ok(rain.drops.length > 20, 'a shower is in the air');
    assert.ok(rain.ripples.length > 0, 'drops that landed left ripples');
    for (const d of rain.drops) {
        assert.ok(d.y < 400 + 40, `a drop is below the ground: ${d.y}`);
        assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
    }
});

test('a drop that reaches the umbrella is gone, splashes, and runs to the nearest point of the rim', () => {
    const rain = make({ density: 0 });
    rain.drops.push(drop(190, 90));
    rain.step(0.05);
    assert.equal(rain.drops.length, 0);
    assert.ok(rain.splashes.length > 0);
    assert.deepEqual(rain.tips.map(t => t.water), [0, 1]);
});

test('water gathers on the rim and drips off, and the drip leaves a ripple on the ground', () => {
    const rain = make({ density: 0 });
    let dripped = false;
    for (let i = 0; i < 40 && !dripped; i++) {
        rain.drops.push(drop(105, 90));
        rain.step(0.05);
        dripped = rain.drips.length > 0;
    }
    assert.ok(dripped, 'a drip formed');
    assert.ok(rain.drips[0].x === 100 && rain.drips[0].y >= 150, 'it starts at the rim');
    for (let i = 0; i < 120 && rain.drips.length; i++) rain.step(1 / 60);
    assert.equal(rain.drips.length, 0, 'it fell');
    assert.ok(rain.ripples.length > 0);
});

test('a drop that hits the man is gone and splashes less', () => {
    const rain = make({ density: 0, shapes: shapes({ hit: (x, y) => (x > 50 && x < 80 && y > 200 && y < 260 ? 'body' : null) }) });
    rain.drops.push(drop(60, 190));
    rain.step(0.05);
    assert.equal(rain.drops.length, 0);
    assert.equal(rain.splashes.length, 2);
});

test('wind pushes the rain sideways', () => {
    const calm = make();
    const gale = make();
    calm.warm(1, 0);
    gale.warm(1, 300);
    const mean = (rain) => rain.drops.reduce((s, d) => s + d.x, 0) / rain.drops.length;
    assert.ok(mean(gale) > mean(calm) + 50, `${mean(gale)} vs ${mean(calm)}`);
});

test('the same seed gives the same shower', () => {
    const a = make();
    const b = make();
    a.warm(2);
    b.warm(2);
    assert.deepEqual(a.drops.map(d => [d.x, d.y]), b.drops.map(d => [d.x, d.y]));
});

test('the lists that are drawn stay bounded however long it rains', () => {
    const rain = make({ density: 4 });
    rain.warm(15);
    assert.ok(rain.ripples.length <= 220);
    assert.ok(rain.splashes.length <= 220);
});

test('resizing keeps the drops in flight and lands them on the new ground', () => {
    const rain = make();
    rain.warm(1);
    const before = rain.drops.length;
    rain.resize(300, 300, shapes({ ground: 250 }), 0.7);
    assert.equal(rain.drops.length, before);
    assert.ok(rain.drops.every(d => d.land < 300));
});

test('wind leans steadily, with gusts that blow hard now and then', () => {
    const wind = createWind(5);
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 90; t += 1 / 60) {
        const w = wind.step(1 / 60);
        assert.ok(Number.isFinite(w));
        min = Math.min(min, w);
        max = Math.max(max, w);
    }
    assert.ok(min < -150 || max > 150, 'at least one gust');
    assert.ok(min > -600 && max < 600);
});
