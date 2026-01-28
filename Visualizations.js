/**
 * Visualizations.js - Interactive visualization system
 *
 * This module provides a registry for visualization types and renders
 * interactive graphics (Canvas, SVG, etc.) that integrate seamlessly
 * with the site's styling and respond to light/dark mode.
 *
 * Usage in markdown:
 *   [[viz(type: polynomial)]]
 *   [[viz(type: polynomial, a: 1, b: 0, c: -1)]]
 *
 * To add a new visualization type:
 *
 *   vizManager.registerViz('myViz', {
 *       render(container, params, context) {
 *           // Create your visualization in the container
 *       },
 *       update(container, params, context) {
 *           // Update the visualization when params change
 *       }
 *   });
 */

// ============================================
// VISUALIZATION REGISTRY
// ============================================

/**
 * Built-in visualization types
 */
export const VizTypes = {
    /**
     * Polynomial function plotter
     * Plots f(x) = ax³ + bx² + cx + d with interactive coefficient sliders
     */
    polynomial: {
        render(container, params, context) {
            const vizId = params.id;

            // Default coefficients
            const defaults = {
                a3: parseFloat(params.a3) || 0,
                a2: parseFloat(params.a2) || 1,
                a1: parseFloat(params.a1) || 0,
                a0: parseFloat(params.a0) || 0
            };

            // Create the visualization structure
            container.innerHTML = `
                <div class="viz-polynomial" data-viz-instance="${vizId}">
                    <div class="viz-function-display">
                        <span class="viz-function-label">f(x) = </span>
                        <span class="viz-function-expr" data-expr-for="${vizId}"></span>
                    </div>
                    <canvas class="viz-canvas" data-canvas-for="${vizId}"></canvas>
                    <div class="viz-controls">
                        <div class="viz-slider-row">
                            <span class="viz-slider-label">a₃</span>
                            <input type="range" class="viz-slider" data-coef="a3" data-viz="${vizId}"
                                   min="-2" max="2" step="0.01" value="${defaults.a3}">
                            <span class="viz-slider-value" data-value-for="${vizId}-a3">${defaults.a3}</span>
                        </div>
                        <div class="viz-slider-row">
                            <span class="viz-slider-label">a₂</span>
                            <input type="range" class="viz-slider" data-coef="a2" data-viz="${vizId}"
                                   min="-5" max="5" step="0.05" value="${defaults.a2}">
                            <span class="viz-slider-value" data-value-for="${vizId}-a2">${defaults.a2}</span>
                        </div>
                        <div class="viz-slider-row">
                            <span class="viz-slider-label">a₁</span>
                            <input type="range" class="viz-slider" data-coef="a1" data-viz="${vizId}"
                                   min="-5" max="5" step="0.05" value="${defaults.a1}">
                            <span class="viz-slider-value" data-value-for="${vizId}-a1">${defaults.a1}</span>
                        </div>
                        <div class="viz-slider-row">
                            <span class="viz-slider-label">a₀</span>
                            <input type="range" class="viz-slider" data-coef="a0" data-viz="${vizId}"
                                   min="-5" max="5" step="0.05" value="${defaults.a0}">
                            <span class="viz-slider-value" data-value-for="${vizId}-a0">${defaults.a0}</span>
                        </div>
                    </div>
                </div>
            `;

            // Get the canvas and set up
            const canvas = container.querySelector(`[data-canvas-for="${vizId}"]`);
            const dpr = window.devicePixelRatio || 1;

            // Set canvas size based on container
            const updateCanvasSize = () => {
                const rect = canvas.getBoundingClientRect();
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                canvas.getContext('2d').scale(dpr, dpr);
            };
            updateCanvasSize();

            // Store state on the container
            container._vizState = {
                coefficients: { ...defaults },
                canvas,
                vizId
            };

            // Initial render
            this.drawPolynomial(container);
            this.updateFunctionDisplay(container);

            // Bind slider events
            container.querySelectorAll('.viz-slider').forEach(slider => {
                slider.addEventListener('input', () => {
                    const coef = slider.dataset.coef;
                    const value = parseFloat(slider.value);
                    container._vizState.coefficients[coef] = value;

                    // Update value display
                    const valueDisplay = container.querySelector(`[data-value-for="${vizId}-${coef}"]`);
                    if (valueDisplay) {
                        valueDisplay.textContent = value.toFixed(2);
                    }

                    this.drawPolynomial(container);
                    this.updateFunctionDisplay(container);
                });
            });

            // Redraw on resize
            const resizeObserver = new ResizeObserver(() => {
                updateCanvasSize();
                this.drawPolynomial(container);
            });
            resizeObserver.observe(canvas);

            // Redraw on theme change
            const observer = new MutationObserver(() => {
                this.drawPolynomial(container);
            });
            observer.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-theme']
            });
        },

        updateFunctionDisplay(container) {
            const state = container._vizState;
            if (!state) return;

            const { a3, a2, a1, a0 } = state.coefficients;
            const exprEl = container.querySelector(`[data-expr-for="${state.vizId}"]`);
            if (!exprEl) return;

            // Build the expression string
            const terms = [];

            if (a3 !== 0) {
                if (a3 === 1) terms.push('x³');
                else if (a3 === -1) terms.push('-x³');
                else terms.push(`${a3}x³`);
            }

            if (a2 !== 0) {
                if (a2 === 1) terms.push(terms.length ? '+ x²' : 'x²');
                else if (a2 === -1) terms.push(terms.length ? '- x²' : '-x²');
                else if (a2 > 0) terms.push(terms.length ? `+ ${a2}x²` : `${a2}x²`);
                else terms.push(`- ${Math.abs(a2)}x²`);
            }

            if (a1 !== 0) {
                if (a1 === 1) terms.push(terms.length ? '+ x' : 'x');
                else if (a1 === -1) terms.push(terms.length ? '- x' : '-x');
                else if (a1 > 0) terms.push(terms.length ? `+ ${a1}x` : `${a1}x`);
                else terms.push(`- ${Math.abs(a1)}x`);
            }

            if (a0 !== 0 || terms.length === 0) {
                if (a0 >= 0) terms.push(terms.length ? `+ ${a0}` : `${a0}`);
                else terms.push(`- ${Math.abs(a0)}`);
            }

            exprEl.textContent = terms.join(' ');
        },

        drawPolynomial(container) {
            const state = container._vizState;
            if (!state) return;

            const canvas = state.canvas;
            const ctx = canvas.getContext('2d');
            const { a3, a2, a1, a0 } = state.coefficients;

            // Get computed colors from CSS variables
            const computedStyle = getComputedStyle(document.documentElement);
            const textColor = computedStyle.getPropertyValue('--color-text-primary').trim() || '#1a1a1a';
            const gridColor = computedStyle.getPropertyValue('--color-border').trim() || '#e0e0e0';
            const bgColor = computedStyle.getPropertyValue('--color-card-background').trim() || '#ffffff';

            // Canvas dimensions (logical pixels)
            const width = canvas.width / (window.devicePixelRatio || 1);
            const height = canvas.height / (window.devicePixelRatio || 1);

            // Clear canvas
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);

            // Define the coordinate system
            const xRange = { min: -5, max: 5 };
            const yRange = { min: -10, max: 10 };

            // Padding
            const padding = 20;
            const plotWidth = width - 2 * padding;
            const plotHeight = height - 2 * padding;

            // Helper functions to convert between coordinates
            const toCanvasX = (x) => padding + ((x - xRange.min) / (xRange.max - xRange.min)) * plotWidth;
            const toCanvasY = (y) => padding + ((yRange.max - y) / (yRange.max - yRange.min)) * plotHeight;

            // Draw grid
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 0.5;

            // Vertical grid lines
            for (let x = Math.ceil(xRange.min); x <= xRange.max; x++) {
                const cx = toCanvasX(x);
                ctx.beginPath();
                ctx.moveTo(cx, padding);
                ctx.lineTo(cx, height - padding);
                ctx.stroke();
            }

            // Horizontal grid lines
            for (let y = Math.ceil(yRange.min); y <= yRange.max; y++) {
                const cy = toCanvasY(y);
                ctx.beginPath();
                ctx.moveTo(padding, cy);
                ctx.lineTo(width - padding, cy);
                ctx.stroke();
            }

            // Draw axes
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 1;

            // X-axis
            const xAxisY = toCanvasY(0);
            if (xAxisY >= padding && xAxisY <= height - padding) {
                ctx.beginPath();
                ctx.moveTo(padding, xAxisY);
                ctx.lineTo(width - padding, xAxisY);
                ctx.stroke();
            }

            // Y-axis
            const yAxisX = toCanvasX(0);
            if (yAxisX >= padding && yAxisX <= width - padding) {
                ctx.beginPath();
                ctx.moveTo(yAxisX, padding);
                ctx.lineTo(yAxisX, height - padding);
                ctx.stroke();
            }

            // Draw the polynomial
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 2;
            ctx.beginPath();

            let firstPoint = true;
            const step = (xRange.max - xRange.min) / 200;

            for (let x = xRange.min; x <= xRange.max; x += step) {
                const y = a3 * x * x * x + a2 * x * x + a1 * x + a0;

                // Only draw if y is within range (with some tolerance)
                if (y >= yRange.min - 5 && y <= yRange.max + 5) {
                    const cx = toCanvasX(x);
                    const cy = toCanvasY(Math.max(yRange.min, Math.min(yRange.max, y)));

                    if (firstPoint) {
                        ctx.moveTo(cx, cy);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(cx, cy);
                    }
                } else {
                    firstPoint = true; // Break the line when out of range
                }
            }

            ctx.stroke();

            // Draw axis labels
            ctx.fillStyle = textColor;
            ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';

            // X-axis labels
            for (let x = Math.ceil(xRange.min); x <= xRange.max; x++) {
                if (x !== 0) {
                    const cx = toCanvasX(x);
                    ctx.fillText(x.toString(), cx, height - padding + 12);
                }
            }

            // Y-axis labels
            ctx.textAlign = 'right';
            for (let y = Math.ceil(yRange.min); y <= yRange.max; y += 2) {
                if (y !== 0) {
                    const cy = toCanvasY(y);
                    ctx.fillText(y.toString(), padding - 4, cy + 3);
                }
            }
        }
    }
};

// ============================================
// VISUALIZATION MANAGER
// ============================================

/**
 * VizManager - Manages visualization types and rendering
 */
export class VizManager {
    constructor() {
        this.vizTypes = { ...VizTypes };
    }

    /**
     * Register a custom visualization type
     *
     * Example:
     * vizManager.registerViz('scatter', {
     *     render(container, params, context) { ... },
     *     update(container, params, context) { ... }
     * });
     */
    registerViz(name, handler) {
        this.vizTypes[name] = handler;
    }

    /**
     * Initialize all visualizations in a container
     * Skips 3D visualization types (handled by Visualizations3D.js)
     */
    initVisualizations(container, context = {}) {
        // 3D types are handled by Visualizations3D.js
        const viz3DTypes = new Set(['surface', 'curve3d', 'model', 'nodegraph3d', 'polynomial3d']);

        container.querySelectorAll('.viz-container[data-viz-type]').forEach(vizContainer => {
            const type = vizContainer.dataset.vizType;

            // Skip 3D types - they're handled by the 3D visualization system
            if (viz3DTypes.has(type)) {
                return;
            }

            const handler = this.vizTypes[type];

            if (handler && handler.render) {
                // Extract all viz params from data attributes
                const params = {};
                Object.entries(vizContainer.dataset).forEach(([key, value]) => {
                    if (key.startsWith('viz')) {
                        const paramName = key.replace('viz', '').toLowerCase();
                        params[paramName] = value;
                    }
                });

                handler.render(vizContainer, params, context);
            } else {
                vizContainer.innerHTML = `<div class="viz-error">Unknown visualization type: ${type}</div>`;
            }
        });
    }
}

// Default singleton instance
export const vizManager = new VizManager();
