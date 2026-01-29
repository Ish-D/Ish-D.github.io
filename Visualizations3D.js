/**
 * Visualizations3D.js - 3D Visualization Infrastructure
 *
 * Provides Three.js-based 3D visualizations including:
 * - Surface plots (z = f(x,y))
 * - Parametric 3D curves
 * - GLTF/GLB model loading
 * - 3D node graphs
 *
 * Features:
 * - Lazy loading of Three.js from CDN
 * - WebGL context pooling (handles browser limits)
 * - Shared animation loop for efficiency
 * - Theme integration (light/dark mode)
 * - Automatic cleanup on card deletion
 *
 * Usage in markdown:
 *   [[viz(type: surface, fn: "sin(x)*cos(y)")]]
 *   [[viz(type: curve3d, x: "cos(t)", y: "sin(t)", z: "t/3")]]
 *   [[viz(type: model, src: "/models/thing.glb")]]
 */

// ============================================
// THREE.JS LOADER
// ============================================

let threeLoaded = false;
let threeLoadPromise = null;

/**
 * Dynamically load Three.js and extensions from CDN
 * Returns a promise that resolves when all modules are ready
 * Uses esm.sh which automatically handles module resolution
 */
export function loadThreeJS() {
    if (threeLoaded) return Promise.resolve();
    if (threeLoadPromise) return threeLoadPromise;

    threeLoadPromise = (async () => {
        // Check if already loaded globally
        if (window.THREE) {
            threeLoaded = true;
            return;
        }

        try {
            // Use esm.sh which automatically bundles dependencies
            // This resolves the "Failed to resolve module specifier 'three'" error
            const [THREE_MODULE, OrbitControlsModule, GLTFLoaderModule] = await Promise.all([
                import('https://esm.sh/three@0.160.0'),
                import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
                import('https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js')
            ]);

            // Create a mutable copy of THREE exports (ES module namespace is frozen)
            // This allows us to add OrbitControls and GLTFLoader as properties
            window.THREE = { ...THREE_MODULE };

            // Attach extensions to THREE namespace for convenience
            window.THREE.OrbitControls = OrbitControlsModule.OrbitControls;
            window.THREE.GLTFLoader = GLTFLoaderModule.GLTFLoader;

            threeLoaded = true;
        } catch (err) {
            console.error('Failed to load Three.js:', err);
            throw err;
        }
    })();

    return threeLoadPromise;
}

// ============================================
// WEBGL CONTEXT POOL
// ============================================

/**
 * RendererPool - Manages a limited pool of WebGL renderers
 * Browsers limit WebGL contexts to ~8-16, so we need pooling
 */
class RendererPool {
    constructor(options = {}) {
        this.maxContexts = options.maxContexts || 12;  // Increased for pages with many visualizations
        this.renderers = new Map();  // container -> renderer
        this.lastUsed = new Map();   // container -> timestamp
    }

    /**
     * Get or create a renderer for a container
     */
    getRenderer(container, width, height) {
        // Ensure minimum dimensions for WebGL
        const safeWidth = Math.max(width, 1);
        const safeHeight = Math.max(height, 1);

        // Evict LRU if at capacity
        if (this.renderers.size >= this.maxContexts && !this.renderers.has(container)) {
            this.evictLRU();
        }

        if (!this.renderers.has(container)) {
            const renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                powerPreference: 'high-performance'
            });
            renderer.setSize(safeWidth, safeHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderers.set(container, renderer);
        }

        this.lastUsed.set(container, Date.now());
        return this.renderers.get(container);
    }

    /**
     * Release a renderer when visualization is destroyed
     */
    release(container) {
        const renderer = this.renderers.get(container);
        if (renderer) {
            renderer.dispose();
            renderer.forceContextLoss();
            this.renderers.delete(container);
            this.lastUsed.delete(container);
        }
    }

    /**
     * Evict least recently used renderer
     */
    evictLRU() {
        if (this.renderers.size === 0) return;

        let oldest = Infinity;
        let oldestContainer = null;

        this.lastUsed.forEach((time, container) => {
            if (time < oldest) {
                oldest = time;
                oldestContainer = container;
            }
        });

        if (oldestContainer) {
            this.release(oldestContainer);
        }
    }
}

export const rendererPool = new RendererPool();

// ============================================
// ANIMATION LOOP MANAGER
// ============================================

/**
 * AnimationManager - Coordinates animation loops across all 3D visualizations
 * Uses a single requestAnimationFrame loop for efficiency
 */
class AnimationManager {
    constructor() {
        this.animations = new Map();  // id -> { render, container, active }
        this.running = false;
        this.frameId = null;
        this.lastTime = 0;
    }

    /**
     * Register a visualization for animation
     */
    register(id, renderFn, container) {
        this.animations.set(id, {
            render: renderFn,
            container: container,
            active: true
        });

        if (!this.running) {
            this.start();
        }
    }

    /**
     * Unregister a visualization
     */
    unregister(id) {
        this.animations.delete(id);

        if (this.animations.size === 0) {
            this.stop();
        }
    }

    /**
     * Pause a specific animation
     */
    pause(id) {
        const anim = this.animations.get(id);
        if (anim) anim.active = false;
    }

    /**
     * Resume a specific animation
     */
    resume(id) {
        const anim = this.animations.get(id);
        if (anim) anim.active = true;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.loop();
    }

    stop() {
        this.running = false;
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
    }

    loop() {
        if (!this.running) return;

        const now = performance.now();
        const delta = (now - this.lastTime) / 1000;  // seconds
        this.lastTime = now;

        this.animations.forEach((anim, id) => {
            if (anim.active && this.isVisible(anim.container)) {
                try {
                    anim.render(delta);
                } catch (e) {
                    console.error(`Animation error for ${id}:`, e);
                }
            }
        });

        this.frameId = requestAnimationFrame(() => this.loop());
    }

    /**
     * Check if container is visible in viewport
     */
    isVisible(container) {
        if (!container) return true;
        const rect = container.getBoundingClientRect();
        return rect.bottom >= 0 &&
               rect.top <= window.innerHeight &&
               rect.right >= 0 &&
               rect.left <= window.innerWidth;
    }
}

export const animationManager = new AnimationManager();

// ============================================
// THEME INTEGRATION
// ============================================

/**
 * ThemeColors - Provides theme-aware colors for 3D visualizations
 */
export class ThemeColors {
    constructor() {
        this.three = {};
        this.updateColors();

        // Watch for theme changes
        this.observer = new MutationObserver(() => {
            this.updateColors();
            this.notifyListeners();
        });
        this.observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });

        this.listeners = new Set();
    }

    updateColors() {
        const styles = getComputedStyle(document.documentElement);

        this.background = styles.getPropertyValue('--color-card-background').trim() || '#ffffff';
        this.text = styles.getPropertyValue('--color-text-primary').trim() || '#1a1a1a';
        this.grid = styles.getPropertyValue('--color-border').trim() || '#e0e0e0';
        this.accent = styles.getPropertyValue('--color-link').trim() || '#0066cc';

        // Only create Three.js colors if THREE is loaded
        if (window.THREE) {
            this.three = {
                background: new THREE.Color(this.background),
                text: new THREE.Color(this.text),
                grid: new THREE.Color(this.grid),
                accent: new THREE.Color(this.accent),
                ambient: new THREE.Color(this.isDark() ? 0x404040 : 0x606060),
                directional: new THREE.Color(0xffffff)
            };
        }
    }

    isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    /**
     * Get surface colormap palette based on theme
     */
    getSurfacePalette() {
        if (this.isDark()) {
            return {
                low: new THREE.Color(0x1a3a5c),    // Deep blue
                mid: new THREE.Color(0x2a5a4a),    // Teal
                high: new THREE.Color(0x6a3a3a)    // Warm red
            };
        } else {
            return {
                low: new THREE.Color(0x2166ac),    // Blue
                mid: new THREE.Color(0x67a9cf),    // Light blue
                high: new THREE.Color(0xb2182b)    // Red
            };
        }
    }

    /**
     * Register a listener for theme changes
     */
    addListener(callback) {
        this.listeners.add(callback);
    }

    removeListener(callback) {
        this.listeners.delete(callback);
    }

    notifyListeners() {
        this.listeners.forEach(cb => {
            try {
                cb();
            } catch (e) {
                console.error('Theme listener error:', e);
            }
        });
    }
}

export const themeColors = new ThemeColors();

// ============================================
// BASE 3D VISUALIZATION
// ============================================

/**
 * Base3DViz - Abstract base class for 3D visualizations
 */
export class Base3DViz {
    constructor(container, params, context) {
        this.container = container;
        this.params = params;
        this.context = context;
        this.id = params.id || `viz3d-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Store state on container for cleanup access
        container._viz3dState = this;

        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.controls = null;
        this.renderer = null;
        this.canvas = null;

        // Dimensions
        this.width = 0;
        this.height = 0;

        // Animation state
        this.isAnimating = false;

        // Theme listener bound method
        this.boundOnThemeChange = () => this.onThemeChange();
    }

    async init() {
        // Ensure Three.js is loaded
        await loadThreeJS();

        // Update theme colors now that THREE is available
        themeColors.updateColors();

        // Get dimensions - use data attributes or computed styles as fallback for inline elements
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;

        // If dimensions are 0 (common for inline elements not yet laid out),
        // try to get dimensions from size preset or explicit data attributes
        if (!this.width || !this.height) {
            const sizePresets = {
                tiny: { width: 80, height: 60 },
                small: { width: 150, height: 120 },
                medium: { width: 250, height: 200 },
                large: { width: 350, height: 280 },
                full: { width: 400, height: 300 }
            };

            const sizePreset = this.container.dataset.vizSize;
            const explicitWidth = parseInt(this.container.dataset.vizWidth);
            const explicitHeight = parseInt(this.container.dataset.vizHeight);

            if (explicitWidth && !isNaN(explicitWidth)) {
                this.width = explicitWidth;
            } else if (sizePreset && sizePresets[sizePreset]) {
                this.width = sizePresets[sizePreset].width;
            } else {
                this.width = 400;
            }

            if (explicitHeight && !isNaN(explicitHeight)) {
                this.height = explicitHeight;
            } else if (sizePreset && sizePresets[sizePreset]) {
                this.height = sizePresets[sizePreset].height;
            } else {
                this.height = 300;
            }
        }

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = themeColors.three.background;

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            this.width / this.height,
            0.1,
            1000
        );
        this.camera.position.set(3, 3, 5);

        // Get renderer from pool
        this.renderer = rendererPool.getRenderer(this.container, this.width, this.height);

        // Add canvas to container
        this.canvas = this.renderer.domElement;
        this.canvas.className = 'viz-3d-canvas';
        this.container.appendChild(this.canvas);

        // Create controls
        this.controls = new THREE.OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = true;

        // Add default lighting
        this.addLighting();

        // Setup observers
        this.setupObservers();

        // Build visualization-specific content
        await this.build();

        // Start animation
        this.startAnimation();
    }

    addLighting() {
        // Ambient light
        this.ambientLight = new THREE.AmbientLight(
            themeColors.three.ambient,
            themeColors.isDark() ? 0.8 : 0.5
        );
        this.scene.add(this.ambientLight);

        // Directional light
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.directionalLight.position.set(5, 10, 7);
        this.scene.add(this.directionalLight);

        // Secondary fill light
        this.fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        this.fillLight.position.set(-5, 5, -5);
        this.scene.add(this.fillLight);
    }

    setupObservers() {
        // Resize observer
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.container);

        // Theme change listener
        themeColors.addListener(this.boundOnThemeChange);
    }

    onResize() {
        const rect = this.container.getBoundingClientRect();
        let newWidth = rect.width;
        let newHeight = rect.height;

        // Fallback to size presets or defaults for inline elements
        if (!newWidth || !newHeight) {
            const sizePresets = {
                tiny: { width: 80, height: 60 },
                small: { width: 150, height: 120 },
                medium: { width: 250, height: 200 },
                large: { width: 350, height: 280 },
                full: { width: 400, height: 300 }
            };

            const sizePreset = this.container.dataset.vizSize;
            if (!newWidth) {
                newWidth = (sizePreset && sizePresets[sizePreset]) ? sizePresets[sizePreset].width : 400;
            }
            if (!newHeight) {
                newHeight = (sizePreset && sizePresets[sizePreset]) ? sizePresets[sizePreset].height : 300;
            }
        }

        this.width = newWidth;
        this.height = newHeight;

        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
    }

    onThemeChange() {
        this.scene.background = themeColors.three.background;

        // Update lighting
        if (this.ambientLight) {
            this.ambientLight.color = themeColors.three.ambient;
            this.ambientLight.intensity = themeColors.isDark() ? 0.8 : 0.5;
        }

        // Call subclass update
        this.updateMaterials();
    }

    /**
     * Override in subclass to update materials on theme change
     */
    updateMaterials() {
        // Subclass implementation
    }

    /**
     * Override in subclass to build the visualization
     */
    async build() {
        throw new Error('Subclass must implement build()');
    }

    startAnimation() {
        this.isAnimating = true;
        animationManager.register(this.id, (delta) => this.animate(delta), this.container);
    }

    stopAnimation() {
        this.isAnimating = false;
        animationManager.unregister(this.id);
    }

    animate(delta) {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Clean up all resources
     */
    dispose() {
        this.stopAnimation();

        // Remove theme listener
        themeColors.removeListener(this.boundOnThemeChange);

        // Disconnect observers
        this.resizeObserver?.disconnect();

        // Dispose Three.js objects
        this.scene?.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(m => m.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });

        // Dispose controls
        this.controls?.dispose();

        // Release renderer back to pool
        rendererPool.release(this.container);

        // Remove canvas
        this.canvas?.remove();

        // Clear container state
        delete this.container._viz3dState;
    }
}

// ============================================
// SURFACE 3D VISUALIZATION
// ============================================

/**
 * Surface3DViz - Renders z = f(x, y) surfaces
 *
 * DSL Usage:
 *   [[viz(type: surface, fn: "sin(x)*cos(y)", xrange: -3:3, yrange: -3:3, resolution: 50)]]
 */
class Surface3DViz extends Base3DViz {
    async build() {
        const fn = this.params.fn || 'sin(sqrt(x*x + y*y))';
        const [xMin, xMax] = this.parseRange(this.params.xrange, [-4, 4]);
        const [yMin, yMax] = this.parseRange(this.params.yrange, [-4, 4]);
        const resolution = parseInt(this.params.resolution) || 60;

        // Parse the function
        this.surfaceFunction = this.compileFunction(fn);

        // Create geometry
        const geometry = new THREE.PlaneGeometry(
            xMax - xMin,
            yMax - yMin,
            resolution,
            resolution
        );

        // Apply z values and colors
        const positions = geometry.attributes.position;
        const colors = [];
        let zMin = Infinity, zMax = -Infinity;

        // First pass: calculate z values and range
        const zValues = [];
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = this.surfaceFunction(x, y);
            zValues.push(z);
            if (isFinite(z)) {
                zMin = Math.min(zMin, z);
                zMax = Math.max(zMax, z);
            }
        }

        // Handle case where all values are the same
        if (zMin === zMax) {
            zMax = zMin + 1;
        }

        // Second pass: set positions and colors
        const palette = themeColors.getSurfacePalette();
        for (let i = 0; i < positions.count; i++) {
            const z = isFinite(zValues[i]) ? zValues[i] : 0;
            positions.setZ(i, z);

            // Normalize z for color mapping
            const t = (z - zMin) / (zMax - zMin);
            const color = this.lerpColor(palette.low, palette.mid, palette.high, t);
            colors.push(color.r, color.g, color.b);
        }

        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        // Create material
        this.surfaceMaterial = new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            flatShading: false,
            shininess: 30
        });

        this.surfaceMesh = new THREE.Mesh(geometry, this.surfaceMaterial);
        this.surfaceMesh.rotation.x = -Math.PI / 2;  // Orient horizontally
        this.scene.add(this.surfaceMesh);

        // Store for theme updates
        this.zValues = zValues;
        this.zMin = zMin;
        this.zMax = zMax;

        // Add grid helper
        const gridSize = Math.max(xMax - xMin, yMax - yMin);
        this.gridHelper = new THREE.GridHelper(gridSize, 10, themeColors.three.grid, themeColors.three.grid);
        this.gridHelper.position.y = zMin - 0.1;
        this.scene.add(this.gridHelper);

        // Adjust camera
        const centerZ = (zMax + zMin) / 2;
        this.camera.position.set(
            (xMax - xMin) * 0.8,
            Math.max(zMax - zMin, 2) * 1.2,
            (yMax - yMin) * 0.8
        );
        this.controls.target.set(0, centerZ, 0);
        this.controls.update();
    }

    parseRange(rangeStr, defaultRange) {
        if (!rangeStr) return defaultRange;
        const parts = rangeStr.split(':').map(s => parseFloat(s.trim()));
        return parts.length === 2 && parts.every(isFinite) ? parts : defaultRange;
    }

    compileFunction(fnStr) {
        // Safe function compilation with math functions
        try {
            const safeFunction = new Function(
                'x', 'y',
                `with(Math) { return ${fnStr}; }`
            );
            return (x, y) => {
                try {
                    const result = safeFunction(x, y);
                    return isFinite(result) ? result : 0;
                } catch {
                    return 0;
                }
            };
        } catch {
            return () => 0;
        }
    }

    lerpColor(low, mid, high, t) {
        if (t < 0.5) {
            const s = t * 2;
            return low.clone().lerp(mid, s);
        } else {
            const s = (t - 0.5) * 2;
            return mid.clone().lerp(high, s);
        }
    }

    updateMaterials() {
        // Update grid color
        if (this.gridHelper) {
            this.gridHelper.material.color = themeColors.three.grid;
        }

        // Update surface colors
        if (this.surfaceMesh && this.zValues) {
            const geometry = this.surfaceMesh.geometry;
            const colors = [];
            const palette = themeColors.getSurfacePalette();

            for (let i = 0; i < this.zValues.length; i++) {
                const z = this.zValues[i];
                const t = (z - this.zMin) / (this.zMax - this.zMin);
                const color = this.lerpColor(palette.low, palette.mid, palette.high, t);
                colors.push(color.r, color.g, color.b);
            }

            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            geometry.attributes.color.needsUpdate = true;
        }
    }
}

// ============================================
// CURVE 3D VISUALIZATION
// ============================================

/**
 * Curve3DViz - Parametric 3D curves
 *
 * DSL Usage:
 *   [[viz(type: curve3d, x: "cos(t)*2", y: "sin(t)*2", z: "t/3", trange: 0:20, segments: 200)]]
 */
class Curve3DViz extends Base3DViz {
    async build() {
        const xFn = this.params.x || 'cos(t)*2';
        const yFn = this.params.y || 't/5';
        const zFn = this.params.z || 'sin(t)*2';
        const [tMin, tMax] = this.parseRange(this.params.trange, [0, 20]);
        const segments = parseInt(this.params.segments) || 300;
        const tubeRadius = parseFloat(this.params.radius) || 0.05;

        const points = [];
        const step = (tMax - tMin) / segments;

        const xFunc = this.compileFunction(xFn, 't');
        const yFunc = this.compileFunction(yFn, 't');
        const zFunc = this.compileFunction(zFn, 't');

        for (let t = tMin; t <= tMax; t += step) {
            const x = xFunc(t);
            const y = yFunc(t);
            const z = zFunc(t);
            if (isFinite(x) && isFinite(y) && isFinite(z)) {
                points.push(new THREE.Vector3(x, y, z));
            }
        }

        if (points.length < 2) {
            console.error('Not enough valid points for curve');
            return;
        }

        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeometry = new THREE.TubeGeometry(curve, segments, tubeRadius, 8, false);

        this.curveMaterial = new THREE.MeshPhongMaterial({
            color: themeColors.three.accent,
            shininess: 50
        });

        this.curveMesh = new THREE.Mesh(tubeGeometry, this.curveMaterial);
        this.scene.add(this.curveMesh);

        // Fit camera to curve
        const box = new THREE.Box3().setFromObject(this.curveMesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        this.camera.position.set(
            center.x + maxDim * 1.2,
            center.y + maxDim * 0.8,
            center.z + maxDim * 1.2
        );
        this.controls.target.copy(center);
        this.controls.update();

        // Add subtle grid
        this.gridHelper = new THREE.GridHelper(maxDim * 2, 10, themeColors.three.grid, themeColors.three.grid);
        this.gridHelper.position.y = box.min.y - 0.1;
        this.scene.add(this.gridHelper);
    }

    parseRange(rangeStr, defaultRange) {
        if (!rangeStr) return defaultRange;
        const parts = rangeStr.split(':').map(s => parseFloat(s.trim()));
        return parts.length === 2 && parts.every(isFinite) ? parts : defaultRange;
    }

    compileFunction(fnStr, varName) {
        try {
            const safeFunction = new Function(varName, `with(Math) { return ${fnStr}; }`);
            return (val) => {
                try {
                    const result = safeFunction(val);
                    return isFinite(result) ? result : 0;
                } catch {
                    return 0;
                }
            };
        } catch {
            return () => 0;
        }
    }

    updateMaterials() {
        if (this.curveMaterial) {
            this.curveMaterial.color = themeColors.three.accent;
        }
        if (this.gridHelper) {
            this.gridHelper.material.color = themeColors.three.grid;
        }
    }
}

// ============================================
// MODEL VIEWER VISUALIZATION
// ============================================

/**
 * ModelViewer - Load and display 3D models (GLTF/GLB)
 *
 * DSL Usage:
 *   [[viz(type: model, src: "/models/robot.glb")]]
 *   [[viz(type: model, src: "https://example.com/model.glb", scale: 2, autorotate: true)]]
 *   [[viz(type: model, src: "model.glb", size: tiny, display: inline)]]
 *
 * Parameters:
 *   src         - URL or path to GLTF/GLB model (required)
 *   scale       - Scale factor for the model (default: auto-fit)
 *   autorotate  - Enable auto-rotation (default: true for tiny/small, false otherwise)
 *   speed       - Rotation speed multiplier (default: 1)
 *   background  - Background color: "transparent", "theme", or hex color (default: theme)
 *   zoom        - Enable zoom controls (default: true for large, false for tiny/small)
 *   pan         - Enable pan controls (default: true for large, false for tiny/small)
 */
class ModelViewer extends Base3DViz {
    async build() {
        const src = this.params.src;
        const size = this.params.size || 'medium';
        const isSmall = size === 'tiny' || size === 'small';

        // Scale: auto-fit by default
        this.customScale = this.params.scale ? parseFloat(this.params.scale) : null;

        // Auto-rotate defaults to true for small sizes
        if (this.params.autorotate !== undefined) {
            this.autoRotate = this.params.autorotate === 'true';
        } else {
            this.autoRotate = isSmall;
        }

        // Rotation speed
        this.rotationSpeed = parseFloat(this.params.speed) || 1;

        // Controls: simplified for small sizes
        if (this.params.zoom !== undefined) {
            this.controls.enableZoom = this.params.zoom === 'true';
        } else {
            this.controls.enableZoom = !isSmall;
        }

        if (this.params.pan !== undefined) {
            this.controls.enablePan = this.params.pan === 'true';
        } else {
            this.controls.enablePan = !isSmall;
        }

        // Background handling
        if (this.params.background === 'transparent') {
            this.scene.background = null;
            this.renderer.setClearColor(0x000000, 0);
        } else if (this.params.background && this.params.background !== 'theme') {
            this.scene.background = new THREE.Color(this.params.background);
        }

        if (!src) {
            this.showError('src required');
            return;
        }

        // Show loading indicator
        this.container.classList.add('loading');
        this.showLoadingIndicator();

        const loader = new THREE.GLTFLoader();

        try {
            const gltf = await new Promise((resolve, reject) => {
                loader.load(
                    src,
                    resolve,
                    (progress) => {
                        if (progress.lengthComputable) {
                            const percent = Math.round((progress.loaded / progress.total) * 100);
                            this.updateLoadingProgress(percent);
                        }
                    },
                    reject
                );
            });

            this.container.classList.remove('loading');
            this.hideLoadingIndicator();

            this.model = gltf.scene;

            // Calculate bounding box for auto-fit
            const box = new THREE.Box3().setFromObject(this.model);
            const modelSize = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);

            // Auto-scale to fit viewport if no custom scale
            if (this.customScale) {
                this.model.scale.setScalar(this.customScale);
            } else {
                // Scale model to fit nicely in the viewport
                const targetSize = 2; // Target size in scene units
                const autoScale = targetSize / maxDim;
                this.model.scale.setScalar(autoScale);
            }

            // Center model at origin
            this.model.position.sub(center.multiplyScalar(this.model.scale.x));

            this.scene.add(this.model);

            // Position camera to see the full model
            const scaledSize = maxDim * this.model.scale.x;
            const distance = scaledSize * 2.5;
            this.camera.position.set(distance * 0.7, distance * 0.5, distance * 0.7);
            this.controls.target.set(0, 0, 0);
            this.controls.update();

            // Handle animations if present
            if (gltf.animations && gltf.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                gltf.animations.forEach(clip => {
                    this.mixer.clipAction(clip).play();
                });
            }

        } catch (error) {
            this.container.classList.remove('loading');
            this.hideLoadingIndicator();
            console.error('Model load error:', error);
            this.showError('Load failed');
        }
    }

    showLoadingIndicator() {
        this.loadingEl = document.createElement('div');
        this.loadingEl.className = 'viz-loading';
        this.loadingEl.innerHTML = '<span class="viz-loading-spinner"></span><span class="viz-loading-text">0%</span>';
        this.container.appendChild(this.loadingEl);
    }

    updateLoadingProgress(percent) {
        if (this.loadingEl) {
            const textEl = this.loadingEl.querySelector('.viz-loading-text');
            if (textEl) textEl.textContent = `${percent}%`;
        }
    }

    hideLoadingIndicator() {
        if (this.loadingEl) {
            this.loadingEl.remove();
            this.loadingEl = null;
        }
    }

    showError(message) {
        // Compact error for small containers
        const isSmall = this.width < 150 || this.height < 100;
        const errorDiv = document.createElement('div');
        errorDiv.className = 'viz-error viz-error-compact';
        errorDiv.textContent = isSmall ? '⚠' : message;
        errorDiv.title = message;
        this.container.appendChild(errorDiv);
    }

    animate(delta) {
        // Handle auto-rotation
        if (this.autoRotate && this.model) {
            this.model.rotation.y += delta * 0.5 * this.rotationSpeed;
        }

        // Update animation mixer if present
        if (this.mixer) {
            this.mixer.update(delta);
        }

        super.animate(delta);
    }

    updateMaterials() {
        // Update background on theme change (unless transparent or custom)
        if (this.params.background !== 'transparent' && !this.params.background) {
            this.scene.background = themeColors.three.background;
        }
    }
}

// ============================================
// NODE GRAPH 3D VISUALIZATION
// ============================================

/**
 * NodeGraph3DViz - 3D force-directed graph or tree
 *
 * DSL Usage:
 *   [[viz(type: nodegraph3d, nodes: "A,B,C,D", edges: "A-B,B-C,C-D,D-A")]]
 */
class NodeGraph3DViz extends Base3DViz {
    async build() {
        // Parse nodes and edges from params
        const nodesStr = this.params.nodes || 'A,B,C,D,E';
        const edgesStr = this.params.edges || 'A-B,B-C,C-D,D-E,E-A';

        const nodes = nodesStr.split(',').map(n => ({ id: n.trim() }));
        const edges = edgesStr.split(',').map(e => {
            const [source, target] = e.split('-').map(n => n.trim());
            return { source, target };
        });

        // Create node meshes
        this.nodeObjects = new Map();
        const nodeGeometry = new THREE.SphereGeometry(0.2, 16, 16);

        nodes.forEach((node) => {
            const nodeMaterial = new THREE.MeshPhongMaterial({
                color: themeColors.three.accent
            });
            const mesh = new THREE.Mesh(nodeGeometry, nodeMaterial);

            // Random initial position
            mesh.position.set(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4
            );

            mesh.userData = { node };
            this.scene.add(mesh);
            this.nodeObjects.set(node.id, mesh);
        });

        // Create edge lines
        this.edgeLines = [];
        edges.forEach(edge => {
            const sourceNode = this.nodeObjects.get(edge.source);
            const targetNode = this.nodeObjects.get(edge.target);

            if (sourceNode && targetNode) {
                const lineMaterial = new THREE.LineBasicMaterial({
                    color: themeColors.three.grid,
                    transparent: true,
                    opacity: 0.6
                });

                const geometry = new THREE.BufferGeometry().setFromPoints([
                    sourceNode.position.clone(),
                    targetNode.position.clone()
                ]);

                const line = new THREE.Line(geometry, lineMaterial);
                line.userData = { edge, sourceNode, targetNode };
                this.scene.add(line);
                this.edgeLines.push(line);
            }
        });

        // Apply force-directed layout
        this.applyForceLayout(100);

        // Fit camera
        const positions = Array.from(this.nodeObjects.values()).map(n => n.position);
        const box = new THREE.Box3();
        positions.forEach(p => box.expandByPoint(p));
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 5;

        this.camera.position.set(
            center.x + maxDim * 1.5,
            center.y + maxDim * 1,
            center.z + maxDim * 1.5
        );
        this.controls.target.copy(center);
        this.controls.update();
    }

    applyForceLayout(iterations) {
        const nodes = Array.from(this.nodeObjects.values());
        const k = 0.5;  // Spring constant
        const c = 3;    // Repulsion constant

        for (let iter = 0; iter < iterations; iter++) {
            // Repulsion between all pairs
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const delta = nodes[i].position.clone().sub(nodes[j].position);
                    const dist = delta.length() || 0.1;
                    const force = delta.normalize().multiplyScalar(c / (dist * dist));

                    nodes[i].position.add(force.clone().multiplyScalar(0.1));
                    nodes[j].position.sub(force.clone().multiplyScalar(0.1));
                }
            }

            // Attraction along edges
            this.edgeLines.forEach(line => {
                const { sourceNode, targetNode } = line.userData;
                const delta = targetNode.position.clone().sub(sourceNode.position);
                const dist = delta.length();
                const force = delta.normalize().multiplyScalar(k * (dist - 2));

                sourceNode.position.add(force.clone().multiplyScalar(0.05));
                targetNode.position.sub(force.clone().multiplyScalar(0.05));
            });
        }

        // Update edge geometries
        this.updateEdges();
    }

    updateEdges() {
        this.edgeLines.forEach(line => {
            const { sourceNode, targetNode } = line.userData;
            const positions = line.geometry.attributes.position.array;
            positions[0] = sourceNode.position.x;
            positions[1] = sourceNode.position.y;
            positions[2] = sourceNode.position.z;
            positions[3] = targetNode.position.x;
            positions[4] = targetNode.position.y;
            positions[5] = targetNode.position.z;
            line.geometry.attributes.position.needsUpdate = true;
        });
    }

    updateMaterials() {
        // Update node colors
        this.nodeObjects.forEach(mesh => {
            mesh.material.color = themeColors.three.accent;
        });

        // Update edge colors
        this.edgeLines.forEach(line => {
            line.material.color = themeColors.three.grid;
        });
    }
}

// ============================================
// POLYNOMIAL 3D VISUALIZATION (Interactive)
// ============================================

/**
 * Polynomial3DViz - Interactive 3D polynomial surface with sliders
 *
 * DSL Usage:
 *   [[viz(type: polynomial3d, a: 1, b: 1, c: 0, d: 0)]]
 *
 * Renders z = a*x² + b*y² + c*x*y + d with interactive coefficient sliders
 */
class Polynomial3DViz extends Base3DViz {
    async build() {
        // Parse initial coefficients
        this.coefficients = {
            a: parseFloat(this.params.a) || 0.5,
            b: parseFloat(this.params.b) || 0.5,
            c: parseFloat(this.params.c) || 0,
            d: parseFloat(this.params.d) || 0
        };

        this.resolution = 30;
        this.range = 2;

        // Create the surface mesh
        this.createSurface();

        // Add grid helper
        this.gridHelper = new THREE.GridHelper(this.range * 2, 8, themeColors.three.grid, themeColors.three.grid);
        this.gridHelper.position.y = -1;
        this.scene.add(this.gridHelper);

        // Position camera closer for better view
        this.camera.position.set(4, 3, 4);
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        // Create slider controls (outside the 3D canvas)
        this.createSliderControls();
    }

    createSurface() {
        // Remove old mesh if exists
        if (this.surfaceMesh) {
            this.scene.remove(this.surfaceMesh);
            this.surfaceMesh.geometry.dispose();
            this.surfaceMesh.material.dispose();
        }

        const geometry = new THREE.PlaneGeometry(
            this.range * 2,
            this.range * 2,
            this.resolution,
            this.resolution
        );

        // Apply z values and colors
        const positions = geometry.attributes.position;
        const colors = [];
        let zMin = Infinity, zMax = -Infinity;

        // First pass: calculate z values and range
        const zValues = [];
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = this.evaluatePolynomial(x, y);
            zValues.push(z);
            if (isFinite(z)) {
                zMin = Math.min(zMin, z);
                zMax = Math.max(zMax, z);
            }
        }

        // Handle case where all values are the same
        if (zMin === zMax) {
            zMax = zMin + 1;
        }

        // Second pass: set positions and colors
        const palette = themeColors.getSurfacePalette();
        for (let i = 0; i < positions.count; i++) {
            const z = isFinite(zValues[i]) ? zValues[i] : 0;
            positions.setZ(i, z);

            // Normalize z for color mapping
            const t = (z - zMin) / (zMax - zMin);
            const color = this.lerpColor(palette.low, palette.mid, palette.high, t);
            colors.push(color.r, color.g, color.b);
        }

        // Mark positions as needing update (critical for GPU buffer sync)
        positions.needsUpdate = true;

        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        // Store for updates
        this.zValues = zValues;
        this.zMin = zMin;
        this.zMax = zMax;

        // Create material
        const material = new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            flatShading: false,
            shininess: 30
        });

        this.surfaceMesh = new THREE.Mesh(geometry, material);
        this.surfaceMesh.rotation.x = -Math.PI / 2;  // Orient horizontally
        this.scene.add(this.surfaceMesh);
    }

    evaluatePolynomial(x, y) {
        const { a, b, c, d } = this.coefficients;
        return a * x * x + b * y * y + c * x * y + d;
    }

    lerpColor(low, mid, high, t) {
        if (t < 0.5) {
            const s = t * 2;
            return low.clone().lerp(mid, s);
        } else {
            const s = (t - 0.5) * 2;
            return mid.clone().lerp(high, s);
        }
    }

    createSliderControls() {
        // Create a controls wrapper that sits below the canvas
        const controlsWrapper = document.createElement('div');
        controlsWrapper.className = 'viz-3d-controls';
        controlsWrapper.innerHTML = `
            <div class="viz-function-display">
                <span class="viz-function-label">z = </span>
                <span class="viz-function-expr" data-expr></span>
            </div>
            <div class="viz-controls">
                <div class="viz-slider-row">
                    <span class="viz-slider-label">a</span>
                    <input type="range" class="viz-slider" data-coef="a"
                           min="-2" max="2" step="0.05" value="${this.coefficients.a}">
                    <span class="viz-slider-value" data-value="a">${this.coefficients.a.toFixed(2)}</span>
                </div>
                <div class="viz-slider-row">
                    <span class="viz-slider-label">b</span>
                    <input type="range" class="viz-slider" data-coef="b"
                           min="-2" max="2" step="0.05" value="${this.coefficients.b}">
                    <span class="viz-slider-value" data-value="b">${this.coefficients.b.toFixed(2)}</span>
                </div>
                <div class="viz-slider-row">
                    <span class="viz-slider-label">c</span>
                    <input type="range" class="viz-slider" data-coef="c"
                           min="-2" max="2" step="0.05" value="${this.coefficients.c}">
                    <span class="viz-slider-value" data-value="c">${this.coefficients.c.toFixed(2)}</span>
                </div>
                <div class="viz-slider-row">
                    <span class="viz-slider-label">d</span>
                    <input type="range" class="viz-slider" data-coef="d"
                           min="-3" max="3" step="0.1" value="${this.coefficients.d}">
                    <span class="viz-slider-value" data-value="d">${this.coefficients.d.toFixed(2)}</span>
                </div>
            </div>
        `;

        this.container.appendChild(controlsWrapper);
        this.controlsWrapper = controlsWrapper;

        // Bind slider events
        controlsWrapper.querySelectorAll('.viz-slider').forEach(slider => {
            slider.addEventListener('input', () => {
                const coef = slider.dataset.coef;
                const value = parseFloat(slider.value);
                this.coefficients[coef] = value;

                // Update value display
                const valueDisplay = controlsWrapper.querySelector(`[data-value="${coef}"]`);
                if (valueDisplay) {
                    valueDisplay.textContent = value.toFixed(2);
                }

                // Rebuild the surface with new coefficients
                this.updateSurface();
                this.updateFunctionDisplay();
            });
        });

        // Initial function display
        this.updateFunctionDisplay();

        // Resize the renderer to account for controls area
        // Use setTimeout to allow CSS layout to complete
        setTimeout(() => this.onResize(), 0);
    }

    updateSurface() {
        if (!this.surfaceMesh) return;

        const geometry = this.surfaceMesh.geometry;
        const positions = geometry.attributes.position;
        const colors = [];

        let zMin = Infinity, zMax = -Infinity;
        const zValues = [];

        // First pass: calculate new z values
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = this.evaluatePolynomial(x, y);
            zValues.push(z);
            if (isFinite(z)) {
                zMin = Math.min(zMin, z);
                zMax = Math.max(zMax, z);
            }
        }

        if (zMin === zMax) zMax = zMin + 1;

        // Second pass: update positions and colors
        const palette = themeColors.getSurfacePalette();
        for (let i = 0; i < positions.count; i++) {
            const z = isFinite(zValues[i]) ? zValues[i] : 0;
            positions.setZ(i, z);

            const t = (z - zMin) / (zMax - zMin);
            const color = this.lerpColor(palette.low, palette.mid, palette.high, t);
            colors.push(color.r, color.g, color.b);
        }

        positions.needsUpdate = true;
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.attributes.color.needsUpdate = true;
        geometry.computeVertexNormals();

        this.zValues = zValues;
        this.zMin = zMin;
        this.zMax = zMax;
    }

    updateFunctionDisplay() {
        const exprEl = this.controlsWrapper?.querySelector('[data-expr]');
        if (!exprEl) return;

        const { a, b, c, d } = this.coefficients;
        const terms = [];

        if (a !== 0) {
            if (a === 1) terms.push('x²');
            else if (a === -1) terms.push('-x²');
            else terms.push(`${a}x²`);
        }

        if (b !== 0) {
            if (b === 1) terms.push(terms.length ? '+ y²' : 'y²');
            else if (b === -1) terms.push(terms.length ? '- y²' : '-y²');
            else if (b > 0) terms.push(terms.length ? `+ ${b}y²` : `${b}y²`);
            else terms.push(`- ${Math.abs(b)}y²`);
        }

        if (c !== 0) {
            if (c === 1) terms.push(terms.length ? '+ xy' : 'xy');
            else if (c === -1) terms.push(terms.length ? '- xy' : '-xy');
            else if (c > 0) terms.push(terms.length ? `+ ${c}xy` : `${c}xy`);
            else terms.push(`- ${Math.abs(c)}xy`);
        }

        if (d !== 0 || terms.length === 0) {
            if (d >= 0) terms.push(terms.length ? `+ ${d}` : `${d}`);
            else terms.push(`- ${Math.abs(d)}`);
        }

        exprEl.textContent = terms.join(' ');
    }

    /**
     * Override onResize to use canvas dimensions instead of container
     * (since container includes the controls area)
     */
    onResize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width || 400;
        this.height = rect.height || 200;

        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
    }

    updateMaterials() {
        // Update grid color
        if (this.gridHelper) {
            this.gridHelper.material.color = themeColors.three.grid;
        }

        // Update surface colors
        if (this.surfaceMesh && this.zValues) {
            this.updateSurface();
        }
    }

    dispose() {
        // Remove controls wrapper
        if (this.controlsWrapper) {
            this.controlsWrapper.remove();
        }
        super.dispose();
    }
}

// ============================================
// 3D VISUALIZATION MANAGER
// ============================================

export const Viz3DTypes = {
    'surface': Surface3DViz,
    'curve3d': Curve3DViz,
    'model': ModelViewer,
    'nodegraph3d': NodeGraph3DViz,
    'polynomial3d': Polynomial3DViz
};

/**
 * Viz3DManager - Manages 3D visualization types and lifecycle
 */
export class Viz3DManager {
    constructor() {
        this.vizTypes = { ...Viz3DTypes };
    }

    /**
     * Register a custom 3D visualization type
     */
    registerViz(name, VizClass) {
        this.vizTypes[name] = VizClass;
    }

    /**
     * Check if a type is a 3D visualization
     */
    is3DType(type) {
        return type in this.vizTypes;
    }

    /**
     * Initialize all 3D visualizations in a container
     */
    async initVisualizations(container, context = {}) {
        const vizContainers = container.querySelectorAll('.viz-container[data-viz-type]');

        for (const vizContainer of vizContainers) {
            const type = vizContainer.dataset.vizType;

            // Check if this is a 3D type
            if (this.is3DType(type)) {
                await this.initViz(vizContainer, type, context);
            }
        }
    }

    async initViz(container, type, context) {
        // Skip if already initialized
        if (container._viz3dState) return;

        const VizClass = this.vizTypes[type];

        if (!VizClass) {
            container.innerHTML = `<div class="viz-error">Unknown 3D viz type: ${type}</div>`;
            return;
        }

        // Extract params from data attributes
        const params = {};
        Object.entries(container.dataset).forEach(([key, value]) => {
            if (key.startsWith('viz')) {
                const paramName = key.replace(/^viz/, '').toLowerCase();
                if (paramName) {
                    params[paramName] = value;
                }
            }
        });

        try {
            const viz = new VizClass(container, params, context);
            await viz.init();
        } catch (error) {
            console.error(`Error initializing 3D viz ${type}:`, error);
            container.innerHTML = `<div class="viz-error">Error: ${error.message}</div>`;
        }
    }
}

export const viz3DManager = new Viz3DManager();
