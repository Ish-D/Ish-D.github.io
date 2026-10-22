import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeData, parseTransform, paintSvg } from '../../core/runtime/snapshot.js';

const el = (tagName, attrs = {}, ...children) => ({
    tagName, children, textContent: attrs.text ?? '',
    getAttribute: (name) => (name in attrs ? String(attrs[name]) : null),
});

/** A 2D context that writes down what it is asked to do. */
function recorder() {
    const log = [];
    const state = { globalAlpha: 1 };
    const stack = [];
    const g = new Proxy({}, {
        get: (_, name) => {
            if (name === 'save') return () => stack.push({ ...state });
            if (name === 'restore') return () => Object.assign(state, stack.pop());
            if (name in state) return state[name];
            return (...args) => { log.push([name, ...args]); };
        },
        set: (_, name, value) => { state[name] = value; log.push(['set', name, value]); return true; },
    });
    return { g, log };
}

const documentFor = (g) => ({ createElement: () => ({ width: 0, height: 0, getContext: () => g }) });

test('shapes become path data, and a shape with no size has none', () => {
    assert.equal(shapeData(el('path', { d: 'M0 0L5 5' })), 'M0 0L5 5');
    assert.equal(shapeData(el('rect', { x: 1, y: 2, width: 10, height: 4 })), 'M1 2H11V6H1Z');
    assert.match(shapeData(el('rect', { x: 0, y: 0, width: 10, height: 10, rx: 2 })), /^M2 0H8A2 2 0 0 1 10 2V8A2 2 0 0 1 8 10H2A2 2 0 0 1 0 8V2A2 2 0 0 1 2 0Z$/);
    assert.equal(shapeData(el('rect', { x: 0, y: 0, width: 10, height: 10, rx: 99 })).includes('A5 5'), true, 'a corner is no more than half a side');
    assert.equal(shapeData(el('circle', { cx: 5, cy: 5, r: 2 })), 'M3 5A2 2 0 1 0 7 5A2 2 0 1 0 3 5Z');
    assert.equal(shapeData(el('ellipse', { cx: 0, cy: 0, rx: 3, ry: 1 })), 'M-3 0A3 1 0 1 0 3 0A3 1 0 1 0 -3 0Z');
    assert.equal(shapeData(el('line', { x1: 0, y1: 1, x2: 2, y2: 3 })), 'M0 1L2 3');
    assert.equal(shapeData(el('polygon', { points: '0,0 4,0 4,4' })), 'M0 0L4 0L4 4Z');
    assert.equal(shapeData(el('polyline', { points: '0 0 4 0 4 4' })), 'M0 0L4 0L4 4');
    assert.equal(shapeData(el('circle', { cx: 5, cy: 5, r: 0 })), null);
    assert.equal(shapeData(el('rect', { width: 10, height: 0 })), null);
    assert.equal(shapeData(el('text', {})), null);
});

test('transforms are read in order, as a browser reads them', () => {
    assert.equal(parseTransform(null), null);
    assert.deepEqual(parseTransform('translate(10 20)'), [1, 0, 0, 1, 10, 20]);
    assert.deepEqual(parseTransform('translate(10, 20) scale(2)'), [2, 0, 0, 2, 10, 20]);
    assert.deepEqual(parseTransform('scale(2) translate(10 20)'), [2, 0, 0, 2, 20, 40]);
    assert.deepEqual(parseTransform('matrix(1 2 3 4 5 6)'), [1, 2, 3, 4, 5, 6]);
    // a turn of 90 degrees about (10, 0) takes the point (10, 5) to (5, 0)
    const [a, b, c, d, e, f] = parseTransform('rotate(90 10 0)');
    const point = [a * 10 + c * 5 + e, b * 10 + d * 5 + f];
    assert.ok(Math.abs(point[0] - 5) < 1e-9 && Math.abs(point[1] - 0) < 1e-9, `got ${point}`);
});

test('a drawing is painted in the order it is written, with the colors and widths it is given', () => {
    const { g, log } = recorder();
    const paper = el('path', { d: 'M0 0L4 0L4 4Z' });
    const ink = el('rect', { x: 0, y: 0, width: 2, height: 2 });
    const group = el('g', { transform: 'translate(10 20)' }, paper, ink);
    const svg = el('svg', { viewBox: '5 6 100 50' }, group);
    const styles = new Map([
        [group, { display: 'inline' }],
        [paper, { fill: 'rgb(255, 255, 255)', stroke: 'rgb(17, 17, 17)', strokeWidth: '1.5px', strokeLinecap: 'round', strokeLinejoin: 'round', fillOpacity: '1', strokeOpacity: '1', strokeDasharray: 'none' }],
        [ink, { fill: 'rgb(17, 17, 17)', stroke: 'none', strokeWidth: '1px' }],
    ]);
    const canvas = paintSvg(svg, { document: documentFor(g), style: (e) => styles.get(e), makePath: (d) => ({ d }) });
    assert.ok(canvas);
    assert.deepEqual([canvas.width, canvas.height], [300, 150], 'three pixels for each unit');

    const names = log.map(c => c[0]);
    assert.deepEqual(log[0], ['scale', 3, 3]);
    assert.deepEqual(log[1], ['translate', -5, -6]);
    assert.deepEqual(log.find(c => c[0] === 'transform'), ['transform', 1, 0, 0, 1, 10, 20]);
    const fills = log.filter(c => c[0] === 'fill');
    assert.deepEqual(fills.map(c => c[1].d), ['M0 0L4 0L4 4Z', 'M0 0H2V2H0Z']);
    assert.equal(log.filter(c => c[0] === 'stroke').length, 1, 'the rect has no stroke');
    assert.ok(names.indexOf('fill') < names.indexOf('stroke'), 'fill, then stroke');
    assert.ok(log.some(c => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === 'rgb(255, 255, 255)'));
    assert.ok(log.some(c => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === 'rgb(17, 17, 17)'));
    assert.ok(log.some(c => c[0] === 'set' && c[1] === 'lineWidth' && c[2] === 1.5));
    assert.ok(log.some(c => c[0] === 'set' && c[1] === 'lineCap' && c[2] === 'round'));
});

test('stroke first when the drawing asks for it, and nothing is painted for hidden or unpainted parts', () => {
    const { g, log } = recorder();
    const mark = el('path', { d: 'M0 0L1 1' });
    const hidden = el('path', { d: 'M0 0L9 9' });
    const gone = el('g', {}, el('path', { d: 'M0 0L8 8' }));
    const svg = el('svg', { viewBox: '0 0 10 10' }, mark, hidden, gone);
    const solid = { fill: 'rgb(0, 0, 0)', stroke: 'rgb(255, 255, 255)', strokeWidth: '2px', paintOrder: 'stroke fill' };
    const styles = new Map([[mark, solid], [hidden, { ...solid, visibility: 'hidden' }], [gone, { display: 'none' }]]);
    const canvas = paintSvg(svg, { document: documentFor(g), style: (e) => styles.get(e) ?? solid, makePath: (d) => ({ d }) });
    assert.ok(canvas);
    const painted = log.filter(c => c[0] === 'fill' || c[0] === 'stroke');
    assert.deepEqual(painted.map(c => c[0]), ['stroke', 'fill']);
    assert.ok(painted.every(c => c[1].d === 'M0 0L1 1'));
});

test('a drawing with a gradient, a clip or a filter is not painted, so the caller keeps it as it is', () => {
    const { g } = recorder();
    const plain = { fill: 'rgb(0, 0, 0)', stroke: 'none' };
    for (const part of [el('clipPath', {}), el('filter', {}), el('use', {}), el('linearGradient', {})]) {
        const svg = el('svg', { viewBox: '0 0 10 10' }, el('path', { d: 'M0 0L1 1' }), part);
        assert.equal(paintSvg(svg, { document: documentFor(g), style: () => plain, makePath: (d) => ({ d }) }), null, part.tagName);
    }
    const gradient = el('svg', { viewBox: '0 0 10 10' }, el('path', { d: 'M0 0L1 1' }));
    assert.equal(paintSvg(gradient, { document: documentFor(g), style: () => ({ fill: 'url("#a")', stroke: 'none' }), makePath: (d) => ({ d }) }), null);
});

test('text is painted where it is anchored, in the font it is given', () => {
    const { g, log } = recorder();
    const label = el('text', { x: 20, y: 8, text: 'd_k = 8' });
    const svg = el('svg', { viewBox: '0 0 40 10' }, label);
    const style = { fill: 'rgb(0, 0, 0)', fontStyle: 'normal', fontWeight: '400', fontSize: '13px', fontFamily: 'Georgia', textAnchor: 'end' };
    assert.ok(paintSvg(svg, { document: documentFor(g), style: () => style, makePath: (d) => ({ d }) }));
    assert.deepEqual(log.find(c => c[0] === 'fillText'), ['fillText', 'd_k = 8', 20, 8]);
    assert.ok(log.some(c => c[0] === 'set' && c[1] === 'textAlign' && c[2] === 'right'));
    assert.ok(log.some(c => c[0] === 'set' && c[1] === 'font' && c[2] === 'normal 400 13px Georgia'));
});
