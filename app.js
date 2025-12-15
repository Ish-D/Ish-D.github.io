import { Card } from './Card.js';
import { MarkdownParser } from './MarkdownParser.js';

class PaperCanvas {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.canvasContent = document.getElementById('canvas-content');
        this.cards = new Map();
        this.parser = new MarkdownParser();

        // Global page counter - increments for each new card
        this.pageCounter = 0;

        // Canvas transform state
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
        this.rotation = 0;

        // Canvas interaction state
        this.isPanning = false;
        this.isRotating = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.rotateStartX = 0;
        this.rotateStartY = 0;
        this.startPanX = 0;
        this.startPanY = 0;
        this.startRotation = 0;

        // Default card placement
        this.defaultOffset = { x: 100, y: 100 };

        this.init();
    }

    async init() {
        this.bindCanvasEvents();
        this.initSettings();
        this.initConnectionsLayer();

        // Check URL for direct card routing
        const cardName = this.getCardNameFromURL();
        if (cardName) {
            // Reset canvas view
            this.panX = 0;
            this.panY = 0;
            this.zoom = 1;
            this.rotation = 0;
            this.updateCanvasTransform();

            // Load card filling most of the viewport
            const card = await this.loadCardFromFile(cardName, { fillViewport: true });
            if (!card) {
                // Card not found, fall back to menu
                console.warn(`Card "${cardName}" not found, loading menu`);
                await this.loadMenuCard();
            }
        } else {
            // No card specified, load the menu
            await this.loadMenuCard();
        }
    }

    getCardNameFromURL() {
        // Check pathname first (for SPA-configured servers)
        const path = window.location.pathname;
        const pathCard = decodeURIComponent(path.replace(/^\/+|\/+$/g, ''));
        if (pathCard) {
            return pathCard;
        }

        // Check hash (works with any static server: /#journal or #journal)
        const hash = window.location.hash;
        const hashCard = decodeURIComponent(hash.replace(/^#\/?/, ''));
        if (hashCard) {
            return hashCard;
        }

        // Check query parameter (?page=journal)
        const params = new URLSearchParams(window.location.search);
        const queryCard = params.get('page');
        if (queryCard) {
            return decodeURIComponent(queryCard);
        }

        return null;
    }

    async loadMenuCard() {
        // Reset canvas view to default
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
        this.rotation = 0;
        this.updateCanvasTransform();

        await this.loadCardFromFile('menu', {
            centered: true,
            width: 320,
            height: 320
        });
    }

    bindCanvasEvents() {
        // Canvas panning with left mouse on empty space
        this.canvas.addEventListener('mousedown', (e) => {
            // Check if clicking on a card or its children
            const isCard = e.target.closest('.card');

            // Left click on canvas background (not on a card) - pan
            if (!isCard && e.button === 0) {
                e.preventDefault();
                this.startPanning(e);
            }
            // Right click on canvas background - rotate
            if (!isCard && e.button === 2) {
                e.preventDefault();
                this.startRotatingCanvas(e);
            }
        });

        // Touch events for canvas
        this.canvas.addEventListener('touchstart', (e) => {
            const isCard = e.target.closest('.card');
            if (!isCard) {
                if (e.touches.length === 1) {
                    // Single finger - pan
                    e.preventDefault();
                    this.startPanningTouch(e);
                } else if (e.touches.length === 2) {
                    // Two fingers - pinch zoom and/or rotate
                    e.preventDefault();
                    this.startTwoFingerGesture(e);
                }
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (this.isPanning && this.isTouchPanning) {
                e.preventDefault();
                this.panTouch(e);
            }
            if (this.isTwoFingerGesture && e.touches.length === 2) {
                e.preventDefault();
                this.twoFingerGesture(e);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            if (this.isPanning && this.isTouchPanning) {
                this.stopPanningTouch();
            }
            if (this.isTwoFingerGesture) {
                // If still have 2 fingers, continue; otherwise stop
                if (e.touches.length < 2) {
                    this.stopTwoFingerGesture();
                }
            }
        });

        // Prevent context menu on right click on background
        this.canvas.addEventListener('contextmenu', (e) => {
            const isCard = e.target.closest('.card');
            if (!isCard) {
                e.preventDefault();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                this.pan(e);
            }
            if (this.isRotating) {
                this.rotateCanvas(e);
            }
        });

        document.addEventListener('mouseup', () => {
            this.stopPanning();
            this.stopRotatingCanvas();
        });

        // Zoom with scroll wheel (only when not over a card)
        this.canvas.addEventListener('wheel', (e) => {
            const isCard = e.target.closest('.card');
            if (!isCard) {
                e.preventDefault();
                this.zoomCanvas(e);
            }
        }, { passive: false });

        // Handle card deletion
        this.canvas.addEventListener('card-delete', (e) => {
            const cardId = e.detail.cardId;

            // Remove connections for this card
            this.removeConnectionsForCard(cardId);

            this.cards.delete(cardId);

            // If no cards remain, respawn the menu card
            if (this.cards.size === 0) {
                this.loadMenuCard();
            }
        });

        // Handle card link clicks
        this.canvas.addEventListener('click', (e) => {
            const cardLink = e.target.closest('.card-link');
            if (cardLink) {
                const cardName = cardLink.dataset.card;
                const embedUrl = cardLink.dataset.url;

                // Get the parent card element
                const parentCardEl = cardLink.closest('.card');
                const parentCard = parentCardEl ? this.getCardById(parentCardEl.id) : null;

                // Extract positioning options from data attributes
                const options = {
                    width: cardLink.dataset.width ? parseInt(cardLink.dataset.width) : null,
                    height: cardLink.dataset.height ? parseInt(cardLink.dataset.height) : null,
                    relX: cardLink.dataset.relX ? parseInt(cardLink.dataset.relX) : null,
                    relY: cardLink.dataset.relY ? parseInt(cardLink.dataset.relY) : null,
                    absX: cardLink.dataset.absX ? parseInt(cardLink.dataset.absX) : null,
                    absY: cardLink.dataset.absY ? parseInt(cardLink.dataset.absY) : null,
                    jitter: cardLink.dataset.jitter ? parseInt(cardLink.dataset.jitter) : 0,
                    rotation: cardLink.dataset.rotation ? parseFloat(cardLink.dataset.rotation) : null,
                    embed: cardLink.dataset.embed === 'true',
                    marginTB: cardLink.dataset.marginTb ? parseFloat(cardLink.dataset.marginTb) : null,
                    marginLR: cardLink.dataset.marginLr ? parseFloat(cardLink.dataset.marginLr) : null
                };

                if (embedUrl) {
                    // Open URL in an embedded card
                    this.openEmbedCard(embedUrl, parentCard, options, e);
                } else if (cardName) {
                    // Open a card file
                    this.openCard(cardName, parentCard, options, e);
                }
            }
        });
    }

    getCardById(id) {
        return this.cards.get(id) || null;
    }

    getNextPageNumber() {
        this.pageCounter++;
        return String(this.pageCounter).padStart(2, '0');
    }

    applyJitter(value, jitter) {
        if (!jitter) return value;
        const offset = (Math.random() - 0.5) * jitter;
        return value + offset;
    }

    startPanning(e) {
        this.isPanning = true;
        this.canvas.style.cursor = 'grabbing';
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.startPanX = this.panX;
        this.startPanY = this.panY;
    }

    pan(e) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.panX = this.startPanX + dx;
        this.panY = this.startPanY + dy;
        this.updateCanvasTransform();
    }

    stopPanning() {
        this.isPanning = false;
        this.isTouchPanning = false;
        this.canvas.style.cursor = 'grab';
    }

    // Touch panning methods
    startPanningTouch(e) {
        this.isPanning = true;
        this.isTouchPanning = true;
        const touch = e.touches[0];
        this.panStartX = touch.clientX;
        this.panStartY = touch.clientY;
        this.startPanX = this.panX;
        this.startPanY = this.panY;
    }

    panTouch(e) {
        if (e.touches.length < 1) return;
        const touch = e.touches[0];
        const dx = touch.clientX - this.panStartX;
        const dy = touch.clientY - this.panStartY;
        this.panX = this.startPanX + dx;
        this.panY = this.startPanY + dy;
        this.updateCanvasTransform();
    }

    stopPanningTouch() {
        this.isPanning = false;
        this.isTouchPanning = false;
    }

    // Two-finger gesture methods (pinch-zoom and rotate)
    startTwoFingerGesture(e) {
        this.isTwoFingerGesture = true;
        this.isPanning = false;
        this.isTouchPanning = false;

        const t1 = e.touches[0];
        const t2 = e.touches[1];

        // Store initial touch positions
        this.gestureStartDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        this.gestureStartAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);
        this.gestureStartZoom = this.zoom;
        this.gestureStartRotation = this.rotation;

        // Gesture center point
        const centerX = (t1.clientX + t2.clientX) / 2;
        const centerY = (t1.clientY + t2.clientY) / 2;
        const rect = this.canvas.getBoundingClientRect();
        this.gestureCenterX = centerX - rect.left;
        this.gestureCenterY = centerY - rect.top;

        // Store pan at start
        this.gestureStartPanX = this.panX;
        this.gestureStartPanY = this.panY;
    }

    twoFingerGesture(e) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];

        // Current distance and angle
        const currentDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const currentAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);

        // Calculate zoom
        const zoomFactor = currentDistance / this.gestureStartDistance;
        const newZoom = Math.max(0.1, Math.min(5, this.gestureStartZoom * zoomFactor));

        // Calculate rotation delta
        let angleDelta = currentAngle - this.gestureStartAngle;
        const newRotation = this.gestureStartRotation + angleDelta;

        // Apply zoom around gesture center
        const contentCenterX = (this.gestureCenterX - this.gestureStartPanX) / this.gestureStartZoom;
        const contentCenterY = (this.gestureCenterY - this.gestureStartPanY) / this.gestureStartZoom;

        // Account for rotation when calculating new pan
        const deltaRotation = (newRotation - this.gestureStartRotation) * Math.PI / 180;
        const cos = Math.cos(deltaRotation);
        const sin = Math.sin(deltaRotation);

        this.panX = this.gestureCenterX - (contentCenterX * cos - contentCenterY * sin) * newZoom;
        this.panY = this.gestureCenterY - (contentCenterX * sin + contentCenterY * cos) * newZoom;

        this.zoom = newZoom;
        this.rotation = newRotation;
        this.updateCanvasTransform();
    }

    stopTwoFingerGesture() {
        this.isTwoFingerGesture = false;
    }

    startRotatingCanvas(e) {
        this.isRotating = true;
        this.canvas.classList.add('rotating');
        this.rotateStartX = e.clientX;
        this.rotateStartY = e.clientY;
        this.startRotation = this.rotation;
        this.startPanXForRotation = this.panX;
        this.startPanYForRotation = this.panY;

        // Store rotation center in screen coordinates
        const rect = this.canvas.getBoundingClientRect();
        this.rotateCenterX = e.clientX - rect.left;
        this.rotateCenterY = e.clientY - rect.top;
    }

    rotateCanvas(e) {
        // Calculate rotation based on horizontal mouse movement
        const dx = e.clientX - this.rotateStartX;
        const newRotation = this.startRotation + dx * 0.5; // 0.5 degrees per pixel
        const deltaRotation = (newRotation - this.startRotation) * Math.PI / 180;

        // Rotate around the mouse position
        // Convert rotation center to content coordinates at start of rotation
        const contentCenterX = (this.rotateCenterX - this.startPanXForRotation) / this.zoom;
        const contentCenterY = (this.rotateCenterY - this.startPanYForRotation) / this.zoom;

        // Calculate new pan to keep rotation center fixed
        const cos = Math.cos(deltaRotation);
        const sin = Math.sin(deltaRotation);

        // The rotation center in screen space should stay at rotateCenterX, rotateCenterY
        // After rotation, the content point (contentCenterX, contentCenterY) should map to the same screen position
        this.panX = this.rotateCenterX - (contentCenterX * cos - contentCenterY * sin) * this.zoom;
        this.panY = this.rotateCenterY - (contentCenterX * sin + contentCenterY * cos) * this.zoom;

        this.rotation = newRotation;
        this.updateCanvasTransform();
    }

    stopRotatingCanvas() {
        this.isRotating = false;
        this.canvas.classList.remove('rotating');
    }

    zoomCanvas(e) {
        const zoomSpeed = 0.001;
        const delta = -e.deltaY * zoomSpeed;
        const newZoom = Math.max(0.1, Math.min(5, this.zoom + delta * this.zoom));

        // Get mouse position relative to canvas
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate the point in canvas-content coordinates before zoom
        const contentX = (mouseX - this.panX) / this.zoom;
        const contentY = (mouseY - this.panY) / this.zoom;

        // Update zoom
        this.zoom = newZoom;

        // Adjust pan so the point under the mouse stays in place
        this.panX = mouseX - contentX * this.zoom;
        this.panY = mouseY - contentY * this.zoom;

        this.updateCanvasTransform();
    }

    updateCanvasTransform() {
        if (this.canvasContent) {
            this.canvasContent.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom}) rotate(${this.rotation}deg)`;
        }
    }

    addCard(options) {
        const card = new Card(options);
        this.cards.set(card.id, card);
        this.canvasContent.appendChild(card.element);

        // Apply current settings to new card
        if (this.settings) {
            if (!this.settings.cardShadow) {
                card.element.style.filter = 'none';
            }
        }

        // Bind any interactive elements in this card
        this.bindInteractiveElements(card.element);

        return card;
    }

    async loadCardFromFile(cardName, positionOptions = {}) {
        try {
            // Add cache-busting query param for development
            const cacheBuster = `?t=${Date.now()}`;
            const response = await fetch(`cards/${cardName}.md${cacheBuster}`);
            if (!response.ok) {
                console.error(`Failed to load card: ${cardName}`);
                return null;
            }

            const markdown = await response.text();
            const parsed = this.parser.parse(markdown);

            // Get dimensions from options, then metadata, then defaults
            let width = positionOptions.width || parseInt(parsed.metadata.width) || 280;
            let height = positionOptions.height || parseInt(parsed.metadata.height) || 360;

            // Get position - if centered option is true, center on viewport
            let x, y;
            if (positionOptions.fillViewport) {
                // Fill most of the viewport with padding for background access
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const padding = 60; // Padding on each side for background access

                width = viewportWidth - (padding * 2);
                height = viewportHeight - (padding * 2);
                x = padding;
                y = padding;
            } else if (positionOptions.centered) {
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                x = viewportWidth / 2 - width / 2;
                y = viewportHeight / 2 - height / 2;
            } else {
                x = positionOptions.x !== undefined ? positionOptions.x : this.defaultOffset.x;
                y = positionOptions.y !== undefined ? positionOptions.y : this.defaultOffset.y;
            }

            // Assign incrementing page number
            const pageNumber = this.getNextPageNumber();

            // Check if this is an image card
            const isImageCard = parsed.metadata.image ? true : false;

            // Calculate rotation: counter-rotate to cancel canvas rotation,
            // so cards appear at their specified rotation relative to the screen.
            // This means cards appear "upright" (or at specified angle) regardless
            // of how the canvas is rotated.
            const cardRotation = (positionOptions.rotation || 0) - this.rotation;

            const cardOptions = {
                x: x,
                y: y,
                width: width,
                height: height,
                rotation: cardRotation,
                pageNumber: pageNumber,
                content: parsed.content,
                margins: parsed.margins,
                sourceFile: cardName,
                marginTB: positionOptions.marginTB,
                marginLR: positionOptions.marginLR
            };

            if (isImageCard) {
                cardOptions.image = parsed.metadata.image;
                cardOptions.caption = parsed.metadata.caption || '';
            }

            const card = this.addCard(cardOptions);
            card.sourceFile = cardName;

            // Add connection from parent card if exists
            if (positionOptions.parentCard) {
                this.addConnection(positionOptions.parentCard, card);
            }

            return card;

        } catch (error) {
            console.error(`Error loading card ${cardName}:`, error);
            return null;
        }
    }

    async openCard(cardName, parentCard = null, options = {}, clickEvent = null) {
        let x, y;
        const jitter = options.jitter || 0;

        // Determine position based on options
        if (options.absX !== null && options.absY !== null) {
            // Absolute positioning
            x = this.applyJitter(options.absX, jitter);
            y = this.applyJitter(options.absY, jitter);
        } else if (options.relX !== null && options.relY !== null && parentCard) {
            // Relative positioning from parent card
            x = this.applyJitter(parentCard.x + options.relX, jitter);
            y = this.applyJitter(parentCard.y + options.relY, jitter);
        } else if (clickEvent) {
            // Convert click position to canvas content coordinates
            const rect = this.canvas.getBoundingClientRect();
            const clickX = (clickEvent.clientX - rect.left - this.panX) / this.zoom;
            const clickY = (clickEvent.clientY - rect.top - this.panY) / this.zoom;
            x = this.applyJitter(clickX + 60, jitter || 40);
            y = this.applyJitter(clickY + 20, jitter || 40);
        } else if (parentCard) {
            // Default: position to the right of parent card
            x = this.applyJitter(parentCard.x + parentCard.width + 40, jitter || 20);
            y = this.applyJitter(parentCard.y, jitter || 20);
        } else {
            // Fallback position
            x = this.applyJitter(this.defaultOffset.x, jitter || 20);
            y = this.applyJitter(this.defaultOffset.y, jitter || 20);
        }

        await this.loadCardFromFile(cardName, {
            x: x,
            y: y,
            width: options.width,
            height: options.height,
            rotation: options.rotation,
            marginTB: options.marginTB,
            marginLR: options.marginLR,
            parentCard: parentCard  // Pass parent for connection tracking
        });
    }

    /**
     * Open an embedded URL in a card with an iframe
     */
    openEmbedCard(url, parentCard = null, options = {}, clickEvent = null) {
        let x, y;
        const jitter = options.jitter || 0;

        // Determine position (same logic as openCard)
        if (options.absX !== null && options.absY !== null) {
            x = this.applyJitter(options.absX, jitter);
            y = this.applyJitter(options.absY, jitter);
        } else if (options.relX !== null && options.relY !== null && parentCard) {
            x = this.applyJitter(parentCard.x + options.relX, jitter);
            y = this.applyJitter(parentCard.y + options.relY, jitter);
        } else if (clickEvent) {
            const rect = this.canvas.getBoundingClientRect();
            const clickX = (clickEvent.clientX - rect.left - this.panX) / this.zoom;
            const clickY = (clickEvent.clientY - rect.top - this.panY) / this.zoom;
            x = this.applyJitter(clickX + 60, jitter || 40);
            y = this.applyJitter(clickY + 20, jitter || 40);
        } else if (parentCard) {
            x = this.applyJitter(parentCard.x + parentCard.width + 40, jitter || 20);
            y = this.applyJitter(parentCard.y, jitter || 20);
        } else {
            x = this.applyJitter(this.defaultOffset.x, jitter || 20);
            y = this.applyJitter(this.defaultOffset.y, jitter || 20);
        }

        // Default size for embed cards
        const width = options.width || 600;
        const height = options.height || 450;

        // Calculate rotation
        const cardRotation = (options.rotation || 0) - this.rotation;

        // Assign page number
        const pageNumber = this.getNextPageNumber();

        const card = this.addCard({
            x: x,
            y: y,
            width: width,
            height: height,
            rotation: cardRotation,
            pageNumber: pageNumber,
            embedUrl: url
        });

        // Add connection from parent card if exists
        if (parentCard) {
            this.addConnection(parentCard, card);
        }

        return card;
    }

    initSettings() {
        // Load saved settings
        this.settings = {
            theme: localStorage.getItem('settings-theme') || 'light',
            fontSize: parseInt(localStorage.getItem('settings-fontSize')) || 12,
            lineHeight: parseFloat(localStorage.getItem('settings-lineHeight')) || 1.5,
            cardShadow: localStorage.getItem('settings-cardShadow') !== 'false',
            showHandles: localStorage.getItem('settings-showHandles') === 'true',
            showConnections: localStorage.getItem('settings-showConnections') === 'true',
            connectionsAbove: localStorage.getItem('settings-connectionsAbove') === 'true'
        };

        // Track connections between cards (parentId -> [childIds])
        this.connections = new Map();

        // Register actions that can be called by buttons
        this.actions = {
            resetSettings: () => this.resetSettings()
        };

        // Apply saved settings immediately
        this.applySettings();

        // Bind settings button
        const settingsBtn = document.getElementById('settings-btn');
        settingsBtn.addEventListener('click', () => this.openSettingsCard());
    }

    // Get a setting value
    getSetting(key) {
        return this.settings[key];
    }

    // Set a setting value and save to localStorage
    setSetting(key, value) {
        this.settings[key] = value;
        localStorage.setItem(`settings-${key}`, value);
        this.applySettings();

        // Update card shadows if that setting changed
        if (key === 'cardShadow') {
            this.updateCardShadows();
        }

        // Update handle visibility if that setting changed
        if (key === 'showHandles') {
            this.updateHandleVisibility();
        }

        // Update connections visibility if that setting changed
        if (key === 'showConnections') {
            this.updateConnectionsVisibility();
        }

        // Update connections layer position if that setting changed
        if (key === 'connectionsAbove') {
            this.updateConnectionsLayer();
        }
    }

    // Execute a registered action
    executeAction(actionName) {
        if (this.actions[actionName]) {
            this.actions[actionName]();
        }
    }

    /**
     * Bind interactive elements (toggles, sliders, buttons) in any card
     */
    bindInteractiveElements(cardElement) {
        // Bind toggles
        cardElement.querySelectorAll('.settings-toggle[data-bind]').forEach(toggle => {
            const bind = toggle.dataset.bind;
            const onValue = toggle.dataset.on || 'true';
            const offValue = toggle.dataset.off || 'false';

            // Set initial state - handle both string and boolean comparisons
            const currentValue = this.getSetting(bind);
            const isOn = String(currentValue) === String(onValue) ||
                         (onValue === 'true' && currentValue === true) ||
                         (onValue === 'dark' && currentValue === 'dark');
            toggle.classList.toggle('active', isOn);

            // Handle clicks
            toggle.addEventListener('click', () => {
                const isCurrentlyOn = toggle.classList.contains('active');
                // Convert to appropriate type
                let newValue = isCurrentlyOn ? offValue : onValue;
                if (newValue === 'true') newValue = true;
                if (newValue === 'false') newValue = false;

                this.setSetting(bind, newValue);
                toggle.classList.toggle('active', !isCurrentlyOn);
            });
        });

        // Bind sliders
        cardElement.querySelectorAll('.settings-slider[data-bind]').forEach(slider => {
            const bind = slider.dataset.bind;
            const suffix = slider.dataset.suffix || '';

            // Set initial value
            const currentValue = this.getSetting(bind);
            if (currentValue !== undefined) {
                slider.value = currentValue;
            }

            // Update display value
            const valueDisplay = cardElement.querySelector(`[data-value-for="${bind}"]`);
            if (valueDisplay) {
                valueDisplay.textContent = `${slider.value}${suffix}`;
            }

            // Handle input
            slider.addEventListener('input', () => {
                const value = slider.step && slider.step.includes('.')
                    ? parseFloat(slider.value)
                    : parseInt(slider.value);
                this.setSetting(bind, value);

                if (valueDisplay) {
                    valueDisplay.textContent = `${value}${suffix}`;
                }
            });
        });

        // Bind buttons
        cardElement.querySelectorAll('.settings-btn-action[data-action]').forEach(button => {
            const action = button.dataset.action;

            button.addEventListener('click', () => {
                this.executeAction(action);

                // Re-sync all interactive elements in this card after action
                this.syncInteractiveElements(cardElement);
            });
        });
    }

    /**
     * Sync interactive element states with current settings (after reset, etc.)
     */
    syncInteractiveElements(cardElement) {
        // Sync toggles
        cardElement.querySelectorAll('.settings-toggle[data-bind]').forEach(toggle => {
            const bind = toggle.dataset.bind;
            const onValue = toggle.dataset.on || 'true';
            const currentValue = this.getSetting(bind);
            const isOn = String(currentValue) === String(onValue) ||
                         (onValue === 'true' && currentValue === true) ||
                         (onValue === 'dark' && currentValue === 'dark');
            toggle.classList.toggle('active', isOn);
        });

        // Sync sliders
        cardElement.querySelectorAll('.settings-slider[data-bind]').forEach(slider => {
            const bind = slider.dataset.bind;
            const suffix = slider.dataset.suffix || '';
            const currentValue = this.getSetting(bind);

            if (currentValue !== undefined) {
                slider.value = currentValue;
            }

            const valueDisplay = cardElement.querySelector(`[data-value-for="${bind}"]`);
            if (valueDisplay) {
                valueDisplay.textContent = `${slider.value}${suffix}`;
            }
        });
    }

    applySettings() {
        // Theme
        if (this.settings.theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }

        // Font size
        document.documentElement.style.setProperty('--font-size-base', `${this.settings.fontSize}px`);

        // Line height
        document.documentElement.style.setProperty('--line-height-base', this.settings.lineHeight);

        // Card shadow
        if (!this.settings.cardShadow) {
            document.documentElement.style.setProperty('--card-shadow-opacity', '0');
        } else {
            document.documentElement.style.removeProperty('--card-shadow-opacity');
        }

        // Handle visibility
        this.updateHandleVisibility();
    }

    saveSetting(key, value) {
        this.settings[key] = value;
        localStorage.setItem(`settings-${key}`, value);
        this.applySettings();
    }

    async openSettingsCard() {
        // Check if settings card already exists
        const existingSettings = document.querySelector('.card[data-settings-card]');
        if (existingSettings) {
            // Bring existing card to front
            const card = this.cards.get(existingSettings.id);
            if (card) card.bringToFront();
            return;
        }

        // Calculate position further from the corner
        const btnRect = document.getElementById('settings-btn').getBoundingClientRect();
        const x = (btnRect.left + 100 - this.panX) / this.zoom;
        const y = (btnRect.top - 450 - this.panY) / this.zoom;

        // Load settings card from file
        const card = await this.loadCardFromFile('settings', {
            x: x,
            y: Math.max(40, y)
        });

        if (card) {
            card.element.setAttribute('data-settings-card', 'true');
        }
    }

    updateCardShadows() {
        document.querySelectorAll('.card').forEach(cardEl => {
            if (this.settings.cardShadow) {
                cardEl.style.removeProperty('filter');
            } else {
                cardEl.style.filter = 'none';
            }
        });
    }

    updateHandleVisibility() {
        const show = this.settings.showHandles;
        document.documentElement.style.setProperty('--handle-display', show ? 'block' : 'none');
    }

    initConnectionsLayer() {
        // Create SVG layer for connection lines
        this.connectionsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.connectionsSvg.classList.add('connections-layer');
        this.connectionsSvg.innerHTML = `
            <defs>
                <filter id="connection-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.4)"/>
                </filter>
            </defs>
        `;
        this.canvasContent.insertBefore(this.connectionsSvg, this.canvasContent.firstChild);

        // Update visibility and layer position based on settings
        this.updateConnectionsVisibility();
        this.updateConnectionsLayer();
    }

    updateConnectionsVisibility() {
        if (this.connectionsSvg) {
            this.connectionsSvg.style.display = this.settings.showConnections ? 'block' : 'none';
        }
    }

    updateConnectionsLayer() {
        if (this.connectionsSvg) {
            // z-index 0 = below cards, z-index 9999 = above cards
            this.connectionsSvg.style.zIndex = this.settings.connectionsAbove ? '9999' : '0';
        }
    }

    addConnection(parentCard, childCard) {
        if (!parentCard || !childCard) return;

        const parentId = parentCard.id;
        const childId = childCard.id;

        // Track the connection
        if (!this.connections.has(parentId)) {
            this.connections.set(parentId, new Set());
        }
        this.connections.get(parentId).add(childId);

        // Create the SVG line
        this.createConnectionLine(parentId, childId);

        // Update position immediately
        this.updateConnectionLine(parentId, childId);
    }

    createConnectionLine(parentId, childId) {
        const lineId = `connection-${parentId}-${childId}`;

        // Don't create duplicate lines
        if (this.connectionsSvg.querySelector(`#${CSS.escape(lineId)}`)) return;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.id = lineId;
        line.classList.add('connection-line');
        line.setAttribute('filter', 'url(#connection-shadow)');
        this.connectionsSvg.appendChild(line);
    }

    updateConnectionLine(parentId, childId) {
        const lineId = `connection-${parentId}-${childId}`;
        const line = this.connectionsSvg.querySelector(`#${CSS.escape(lineId)}`);
        if (!line) return;

        const parentCard = this.cards.get(parentId);
        const childCard = this.cards.get(childId);

        if (!parentCard || !childCard) {
            // One of the cards was deleted, remove the line
            line.remove();
            return;
        }

        // Calculate top center points accounting for rotation
        const parentPos = this.getCardTopCenter(parentCard);
        const childPos = this.getCardTopCenter(childCard);

        line.setAttribute('x1', parentPos.x);
        line.setAttribute('y1', parentPos.y);
        line.setAttribute('x2', childPos.x);
        line.setAttribute('y2', childPos.y);
    }

    getCardTopCenter(card) {
        // Get slightly below top center of the card, accounting for rotation
        const centerX = card.x + card.width / 2;
        const centerY = card.y + card.height / 2;

        // Slightly below top center (offset by 10px from top edge)
        const topCenterRelX = 0;
        const topCenterRelY = -card.height / 2 + 10;

        // Apply rotation
        const rad = card.rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const rotatedX = topCenterRelX * cos - topCenterRelY * sin;
        const rotatedY = topCenterRelX * sin + topCenterRelY * cos;

        return {
            x: centerX + rotatedX,
            y: centerY + rotatedY
        };
    }

    updateAllConnections() {
        this.connections.forEach((children, parentId) => {
            children.forEach(childId => {
                this.updateConnectionLine(parentId, childId);
            });
        });
    }

    removeConnectionsForCard(cardId) {
        // Remove connections where this card is the parent
        if (this.connections.has(cardId)) {
            this.connections.get(cardId).forEach(childId => {
                const lineId = `connection-${cardId}-${childId}`;
                const line = this.connectionsSvg.querySelector(`#${CSS.escape(lineId)}`);
                if (line) line.remove();
            });
            this.connections.delete(cardId);
        }

        // Remove connections where this card is the child
        this.connections.forEach((children, parentId) => {
            if (children.has(cardId)) {
                children.delete(cardId);
                const lineId = `connection-${parentId}-${cardId}`;
                const line = this.connectionsSvg.querySelector(`#${CSS.escape(lineId)}`);
                if (line) line.remove();
            }
        });
    }

    resetSettings() {
        this.settings = {
            theme: 'light',
            fontSize: 12,
            lineHeight: 1.5,
            cardShadow: true,
            showHandles: false,
            showConnections: false,
            connectionsAbove: false
        };

        // Clear localStorage
        Object.keys(this.settings).forEach(key => {
            localStorage.removeItem(`settings-${key}`);
        });

        this.applySettings();
        this.updateCardShadows();
        this.updateHandleVisibility();
    }

    // Export all cards to JSON
    exportCards() {
        const cardsArray = [];
        this.cards.forEach(card => {
            cardsArray.push(card.toJSON());
        });
        return JSON.stringify(cardsArray, null, 2);
    }
}

// Initialize application
const app = new PaperCanvas();

// Expose to window for debugging
window.paperCanvas = app;

// Helper to load a card programmatically
window.openCard = (cardName, options = {}) => {
    return app.loadCardFromFile(cardName, options);
};
