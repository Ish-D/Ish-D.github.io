/**
 * Companion script for llms_for_bozos_1.md
 *
 * Two visualizations:
 * 1. neuron-approx  — adaptive triangulation, slider = # of neurons
 * 2. gradient-descent — fixed grid, slider = # of GD iterations
 */
import {
    loadThreeJS,
    rendererPool,
    animationManager,
    themeColors
} from '../Visualizations3D.js';

const RANGE = 3;
const TRUE_RES = 80;
const MAX_NEURONS = 200;
const MAX_ITERS = 50;
const GD_RES = 10;       // grid resolution for gradient descent mesh
const GD_LR = 0.2;       // learning rate
const DEFAULT_FN = 'sin(x)*cos(y) + 0.3*x*y';

// ---- Shared utilities ----

function toLatex(expr) {
    let s = expr;
    s = s.replace(/\^/g, '**');
    s = s.replace(/\*\*(\d+)/g, '^{$1}');
    s = s.replace(/\*\*(\([^)]+\))/g, '^{$1}');
    s = s.replace(/(?<!\*)\*(?!\*)/g, ' \\cdot ');
    s = s.replace(/\bsin\b/g, '\\sin');
    s = s.replace(/\bcos\b/g, '\\cos');
    s = s.replace(/\btan\b/g, '\\tan');
    s = s.replace(/\bsqrt\(/g, '\\sqrt{');
    let out = '', depth = 0, inSqrt = false;
    for (let i = 0; i < s.length; i++) {
        if (s.substring(i, i + 6) === '\\sqrt{') {
            out += '\\sqrt{'; i += 5; inSqrt = true; depth = 1;
        } else if (inSqrt) {
            if (s[i] === '(') { depth++; out += s[i]; }
            else if (s[i] === ')') { depth--; if (depth === 0) { out += '}'; inSqrt = false; } else out += s[i]; }
            else out += s[i];
        } else out += s[i];
    }
    return out;
}

function compile(expr) {
    const js = expr.replace(/\^/g, '**');
    try {
        const fn = new Function('x', 'y', `with(Math) { return ${js}; }`);
        const test = fn(0, 0);
        if (!isFinite(test)) return null;
        return (x, y) => {
            try { const v = fn(x, y); return isFinite(v) ? v : 0; }
            catch { return 0; }
        };
    } catch { return null; }
}

function makeSurface(resolution, fn) {
    const geo = new THREE.PlaneGeometry(RANGE * 2, RANGE * 2, resolution, resolution);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        pos.setZ(i, fn(pos.getX(i), pos.getY(i)));
    }
    pos.needsUpdate = true;
    return geo;
}

/** Seeded PRNG (LCG) for deterministic random init */
function seededRandom(seed) {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

// ---- Shared 3D scene builder ----

function createScene(vizEl) {
    const rect = vizEl.getBoundingClientRect();
    const width = rect.width || 400;
    const height = parseInt(vizEl.dataset.vizHeight) || 300;

    const scene = new THREE.Scene();
    scene.background = themeColors.three.background;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(6, 4.5, 6);

    const renderer = rendererPool.getRenderer(vizEl, width, height);
    renderer.setSize(width, height);
    const canvas = renderer.domElement;
    canvas.className = 'viz-3d-canvas';
    vizEl.appendChild(canvas);

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.update();

    const ambient = new THREE.AmbientLight(
        themeColors.three.ambient, themeColors.isDark() ? 0.8 : 0.5
    );
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    const trueMat = new THREE.MeshBasicMaterial({
        wireframe: true,
        color: new THREE.Color(themeColors.text),
        transparent: true, opacity: 0.18,
        depthWrite: false, depthTest: false,
    });

    const grid = new THREE.GridHelper(
        RANGE * 2, 8, themeColors.three.grid, themeColors.three.grid
    );
    grid.position.y = -3;
    scene.add(grid);

    // Resize observer
    new ResizeObserver(() => {
        const r = canvas.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            camera.aspect = r.width / r.height;
            camera.updateProjectionMatrix();
            renderer.setSize(r.width, r.height);
        }
    }).observe(canvas);

    return { scene, camera, renderer, canvas, controls, ambient, trueMat, grid };
}

function addWireframe(scene, trueMat, fn) {
    const geo = makeSurface(TRUE_RES, fn);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, trueMat);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    return mesh;
}

function makeSurfaceColor() {
    return themeColors.isDark()
        ? new THREE.Color(0.55, 0.55, 0.58)
        : new THREE.Color(0.35, 0.35, 0.38);
}

/** Build controls div with KaTeX display, editable input, and a slider */
function buildControls(vizEl, sliderLabel, sliderMin, sliderMax, sliderDefault, defaultExpr) {
    const ctrlDiv = document.createElement('div');
    ctrlDiv.className = 'viz-3d-controls';
    ctrlDiv.innerHTML = `
        <div class="viz-controls">
            <div class="viz-fn-row">
                <span class="viz-fn-display"></span>
                <input type="text" class="viz-fn-input" spellcheck="false" autocomplete="off"
                       value="${defaultExpr}">
            </div>
            <div class="viz-slider-row">
                <span class="viz-slider-label">${sliderLabel}</span>
                <input type="range" class="viz-slider" min="${sliderMin}" max="${sliderMax}" step="1" value="${sliderDefault}">
                <span class="viz-slider-value">${sliderDefault}</span>
            </div>
        </div>
    `;
    vizEl.appendChild(ctrlDiv);
    return ctrlDiv;
}

function bindFnInput(ctrlDiv, currentExpr, onFnChange) {
    const fnDisplay = ctrlDiv.querySelector('.viz-fn-display');
    const fnInput = ctrlDiv.querySelector('.viz-fn-input');
    let expr = currentExpr;

    function renderDisplay() {
        try {
            katex.render('z = ' + toLatex(expr), fnDisplay, {
                throwOnError: false, displayMode: false,
            });
        } catch { fnDisplay.textContent = 'z = ' + expr; }
    }
    renderDisplay();

    fnDisplay.addEventListener('click', () => {
        fnDisplay.style.display = 'none';
        fnInput.style.display = 'block';
        fnInput.value = expr;
        fnInput.focus();
    });

    fnInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') fnInput.blur();
        if (e.key === 'Escape') { fnInput.value = expr; fnInput.blur(); }
    });

    fnInput.addEventListener('blur', () => {
        const newFn = compile(fnInput.value);
        if (newFn) {
            expr = fnInput.value;
            onFnChange(expr, newFn);
        }
        fnInput.style.display = 'none';
        fnDisplay.style.display = '';
        renderDisplay();
    });

    return { getExpr: () => expr };
}

// ---- Neuron approximation (adaptive triangulation) ----

function triError(tri, verts, fn) {
    const [a, b, c] = tri;
    const [ax, ay] = verts[a], [bx, by] = verts[b], [cx, cy] = verts[c];
    const za = fn(ax, ay), zb = fn(bx, by), zc = fn(cx, cy);
    let maxErr = 0;
    const samples = [[1/3,1/3], [0.5,0.25], [0.25,0.5], [0.1,0.1], [0.6,0.2], [0.2,0.6]];
    for (const [u, v] of samples) {
        const w = 1 - u - v;
        if (w < 0) continue;
        const actual = fn(u*ax + v*bx + w*cx, u*ay + v*by + w*cy);
        const interp = u*za + v*zb + w*zc;
        maxErr = Math.max(maxErr, Math.abs(actual - interp));
    }
    const area = Math.abs((bx-ax)*(cy-ay) - (cx-ax)*(by-ay)) / 2;
    return maxErr * area;
}

function precomputeSteps(fn) {
    const R = RANGE;
    const verts = [[-R,-R], [R,-R], [R,R], [-R,R]];
    const tris = [[0,1,2], [0,2,3]];
    const steps = [];
    steps.push([[0,1,2]]);
    steps.push(tris.map(t => [...t]));
    for (let n = 3; n <= MAX_NEURONS; n++) {
        let worstIdx = 0, worstErr = -1;
        for (let i = 0; i < tris.length; i++) {
            const e = triError(tris[i], verts, fn);
            if (e > worstErr) { worstErr = e; worstIdx = i; }
        }
        const [a, b, c] = tris[worstIdx];
        const edges = [[a,b,c], [b,c,a], [c,a,b]];
        let best = 0, bestLen = 0;
        for (let i = 0; i < 3; i++) {
            const [p, q] = edges[i];
            const dx = verts[p][0] - verts[q][0], dy = verts[p][1] - verts[q][1];
            if (dx*dx + dy*dy > bestLen) { bestLen = dx*dx + dy*dy; best = i; }
        }
        const [p, q, r] = edges[best];
        const midIdx = verts.length;
        verts.push([(verts[p][0]+verts[q][0])/2, (verts[p][1]+verts[q][1])/2]);
        tris[worstIdx] = [p, midIdx, r];
        tris.push([midIdx, q, r]);
        steps.push(tris.map(t => [...t]));
    }
    return { verts, steps };
}

function buildGeo(step, verts, fn) {
    const positions = [];
    for (const [a, b, c] of step) {
        for (const idx of [a, b, c]) {
            const [x, y] = verts[idx];
            positions.push(x, y, fn(x, y));
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
}

function initNeuronApprox(vizEl) {
    let evalFn = compile(DEFAULT_FN);
    let precomputed = precomputeSteps(evalFn);

    const ctx = createScene(vizEl);
    let trueMesh = addWireframe(ctx.scene, ctx.trueMat, evalFn);
    let approxMesh = null;
    let currentN = 1;

    function setNeurons(n) {
        currentN = n;
        if (approxMesh) {
            ctx.scene.remove(approxMesh);
            approxMesh.geometry.dispose();
            approxMesh.material.dispose();
        }
        const step = precomputed.steps[Math.min(n, precomputed.steps.length) - 1];
        const geo = buildGeo(step, precomputed.verts, evalFn);
        approxMesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
            color: makeSurfaceColor(),
            side: THREE.DoubleSide, flatShading: true,
            shininess: 40, transparent: true, opacity: 0.9,
        }));
        approxMesh.rotation.x = -Math.PI / 2;
        ctx.scene.add(approxMesh);
    }
    setNeurons(1);

    const vizId = `neuron-approx-${Date.now()}`;
    animationManager.register(vizId, () => {
        ctx.controls.update();
        ctx.renderer.render(ctx.scene, ctx.camera);
    }, vizEl);

    const ctrlDiv = buildControls(vizEl, '# of neurons', 1, MAX_NEURONS, 1, DEFAULT_FN);

    bindFnInput(ctrlDiv, DEFAULT_FN, (expr, newFn) => {
        evalFn = newFn;
        precomputed = precomputeSteps(evalFn);
        ctx.scene.remove(trueMesh); trueMesh.geometry.dispose();
        trueMesh = addWireframe(ctx.scene, ctx.trueMat, evalFn);
        setNeurons(currentN);
    });

    const slider = ctrlDiv.querySelector('.viz-slider');
    const valSpan = ctrlDiv.querySelector('.viz-slider-value');
    slider.addEventListener('input', () => {
        const n = parseInt(slider.value);
        valSpan.textContent = n;
        setNeurons(n);
    });

    themeColors.addListener(() => {
        themeColors.updateColors();
        ctx.scene.background = themeColors.three.background;
        ctx.trueMat.color.set(themeColors.text);
        ctx.ambient.color = themeColors.three.ambient;
        ctx.ambient.intensity = themeColors.isDark() ? 0.8 : 0.5;
        if (approxMesh) approxMesh.material.color.set(themeColors.isDark() ? 0x8c8c94 : 0x595961);
    });
}

// ---- Gradient descent ----

/**
 * Precompute stochastic gradient descent snapshots.
 * Each iteration updates a random subset of vertices (mini-batch),
 * adding noise to the gradient for stochasticity.
 */
function precomputeGD(fn, seed) {
    const rng = seededRandom(seed);
    const res = GD_RES;
    const count = (res + 1) * (res + 1);
    const batchSize = Math.max(4, Math.floor(count * 0.3)); // ~30% of vertices per step

    // Build grid positions and target z-values
    const xs = new Float32Array(count);
    const ys = new Float32Array(count);
    const target = new Float32Array(count);
    for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
            const idx = j * (res + 1) + i;
            xs[idx] = -RANGE + (i / res) * RANGE * 2;
            ys[idx] = RANGE - (j / res) * RANGE * 2;
            target[idx] = fn(xs[idx], ys[idx]);
        }
    }

    // Random init
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < count; i++) {
        if (target[i] < zMin) zMin = target[i];
        if (target[i] > zMax) zMax = target[i];
    }
    const spread = Math.max(zMax - zMin, 1) * 1.5;
    const mid = (zMax + zMin) / 2;

    const z = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        z[i] = (rng() - 0.5) * 0.3;
    }

    const snapshots = [new Float32Array(z)];

    // SGD iterations — random mini-batch + gradient noise
    for (let iter = 0; iter < MAX_ITERS; iter++) {
        // Fisher-Yates shuffle to pick a random batch
        const indices = Array.from({ length: count }, (_, i) => i);
        for (let i = count - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        // Update only the mini-batch
        for (let b = 0; b < batchSize; b++) {
            const i = indices[b];
            const noise = (rng() - 0.5) * 0.15; // gradient noise
            z[i] -= GD_LR * ((z[i] - target[i]) + noise);
        }
        snapshots.push(new Float32Array(z));
    }

    return { snapshots, xs, ys };
}

/** Build a PlaneGeometry with z-values from a GD snapshot */
function buildGDGeo(snapshot, res) {
    const geo = new THREE.PlaneGeometry(RANGE * 2, RANGE * 2, res, res);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        pos.setZ(i, snapshot[i]);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

function initGradientDescent(vizEl) {
    let evalFn = compile(DEFAULT_FN);
    let gdSeed = 42;
    let gdData = precomputeGD(evalFn, gdSeed);

    const ctx = createScene(vizEl);
    let trueMesh = addWireframe(ctx.scene, ctx.trueMat, evalFn);
    let approxMesh = null;
    let currentIter = 0;

    function setIteration(iter) {
        currentIter = iter;
        if (approxMesh) {
            ctx.scene.remove(approxMesh);
            approxMesh.geometry.dispose();
            approxMesh.material.dispose();
        }
        const snap = gdData.snapshots[Math.min(iter, gdData.snapshots.length - 1)];
        const geo = buildGDGeo(snap, GD_RES);
        approxMesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
            color: makeSurfaceColor(),
            side: THREE.DoubleSide, flatShading: true,
            shininess: 40, transparent: true, opacity: 0.9,
        }));
        approxMesh.rotation.x = -Math.PI / 2;
        ctx.scene.add(approxMesh);
    }
    setIteration(0);

    const vizId = `gradient-descent-${Date.now()}`;
    animationManager.register(vizId, () => {
        ctx.controls.update();
        ctx.renderer.render(ctx.scene, ctx.camera);
    }, vizEl);

    const ctrlDiv = buildControls(vizEl, '# of iterations', 0, MAX_ITERS, 0, DEFAULT_FN);

    // Add reset button inline with the slider
    const sliderRow = ctrlDiv.querySelector('.viz-slider-row');
    const resetBtn = document.createElement('button');
    resetBtn.className = 'viz-reset-btn';
    resetBtn.textContent = 'reset';
    sliderRow.appendChild(resetBtn);

    const slider = ctrlDiv.querySelector('.viz-slider');
    const valSpan = ctrlDiv.querySelector('.viz-slider-value');

    function reset() {
        gdSeed = Date.now();
        gdData = precomputeGD(evalFn, gdSeed);
        slider.value = 0;
        valSpan.textContent = 0;
        setIteration(0);
    }

    resetBtn.addEventListener('click', reset);

    bindFnInput(ctrlDiv, DEFAULT_FN, (expr, newFn) => {
        evalFn = newFn;
        gdData = precomputeGD(evalFn, gdSeed);
        ctx.scene.remove(trueMesh); trueMesh.geometry.dispose();
        trueMesh = addWireframe(ctx.scene, ctx.trueMat, evalFn);
        setIteration(currentIter);
    });

    slider.addEventListener('input', () => {
        const n = parseInt(slider.value);
        valSpan.textContent = n;
        setIteration(n);
    });

    themeColors.addListener(() => {
        themeColors.updateColors();
        ctx.scene.background = themeColors.three.background;
        ctx.trueMat.color.set(themeColors.text);
        ctx.ambient.color = themeColors.three.ambient;
        ctx.ambient.intensity = themeColors.isDark() ? 0.8 : 0.5;
        if (approxMesh) approxMesh.material.color.set(themeColors.isDark() ? 0x8c8c94 : 0x595961);
    });
}

// ---- Entry point ----

export async function init(container) {
    const neuronViz = container.querySelector('.viz-container[data-viz-type="neuron-approx"]');
    const gdViz = container.querySelector('.viz-container[data-viz-type="gradient-descent"]');

    if (!neuronViz && !gdViz) return;

    await loadThreeJS();
    themeColors.updateColors();

    if (neuronViz) {
        neuronViz.innerHTML = '';
        initNeuronApprox(neuronViz);
    }
    if (gdViz) {
        gdViz.innerHTML = '';
        initGradientDescent(gdViz);
    }
}
