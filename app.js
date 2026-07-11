import { Card } from './Card.js';
import { MarkdownParser } from './MarkdownParser.js';
import { CardCrypto } from './Crypto.js';
import { controlsManager, SettingsConfig } from './Controls.js';
import { vizManager } from './Visualizations.js';
import { Z_INDEX_BASE, Z_INDEX_CARD_CAP, CARD_DEFAULT_WIDTH, CARD_TEMPLATE_WIDTH, CARD_TEMPLATE_HEIGHT, DEFAULT_MARGIN_PERCENT, SPLIT_DIVIDER_SIZE, SPLIT_MIN_PANE_RATIO, isMobile } from './constants.js';

// Editor is loaded dynamically only on localhost

/**
 * FileWatcherClient - Connects to WebSocket server for live markdown updates
 */
class FileWatcherClient {
    constructor(paperCanvas) {
        this.canvas = paperCanvas;
        this.ws = null;
        this.watchedFiles = new Set();
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.connected = false;
        this.enabled = true;
    }

    connect() {
        if (!this.enabled) return;

        // WebSocket server runs on HTTP port + 1
        const port = location.port || '8000';
        const wsPort = parseInt(port) + 1;
        const wsUrl = `ws://${location.hostname || 'localhost'}:${wsPort}`;

        console.log(`Live-reload: Connecting to ${wsUrl}...`);

        try {
            this.ws = new WebSocket(wsUrl);
        } catch (e) {
            console.log('Live-reload: WebSocket not available -', e.message);
            this.enabled = false;
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            this.reconnectDelay = 1000;
            console.log('Live-reload: Connected');

            // Re-subscribe to watched files after reconnect
            this.watchedFiles.forEach(file => {
                this.sendWatch(file);
            });
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'update') {
                    this.handleFileUpdate(data.file, data.content);
                }
            } catch (e) {
                console.error('Live-reload: Error parsing message', e);
            }
        };

        this.ws.onclose = (event) => {
            if (this.connected) {
                console.log('Live-reload: Disconnected, reconnecting...');
            } else {
                console.log(`Live-reload: Connection failed (code: ${event.code})`);
            }
            this.connected = false;

            // Exponential backoff reconnection
            if (this.enabled) {
                setTimeout(() => this.connect(), this.reconnectDelay);
                this.reconnectDelay = Math.min(
                    this.reconnectDelay * 2,
                    this.maxReconnectDelay
                );
            }
        };

        this.ws.onerror = (error) => {
            console.log('Live-reload: WebSocket error', error);
        };
    }

    sendWatch(fileName) {
        if (this.connected && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'watch',
                file: fileName
            }));
        }
    }

    watch(fileName) {
        if (!fileName || this.watchedFiles.has(fileName)) return;

        this.watchedFiles.add(fileName);
        this.sendWatch(fileName);
    }

    unwatch(fileName) {
        if (!fileName || !this.watchedFiles.has(fileName)) return;

        this.watchedFiles.delete(fileName);
        if (this.connected && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'unwatch',
                file: fileName
            }));
        }
    }

    handleFileUpdate(fileName, content) {
        // Find all cards displaying this file and update them
        this.canvas.updateCardsWithFile(fileName, content);
    }
}

class PaperCanvas {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.canvasContent = document.getElementById('canvas-content');
        this.cards = new Map();
        this.parser = new MarkdownParser();

        // Security: Check if running locally
        this.isLocal = this.checkIsLocal();

        // Crypto for private/encrypted cards
        this.crypto = new CardCrypto();

        // Global page counter - increments for each new card
        this.pageCounter = 0;

        // Z-index counter - ensures new cards always appear on top
        this.zIndexCounter = Z_INDEX_BASE;

        // Comprehensive tag index - built from all files at startup
        this.globalTagIndex = {}; // Subtags (for specific tag pages)
        this.mainTagIndex = {};   // Main tags (for overview)
        this.fileTagCache = new Map(); // Cache file metadata to avoid re-parsing

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

        // Split mode state
        this.isSplitMode = false;
        this.splitRoot = null;
        this.splitContainer = null;
        this.splitModeInitialCard = null;
        this.splitClickHandler = null;
        this.splitDeleteHandler = null;
        this.splitTagClickHandler = null;

        // Live-reload file watcher
        this.fileWatcher = new FileWatcherClient(this);

        // Editor support - initialized dynamically on localhost only
        this.fsManager = null;
        this.editorCards = new Map();

        this.init();
    }

    async init() {
        this.bindCanvasEvents();
        this.initSettings();
        this.initConnectionsLayer();
        this.initEditor();

        // Load drop cap metrics for per-letter spacing
        this.loadDropcapMetrics();

        // Connect to live-reload WebSocket server
        this.fileWatcher.connect();

        // Build tag index in background (don't block initial render)
        this.tagIndexReady = this.buildGlobalTagIndex();

        this.initContentProviders();

        // Bind browser history navigation
        window.addEventListener('popstate', (e) => this.handlePopState(e));

        // Bind hash change for direct URL edits (address bar changes)
        window.addEventListener('hashchange', () => this.handleHashChange());

        // Bind viewport resize for split mode
        window.addEventListener('resize', () => this.handleResize());

        // Custom right-click / long-press menu on card links
        this.bindContextMenu();

        // Route to the card named by the URL; default to the menu
        const urlInfo = this.getCardNameFromURL();
        await this.showCard(urlInfo?.cardName || 'menu', false, urlInfo?.headingId || null);
    }

    /**
     * Check if running on localhost/local environment
     * Used to enable editor and other dev-only features
     */
    checkIsLocal() {
        const hostname = location.hostname;
        return hostname === 'localhost' ||
               hostname === '127.0.0.1' ||
               hostname === '' ||  // file:// protocol
               hostname.endsWith('.local');
    }

    getCardNameFromURL() {
        // Extract the raw target from pathname, hash, or ?page= (priority order)
        let raw = decodeURIComponent(window.location.pathname.replace(/^\/+|\/+$/g, ''));
        if (!raw) raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
        if (!raw) raw = decodeURIComponent(new URLSearchParams(window.location.search).get('page') || '');
        if (!raw) return null;

        // Legacy snapshot links (v/…) don't map to a single page — fall back to the menu
        if (raw.startsWith('v/')) return null;
        // Strip legacy mode prefixes: r/ (reader), c/ (canvas), s/ (split)
        raw = raw.replace(/^[rcs]\//, '');
        // Legacy multi-card URLs were ~-joined; the first card is the page
        if (raw.includes('~')) raw = raw.split('~')[0];

        const [cardName, headingId] = this.parseCardAndHeading(raw);
        return { cardName, headingId };
    }

    /**
     * Parse a URL path segment into card name and optional heading ID.
     * E.g., "journal/day-one" → ["journal", "day-one"]
     *       "journal" → ["journal", null]
     */
    parseCardAndHeading(path) {
        const slashIndex = path.indexOf('/');
        if (slashIndex === -1) {
            return [path, null];
        }
        if (this.manifestCards?.has(path)) {
            return [path, null];
        }
        const cardName = path.slice(0, slashIndex);
        const headingId = path.slice(slashIndex + 1) || null;
        return [cardName, headingId];
    }

    /**
     * Scroll to a heading within a card's content area.
     */
    scrollToHeadingInCard(card, headingId) {
        // Small delay to ensure DOM is fully rendered
        setTimeout(() => {
            const contentContainer = card.element.querySelector('.card-content');
            const targetElement = card.element.querySelector(`#${CSS.escape(headingId)}`);
            if (contentContainer && targetElement) {
                const containerRect = contentContainer.getBoundingClientRect();
                const targetRect = targetElement.getBoundingClientRect();
                const scrollOffset = targetRect.top - containerRect.top + contentContainer.scrollTop;
                contentContainer.scrollTo({
                    top: scrollOffset - 10,
                    behavior: 'smooth'
                });
            }
        }, 100);
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
            width: CARD_TEMPLATE_WIDTH,
            height: CARD_TEMPLATE_WIDTH
        });
    }



    bindCanvasEvents() {
        // Canvas panning with left mouse on empty space
        this.canvas.addEventListener('mousedown', (e) => {
            // Check if clicking on a card or its children
            const isCard = e.target.closest('.card');

            // Ignore canvas interactions when locked (split mode)
            if (this.canvasLocked) return;

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
            // Ignore canvas interactions when locked (split mode)
            if (this.canvasLocked) return;
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
            if (this.canvasLocked) return;
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
            this.scheduleLayoutSave();
        });

        // Zoom with scroll wheel (only when not over a card)
        this.canvas.addEventListener('wheel', (e) => {
            if (this.canvasLocked) return;
            const isCard = e.target.closest('.card');
            if (!isCard) {
                e.preventDefault();
                this.zoomCanvas(e);
            }
        }, { passive: false });

        // Handle card deletion
        this.canvas.addEventListener('card-delete', (e) => {
            const cardId = e.detail.cardId;
            const card = this.cards.get(cardId);

            // Split mode: close the pane containing this card
            if (this.isSplitMode) {
                e.preventDefault();
                const pane = card?.element?.closest('.split-pane');
                if (pane) {
                    const leafNode = this.findSplitLeafByElement(pane);
                    if (leafNode) {
                        this.pushNavigationState();
                        this.closeSplitPane(leafNode);
                    }
                }
                return;
            }

            this.pushNavigationState();

            // Cleanup file watcher if no other cards display this file
            if (card && card.sourceFile && !card.isDynamic) {
                const sourceFile = card.sourceFile;
                // Count cards displaying this file (excluding the one being deleted)
                let count = 0;
                this.cards.forEach(c => {
                    if (c.id !== cardId && c.sourceFile === sourceFile) {
                        count++;
                    }
                });
                if (count === 0) {
                    this.fileWatcher.unwatch(sourceFile);
                }
            }

            // Remove connections for this card
            this.removeConnectionsForCard(cardId);

            this.cards.delete(cardId);

            // Update URL to reflect remaining cards
            this.updateURLWithOpenCards();

            // If no cards remain, respawn the menu card
            if (this.cards.size === 0) {
                this.loadMenuCard();
            }
        });

        // Handle card link clicks
        this.canvas.addEventListener('click', async (e) => {
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
                    // Handle tag-* links by registering the page first
                    if (cardName.startsWith('tag-')) {
                        const tagName = cardName.slice(4); // Remove 'tag-' prefix
                        this.registerTagPage(tagName, parentCard);
                    }
                    // Open a card file
                    this.pushNavigationState();
                    this.openCard(cardName, parentCard, options, e);
                }
            }
        });

        // Handle tag clicks
        this.canvas.addEventListener('tag-click', async (e) => {
            const { tagName, card } = e.detail;

            // Register the tag page dynamically
            const tagCardName = this.registerTagPage(tagName, card);

            // Remove any existing tag page for this tag to ensure fresh positioning
            const existingTagCard = Array.from(this.cards.values()).find(c =>
                c.sourceFile === `dynamic:tag-${tagName}`
            );
            if (existingTagCard) {
                this.removeCard(existingTagCard.id);
            }

            // Calculate random position at click time - make it more dramatic
            const randomOffsetX = (Math.random() - 0.5) * 400; // ±200px
            const randomOffsetY = (Math.random() - 0.5) * 600; // ±300px

            // Open the tag page using the standard card opening system
            this.pushNavigationState();
            this.openCard(tagCardName, card, {
                width: 300,
                height: 300,
                relX: card.width + 50 + randomOffsetX,
                relY: randomOffsetY,
                jitter: 50 // Add some additional jitter on top
            });
        });

        // Handle jump link clicks for intra-card navigation
        this.canvas.addEventListener('click', (e) => {
            const jumpLink = e.target.closest('.jump-link');

            if (jumpLink) {
                e.preventDefault();
                const targetId = jumpLink.dataset.jumpTarget;
                const sourceCard = jumpLink.closest('.card');

                if (sourceCard && targetId) {
                    this.jumpToAnchor(sourceCard, targetId);
                }
            }
        });

        // Handle TOC link clicks for scrolling to headings
        this.canvas.addEventListener('click', (e) => {
            const tocLink = e.target.closest('[data-toc-target]');

            if (tocLink) {
                e.preventDefault();
                e.stopPropagation();
                const targetId = tocLink.dataset.tocTarget;
                const cardElement = tocLink.closest('.card');

                if (cardElement && targetId) {
                    const contentContainer = cardElement.querySelector('.card-content');
                    const targetElement = cardElement.querySelector(`#${CSS.escape(targetId)}`);
                    if (contentContainer && targetElement) {
                        // Calculate offset within the scrollable container
                        const containerRect = contentContainer.getBoundingClientRect();
                        const targetRect = targetElement.getBoundingClientRect();
                        const scrollOffset = targetRect.top - containerRect.top + contentContainer.scrollTop;

                        // Scroll only the content container, not the whole page
                        contentContainer.scrollTo({
                            top: scrollOffset - 10, // Small offset from top
                            behavior: 'smooth'
                        });

                        // Update URL with heading ID
                        const cardId = cardElement.dataset.cardId;
                        const card = this.cards.get(cardId);
                        if (card && card.sourceFile) {
                            const newUrl = `#/c/${card.sourceFile}/${targetId}`;
                            window.history.pushState(
                                { cardName: card.sourceFile, headingId: targetId },
                                '',
                                newUrl
                            );
                        }
                    }
                }
            }
        });

        // Handle TOC link taps on mobile (touchend for better mobile support)
        // Track touch start position to distinguish taps from scrolls
        let tocTouchStartY = null;
        let tocTouchStartX = null;
        let tocTouchTarget = null;

        this.canvas.addEventListener('touchstart', (e) => {
            const tocLink = e.target.closest('[data-toc-target]');
            if (tocLink) {
                tocTouchStartY = e.touches[0].clientY;
                tocTouchStartX = e.touches[0].clientX;
                tocTouchTarget = tocLink;
            } else {
                tocTouchTarget = null;
            }
        }, { passive: true });

        this.canvas.addEventListener('touchend', (e) => {
            if (!tocTouchTarget) return;

            const tocLink = e.target.closest('[data-toc-target]');
            if (!tocLink || tocLink !== tocTouchTarget) {
                tocTouchTarget = null;
                return;
            }

            // Check if this was a tap (minimal movement) vs a scroll
            const touchEndY = e.changedTouches[0].clientY;
            const touchEndX = e.changedTouches[0].clientX;
            const deltaY = Math.abs(touchEndY - tocTouchStartY);
            const deltaX = Math.abs(touchEndX - tocTouchStartX);

            // If touch moved more than 10px, it's a scroll, not a tap
            if (deltaY > 10 || deltaX > 10) {
                tocTouchTarget = null;
                return;
            }

            e.preventDefault();
            const targetId = tocLink.dataset.tocTarget;
            const cardElement = tocLink.closest('.card');

            if (cardElement && targetId) {
                const contentContainer = cardElement.querySelector('.card-content');
                const targetElement = cardElement.querySelector(`#${CSS.escape(targetId)}`);
                if (contentContainer && targetElement) {
                    // Calculate offset within the scrollable container
                    const containerRect = contentContainer.getBoundingClientRect();
                    const targetRect = targetElement.getBoundingClientRect();
                    const scrollOffset = targetRect.top - containerRect.top + contentContainer.scrollTop;

                    // Scroll only the content container, not the whole page
                    contentContainer.scrollTo({
                        top: scrollOffset - 10,
                        behavior: 'smooth'
                    });

                    // Update URL with heading ID
                    const cardId = cardElement.dataset.cardId;
                    const card = this.cards.get(cardId);
                    if (card && card.sourceFile) {
                        const newUrl = `#/c/${card.sourceFile}/${targetId}`;
                        window.history.pushState(
                            { cardName: card.sourceFile, headingId: targetId },
                            '',
                            newUrl
                        );
                    }
                }
            }

            tocTouchTarget = null;
        });

        // Handle heading link clicks to copy URL to clipboard
        this.canvas.addEventListener('click', (e) => {
            const headingLink = e.target.closest('.heading-link');

            if (headingLink) {
                e.preventDefault();
                e.stopPropagation();
                const headingId = headingLink.dataset.headingId;
                const cardElement = headingLink.closest('.card');

                if (cardElement && headingId) {
                    const cardId = cardElement.dataset.cardId;
                    const card = this.cards.get(cardId);
                    if (card && card.sourceFile) {
                        const url = `${window.location.origin}${window.location.pathname}#/c/${card.sourceFile}/${headingId}`;
                        navigator.clipboard.writeText(url).catch(err => {
                            console.error('Failed to copy link:', err);
                        });
                    }
                }
            }
        });

        // Listen for card state changes (from Card.js events)
        this.canvas.addEventListener('card-state-changed', () => {
            this.scheduleSave();
        });

        // Listen for margin size changes from card drag (to sync with global setting)
        this.canvas.addEventListener('margin-size-changed', (e) => {
            const { marginPercent } = e.detail;
            // Update the global setting without triggering card updates (already updated)
            this.settings.marginSize = marginPercent;
            localStorage.setItem('settings-marginSize', marginPercent);
            // Sync settings UI if any settings cards are open
            this.syncAllSettingsCards();
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
        // Schedule state save for canvas transform changes
        this.scheduleSave();
    }

    addCard(options) {
        const card = new Card(options);
        this.cards.set(card.id, card);

        this.canvasContent.appendChild(card.element);

        // Ensure this card appears on top by assigning highest z-index
        this.zIndexCounter++;
        card.zIndex = this.zIndexCounter;
        card.element.style.zIndex = this.zIndexCounter;

        // Apply current settings to new card
        if (this.settings) {
            if (!this.settings.cardShadow) {
                card.element.style.filter = 'none';
            }
            // Apply global margin size if no custom margins were specified
            if (card.marginTB === null && card.marginLR === null && this.settings.marginSize !== undefined) {
                card.updateMarginSize(this.settings.marginSize);
            }
        }

        // Bind any interactive elements in this card
        this.bindInteractiveElements(card.element);

        // Schedule state save
        this.scheduleSave();

        // Update URL to reflect open cards
        this.updateURLWithOpenCards();

        return card;
    }

    /**
     * Create a new card programmatically (for editor use)
     * @param {Object} options - Card options including x, y, width, height, content, margins
     * @returns {Card} The created card
     */
    createCard(options = {}) {
        const pageNumber = this.getNextPageNumber();

        const cardOptions = {
            x: options.x || this.defaultOffset.x,
            y: options.y || this.defaultOffset.y,
            width: options.width || CARD_TEMPLATE_WIDTH,
            height: options.height || CARD_TEMPLATE_HEIGHT,
            rotation: options.rotation || 0,
            pageNumber: pageNumber,
            content: options.content || '',
            margins: options.margins || { left: [], right: [], top: [], bottom: [] },
            sourceFile: options.sourceFile || null,
            isDynamic: options.isDynamic || false,
            progressBar: options.progressBar || false,
            wordCount: options.wordCount || false,
            readTime: options.readTime || false,
            tags: options.tags || [],
            ...options.extra,
        };

        return this.addCard(cardOptions);
    }

    /**
     * Get all cards displaying content from a specific source file
     */
    getCardsDisplayingFile(fileName) {
        const matchingCards = [];
        this.cards.forEach(card => {
            if (card.sourceFile === fileName) {
                matchingCards.push(card);
            }
        });
        return matchingCards;
    }

    /**
     * Update all cards displaying a file with new content (for live-reload)
     */
    updateCardsWithFile(fileName, markdownContent) {
        const cards = this.getCardsDisplayingFile(fileName);
        if (cards.length === 0) return;

        // Parse the new content
        const parsed = this.parser.parse(markdownContent);
        if (!parsed) return;

        // Update each card while preserving state
        cards.forEach(card => {
            card.setContent(parsed);
            // Re-bind interactive elements after content update
            this.bindInteractiveElements(card.element);
            // Re-run companion script on new DOM
            this.loadCardScript(fileName, card.element);
        });

        console.log(`Live-reload: Updated ${cards.length} card(s) displaying "${fileName}"`);
    }

    // Content provider system - abstraction layer for card content
    async getCardContent(cardName) {
        // Check if this is a dynamic content provider
        if (this.contentProviders && this.contentProviders[cardName]) {
            return await this.contentProviders[cardName]();
        }

        // In production, only allow cards listed in the manifest
        if (!this.isLocal) {
            await this.tagIndexReady;
            if (this.manifestCards && !this.manifestCards.has(cardName)) {
                console.warn(`Card "${cardName}" is not available`);
                return null;
            }
        }

        // Default: load from markdown file
        try {
            const cacheBuster = this.isLocal ? `?t=${Date.now()}` : '';
            const response = await fetch(`cards/${cardName}.md${cacheBuster}`);
            if (!response.ok) {
                console.error(`Failed to load card: ${cardName}`);
                return null;
            }

            let markdown = await response.text();

            // Check if content is encrypted
            const frontmatterMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
            if (frontmatterMatch) {
                const frontmatter = frontmatterMatch[1];
                if (frontmatter.includes('encrypted: true')) {
                    // Extract encryption data but don't prompt yet
                    const saltMatch = frontmatter.match(/salt:\s*(.+)/);
                    const ivMatch = frontmatter.match(/iv:\s*(.+)/);
                    const ciphertext = frontmatterMatch[2].trim();

                    if (saltMatch && ivMatch) {
                        // Parse metadata from frontmatter for card sizing
                        const metadata = this.parseFrontmatterMetadata(frontmatter);

                        return {
                            content: null,
                            isDynamic: false,
                            sourceFile: cardName,
                            isEncrypted: true,
                            encryptedData: {
                                salt: saltMatch[1].trim(),
                                iv: ivMatch[1].trim(),
                                ciphertext: ciphertext,
                                originalFrontmatter: frontmatter
                            },
                            metadata: metadata
                        };
                    }
                }
            }

            return {
                content: markdown,
                isDynamic: false,
                sourceFile: cardName
            };
        } catch (error) {
            console.error(`Error loading card ${cardName}:`, error);
            return null;
        }
    }

    /**
     * Parse frontmatter string into metadata object
     */
    parseFrontmatterMetadata(frontmatter) {
        const metadata = {};
        const lines = frontmatter.split('\n');
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.*)$/);
            if (match) {
                metadata[match[1]] = match[2].trim();
            }
        }
        return metadata;
    }

    /**
     * Try to auto-decrypt with cached password
     * Returns decrypted body or null if no cached password or it failed
     */
    async tryAutoDecrypt(encryptedData) {
        const password = this.crypto.getCachedPassword();
        if (!password) return null;

        try {
            return await this.crypto.decrypt(encryptedData, password);
        } catch (e) {
            // Cached password didn't work, clear it
            this.crypto.clearPassword();
            return null;
        }
    }

    /**
     * Reconstruct markdown with decrypted content
     * Preserves original metadata (width, height, tags) but removes encryption fields
     */
    reconstructDecryptedMarkdown(encryptedFrontmatter, decryptedBody) {
        // Remove encryption-specific fields from frontmatter
        const cleanedFrontmatter = encryptedFrontmatter
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                return !trimmed.startsWith('encrypted:') &&
                       !trimmed.startsWith('salt:') &&
                       !trimmed.startsWith('iv:');
            })
            .join('\n')
            .trim();

        // Ensure body doesn't have excessive leading newlines
        const cleanedBody = decryptedBody.replace(/^\n+/, '\n');

        return `---\n${cleanedFrontmatter}\n---\n${cleanedBody}`;
    }

    /**
     * Create a locked card for encrypted content
     * Shows password input instead of content
     */
    createLockedCard(cardName, contentData, positionOptions) {
        const metadata = contentData.metadata || {};

        // Get dimensions from metadata
        let width = positionOptions.width || parseInt(metadata.width) || 280;
        let height = positionOptions.height || parseInt(metadata.height) || 360;

        // Calculate position
        let x, y;
        if (positionOptions.fillViewport) {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const padding = 60;
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

        const pageNumber = this.getNextPageNumber();
        const cardRotation = (positionOptions.rotation || 0) - this.rotation;

        // Create locked content HTML - minimal, just a password input
        const lockedContent = `
            <div class="locked-card-content">
                <input type="password" class="locked-password-input" placeholder="Password">
                <div class="locked-error"></div>
            </div>
        `;

        const card = this.addCard({
            x: x,
            y: y,
            width: width,
            height: height,
            rotation: cardRotation,
            pageNumber: pageNumber,
            content: lockedContent,
            margins: { left: [], right: [], top: [], bottom: [] },
            sourceFile: contentData.sourceFile,
            marginTB: positionOptions.marginTB,
            marginLR: positionOptions.marginLR,
            // Disable features for locked cards
            progressBar: false,
            wordCount: false,
            readTime: false,
            showTags: false,
            tags: [],
            isDynamic: false
        });

        // Store encrypted data on card for later unlock
        card.encryptedData = contentData.encryptedData;
        card.originalMetadata = metadata;
        card.isLocked = true;

        // Bind unlock event handlers
        this.bindLockedCardEvents(card);

        // Add connection from parent if exists
        if (positionOptions.parentCard) {
            this.addConnection(positionOptions.parentCard, card);
        }

        return card;
    }

    /**
     * Bind event handlers for locked card password input
     */
    bindLockedCardEvents(card) {
        const cardElement = card.element;
        const input = cardElement.querySelector('.locked-password-input');
        const errorDiv = cardElement.querySelector('.locked-error');

        if (!input || !errorDiv) return;

        const tryUnlock = async () => {
            const password = input.value;
            if (!password) return;

            // Disable input during attempt
            input.disabled = true;

            try {
                const decryptedBody = await this.crypto.decrypt(card.encryptedData, password);

                // Success! Cache password for other encrypted cards
                this.crypto.cachePassword(password);

                // Reconstruct full markdown
                const fullMarkdown = this.reconstructDecryptedMarkdown(
                    card.encryptedData.originalFrontmatter,
                    decryptedBody
                );

                // Parse and update card content
                const parsed = this.parser.parse(fullMarkdown);
                if (parsed) {
                    card.setContent(parsed);
                    card.isLocked = false;

                    // Re-bind interactive elements
                    this.bindInteractiveElements(card.element);
                }

            } catch (e) {
                // Wrong password
                errorDiv.textContent = 'Wrong password';
                errorDiv.classList.add('visible');
                input.value = '';
                input.disabled = false;
                input.focus();
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') tryUnlock();
            // Hide error when typing
            errorDiv.classList.remove('visible');
        });

        // Focus input when card is created
        setTimeout(() => input.focus(), 100);
    }

    // Build comprehensive tag index from ALL card files at startup
    async buildGlobalTagIndex() {
        let manifest = null;

        // Load manifest (single request)
        const cacheBuster = this.isLocal ? `?t=${Date.now()}` : '';
        try {
            const response = await fetch(`cards/manifest.json${cacheBuster}`);
            if (response.ok) {
                manifest = await response.json();
            }
        } catch (e) {
            console.warn('Failed to load manifest.json:', e);
        }

        if (!manifest || !manifest.cards || manifest.cards.length === 0) {
            console.warn('No cards found');
            return;
        }

        this.globalTagIndex = {};
        this.mainTagIndex = {};
        this.manifestCards = new Set(manifest.cards);
        this.fileTagCache.clear();

        // Use pre-built metadata from manifest (no individual file fetches needed)
        const metadata = manifest.metadata || {};

        for (const cardName of manifest.cards) {
            const meta = metadata[cardName];
            if (!meta || !meta.tags || meta.encrypted) continue;

            const displayName = meta.name || cardName;
            let dateValue = null;
            if (meta.date) {
                const [month, day, year] = meta.date.split('-').map(Number);
                dateValue = new Date(year, month - 1, day);
            }

            const tagsStr = meta.tags;
            const tagPairPattern = /\[([^,\]]+),\s*([^\]]+)\]/g;
            const subtags = [];
            const mainTags = [];
            const subtagToMain = {};

            let match;
            while ((match = tagPairPattern.exec(tagsStr)) !== null) {
                const subtag = match[1].trim();
                const mainTag = match[2].trim();

                if (!subtags.includes(subtag)) subtags.push(subtag);
                if (!mainTags.includes(mainTag)) mainTags.push(mainTag);

                if (!subtagToMain[subtag]) subtagToMain[subtag] = [];
                if (!subtagToMain[subtag].includes(mainTag)) {
                    subtagToMain[subtag].push(mainTag);
                }
            }

            const cardData = {
                tags: subtags,
                mainTags: mainTags,
                subtagToMain: subtagToMain,
                sourceFile: cardName,
                title: displayName,
                date: dateValue
            };

            this.fileTagCache.set(cardName, cardData);

            subtags.forEach(tag => {
                if (!this.globalTagIndex[tag]) {
                    this.globalTagIndex[tag] = [];
                }
                this.globalTagIndex[tag].push(cardData);
            });

            mainTags.forEach(mainTag => {
                if (!this.mainTagIndex[mainTag]) {
                    this.mainTagIndex[mainTag] = [];
                }
                this.mainTagIndex[mainTag].push(cardData);
            });
        }
    }

    // Get cards with a specific tag from the global index
    getGlobalCardsWithTag(tagName) {
        return this.globalTagIndex[tagName] || [];
    }

    // Sort cards by date (most recent first), with undated cards at the end
    sortCardsByDate(cards) {
        return [...cards].sort((a, b) => {
            if (a.date && b.date) {
                const dateDiff = b.date.getTime() - a.date.getTime();
                if (dateDiff !== 0) return dateDiff;
                return a.title.localeCompare(b.title);
            }
            if (a.date && !b.date) return -1;
            if (!a.date && b.date) return 1;
            return a.title.localeCompare(b.title);
        });
    }

    // Register content providers for dynamic cards
    initContentProviders() {
        this.contentProviders = {
            'tags': async () => {
                await this.tagIndexReady;
                return await this.generateTagsContent();
            },

            'writing': async () => {
                await this.tagIndexReady;
                return await this.generateWritingContent();
            },
        };

        // Embed generators - return just the HTML content, no headings
        this.embedGenerators = {
            'writing': () => this.generateWritingEmbed(),
            'tags': () => this.generateTagsEmbed()
        };
    }

    // Generate content for tags overview
    async generateTagsContent() {
        // Get main tags dynamically from what's indexed
        const mainTags = Object.keys(this.mainTagIndex).sort();

        if (mainTags.length === 0) {
            return {
                content: '# Tags\n\nNo tagged pages found.',
                isDynamic: true,
                sourceFile: 'dynamic:tags-overview'
            };
        }

        // Build subtag data for each main tag
        const mainTagData = mainTags.map(mainTag => {
            const cards = this.mainTagIndex[mainTag] || [];
            // Collect all subtags under this main tag with counts
            const subtagCounts = {};
            cards.forEach(card => {
                card.tags.forEach(subtag => {
                    if (card.subtagToMain?.[subtag]?.includes(mainTag)) {
                        subtagCounts[subtag] = (subtagCounts[subtag] || 0) + 1;
                    }
                });
            });
            return { mainTag, subtagCounts };
        });

        // Split into two columns
        const midpoint = Math.ceil(mainTagData.length / 2);
        const leftColumn = mainTagData.slice(0, midpoint);
        const rightColumn = mainTagData.slice(midpoint);

        // Helper to render a column
        const renderColumn = (items) => {
            return items.map(({ mainTag, subtagCounts }) => {
                const subtags = Object.entries(subtagCounts)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([subtag, count]) => `- [[tag-${subtag}|${subtag}]] (${count})`)
                    .join('\n');
                return `### ${mainTag}\n${subtags || '*no subtags*'}`;
            }).join('\n\n');
        };

        // Generate two-column HTML
        const content = `# Tags

<div class="tags-two-column">
<div class="tags-column">

${renderColumn(leftColumn)}

</div>
<div class="tags-column">

${renderColumn(rightColumn)}

</div>
</div>`;

        return {
            content: content,
            isDynamic: true,
            sourceFile: 'dynamic:tags-overview'
        };
    }

    // Generate content for writing page - cards grouped by main tag
    async generateWritingContent() {
        const mainTags = Object.keys(this.mainTagIndex).sort();

        if (mainTags.length === 0) {
            return {
                content: '# Writing\n\nNo tagged pages found.',
                isDynamic: true,
                sourceFile: 'dynamic:writing'
            };
        }

        // Build card list for each main tag
        const mainTagData = mainTags.map(mainTag => {
            const cards = this.mainTagIndex[mainTag] || [];
            return { mainTag, cards };
        }).filter(({ cards }) => cards.length > 0);

        // Split into two columns
        const midpoint = Math.ceil(mainTagData.length / 2);
        const leftColumn = mainTagData.slice(0, midpoint);
        const rightColumn = mainTagData.slice(midpoint);

        // Helper to render a column
        const renderColumn = (items) => {
            return items.map(({ mainTag, cards }) => {
                const cardLinks = this.sortCardsByDate(cards)
                    .map(card => {
                        const subtags = card.tags || [];
                        const subtagsStr = subtags.length > 0 ? ` [${subtags.join(', ')}]` : '';
                        return `- [[${card.sourceFile}|${card.title}]]${subtagsStr}`;
                    })
                    .join('\n');
                return `### ${mainTag}\n${cardLinks || '*no cards*'}`;
            }).join('\n\n');
        };

        const content = `# Writing

<p style="text-align: center;">A collection of my writings and ramblings.</p>

<div class="tags-two-column">
<div class="tags-column">

${renderColumn(leftColumn)}

</div>
<div class="tags-column">

${renderColumn(rightColumn)}

</div>
</div>`;

        return {
            content: content,
            isDynamic: true,
            sourceFile: 'dynamic:writing'
        };
    }

    /**
     * Generate just the writing index HTML for embedding in markdown files
     * Returns HTML string without heading - user defines their own heading in markdown
     */
    generateWritingEmbed() {
        const mainTags = Object.keys(this.mainTagIndex).sort();

        if (mainTags.length === 0) {
            return '<p>No tagged pages found.</p>';
        }

        // Build card list for each main tag
        const mainTagData = mainTags.map(mainTag => {
            const cards = this.mainTagIndex[mainTag] || [];
            return { mainTag, cards };
        }).filter(({ cards }) => cards.length > 0);

        // Split into two columns
        const midpoint = Math.ceil(mainTagData.length / 2);
        const leftColumn = mainTagData.slice(0, midpoint);
        const rightColumn = mainTagData.slice(midpoint);

        // Helper to render a column - returns parsed HTML
        const renderColumn = (items) => {
            return items.map(({ mainTag, cards }) => {
                const cardLinks = this.sortCardsByDate(cards)
                    .map(card => {
                        const subtags = card.tags || [];
                        const subtagsStr = subtags.length > 0 ? ` [${subtags.join(', ')}]` : '';
                        return `<li><strong class="card-link" data-card="${card.sourceFile}">${card.title}</strong>${subtagsStr}</li>`;
                    })
                    .join('\n');
                return `<h3>${mainTag}</h3>\n<ul>${cardLinks || '<li><em>no cards</em></li>'}</ul>`;
            }).join('\n\n');
        };

        return `<div class="tags-two-column">
<div class="tags-column">
${renderColumn(leftColumn)}
</div>
<div class="tags-column">
${renderColumn(rightColumn)}
</div>
</div>`;
    }

    /**
     * Generate just the tags index HTML for embedding in markdown files
     * Returns HTML string without heading - user defines their own heading in markdown
     */
    generateTagsEmbed() {
        // Get main tags dynamically from what's indexed
        const mainTags = Object.keys(this.mainTagIndex).sort();

        if (mainTags.length === 0) {
            return '<p>No tagged pages found.</p>';
        }

        // Build subtag data for each main tag
        const mainTagData = mainTags.map(mainTag => {
            const cards = this.mainTagIndex[mainTag] || [];
            // Collect all subtags under this main tag with counts
            const subtagCounts = {};
            cards.forEach(card => {
                card.tags.forEach(subtag => {
                    if (card.subtagToMain?.[subtag]?.includes(mainTag)) {
                        subtagCounts[subtag] = (subtagCounts[subtag] || 0) + 1;
                    }
                });
            });
            return { mainTag, subtagCounts };
        });

        // Split into two columns
        const midpoint = Math.ceil(mainTagData.length / 2);
        const leftColumn = mainTagData.slice(0, midpoint);
        const rightColumn = mainTagData.slice(midpoint);

        // Helper to render a column - returns parsed HTML
        const renderColumn = (items) => {
            return items.map(({ mainTag, subtagCounts }) => {
                const subtags = Object.entries(subtagCounts)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([subtag, count]) => `<li><strong class="card-link" data-card="tag-${subtag}">${subtag}</strong> (${count})</li>`)
                    .join('\n');
                return `<h3>${mainTag}</h3>\n<ul>${subtags || '<li><em>no subtags</em></li>'}</ul>`;
            }).join('\n\n');
        };

        return `<div class="tags-two-column">
<div class="tags-column">
${renderColumn(leftColumn)}
</div>
<div class="tags-column">
${renderColumn(rightColumn)}
</div>
</div>`;
    }

    // Register a dynamic tag page on demand
    registerTagPage(tagName, sourceCard) {
        const cardName = `tag-${tagName}`;

        // Register the content provider
        this.contentProviders[cardName] = async () => {
            await this.tagIndexReady;
            const taggedCards = this.getGlobalCardsWithTag(tagName);

            // Generate content for the tag page
            let content = `# ${tagName}\n\n`;

            if (taggedCards.length === 0) {
                content += 'No pages found with this tag.';
            } else {
                this.sortCardsByDate(taggedCards).forEach(card => {
                    const subtags = card.tags || [];
                    const subtagsStr = subtags.length > 0 ? ` [${subtags.join(', ')}]` : '';
                    content += `- [[${card.sourceFile}|${card.title}]]${subtagsStr}\n`;
                });
            }

            return {
                content: content,
                isDynamic: true,
                sourceFile: `dynamic:${cardName}`,
                dynamicSourceCard: sourceCard // Store the originating card for connections
            };
        };

        return cardName;
    }

    async loadCardFromFile(cardName, positionOptions = {}) {
        // Get content from provider system (file or dynamic)
        const contentData = await this.getCardContent(cardName);
        if (!contentData) {
            console.error('No content data returned for:', cardName);
            return null;
        }

        // Handle encrypted cards
        if (contentData.isEncrypted) {
            // Try auto-decrypt with cached password
            const decryptedBody = await this.tryAutoDecrypt(contentData.encryptedData);

            if (decryptedBody) {
                // Success! Reconstruct the full markdown
                const fullMarkdown = this.reconstructDecryptedMarkdown(
                    contentData.encryptedData.originalFrontmatter,
                    decryptedBody
                );
                contentData.content = fullMarkdown;
                contentData.isEncrypted = false;
            } else {
                // No cached password or it failed - show locked card
                return this.createLockedCard(cardName, contentData, positionOptions);
            }
        }

        // Parse the content
        const parsed = this.parser.parse(contentData.content);
        if (!parsed) {
            console.error('Parser returned null for:', cardName);
            return null;
        }

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

        const pageNumber = this.getNextPageNumber();

        // Check if this is an image card
        const isImageCard = parsed.metadata.image ? true : false;

        // Calculate rotation: counter-rotate to cancel canvas rotation,
        // so cards appear at their specified rotation relative to the screen.
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
            sourceFile: contentData.sourceFile,
            marginTB: positionOptions.marginTB,
            marginLR: positionOptions.marginLR,
            progressBar: parsed.metadata.progressBar === 'true' || parsed.metadata.progressBar === true,
            wordCount: parsed.metadata.wordCount === 'true' || parsed.metadata.wordCount === true,
            readTime: parsed.metadata.readTime === 'true' || parsed.metadata.readTime === true,
            showTags: parsed.metadata.showTags === 'true' || parsed.metadata.showTags === true,
            tags: (() => {
                const tagsStr = parsed.metadata.tags || '';
                const tagPairPattern = /\[([^,\]]+),\s*([^\]]+)\]/g;
                const subtags = [];
                let match;
                while ((match = tagPairPattern.exec(tagsStr)) !== null) {
                    const subtag = match[1].trim();
                    if (!subtags.includes(subtag)) subtags.push(subtag);
                }
                return subtags;
            })(),
            // Parse date from frontmatter (format: MM-DD-YYYY)
            date: (() => {
                const dateStr = parsed.metadata.date || '';
                const dateMatch = dateStr.match(/(\d{2})-(\d{2})-(\d{4})/);
                if (dateMatch) {
                    const [, month, day, year] = dateMatch;
                    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                }
                return null;
            })(),
            // Mark dynamic cards
            isDynamic: contentData.isDynamic || false,
            loadName: cardName
        };

        if (isImageCard) {
            cardOptions.image = parsed.metadata.image;
            cardOptions.caption = parsed.metadata.caption || '';
        }

        const card = this.addCard(cardOptions);

        // Add connection from parent card if exists
        if (positionOptions.parentCard) {
            this.addConnection(positionOptions.parentCard, card);
        } else if (contentData.dynamicSourceCard) {
            // For dynamic cards that have a source card reference
            this.addConnection(contentData.dynamicSourceCard, card);
        }

        // Register this file for live-reload watching (skip dynamic content)
        if (!contentData.isDynamic && contentData.sourceFile) {
            this.fileWatcher.watch(contentData.sourceFile);
        }

        // Load companion script if one exists
        await this.loadCardScript(cardName, card.element);

        return card;
    }

    /**
     * Load an optional companion script for a card.
     * If cards/{cardName}.js exists, dynamically import it and call its init() export.
     */
    async loadCardScript(cardName, cardElement) {
        const scriptUrl = `./cards/${cardName}.js`;
        try {
            const head = await fetch(scriptUrl, { method: 'HEAD' });
            if (!head.ok) return;
        } catch { return; }

        try {
            const module = await import(scriptUrl);
            if (typeof module.init === 'function') {
                await module.init(cardElement, {
                    vizManager,
                    getSetting: (key) => this.getSetting(key),
                    setSetting: (key, value) => this.setSetting(key, value),
                });
            }
        } catch (e) {
            console.error(`Card script error (${cardName}):`, e);
        }
    }

    async openCard(cardName, parentCard = null, options = {}, clickEvent = null) {
        let x, y;
        const jitter = options.jitter || 0;

        // Special handling for 'about' card: position left of menu with scatter image right of menu
        // Determine position based on options
        if (typeof options.absX === 'number' && typeof options.absY === 'number') {
            // Absolute positioning
            x = this.applyJitter(options.absX, jitter);
            y = this.applyJitter(options.absY, jitter);
        } else if (typeof options.relX === 'number' && typeof options.relY === 'number' && parentCard) {
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
        // Load saved settings from Controls.js configuration
        this.settings = controlsManager.loadSettings();

        this.canvasLocked = false;

        // Track connections between cards (parentId -> [childIds])
        this.connections = new Map();

        // Apply saved settings immediately
        this.applySettings();

        // Bind settings button \u2014 open settings as a page
        const settingsBtn = document.getElementById('settings-btn');
        settingsBtn.addEventListener('click', () => this.showCard('settings', true));

        // Bind share button \u2014 copy the current page URL
        const shareBtn = document.getElementById('share-btn');
        shareBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href).catch(err => console.error('Failed to copy:', err));
        });
    }

    async loadDropcapMetrics() {
        try {
            const response = await fetch('/dropcap-metrics.json');
            Card.dropcapMetrics = await response.json();
        } catch (e) {
            console.warn('Could not load dropcap-metrics.json:', e);
            Card.dropcapMetrics = null;
        }
    }

    // Get a setting value
    getSetting(key) {
        return this.settings[key];
    }

    // Set a setting value and save to localStorage
    setSetting(key, value) {
        this.settings[key] = value;

        // Get config from SettingsConfig for storage key and side effects
        const config = SettingsConfig[key];
        if (config) {
            localStorage.setItem(config.storage, value);

            // Create context for side effect handlers
            const context = controlsManager.createContext(this);

            // Run apply function for CSS variable updates
            if (config.apply) {
                config.apply(value, context);
            }

            // Run onSet for setting-specific side effects
            if (config.onSet) {
                config.onSet(value, context);
            }
        } else {
            // Fallback for unknown settings
            localStorage.setItem(`settings-${key}`, value);
        }

        // Sync all settings cards to reflect the change
        this.syncAllSettingsCards();
    }

    /**
     * Bind interactive elements (toggles, sliders, buttons) in any card
     */
    bindInteractiveElements(cardElement) {
        // Delegate to controlsManager for all control binding
        controlsManager.bindInteractiveElements(cardElement, this);

        // Save layout on scroll (debounced via scheduleLayoutSave)
        const contentArea = cardElement.querySelector('.card-content');
        if (contentArea && !contentArea._layoutScrollBound) {
            contentArea.addEventListener('scroll', () => this.scheduleLayoutSave(), { passive: true });
            contentArea._layoutScrollBound = true;
        }

        // Initialize any visualizations in this card
        vizManager.initVisualizations(cardElement, {
            getSetting: (key) => this.getSetting(key),
            setSetting: (key, value) => this.setSetting(key, value)
        });

        // Initialize 3D visualizations (lazy load)
        this.init3DVisualizations(cardElement);

        // Process any dynamic embeds in this card
        this.processEmbeds(cardElement);

        // Bind margin overflow arrows — spawn card with full margin content
        cardElement.querySelectorAll('.margin-overflow-arrow').forEach(arrow => {
            arrow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.spawnMarginCard(arrow);
            });
        });

        // Bind gallery item clicks — open lightbox
        cardElement.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openGalleryLightbox(item.dataset.src, item.dataset.text);
            });
        });

        // Distribute gallery items into columns for row-major ordering
        cardElement.querySelectorAll('.gallery-grid').forEach(grid => {
            const items = Array.from(grid.querySelectorAll('.gallery-item'));
            if (items.length === 0) return;

            const numCols = parseInt(grid.dataset.columns) || 3;
            const gap = parseInt(grid.dataset.gap) || 8;

            const distribute = () => {
                if (grid.clientWidth === 0) return false;

                items.forEach(item => item.remove());
                grid.innerHTML = '';
                grid.style.display = 'flex';
                grid.style.gap = gap + 'px';
                grid.classList.add('gallery-grid-distributed');

                const columns = [];
                for (let i = 0; i < numCols; i++) {
                    const col = document.createElement('div');
                    col.className = 'gallery-column';
                    col.style.gap = gap + 'px';
                    grid.appendChild(col);
                    columns.push(col);
                }

                items.forEach((item, i) => {
                    columns[i % numCols].appendChild(item);
                });
                return true;
            };

            if (!distribute()) {
                const ro = new ResizeObserver(() => {
                    if (distribute()) ro.disconnect();
                });
                ro.observe(grid);
            }
        });
    }

    openGalleryLightbox(src, text) {
        if (!src) return;

        const overlay = document.createElement('div');
        overlay.className = 'gallery-lightbox';

        const content = document.createElement('div');
        content.className = 'gallery-lightbox-content';

        const img = document.createElement('img');
        img.className = 'gallery-lightbox-image';
        img.src = src;

        content.appendChild(img);

        if (text) {
            const textEl = document.createElement('div');
            textEl.className = 'gallery-lightbox-text';
            textEl.textContent = text;
            content.appendChild(textEl);
        }

        overlay.appendChild(content);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => overlay.classList.add('active'));

        const close = () => {
            overlay.classList.remove('active');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            document.removeEventListener('keydown', onKey);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        const onKey = (e) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', onKey);
    }

    /**
     * Spawn a new card containing the full content of an overflowed margin item
     */
    spawnMarginCard(arrowElement) {
        const marginItem = arrowElement.closest('.margin-item');
        if (!marginItem) return;

        const rawHtml = marginItem.dataset.rawHtml || '';
        if (!rawHtml) return;

        // Find the parent card to position relative to it
        const parentCardEl = marginItem.closest('.card');
        if (!parentCardEl) return;
        const parentCard = this.cards.get(parentCardEl.id);
        if (!parentCard) return;

        const side = marginItem.dataset.marginSide || 'right';

        // Position the new card near the parent, offset based on margin side
        let spawnX = parentCard.x;
        let spawnY = parentCard.y;
        const offset = 60;

        if (side === 'right') {
            spawnX = parentCard.x + parentCard.width + offset;
        } else if (side === 'left') {
            spawnX = parentCard.x - 320 - offset;
        } else if (side === 'top') {
            spawnY = parentCard.y - 400 - offset;
        } else if (side === 'bottom') {
            spawnY = parentCard.y + parentCard.height + offset;
        }

        this.createCard({
            x: spawnX,
            y: spawnY,
            width: CARD_DEFAULT_WIDTH,
            height: 320,
            content: rawHtml
        });
    }

    /**
     * Initialize 3D visualizations in a card element
     * Lazy loads Three.js and the 3D system only when needed
     */
    async init3DVisualizations(cardElement) {
        // Check if any 3D viz containers exist
        const viz3DContainers = cardElement.querySelectorAll(
            '.viz-container[data-viz-type="surface"],' +
            '.viz-container[data-viz-type="curve3d"],' +
            '.viz-container[data-viz-type="model"],' +
            '.viz-container[data-viz-type="nodegraph3d"],' +
            '.viz-container[data-viz-type="polynomial3d"]'
        );

        if (viz3DContainers.length === 0) return;

        // Lazy load 3D system only when needed
        try {
            const { viz3DManager } = await import('./Visualizations3D.js');
            await viz3DManager.initVisualizations(cardElement, {
                getSetting: (key) => this.getSetting(key),
                setSetting: (key, value) => this.setSetting(key, value)
            });
        } catch (error) {
            console.error('Failed to initialize 3D visualizations:', error);
        }
    }

    /**
     * Process dynamic embed placeholders in card content
     * Replaces {{name}} placeholders with generated content
     */
    processEmbeds(cardElement) {
        const embedPlaceholders = cardElement.querySelectorAll('.dynamic-embed[data-embed]');

        embedPlaceholders.forEach(placeholder => {
            const embedName = placeholder.dataset.embed;

            if (this.embedGenerators && this.embedGenerators[embedName]) {
                const generatedHtml = this.embedGenerators[embedName]();

                // Create a wrapper div and set the HTML
                const wrapper = document.createElement('div');
                wrapper.className = 'embed-content';
                wrapper.innerHTML = generatedHtml;

                // Replace the placeholder with the generated content
                placeholder.replaceWith(wrapper);
            } else {
                // Unknown embed - show error message
                placeholder.innerHTML = `<p><em>Unknown embed: ${embedName}</em></p>`;
            }
        });
    }

    /**
     * Sync interactive element states with current settings (after reset, etc.)
     */
    syncInteractiveElements(cardElement) {
        // Delegate to controlsManager for all control syncing
        controlsManager.syncInteractiveElements(cardElement, this);
    }

    /**
     * Sync all settings cards with current setting values
     */
    syncAllSettingsCards() {
        const allSettingsCards = document.querySelectorAll('.card[data-settings-card]');
        allSettingsCards.forEach(cardElement => {
            this.syncInteractiveElements(cardElement);
        });
    }

    applySettings() {
        // Delegate to controlsManager for applying all settings
        const context = controlsManager.createContext(this);
        controlsManager.applySettings(this.settings, context);

        // Handle visibility and shadows (these are always needed on init)
        this.updateHandleVisibility();
        this.updateCardShadows();
    }

    /**
     * Initialize editor functionality (localhost only)
     */
    async initEditor() {
        const editBtn = document.getElementById('edit-btn');

        if (!this.isLocal) return;

        // Dynamically import editor module (only on localhost)
        try {
            const { EditorCard, FileSystemManager } = await import('./Editor.js');
            this.EditorCard = EditorCard;
            this.fsManager = new FileSystemManager();

            // Show edit button and shift share button over
            if (editBtn) {
                editBtn.style.setProperty('display', 'flex', 'important');
                editBtn.addEventListener('click', () => this.openEditorCard());
            }
            const shareBtn = document.getElementById('share-btn');
            if (shareBtn) {
                shareBtn.style.setProperty('left', '112px', 'important');
            }

            // Try to restore directory handle from storage
            this.fsManager.restoreHandle();

            // Listen for editor close events
            document.addEventListener('editor-close', (e) => {
                const editorId = e.detail.editorId;
                this.editorCards.delete(editorId);
                this.updateURLWithOpenCards();
                this.scheduleSave();
            });

            // Warn about unsaved changes before leaving page
            window.addEventListener('beforeunload', (e) => {
                const hasUnsaved = Array.from(this.editorCards.values())
                    .some(editor => editor.isDirty);
                if (hasUnsaved) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });

            console.log('Editor enabled (localhost mode)');
        } catch (error) {
            console.log('Editor module not available:', error.message);
        }
    }

    /**
     * Open editor card (localhost only)
     * @param {string} filename - Optional filename to open
     */
    async openEditorCard(filename = null) {
        // Editor is local-only and needs the File System Access API
        if (!this.isLocal || !this.EditorCard) {
            console.warn('Editor is only available on localhost');
            return null;
        }
        if (!this.fsManager || !this.fsManager.isSupported()) {
            alert('Editor requires File System Access API. Please use Chrome or Edge.');
            return null;
        }

        // The editor always opens in a split alongside the current page
        if (!this.isSplitMode) {
            await this.enterSplitMode(this.currentPage || 'menu');
        }
        const leaf = this.findLastSplitLeaf(this.splitRoot);
        if (leaf) await this.splitPaneWithEditor(leaf, filename);
        return null;
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

    /**
     * Update all card margins to match the global margin size setting
     * @param {number} marginPercent - Margin size as percentage (0-45)
     */
    updateAllCardMargins(marginPercent) {
        // Split mode cards get a slightly larger margin
        const marginMultiplier = isMobile() ? 1.4 : 1.1;
        const splitModeMargin = Math.min(45, marginPercent * marginMultiplier);

        this.cards.forEach(card => {
            if (card.updateMarginSize) {
                const effective = card.element.classList.contains('card-split-mode')
                    ? splitModeMargin
                    : marginPercent;
                card.updateMarginSize(effective);
            }
        });
    }

    initConnectionsLayer() {
        // Create SVG layer for connection lines
        this.connectionsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.connectionsSvg.classList.add('connections-layer');

        // Set SVG to cover the entire canvas area with a large viewBox
        this.connectionsSvg.setAttribute('width', '100%');
        this.connectionsSvg.setAttribute('height', '100%');
        this.connectionsSvg.setAttribute('viewBox', '0 0 10000 10000');
        this.connectionsSvg.style.position = 'absolute';
        this.connectionsSvg.style.top = '0';
        this.connectionsSvg.style.left = '0';
        this.connectionsSvg.style.pointerEvents = 'none'; // Don't interfere with card interactions

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
            // z-index 0 = below cards, Z_INDEX_CARD_CAP = above cards
            this.connectionsSvg.style.zIndex = this.settings.connectionsAbove ? String(Z_INDEX_CARD_CAP) : '0';
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

        // Schedule state save
        this.scheduleSave();
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

    // Export all cards to JSON
    // Remove a card and its connections
    removeCard(cardId) {
        const card = this.cards.get(cardId);
        if (card) {
            // Remove connections for this card
            this.removeConnectionsForCard(cardId);

            // Remove from cards map
            this.cards.delete(cardId);

            // Remove DOM element
            card.element.remove();

            // Schedule state save
            this.scheduleSave();

            // Update URL to reflect open cards
            this.updateURLWithOpenCards();
        }
    }

    pushNavigationState() {
        // Split navigation is ephemeral — no per-action history entries
    }

    updateURLWithOpenCards() {
        // Split is ephemeral — it never writes to the URL
        if (this.isSplitMode) return;

        const cardNames = [];
        for (const card of this.cards.values()) {
            const name = card.loadName || card.sourceFile;
            if (name) cardNames.push(name);
        }
        for (const editor of this.editorCards.values()) {
            cardNames.push('__editor__');
        }

        if (cardNames.length === 0) {
            window.history.replaceState(null, '', window.location.pathname);
        } else {
            window.history.replaceState(null, '', '#/c/' + cardNames.join('~'));
        }
    }

    // Layout persistence was removed; these remain as no-ops for their existing call sites.
    scheduleSave() {}

    scheduleLayoutSave() {}

    /**
     * Generic jump-to system for intra-card navigation
     * Handles jumping to anchors in main content or margins with proper scrolling
     * @param {Element|string} cardElementOrId - Card DOM element or card ID for cross-card jumps
     * @param {string} targetId - The anchor ID to jump to
     */
    jumpToAnchor(cardElementOrId, targetId) {
        let cardElement;

        // Handle both card element and card ID for future extensibility
        if (typeof cardElementOrId === 'string') {
            // Cross-card jump (future feature)
            const card = this.cards.get(cardElementOrId);
            if (!card) {
                console.warn(`Card "${cardElementOrId}" not found for jump`);
                return;
            }
            cardElement = card.element;
        } else {
            // Intra-card jump (current implementation)
            cardElement = cardElementOrId;
        }

        // Use requestAnimationFrame to ensure DOM has updated after any content changes
        requestAnimationFrame(() => {
            // Find the target anchor element within the card
            const targetElement = cardElement.querySelector(`[data-anchor-id="${targetId}"]`);

            if (!targetElement) {
                console.warn(`Jump target "${targetId}" not found in card`);
                return;
            }

            // Determine which container the target is in and scroll accordingly
            const container = this.findScrollableContainer(targetElement);

            if (!container) {
                console.warn(`No scrollable container found for target "${targetId}"`);
                return;
            }

            // If target is in a margin, we need to scroll both the margin container AND the main content
            if (container.type === 'margin-content') {
                // First, scroll within the margin container to center the target
                const targetPosition = this.calculateTargetPosition(targetElement, container);
                this.smoothScrollTo(container, targetPosition);

                // Then, scroll the main content area to bring the margin area into view
                const mainContent = cardElement.querySelector('.card-content');
                if (mainContent) {
                    // Calculate where the margin area appears relative to the main content
                    const marginItem = targetElement.closest('.margin-item');
                    if (marginItem) {
                        // Get the vertical position of the margin item
                        const marginRect = marginItem.getBoundingClientRect();
                        const mainContentRect = mainContent.getBoundingClientRect();

                        // Calculate the margin's center position relative to main content scroll area
                        const marginCenterY = marginRect.top + marginRect.height / 2 - mainContentRect.top + mainContent.scrollTop;
                        const mainContentHeight = mainContent.clientHeight;

                        // Calculate scroll position to center the margin area in main content
                        const mainScrollTarget = marginCenterY - (mainContentHeight / 2);

                        const mainContainer = {
                            element: mainContent,
                            type: 'main-content',
                            scrollDirection: 'vertical'
                        };

                        // Smooth scroll the main content to center the margin area
                        this.smoothScrollTo(mainContainer, Math.max(0, mainScrollTarget));
                    }
                }
            } else {
                // Target is in main content, scroll normally
                const targetPosition = this.calculateTargetPosition(targetElement, container);
                this.smoothScrollTo(container, targetPosition);
            }

            // Animate the number on the target to draw attention
            this.pulseTargetNumber(targetElement);
        });
    }

    /**
     * Highlight the jump target element
     */
    pulseTargetNumber(targetElement) {
        // Add background highlight to the entire target element
        targetElement.classList.remove('jump-target-highlight');
        // Force reflow to restart animation
        void targetElement.offsetWidth;
        targetElement.classList.add('jump-target-highlight');

        // Remove highlight class after animation completes
        setTimeout(() => {
            targetElement.classList.remove('jump-target-highlight');
        }, 2000);
    }

    /**
     * Highlight the jump target element briefly
     */
    /**
     * Find the scrollable container for a target element
     * Returns the container element and its type
     */
    findScrollableContainer(targetElement) {
        // Check if target is in main content
        const mainContent = targetElement.closest('.card-content');
        if (mainContent) {
            return {
                element: mainContent,
                type: 'main-content',
                scrollDirection: 'vertical'
            };
        }

        // Check if target is in a margin item content
        const scrollableContent = targetElement.closest('.margin-item-content');
        if (scrollableContent) {
            const marginItem = scrollableContent.closest('.margin-item');
            const marginElement = scrollableContent.closest('.card-margin');
            if (marginElement && marginItem) {
                // Check orientation on the margin item (parent of margin-item-content)
                const isVerticalText = marginItem.classList.contains('margin-orientation-vertical');
                const isHorizontalText = marginItem.classList.contains('margin-orientation-horizontal');

                let scrollDirection = 'vertical';
                if (isVerticalText && !isHorizontalText) {
                    scrollDirection = 'horizontal';
                } else if (isHorizontalText) {
                    scrollDirection = 'vertical';
                }

                return {
                    element: scrollableContent,
                    type: 'margin-content',
                    scrollDirection: scrollDirection,
                    marginSide: this.getMarginSide(marginElement)
                };
            }
        }

        // Fallback: check if target is in a margin but not in scrollable content
        const marginElement = targetElement.closest('.card-margin');
        if (marginElement) {
            // Find the scrollable content within the margin that contains the target
            const allScrollableContent = marginElement.querySelectorAll('.margin-item-content');

            for (const content of allScrollableContent) {
                if (content.contains(targetElement)) {
                    const marginItem = content.closest('.margin-item');

                    // Check orientation on the margin item
                    const isVerticalText = marginItem && marginItem.classList.contains('margin-orientation-vertical');
                    const isHorizontalText = marginItem && marginItem.classList.contains('margin-orientation-horizontal');

                    let scrollDirection = 'vertical';
                    if (isVerticalText && !isHorizontalText) {
                        scrollDirection = 'horizontal';
                    } else if (isHorizontalText) {
                        scrollDirection = 'vertical';
                    }

                    return {
                        element: content,
                        type: 'margin-content',
                        scrollDirection: scrollDirection,
                        marginSide: this.getMarginSide(marginElement)
                    };
                }
            }
        }

        return null;
    }

    /**
     * Determine which margin side an element belongs to
     */
    getMarginSide(marginElement) {
        if (marginElement.classList.contains('card-margin-left')) return 'left';
        if (marginElement.classList.contains('card-margin-right')) return 'right';
        if (marginElement.classList.contains('card-margin-top')) return 'top';
        if (marginElement.classList.contains('card-margin-bottom')) return 'bottom';
        return 'unknown';
    }

    /**
     * Calculate the target scroll position within a container to center the target
     */
    calculateTargetPosition(targetElement, container) {
        if (container.scrollDirection === 'vertical') {
            // Force DOM layout update before calculating positions
            container.element.offsetHeight; // Trigger reflow

            // Calculate the target's position relative to the container's scroll area
            let targetOffsetTop = 0;
            let element = targetElement;

            // Walk up the DOM tree accumulating offsets until we reach the container
            while (element && element !== container.element) {
                targetOffsetTop += element.offsetTop;
                element = element.offsetParent;

                // If we hit the container during the walk, break
                if (element === container.element) {
                    break;
                }
            }

            // If we didn't find the container via offsetParent, use direct calculation
            if (element !== container.element) {
                const containerRect = container.element.getBoundingClientRect();
                const targetRect = targetElement.getBoundingClientRect();

                // getBoundingClientRect values are affected by canvas zoom, but scroll values are not
                // So we need to convert the rect-based calculation to unscaled coordinates
                const canvasZoom = this.zoom || 1;
                const unscaledTop = (targetRect.top - containerRect.top) / canvasZoom;
                targetOffsetTop = unscaledTop + container.element.scrollTop;
            }

            // Center the target in the visible area
            const containerHeight = container.element.clientHeight;
            const targetHeight = targetElement.offsetHeight || 0;

            // Calculate scroll position to center the target
            const centeredPosition = targetOffsetTop - (containerHeight / 2) + (targetHeight / 2);
            return Math.max(0, centeredPosition);
        } else {
            // Calculate the target's position relative to the container's scroll area (horizontal)
            let targetOffsetLeft = 0;
            let element = targetElement;

            // Walk up the DOM tree accumulating offsets until we reach the container
            while (element && element !== container.element) {
                targetOffsetLeft += element.offsetLeft;
                element = element.offsetParent;

                // If we hit the container during the walk, break
                if (element === container.element) {
                    break;
                }
            }

            // If we didn't find the container via offsetParent, use direct calculation
            if (element !== container.element) {
                const containerRect = container.element.getBoundingClientRect();
                const targetRect = targetElement.getBoundingClientRect();

                // getBoundingClientRect values are affected by canvas zoom, but scroll values are not
                // So we need to convert the rect-based calculation to unscaled coordinates
                const canvasZoom = this.zoom || 1;
                const unscaledLeft = (targetRect.left - containerRect.left) / canvasZoom;
                targetOffsetLeft = unscaledLeft + container.element.scrollLeft;
            }

            // Center the target in the visible area
            const containerWidth = container.element.clientWidth;
            const targetWidth = targetElement.offsetWidth || 0;

            // Calculate scroll position to center the target
            const centeredPosition = targetOffsetLeft - (containerWidth / 2) + (targetWidth / 2);
            return Math.max(0, centeredPosition);
        }
    }

    /**
     * Perform smooth scrolling to a target position
     */
    smoothScrollTo(container, targetPosition) {
        const element = container.element;
        const scrollProperty = container.scrollDirection === 'vertical' ? 'scrollTop' : 'scrollLeft';
        const startPosition = element[scrollProperty];
        const distance = targetPosition - startPosition;
        const duration = 500; // 500ms animation
        const startTime = performance.now();

        // Easing function (ease-out cubic)
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easeOutCubic(progress);

            element[scrollProperty] = startPosition + (distance * easedProgress);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }

    // ============================================
    // Canvas Lock / Split Mode Helpers
    // ============================================

    /**
     * Lock canvas - disable pan, zoom, rotate
     */
    lockCanvas() {
        this.canvasLocked = true;
        this.canvas.style.cursor = 'default';

        // Reset transform for split mode
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
        this.rotation = 0;
        this.updateCanvasTransform();
    }

    /**
     * Unlock canvas - restore normal interaction
     */
    unlockCanvas() {
        this.canvasLocked = false;
        this.canvas.style.cursor = 'grab';
    }

    /**
     * Clear all cards from canvas
     */
    clearAllCards() {
        this.cards.forEach((card, id) => {
            this.removeConnectionsForCard(id);
            card.element.remove();
        });
        this.cards.clear();

        // Also clear editor cards
        this.editorCards.forEach(editor => {
            editor.stopAutosave();
            if (editor.updateDebounceTimer) {
                clearTimeout(editor.updateDebounceTimer);
            }
            editor.element.remove();
        });
        this.editorCards.clear();
    }

    /**
     * Build a Card for a card file: fetch content, decrypt if possible, parse markdown,
     * construct the Card, bind interactive elements, and register live-reload.
     * Returns the Card, or null if missing/unparseable. Positioning is the caller's job.
     */
    async buildCard(cardName) {
        if (cardName.startsWith('tag-')) {
            this.registerTagPage(cardName.slice(4), null);
        }

        const contentData = await this.getCardContent(cardName);
        if (!contentData) return null;

        if (contentData.isEncrypted) {
            const decryptedBody = await this.tryAutoDecrypt(contentData.encryptedData);
            if (decryptedBody) {
                contentData.content = this.reconstructDecryptedMarkdown(
                    contentData.encryptedData.originalFrontmatter, decryptedBody
                );
                contentData.isEncrypted = false;
            }
        }

        const parsed = this.parser.parse(contentData.content);
        if (!parsed) return null;

        const card = new Card({
            x: 0, y: 0,
            width: window.innerWidth, height: window.innerHeight,
            rotation: 0,
            pageNumber: null,
            content: parsed.content,
            margins: parsed.margins || { left: [], right: [], top: [], bottom: [] },
            sourceFile: contentData.sourceFile,
            progressBar: parsed.metadata.progressBar === 'true',
            wordCount: parsed.metadata.wordCount === 'true',
            readTime: parsed.metadata.readTime === 'true',
            showTags: parsed.metadata.showTags === 'true' || parsed.metadata.showTags === true,
            tags: (() => {
                const tagsStr = parsed.metadata.tags || '';
                const tagPairPattern = /\[([^,\]]+),\s*([^\]]+)\]/g;
                const subtags = [];
                let match;
                while ((match = tagPairPattern.exec(tagsStr)) !== null) {
                    const subtag = match[1].trim();
                    if (!subtags.includes(subtag)) subtags.push(subtag);
                }
                return subtags;
            })(),
            date: (() => {
                const dateStr = parsed.metadata.date || '';
                const dateMatch = dateStr.match(/(\d{2})-(\d{2})-(\d{4})/);
                if (dateMatch) {
                    const [, month, day, year] = dateMatch;
                    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                }
                return null;
            })(),
            isDynamic: contentData.isDynamic || false
        });

        this.cards.set(card.id, card);
        this.bindInteractiveElements(card.element);
        await this.loadCardScript(cardName, card.element);

        if (!contentData.isDynamic && contentData.sourceFile) {
            this.fileWatcher.watch(contentData.sourceFile);
        }

        return card;
    }

    /**
     * Render a single card as the full-screen reading page, replacing the current one.
     * This is the primary navigation primitive: [[link]] clicks and URL changes route here.
     * The pannable canvas stays dormant behind the page (reserved for the canvas page).
     */
    async showCard(cardName, pushHistory = true, headingId = null) {
        if (!cardName) cardName = 'menu';

        // One-time setup: page container, overlay layer, and delegated handlers
        if (!this.pageContainer) {
            this.lockCanvas();
            document.body.classList.add('reader-active');

            this.pageContainer = document.createElement('div');
            this.pageContainer.id = 'page-container';
            document.body.appendChild(this.pageContainer);
            this.bindPageHandlers(this.pageContainer);
            this.setupPrintHandlers();

            // Floating overlay layer (above the page, below the fixed buttons)
            this.overlayLayer = document.createElement('div');
            this.overlayLayer.id = 'overlay-layer';
            document.body.appendChild(this.overlayLayer);
            this.bindPageHandlers(this.overlayLayer);
            this.bindOverlayLayerEvents(this.overlayLayer);

            this.overlays = [];
            this.overlayCache = new Map();
            this.overlayCascade = 0;

            // Dismiss the top overlay on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.overlays.length) {
                    this.overlays[this.overlays.length - 1].card.delete();
                }
            });
        }

        // Tear down the previous page and its overlays
        this.clearAllCards();
        this.pageContainer.replaceChildren();
        this.overlayLayer.replaceChildren();
        this.overlays = [];
        this.overlayCascade = 0;
        this.currentPage = cardName;

        const card = await this.buildCard(cardName);
        if (!card) {
            if (cardName !== 'menu') return this.showCard('menu', pushHistory);
            this.pageContainer.innerHTML = '<div class="page-empty">Not found</div>';
            return;
        }

        card.element.classList.add('card-reader');
        if (this.settings && !this.settings.cardShadow) {
            card.element.style.filter = 'none';
        }
        this.pageContainer.appendChild(card.element);
        this.baseCard = card;

        // Size the card to the container; keep margins in sync on resize
        const applySize = () => {
            const w = this.pageContainer.clientWidth;
            const h = this.pageContainer.clientHeight;
            if (w > 0 && h > 0) {
                card.width = w;
                card.height = h;
                if (card.marginTB === null && card.marginLR === null && this.settings?.marginSize !== undefined) {
                    const marginMultiplier = isMobile() ? 1.4 : 1.1;
                    card.updateMarginSize(Math.min(45, this.settings.marginSize * marginMultiplier));
                }
            }
        };
        applySize();
        if (this.baseResizeObserver) this.baseResizeObserver.disconnect();
        this.baseResizeObserver = new ResizeObserver(applySize);
        this.baseResizeObserver.observe(this.pageContainer);

        if (headingId) {
            setTimeout(() => this.scrollToHeadingInCard(card, headingId), 0);
        }

        // Restore overlays previously opened on this page (back/forward continuity)
        this.restoreOverlaysForPage(cardName);

        const url = `#/${cardName}`;
        if (pushHistory) {
            window.history.pushState({ cardName }, '', url);
        } else {
            window.history.replaceState({ cardName }, '', url);
        }
    }

    /**
     * Bind print event handlers once. Native Cmd+P / "Save as PDF" fire
     * beforeprint/afterprint; Safari is unreliable there, so we also drive
     * off the print media query.
     */
    setupPrintHandlers() {
        if (this._printHandlersBound) return;
        this._printHandlersBound = true;

        window.addEventListener('beforeprint', () => this.preparePrintLayout());
        window.addEventListener('afterprint', () => this.teardownPrintLayout());

        const mql = window.matchMedia('print');
        const onChange = (e) => {
            if (e.matches) this.preparePrintLayout();
            else this.teardownPrintLayout();
        };
        if (mql.addEventListener) mql.addEventListener('change', onChange);
        else if (mql.addListener) mql.addListener(onChange);
    }

    /**
     * Walk up from an element to the nearest ancestor that is a direct child
     * of container (its block-level owner within the content flow).
     */
    blockAncestor(el, container) {
        let cur = el;
        while (cur && cur.parentNode !== container) {
            cur = cur.parentNode;
            if (!cur || cur === document.body) return null;
        }
        return cur;
    }

    /**
     * Rebuild the reading page for print: relocate each margin [[note]] next to
     * its anchor as a floated sidenote, and snapshot interactive content.
     * Every mutation is recorded in _printCleanup for exact teardown.
     */
    preparePrintLayout() {
        if (this._printActive) return;
        const card = this.baseCard;
        if (!card || !document.body.classList.contains('reader-active')) return;
        const content = card.element.querySelector('.card-content');
        if (!content) return;

        this._printActive = true;
        this._printCleanup = [];

        // Relocate left/right margin notes inline, floated into the gutters.
        const registry = card.marginItemRegistry || {};
        for (const side of ['left', 'right']) {
            for (const item of (registry[side] || [])) {
                if (!item.anchorId) continue;
                const anchor = content.querySelector(`[data-anchor-id="${CSS.escape(item.anchorId)}"]`);
                if (!anchor) continue;
                const contentEl = item.element.querySelector('.margin-item-content');
                if (!contentEl) continue;

                const aside = document.createElement('aside');
                aside.className = `print-sidenote print-sidenote-${side}`;
                aside.innerHTML = contentEl.innerHTML;

                const block = this.blockAncestor(anchor, content);
                if (block) content.insertBefore(aside, block);
                else content.appendChild(aside);

                this._printCleanup.push(() => aside.remove());
            }
        }

        // Snapshot visualizations (WebGL via capture(), 2D canvas directly).
        content.querySelectorAll('.viz-container').forEach((vc) => this.capturePrintViz(vc));

        // Iframes (embeds) can't be snapshotted cross-origin — leave a pointer.
        content.querySelectorAll('iframe').forEach((frame) => {
            const url = frame.getAttribute('src') || '';
            const ph = document.createElement('div');
            ph.className = 'print-viz-fallback';
            ph.textContent = url ? `[Embedded content — ${url}]` : '[Embedded content]';
            frame.style.display = 'none';
            frame.parentNode.insertBefore(ph, frame.nextSibling);
            this._printCleanup.push(() => { ph.remove(); frame.style.display = ''; });
        });
    }

    /**
     * Replace a live visualization with a static snapshot for print, or a
     * captioned placeholder if capture fails (e.g. context evicted/tainted).
     */
    capturePrintViz(vc) {
        let dataURL = null;
        try {
            const inst = vc._viz3dState;
            if (inst && typeof inst.capture === 'function') {
                dataURL = inst.capture();
            } else {
                const canvas = vc.querySelector('canvas');
                if (canvas) dataURL = canvas.toDataURL('image/png');
            }
        } catch (e) {
            dataURL = null;
        }

        const label = vc.dataset.vizType || 'visualization';
        let node;
        if (dataURL) {
            node = document.createElement('img');
            node.className = 'print-viz-img';
            node.src = dataURL;
            node.alt = label;
        } else {
            node = document.createElement('div');
            node.className = 'print-viz-fallback';
            node.textContent = `[Interactive ${label} — view online]`;
        }

        vc.classList.add('print-captured');
        vc.appendChild(node);
        this._printCleanup.push(() => { node.remove(); vc.classList.remove('print-captured'); });
    }

    /**
     * Revert every mutation made by preparePrintLayout().
     */
    teardownPrintLayout() {
        if (!this._printActive) return;
        for (const undo of (this._printCleanup || [])) {
            try { undo(); } catch (e) { /* best-effort restore */ }
        }
        this._printCleanup = [];
        this._printActive = false;
    }

    /**
     * Bind delegated handlers on the reading page: [[link]] navigation, jump/TOC/heading
     * links, and tag clicks. [[card]] overlay handling is added by the overlay system.
     */
    bindPageHandlers(container) {
        container.addEventListener('click', (e) => {
            // [[card]] — spawn a floating overlay near the click
            const overlayLink = e.target.closest('.card-overlay-link');
            if (overlayLink) {
                const targetCard = overlayLink.dataset.card;
                if (targetCard) {
                    e.preventDefault();
                    e.stopPropagation();
                    const w = parseInt(overlayLink.dataset.width) || null;
                    const h = parseInt(overlayLink.dataset.height) || null;
                    this.spawnOverlay(targetCard, { clickX: e.clientX, clickY: e.clientY, width: w, height: h, anchorEl: overlayLink.closest('.card-content') });
                }
                return;
            }

            // [[link]] — replace the page with the target card
            const cardLink = e.target.closest('.card-link');
            if (cardLink) {
                const targetCard = cardLink.dataset.card;
                if (targetCard && !cardLink.dataset.url) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showCard(targetCard, true);
                }
                return;
            }

            // Jump links (intra-card anchors)
            const jumpLink = e.target.closest('.jump-link');
            if (jumpLink) {
                e.preventDefault();
                const sourceCard = jumpLink.closest('.card');
                if (sourceCard && jumpLink.dataset.jumpTarget) {
                    this.jumpToAnchor(sourceCard, jumpLink.dataset.jumpTarget);
                }
                return;
            }

            // TOC links — scroll to a heading within the card
            const tocLink = e.target.closest('[data-toc-target]');
            if (tocLink) {
                e.preventDefault();
                e.stopPropagation();
                const cardElement = tocLink.closest('.card');
                const targetId = tocLink.dataset.tocTarget;
                if (cardElement && targetId) {
                    const contentContainer = cardElement.querySelector('.card-content');
                    const targetElement = cardElement.querySelector(`#${CSS.escape(targetId)}`);
                    if (contentContainer && targetElement) {
                        const containerRect = contentContainer.getBoundingClientRect();
                        const targetRect = targetElement.getBoundingClientRect();
                        const scrollOffset = targetRect.top - containerRect.top + contentContainer.scrollTop;
                        contentContainer.scrollTo({ top: scrollOffset - 10, behavior: 'smooth' });
                    }
                }
                return;
            }

            // Heading links — copy a deep link to the clipboard
            const headingLink = e.target.closest('.heading-link');
            if (headingLink) {
                e.preventDefault();
                e.stopPropagation();
                const headingId = headingLink.dataset.headingId;
                const cardElement = headingLink.closest('.card');
                if (cardElement && headingId) {
                    const card = this.cards.get(cardElement.dataset.cardId);
                    if (card && card.sourceFile) {
                        const url = `${window.location.origin}${window.location.pathname}#/${card.sourceFile}/${headingId}`;
                        navigator.clipboard.writeText(url).catch(err => console.error('Failed to copy link:', err));
                    }
                }
            }
        });

        // Tag clicks — navigate to the tag page
        container.addEventListener('tag-click', (e) => {
            const { tagName, card } = e.detail;
            const tagCardName = this.registerTagPage(tagName, card);
            this.showCard(tagCardName, true);
        });
    }

    /**
     * React to overlay cards' own events: close on delete, re-anchor on move/resize/pin.
     */
    bindOverlayLayerEvents(layer) {
        layer.addEventListener('card-delete', (e) => {
            const el = e.target.closest('.card');
            const ov = this.overlays.find(o => o.el === el);
            if (ov) this.closeOverlay(ov);
        });
        layer.addEventListener('card-state-changed', (e) => {
            const el = e.target.closest('.card');
            const ov = this.overlays.find(o => o.el === el);
            if (ov) this.syncOverlay(ov);
        });
    }

    /**
     * Spawn a floating overlay card over the current page. Positioned near the click and
     * cascaded for multiples; the card owns its geometry (draggable + scalable) while this
     * layer keeps unpinned overlays anchored to the page as it scrolls. Pass opts.restore to
     * recreate a cached overlay at its saved position.
     */
    async spawnOverlay(cardName, opts = {}) {
        if (!cardName || !this.overlayLayer) return null;
        const card = await this.buildCard(cardName);
        if (!card) return null;
        card.element.classList.add('card-overlay');

        const vw = window.innerWidth, vh = window.innerHeight, mobile = isMobile();
        const restore = opts.restore || null;
        // Scroll container the overlay follows (its source text); falls back to the base card
        const scrollEl = opts.anchorEl || this.baseCard?.element.querySelector('.card-content') || null;
        const scroll = scrollEl ? scrollEl.scrollTop : 0;

        // Compact default size (resizable afterward), clamped to fit
        let width = opts.width || restore?.width || Math.round(mobile ? vw * 0.8 : vw * 0.26);
        let height = opts.height || restore?.height || Math.round(mobile ? vh * 0.4 : vh * 0.52);
        width = Math.max(240, Math.min(width, vw - 24));
        height = Math.max(200, Math.min(height, vh - 24));

        // Position + scroll anchor (docY = position in the page's scroll space)
        let left, top, docY, pinned = false;
        if (restore) {
            pinned = !!restore.pinned;
            left = restore.left;
            top = pinned ? restore.screenTop : (restore.docY - scroll);
            docY = pinned ? (top + scroll) : restore.docY;
        } else {
            const cascade = (this.overlayCascade || 0) * 28;
            left = Math.max(12, Math.min((opts.clickX ?? vw / 2) + 14 + cascade, vw - width - 12));
            top = Math.max(12, Math.min((opts.clickY ?? vh / 3) + 14 + cascade, vh - height - 12));
            docY = top + scroll;
            this.overlayCascade = (this.overlayCascade || 0) + 1;
        }

        // The Card owns its geometry so its native drag/resize work (the canvas is locked at
        // zoom 1 here, so mouse deltas map 1:1 to the viewport).
        card.x = left;
        card.y = top;
        card.width = width;
        card.height = height;
        this.overlayLayer.appendChild(card.element);
        card.updateTransform();
        card.updateMarginSize(0);  // overlays are small — minimize gutters
        if (pinned) card.setPinned(true);

        const ov = { card, el: card.element, cardName, docY, pinned, scrollEl };
        this.overlays.push(ov);
        this.bindOverlayScroll(scrollEl);
        if (!restore) this.saveOverlayCache();
        return ov;
    }

    /**
     * Remove an overlay. Its element is already detached when this is triggered by the
     * card's own delete (close button / Escape); the extra remove() is a harmless no-op.
     */
    closeOverlay(ov) {
        if (!ov) return;
        this.cards.delete(ov.card.id);
        ov.el.remove();
        const i = this.overlays.indexOf(ov);
        if (i >= 0) this.overlays.splice(i, 1);
        this.saveOverlayCache();
    }

    /**
     * Attach a scroll listener to an overlay's source scroll container (deduped) so the
     * overlay follows that text as it scrolls.
     */
    bindOverlayScroll(el) {
        if (!el || el._overlayScrollBound) return;
        el._overlayScrollBound = true;
        el.addEventListener('scroll', () => this.updateOverlayPositions(), { passive: true });
    }

    /**
     * Follow scroll: move each unpinned overlay with its own source container, keeping the
     * card's y in sync so a subsequent drag starts from the correct position.
     */
    updateOverlayPositions() {
        if (!this.overlays) return;
        for (const ov of this.overlays) {
            if (ov.pinned) continue;
            const scroll = ov.scrollEl ? ov.scrollEl.scrollTop : 0;
            const top = ov.docY - scroll;
            ov.card.y = top;
            ov.el.style.top = top + 'px';
        }
    }

    /**
     * Re-sync an overlay after the user moved, resized, or (un)pinned it. A pinned overlay
     * freezes on screen; an unpinned one re-anchors to the page at its current position.
     */
    syncOverlay(ov) {
        const scroll = ov.scrollEl ? ov.scrollEl.scrollTop : 0;
        ov.pinned = ov.card.pinned;
        if (!ov.pinned) ov.docY = ov.card.y + scroll;
        this.saveOverlayCache();
    }

    /**
     * Re-open overlays that were open on this page the last time it was shown.
     */
    restoreOverlaysForPage(cardName) {
        const saved = this.overlayCache?.get(cardName);
        if (!saved || !saved.length) return;
        for (const s of saved) this.spawnOverlay(s.cardName, { restore: s });
    }

    /**
     * Persist the current page's overlays in memory (keyed by page) for back/forward.
     */
    saveOverlayCache() {
        if (!this.currentPage || !this.overlayCache) return;
        if (!this.overlays.length) {
            this.overlayCache.delete(this.currentPage);
            return;
        }
        this.overlayCache.set(this.currentPage, this.overlays.map(o => ({
            cardName: o.cardName,
            left: o.card.x,
            width: o.card.width,
            height: o.card.height,
            pinned: o.pinned,
            docY: o.docY,
            screenTop: o.card.y
        })));
    }

    /**
     * Wire the custom context menu for card links: desktop right-click and mobile
     * long-press. Only card references (data-card, not external data-url) are intercepted;
     * everything else keeps the native browser menu.
     */
    bindContextMenu() {
        const menu = document.createElement('div');
        menu.id = 'link-context-menu';
        menu.style.display = 'none';
        document.body.appendChild(menu);
        this.contextMenu = menu;
        this.hideContextMenu = () => { menu.style.display = 'none'; };

        const linkFor = (target) => {
            const link = target.closest?.('.card-link, .card-overlay-link');
            return (link && link.dataset.card && !link.dataset.url) ? link : null;
        };

        // Desktop right-click (also fires on Android long-press)
        document.addEventListener('contextmenu', (e) => {
            const link = linkFor(e.target);
            if (!link) return;
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY, link.dataset.card, link.textContent.trim(), link.closest('.card-content'));
        });

        // Mobile long-press (iOS, where contextmenu doesn't fire)
        let lpTimer = null, lpMoved = false;
        document.addEventListener('touchstart', (e) => {
            const link = linkFor(e.target);
            if (!link) return;
            lpMoved = false;
            const t = e.touches[0];
            const x = t.clientX, y = t.clientY;
            lpTimer = setTimeout(() => {
                if (!lpMoved) this.showContextMenu(x, y, link.dataset.card, link.textContent.trim(), link.closest('.card-content'));
            }, 500);
        }, { passive: true });
        const cancelLongPress = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
        document.addEventListener('touchmove', () => { lpMoved = true; cancelLongPress(); }, { passive: true });
        document.addEventListener('touchend', cancelLongPress, { passive: true });

        // Dismiss on outside interaction
        document.addEventListener('click', (e) => {
            if (menu.style.display !== 'none' && !menu.contains(e.target) && !menu._justOpened) {
                this.hideContextMenu();
            }
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hideContextMenu(); });
        window.addEventListener('blur', () => this.hideContextMenu());
    }

    /**
     * Populate and position the context menu for a card reference.
     */
    showContextMenu(x, y, cardName, text, anchorEl = null) {
        const base = window.location.origin + window.location.pathname;
        const url = `${base}#/${cardName}`;
        const items = [
            { label: 'Open in split', run: () => this.openInSplit(cardName) },
            { label: 'Open as card', run: () => this.spawnOverlay(cardName, { clickX: x, clickY: y, anchorEl }) },
            { label: 'Open in new tab', run: () => window.open(url, '_blank', 'noopener') },
            { label: 'Open in new window', run: () => window.open(url, '_blank', 'noopener,width=900,height=720') },
            { label: 'Copy link', run: () => navigator.clipboard?.writeText(url).catch(() => {}) },
            { label: 'Copy text', run: () => navigator.clipboard?.writeText(text).catch(() => {}) },
        ];

        const menu = this.contextMenu;
        menu.innerHTML = '';
        for (const it of items) {
            const btn = document.createElement('button');
            btn.className = 'context-menu-item';
            btn.textContent = it.label;
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.hideContextMenu();
                it.run();
            });
            menu.appendChild(btn);
        }

        // Show, then clamp within the viewport
        menu.style.display = 'block';
        menu.style.left = '0px';
        menu.style.top = '0px';
        const rect = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';

        // Guard against the opening interaction immediately dismissing it (touch)
        menu._justOpened = true;
        setTimeout(() => { menu._justOpened = false; }, 300);
    }

    // ========================================
    // Split Screen Mode
    // ========================================

    /**
     * Enter split screen mode with a specific card, or multiple cards from canvas
     * @param {string} cardName - The card to display (used for URL/history)
     * @param {boolean} pushHistory - Whether to push to browser history
     * @param {Array} cardInfos - Optional array of {cardName, x, y, width, height} for multi-card transition
     */
    /**
     * Open a card in the background split: enters split mode (current page | target) if not
     * already split, otherwise adds the target as a new pane beside the most recent one.
     */
    async openInSplit(cardName) {
        if (!cardName) return;
        if (!this.isSplitMode) {
            await this.enterSplitMode(this.currentPage || 'menu');
        }
        const leaf = this.findLastSplitLeaf(this.splitRoot);
        if (leaf) await this.splitPane(leaf, cardName);
    }

    async enterSplitMode(cardName, pushHistory = true, cardInfos = null) {
        // Default to menu if no card specified (e.g. #/ with no name)
        if (!cardName) cardName = 'menu';

        // Register dynamic tag page provider if navigating directly to a tag URL
        if (cardName.startsWith('tag-')) {
            const tagName = cardName.slice(4);
            this.registerTagPage(tagName, null);
        }

        this.isSplitMode = true;
        this.splitModeInitialCard = cardName;
        this.lockCanvas();
        // Keep the page (hidden underneath) and any overlays intact: the split layers on top
        // and overlays keep floating above it. Everything is restored when the split exits.
        this.canvas.classList.add('split-mode');
        document.body.classList.add('split-mode-active');

        // Create fixed overlay container
        this.splitContainer = document.createElement('div');
        this.splitContainer.id = 'split-mode-container';
        document.body.appendChild(this.splitContainer);

        // Build the split tree
        if (cardInfos && cardInfos.length > 1) {
            // Multi-card transition: build tree from card positions
            this.splitRoot = await this.buildSplitTreeFromCards(cardInfos, null);
            this.splitContainer.appendChild(this.splitRoot.element);
        } else {
            // Single card: create a simple root leaf
            this.splitRoot = await this.createSplitLeaf(cardName);
            this.splitContainer.appendChild(this.splitRoot.element);
        }

        // Bind click handler on split container for link interception
        this.splitClickHandler = async (e) => {
            // [[card]] — spawn a floating overlay over the split
            const overlayLink = e.target.closest('.card-overlay-link');
            if (overlayLink && overlayLink.dataset.card) {
                e.preventDefault();
                e.stopPropagation();
                const w = parseInt(overlayLink.dataset.width) || null;
                const h = parseInt(overlayLink.dataset.height) || null;
                this.spawnOverlay(overlayLink.dataset.card, { clickX: e.clientX, clickY: e.clientY, width: w, height: h, anchorEl: overlayLink.closest('.card-content') });
                return;
            }

            const cardLink = e.target.closest('.card-link');
            if (!cardLink) return;

            const targetCard = cardLink.dataset.card;
            const embedUrl = cardLink.dataset.url;

            if (targetCard && !embedUrl) {
                e.preventDefault();
                e.stopPropagation();

                // Register dynamic content providers for tag pages
                if (targetCard.startsWith('tag-')) {
                    const tagName = targetCard.slice(4);
                    this.registerTagPage(tagName, null);
                }

                const pane = cardLink.closest('.split-pane');
                if (pane) {
                    const leafNode = this.findSplitLeafByElement(pane);
                    if (leafNode) {
                        await this.paneNavigate(leafNode, targetCard);
                    }
                }
            }
        };
        this.splitContainer.addEventListener('click', this.splitClickHandler);

        // Handle tag-click events from split pane cards
        this.splitTagClickHandler = async (e) => {
            const { tagName, card } = e.detail;
            const tagCardName = this.registerTagPage(tagName, card);
            const pane = card?.element?.closest('.split-pane');
            if (pane) {
                const leafNode = this.findSplitLeafByElement(pane);
                if (leafNode) {
                    await this.paneNavigate(leafNode, tagCardName);
                }
            }
        };
        this.splitContainer.addEventListener('tag-click', this.splitTagClickHandler);

        // Handle card-delete events from split pane cards (they bubble outside canvas)
        this.splitDeleteHandler = (e) => {
            const cardId = e.detail.cardId;
            const card = this.cards.get(cardId);
            if (card) {
                e.preventDefault();
                const pane = card.element.closest('.split-pane');
                if (pane) {
                    const leafNode = this.findSplitLeafByElement(pane);
                    if (leafNode) {
                        this.pushNavigationState();
                        this.closeSplitPane(leafNode);
                    }
                }
            }
        };
        this.splitContainer.addEventListener('card-delete', this.splitDeleteHandler);

        // Handle jump link clicks (intra-card anchor navigation)
        this.splitJumpHandler = (e) => {
            const jumpLink = e.target.closest('.jump-link');
            if (jumpLink) {
                e.preventDefault();
                const targetId = jumpLink.dataset.jumpTarget;
                const sourceCard = jumpLink.closest('.card');
                if (sourceCard && targetId) {
                    this.jumpToAnchor(sourceCard, targetId);
                }
            }
        };
        this.splitContainer.addEventListener('click', this.splitJumpHandler);

        // Handle TOC link clicks (scroll to heading within the card)
        this.splitTocHandler = (e) => {
            const tocLink = e.target.closest('[data-toc-target]');
            if (tocLink) {
                e.preventDefault();
                e.stopPropagation();
                const targetId = tocLink.dataset.tocTarget;
                const cardElement = tocLink.closest('.card');
                if (cardElement && targetId) {
                    const contentContainer = cardElement.querySelector('.card-content');
                    const targetElement = cardElement.querySelector(`#${CSS.escape(targetId)}`);
                    if (contentContainer && targetElement) {
                        const containerRect = contentContainer.getBoundingClientRect();
                        const targetRect = targetElement.getBoundingClientRect();
                        const scrollOffset = targetRect.top - containerRect.top + contentContainer.scrollTop;
                        contentContainer.scrollTo({
                            top: scrollOffset - 10,
                            behavior: 'smooth'
                        });
                    }
                }
            }
        };
        this.splitContainer.addEventListener('click', this.splitTocHandler);

        // Handle heading link clicks (copy URL to clipboard)
        this.splitHeadingLinkHandler = (e) => {
            const headingLink = e.target.closest('.heading-link');
            if (headingLink) {
                e.preventDefault();
                e.stopPropagation();
                const headingId = headingLink.dataset.headingId;
                const cardElement = headingLink.closest('.card');
                if (cardElement && headingId) {
                    const cardId = cardElement.dataset.cardId;
                    const card = this.cards.get(cardId);
                    if (card && card.sourceFile) {
                        const url = `${window.location.origin}${window.location.pathname}#/${card.sourceFile}/${headingId}`;
                        navigator.clipboard.writeText(url).catch(err => {
                            console.error('Failed to copy link:', err);
                        });
                    }
                }
            }
        };
        this.splitContainer.addEventListener('click', this.splitHeadingLinkHandler);


        // Split is ephemeral: don't touch the URL. Push one history entry (same URL) so the
        // browser back button exits the split.
        if (pushHistory) {
            window.history.pushState({ split: true }, '', window.location.href);
        }
    }

    /**
     * Clean up split mode state without navigating
     */
    cleanupSplitMode() {
        this.isSplitMode = false;
        this.unlockCanvas();
        this.canvas.classList.remove('split-mode');
        document.body.classList.remove('split-mode-active');

        // Remove event listeners
        if (this.splitContainer && this.splitClickHandler) {
            this.splitContainer.removeEventListener('click', this.splitClickHandler);
            this.splitClickHandler = null;
        }
        if (this.splitContainer && this.splitTagClickHandler) {
            this.splitContainer.removeEventListener('tag-click', this.splitTagClickHandler);
            this.splitTagClickHandler = null;
        }
        if (this.splitContainer && this.splitDeleteHandler) {
            this.splitContainer.removeEventListener('card-delete', this.splitDeleteHandler);
            this.splitDeleteHandler = null;
        }
        if (this.splitContainer && this.splitJumpHandler) {
            this.splitContainer.removeEventListener('click', this.splitJumpHandler);
            this.splitJumpHandler = null;
        }
        if (this.splitContainer && this.splitTocHandler) {
            this.splitContainer.removeEventListener('click', this.splitTocHandler);
            this.splitTocHandler = null;
        }
        if (this.splitContainer && this.splitHeadingLinkHandler) {
            this.splitContainer.removeEventListener('click', this.splitHeadingLinkHandler);
            this.splitHeadingLinkHandler = null;
        }

        // Destroy all cards in the tree
        this.destroySplitTree(this.splitRoot);
        this.splitRoot = null;
        this.splitModeInitialCard = null;

        // Remove the container
        if (this.splitContainer) {
            this.splitContainer.remove();
            this.splitContainer = null;
        }
    }

    /**
     * Exit split mode and return to the single-page reading view.
     */
    async exitSplitMode(cardName = null) {
        if (!cardName) {
            const firstLeaf = this.findFirstSplitLeaf(this.splitRoot);
            cardName = (firstLeaf && firstLeaf.cardName && firstLeaf.cardName !== 'editor')
                ? firstLeaf.cardName
                : (this.currentPage || 'menu');
        }
        this.cleanupSplitMode();
        await this.showCard(cardName, false);
    }

    /**
     * Build a split tree from an array of card position infos.
     * Recursively partitions cards spatially into a binary tree.
     */
    async buildSplitTreeFromCards(cardInfos, parent) {
        if (cardInfos.length === 1) {
            const info = cardInfos[0];
            let leaf;
            if (info.isEditor) {
                leaf = this.createSplitEditorLeaf(info.filename);
                if (info.filename) {
                    await leaf.editor.loadFile(info.filename);
                }
            } else {
                leaf = await this.createSplitLeaf(info.cardName);
            }
            leaf.parent = parent;
            return leaf;
        }

        // Compute bounding box of all cards
        const minX = Math.min(...cardInfos.map(c => c.x));
        const minY = Math.min(...cardInfos.map(c => c.y));
        const maxX = Math.max(...cardInfos.map(c => c.x + c.width));
        const maxY = Math.max(...cardInfos.map(c => c.y + c.height));
        const spanW = maxX - minX;
        const spanH = maxY - minY;

        // Choose split direction based on bounding box aspect ratio
        const direction = spanW >= spanH ? 'vertical' : 'horizontal';

        // Sort by center position along the split axis
        const sorted = [...cardInfos].sort((a, b) => {
            if (direction === 'vertical') {
                return (a.x + a.width / 2) - (b.x + b.width / 2);
            } else {
                return (a.y + a.height / 2) - (b.y + b.height / 2);
            }
        });

        // Split at median
        const mid = Math.ceil(sorted.length / 2);
        const firstGroup = sorted.slice(0, mid);
        const secondGroup = sorted.slice(mid);

        // Calculate split ratio based on the total size each group occupies
        let ratio;
        if (direction === 'vertical') {
            const firstMaxX = Math.max(...firstGroup.map(c => c.x + c.width));
            const secondMinX = Math.min(...secondGroup.map(c => c.x));
            const splitPoint = (firstMaxX + secondMinX) / 2;
            ratio = Math.max(SPLIT_MIN_PANE_RATIO, Math.min(1 - SPLIT_MIN_PANE_RATIO,
                (splitPoint - minX) / spanW
            ));
        } else {
            const firstMaxY = Math.max(...firstGroup.map(c => c.y + c.height));
            const secondMinY = Math.min(...secondGroup.map(c => c.y));
            const splitPoint = (firstMaxY + secondMinY) / 2;
            ratio = Math.max(SPLIT_MIN_PANE_RATIO, Math.min(1 - SPLIT_MIN_PANE_RATIO,
                (splitPoint - minY) / spanH
            ));
        }

        // Create DOM container
        const container = document.createElement('div');
        container.className = 'split-container';
        container.classList.add(direction === 'vertical' ? 'split-vertical' : 'split-horizontal');

        const divider = document.createElement('div');
        divider.className = 'split-divider';
        divider.classList.add(direction === 'vertical' ? 'split-divider-vertical' : 'split-divider-horizontal');

        // Create branch node (parent refs set after children are built)
        const branchNode = {
            type: direction,
            first: null,
            second: null,
            splitRatio: ratio,
            divider,
            element: container,
            parent
        };

        // Recursively build children
        branchNode.first = await this.buildSplitTreeFromCards(firstGroup, branchNode);
        branchNode.second = await this.buildSplitTreeFromCards(secondGroup, branchNode);

        // Assemble DOM
        container.appendChild(branchNode.first.element);
        container.appendChild(divider);
        container.appendChild(branchNode.second.element);

        this.applySplitRatio(branchNode);
        this.bindDividerDrag(branchNode);

        return branchNode;
    }

    /**
     * Create a leaf node for the split tree
     */
    async createSplitLeaf(cardName) {
        const pane = document.createElement('div');
        pane.className = 'split-pane';
        pane.dataset.cardName = cardName;

        const card = await this.buildCard(cardName);
        if (!card) {
            pane.innerHTML = `<div class="split-pane-empty">Card "${cardName}" not found</div>`;
            const node = { type: 'leaf', cardName, card: null, element: pane, parent: null, history: [cardName], historyIndex: 0 };
            this.addSplitPaneControls(pane, node);
            return node;
        }

        card.element.classList.add('card-split-mode');
        if (this.settings && !this.settings.cardShadow) {
            card.element.style.filter = 'none';
        }
        pane.appendChild(card.element);

        // Observe pane size and update card dimensions + margins accordingly
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    card.width = width;
                    card.height = height;
                    // Recalculate margins based on actual pane dimensions
                    if (card.marginTB === null && card.marginLR === null && this.settings?.marginSize !== undefined) {
                        const marginMultiplier = isMobile() ? 1.4 : 1.1;
                        const splitMargin = Math.min(45, this.settings.marginSize * marginMultiplier);
                        card.updateMarginSize(splitMargin);
                    }
                }
            }
        });
        observer.observe(pane);

        const node = { type: 'leaf', cardName, card, element: pane, parent: null, resizeObserver: observer, history: [cardName], historyIndex: 0 };
        this.addSplitPaneControls(pane, node);
        return node;
    }

    /**
     * Add control buttons (drag handle + close) to a split pane
     */
    addSplitPaneControls(pane, node) {
        const controls = document.createElement('div');
        controls.className = 'split-pane-controls';

        // Drag handle for swapping panes
        const dragBtn = document.createElement('button');
        dragBtn.className = 'split-pane-drag';
        dragBtn.innerHTML = '⠿';
        dragBtn.title = 'Drag to swap with another pane';
        dragBtn.draggable = true;

        // --- Desktop: HTML5 drag-and-drop ---
        dragBtn.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            this._dragSourceNode = node;
            pane.classList.add('split-pane-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
        });

        dragBtn.addEventListener('dragend', (e) => {
            e.stopPropagation();
            pane.classList.remove('split-pane-dragging');
            this._dragSourceNode = null;
            this.splitContainer.querySelectorAll('.split-pane-drop-target').forEach(el => {
                el.classList.remove('split-pane-drop-target');
            });
        });

        pane.addEventListener('dragover', (e) => {
            if (!this._dragSourceNode || this._dragSourceNode === node) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            pane.classList.add('split-pane-drop-target');
        });

        pane.addEventListener('dragleave', (e) => {
            if (!pane.contains(e.relatedTarget)) {
                pane.classList.remove('split-pane-drop-target');
            }
        });

        pane.addEventListener('drop', (e) => {
            e.preventDefault();
            pane.classList.remove('split-pane-drop-target');
            if (!this._dragSourceNode || this._dragSourceNode === node) return;
            this.swapSplitPanes(this._dragSourceNode, node);
            this._dragSourceNode = null;
        });

        // --- Mobile: touch-based drag-to-swap ---
        dragBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._dragSourceNode = node;
            this._dragTouchId = e.changedTouches[0].identifier;
            pane.classList.add('split-pane-dragging');

            // Create floating indicator that follows the finger
            const touch = e.changedTouches[0];
            const indicator = document.createElement('div');
            indicator.className = 'split-drag-indicator';
            indicator.innerHTML = '⠿';
            indicator.style.left = touch.clientX + 'px';
            indicator.style.top = touch.clientY + 'px';
            document.body.appendChild(indicator);
            this._dragIndicator = indicator;
        });

        dragBtn.addEventListener('touchmove', (e) => {
            if (!this._dragSourceNode || this._dragSourceNode !== node) return;
            e.preventDefault();
            e.stopPropagation();

            const touch = [...e.changedTouches].find(t => t.identifier === this._dragTouchId);
            if (!touch) return;

            // Move indicator
            if (this._dragIndicator) {
                this._dragIndicator.style.left = touch.clientX + 'px';
                this._dragIndicator.style.top = touch.clientY + 'px';
            }

            // Highlight pane under finger
            const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetPane = elementUnder?.closest('.split-pane');

            // Clear previous highlights
            this.splitContainer.querySelectorAll('.split-pane-drop-target').forEach(el => {
                el.classList.remove('split-pane-drop-target');
            });

            if (targetPane && targetPane !== pane) {
                targetPane.classList.add('split-pane-drop-target');
            }
        });

        dragBtn.addEventListener('touchend', (e) => {
            if (!this._dragSourceNode || this._dragSourceNode !== node) return;
            e.preventDefault();
            e.stopPropagation();

            const touch = [...e.changedTouches].find(t => t.identifier === this._dragTouchId);
            if (touch) {
                const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY);
                const targetPane = elementUnder?.closest('.split-pane');
                if (targetPane && targetPane !== pane) {
                    const targetNode = this.findSplitLeafByElement(targetPane);
                    if (targetNode) {
                        this.swapSplitPanes(node, targetNode);
                    }
                }
            }

            // Cleanup
            pane.classList.remove('split-pane-dragging');
            this._dragSourceNode = null;
            this._dragTouchId = null;
            if (this._dragIndicator) {
                this._dragIndicator.remove();
                this._dragIndicator = null;
            }
            this.splitContainer.querySelectorAll('.split-pane-drop-target').forEach(el => {
                el.classList.remove('split-pane-drop-target');
            });
        });

        dragBtn.addEventListener('touchcancel', () => {
            pane.classList.remove('split-pane-dragging');
            this._dragSourceNode = null;
            this._dragTouchId = null;
            if (this._dragIndicator) {
                this._dragIndicator.remove();
                this._dragIndicator = null;
            }
            this.splitContainer.querySelectorAll('.split-pane-drop-target').forEach(el => {
                el.classList.remove('split-pane-drop-target');
            });
        });

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'split-pane-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Close pane';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pushNavigationState();
            this.closeSplitPane(node);
        });

        controls.appendChild(dragBtn);
        controls.appendChild(closeBtn);
        pane.appendChild(controls);

        // Prev/next navigation for this pane's own history (top-left)
        const nav = document.createElement('div');
        nav.className = 'split-pane-nav';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'split-pane-nav-btn split-nav-prev';
        prevBtn.innerHTML = '‹';
        prevBtn.title = 'Back';
        prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.paneGoBack(node); });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'split-pane-nav-btn split-nav-next';
        nextBtn.innerHTML = '›';
        nextBtn.title = 'Forward';
        nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.paneGoForward(node); });

        nav.appendChild(prevBtn);
        nav.appendChild(nextBtn);
        pane.appendChild(nav);
        this.updatePaneNavButtons(node);
    }

    /**
     * Swap the contents of two split pane leaf nodes
     */
    swapSplitPanes(nodeA, nodeB) {
        if (!nodeA || !nodeB || nodeA === nodeB) return;
        if (nodeA.type !== 'leaf' || nodeB.type !== 'leaf') return;

        const paneA = nodeA.element;
        const paneB = nodeB.element;

        // Swap card/editor references
        const tempCard = nodeA.card;
        const tempEditor = nodeA.editor;
        const tempCardName = nodeA.cardName;
        const tempObserver = nodeA.resizeObserver;

        nodeA.card = nodeB.card;
        nodeA.editor = nodeB.editor;
        nodeA.cardName = nodeB.cardName;
        nodeA.resizeObserver = nodeB.resizeObserver;

        nodeB.card = tempCard;
        nodeB.editor = tempEditor;
        nodeB.cardName = tempCardName;
        nodeB.resizeObserver = tempObserver;

        // Swap the card/editor DOM elements between panes
        // Collect content children (not the controls div)
        const contentA = [];
        const contentB = [];
        for (const child of [...paneA.children]) {
            if (!child.classList.contains('split-pane-controls')) {
                contentA.push(child);
            }
        }
        for (const child of [...paneB.children]) {
            if (!child.classList.contains('split-pane-controls')) {
                contentB.push(child);
            }
        }

        // Move B's content to A, A's content to B
        contentA.forEach(el => paneB.insertBefore(el, paneB.querySelector('.split-pane-controls')));
        contentB.forEach(el => paneA.insertBefore(el, paneA.querySelector('.split-pane-controls')));

        // Re-observe the correct panes
        if (nodeA.resizeObserver) {
            nodeA.resizeObserver.disconnect();
            nodeA.resizeObserver.observe(paneA);
        }
        if (nodeB.resizeObserver) {
            nodeB.resizeObserver.disconnect();
            nodeB.resizeObserver.observe(paneB);
        }
    }

    /**
     * Split a leaf pane to show a new card alongside it
     */
    /**
     * Replace the card shown in a split pane, keeping the pane's place in the tree.
     * (A regular link click navigates within its pane; use splitPane to add a new pane.)
     */
    async navigatePaneToCard(oldLeaf, cardName, history = null, index = null) {
        if (!oldLeaf) return;
        const newLeaf = await this.createSplitLeaf(cardName);
        if (history) {
            newLeaf.history = history;
            newLeaf.historyIndex = index;
        }

        // Preserve the pane's size within its parent split
        newLeaf.element.style.flex = oldLeaf.element.style.flex;

        // Swap the pane element in the DOM
        const domParent = oldLeaf.element.parentElement;
        if (domParent) domParent.replaceChild(newLeaf.element, oldLeaf.element);

        // Swap the leaf node in the tree
        newLeaf.parent = oldLeaf.parent;
        if (this.splitRoot === oldLeaf) {
            this.splitRoot = newLeaf;
        } else if (oldLeaf.parent) {
            if (oldLeaf.parent.first === oldLeaf) oldLeaf.parent.first = newLeaf;
            else oldLeaf.parent.second = newLeaf;
        }

        // Tear down the old leaf's card/editor/observer
        if (oldLeaf.resizeObserver) oldLeaf.resizeObserver.disconnect();
        if (oldLeaf.editor) {
            oldLeaf.editor.stopAutosave?.();
            if (oldLeaf.editor.updateDebounceTimer) clearTimeout(oldLeaf.editor.updateDebounceTimer);
            this.editorCards.delete(oldLeaf.editor.id);
        }
        if (oldLeaf.card) {
            this.removeConnectionsForCard(oldLeaf.card.id);
            this.cards.delete(oldLeaf.card.id);
        }

        this.updatePaneNavButtons(newLeaf);
        return newLeaf;
    }

    /**
     * Navigate a pane to a card via a link click: pushes onto the pane's own history
     * (dropping any forward entries).
     */
    async paneNavigate(leaf, cardName) {
        const hist = (leaf.history || [leaf.cardName]).slice(0, (leaf.historyIndex ?? 0) + 1);
        hist.push(cardName);
        await this.navigatePaneToCard(leaf, cardName, hist, hist.length - 1);
    }

    /** Step back in a pane's own history. */
    async paneGoBack(leaf) {
        if (!leaf.history || (leaf.historyIndex ?? 0) <= 0) return;
        const i = leaf.historyIndex - 1;
        await this.navigatePaneToCard(leaf, leaf.history[i], leaf.history, i);
    }

    /** Step forward in a pane's own history. */
    async paneGoForward(leaf) {
        if (!leaf.history || (leaf.historyIndex ?? 0) >= leaf.history.length - 1) return;
        const i = leaf.historyIndex + 1;
        await this.navigatePaneToCard(leaf, leaf.history[i], leaf.history, i);
    }

    /** Enable/disable a pane's prev/next arrows based on its history position. */
    updatePaneNavButtons(leaf) {
        if (!leaf || !leaf.element) return;
        const idx = leaf.historyIndex ?? 0;
        const len = leaf.history ? leaf.history.length : 0;
        const prev = leaf.element.querySelector('.split-nav-prev');
        const next = leaf.element.querySelector('.split-nav-next');
        if (prev) prev.disabled = !(idx > 0);
        if (next) next.disabled = !(len > 0 && idx < len - 1);
    }

    async splitPane(leafNode, newCardName) {
        const paneElement = leafNode.element;
        const rect = paneElement.getBoundingClientRect();

        // Determine split direction based on pane aspect ratio
        const direction = rect.width >= rect.height ? 'vertical' : 'horizontal';

        // Create new leaf for the linked card
        const newLeaf = await this.createSplitLeaf(newCardName);

        // Create the branch container
        const container = document.createElement('div');
        container.className = 'split-container';
        container.classList.add(direction === 'vertical' ? 'split-vertical' : 'split-horizontal');

        // Create divider
        const divider = document.createElement('div');
        divider.className = 'split-divider';
        divider.classList.add(direction === 'vertical' ? 'split-divider-vertical' : 'split-divider-horizontal');

        // Swap in the DOM: replace leaf element with container, then put leaf inside container
        const domParent = paneElement.parentElement;
        domParent.replaceChild(container, paneElement);

        // Assemble container: [existing pane] [divider] [new pane]
        container.appendChild(paneElement);
        container.appendChild(divider);
        container.appendChild(newLeaf.element);

        // Create branch node
        const branchNode = {
            type: direction,
            first: leafNode,
            second: newLeaf,
            splitRatio: 0.5,
            divider,
            element: container,
            parent: leafNode.parent
        };

        // Update parent references
        leafNode.parent = branchNode;
        newLeaf.parent = branchNode;

        // Replace in tree
        if (this.splitRoot === leafNode) {
            this.splitRoot = branchNode;
        } else {
            const grandparent = branchNode.parent;
            if (grandparent.first === leafNode) {
                grandparent.first = branchNode;
            } else {
                grandparent.second = branchNode;
            }
        }

        // Apply layout
        this.applySplitRatio(branchNode);

        // Bind divider drag
        this.bindDividerDrag(branchNode);

        // Update URL to reflect open panes
        this.updateURLWithOpenCards();
    }
    async splitPaneWithEditor(leafNode, filename = null) {
        const newLeaf = this.createSplitEditorLeaf(filename);

        const paneElement = leafNode.element;
        const rect = paneElement.getBoundingClientRect();
        const direction = rect.width >= rect.height ? 'vertical' : 'horizontal';

        const container = document.createElement('div');
        container.className = 'split-container';
        container.classList.add(direction === 'vertical' ? 'split-vertical' : 'split-horizontal');

        const divider = document.createElement('div');
        divider.className = 'split-divider';
        divider.classList.add(direction === 'vertical' ? 'split-divider-vertical' : 'split-divider-horizontal');

        const domParent = paneElement.parentElement;
        domParent.replaceChild(container, paneElement);

        container.appendChild(paneElement);
        container.appendChild(divider);
        container.appendChild(newLeaf.element);

        const branchNode = {
            type: direction,
            first: leafNode,
            second: newLeaf,
            splitRatio: 0.5,
            divider,
            element: container,
            parent: leafNode.parent
        };

        leafNode.parent = branchNode;
        newLeaf.parent = branchNode;

        if (this.splitRoot === leafNode) {
            this.splitRoot = branchNode;
        } else {
            const grandparent = branchNode.parent;
            if (grandparent.first === leafNode) {
                grandparent.first = branchNode;
            } else {
                grandparent.second = branchNode;
            }
        }

        this.applySplitRatio(branchNode);
        this.bindDividerDrag(branchNode);

        // Load file after it's in the DOM
        if (filename && newLeaf.editor) {
            await newLeaf.editor.loadFile(filename);
        }

        this.updateURLWithOpenCards();
        this.scheduleLayoutSave();
    }

    /**
     * Create a split leaf containing an EditorCard
     */
    createSplitEditorLeaf(filename = null) {
        const pane = document.createElement('div');
        pane.className = 'split-pane';
        pane.dataset.cardName = 'editor';

        const editor = new this.EditorCard({
            x: 0, y: 0,
            width: window.innerWidth, height: window.innerHeight,
            rotation: 0,
            parser: this.parser,
            fsManager: this.fsManager,
            canvas: this,
            zIndex: 1,
            filename: filename || ''
        });

        editor.element.classList.add('card-split-mode');
        this.editorCards.set(editor.id, editor);
        pane.appendChild(editor.element);

        const node = { type: 'leaf', cardName: 'editor', card: null, editor, element: pane, parent: null, resizeObserver: null, history: [], historyIndex: 0 };
        this.addSplitPaneControls(pane, node);
        return node;
    }

    /**
     * Close a split pane, promoting its sibling
     */
    closeSplitPane(leafNode) {
        // If this is the only pane, replace it with the menu
        if (leafNode === this.splitRoot) {
            // Clean up the old leaf
            if (leafNode.resizeObserver) leafNode.resizeObserver.disconnect();
            if (leafNode.editor) {
                leafNode.editor.stopAutosave();
                if (leafNode.editor.updateDebounceTimer) {
                    clearTimeout(leafNode.editor.updateDebounceTimer);
                }
                this.editorCards.delete(leafNode.editor.id);
                leafNode.editor.element.remove();
            }
            if (leafNode.card) {
                this.removeConnectionsForCard(leafNode.card.id);
                this.cards.delete(leafNode.card.id);
                leafNode.card.element.remove();
            }
            // Closing the last pane exits the split, showing this card as the page
            const lastCard = (leafNode.cardName && leafNode.cardName !== 'editor')
                ? leafNode.cardName : this.currentPage;
            this.exitSplitMode(lastCard);
            return;
        }

        const parent = leafNode.parent;
        const sibling = (parent.first === leafNode) ? parent.second : parent.first;

        // Remove the card from cards map
        if (leafNode.resizeObserver) {
            leafNode.resizeObserver.disconnect();
        }
        if (leafNode.editor) {
            leafNode.editor.stopAutosave();
            if (leafNode.editor.updateDebounceTimer) {
                clearTimeout(leafNode.editor.updateDebounceTimer);
            }
            this.editorCards.delete(leafNode.editor.id);
            leafNode.editor.element.remove();
        }
        if (leafNode.card) {
            const sourceFile = leafNode.card.sourceFile;
            this.removeConnectionsForCard(leafNode.card.id);
            this.cards.delete(leafNode.card.id);
            leafNode.card.element.remove();

            // Unwatch file if no other card uses it
            if (sourceFile && !leafNode.card.isDynamic) {
                let stillUsed = false;
                this.cards.forEach(c => {
                    if (c.sourceFile === sourceFile) stillUsed = true;
                });
                if (!stillUsed) this.fileWatcher.unwatch(sourceFile);
            }
        }

        // Promote sibling to take parent's place
        sibling.parent = parent.parent;

        if (parent === this.splitRoot) {
            this.splitRoot = sibling;
            // Clear inline flex style so sibling fills the container
            sibling.element.style.flex = '';
            this.splitContainer.innerHTML = '';
            this.splitContainer.appendChild(sibling.element);
        } else {
            const grandparent = parent.parent;
            if (grandparent.first === parent) {
                grandparent.first = sibling;
            } else {
                grandparent.second = sibling;
            }
            grandparent.element.replaceChild(sibling.element, parent.element);
            // Reapply grandparent's ratio to correctly size the promoted sibling
            this.applySplitRatio(grandparent);
        }

        // Clean up parent references
        parent.divider = null;
        parent.element = null;

        // Update URL to reflect remaining panes
        this.updateURLWithOpenCards();
    }
    destroySplitTree(node) {
        if (!node) return;
        if (node.type === 'leaf') {
            if (node.resizeObserver) node.resizeObserver.disconnect();
            if (node.editor) {
                node.editor.stopAutosave();
                if (node.editor.updateDebounceTimer) {
                    clearTimeout(node.editor.updateDebounceTimer);
                }
                this.editorCards.delete(node.editor.id);
                node.editor.element.remove();
            }
            if (node.card) {
                this.removeConnectionsForCard(node.card.id);
                this.cards.delete(node.card.id);
                node.card.element.remove();
            }
        } else {
            this.destroySplitTree(node.first);
            this.destroySplitTree(node.second);
        }
    }

    /**
     * Apply split ratio to a branch node's children via flex
     */
    applySplitRatio(branchNode) {
        const ratio = branchNode.splitRatio;
        const divSize = SPLIT_DIVIDER_SIZE;
        branchNode.first.element.style.flex = `0 0 calc(${ratio * 100}% - ${divSize / 2}px)`;
        branchNode.second.element.style.flex = `0 0 calc(${(1 - ratio) * 100}% - ${divSize / 2}px)`;
    }

    /**
     * Bind mouse/touch drag events on a split divider for resizing
     */
    bindDividerDrag(branchNode) {
        const divider = branchNode.divider;
        const isVertical = branchNode.type === 'vertical';

        let startPos = 0;
        let startRatio = 0;
        let containerSize = 0;

        const onMouseDown = (e) => {
            e.preventDefault();
            startPos = isVertical ? e.clientX : e.clientY;
            startRatio = branchNode.splitRatio;
            containerSize = isVertical
                ? branchNode.element.getBoundingClientRect().width
                : branchNode.element.getBoundingClientRect().height;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';
            document.body.style.userSelect = 'none';
            divider.classList.add('active');
        };

        const onMouseMove = (e) => {
            const currentPos = isVertical ? e.clientX : e.clientY;
            const delta = (currentPos - startPos) / containerSize;
            branchNode.splitRatio = Math.max(SPLIT_MIN_PANE_RATIO, Math.min(1 - SPLIT_MIN_PANE_RATIO, startRatio + delta));
            this.applySplitRatio(branchNode);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            divider.classList.remove('active');
            this.scheduleLayoutSave();
        };

        divider.addEventListener('mousedown', onMouseDown);

        // Touch support
        divider.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            startPos = isVertical ? touch.clientX : touch.clientY;
            startRatio = branchNode.splitRatio;
            containerSize = isVertical
                ? branchNode.element.getBoundingClientRect().width
                : branchNode.element.getBoundingClientRect().height;
            divider.classList.add('active');
            document.body.style.userSelect = 'none';
        });

        divider.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const currentPos = isVertical ? touch.clientX : touch.clientY;
            const delta = (currentPos - startPos) / containerSize;
            branchNode.splitRatio = Math.max(SPLIT_MIN_PANE_RATIO, Math.min(1 - SPLIT_MIN_PANE_RATIO, startRatio + delta));
            this.applySplitRatio(branchNode);
        });

        divider.addEventListener('touchend', () => {
            divider.classList.remove('active');
            document.body.style.userSelect = '';
        });
    }

    /**
     * Find a split tree leaf node by its DOM element
     */
    findSplitLeafByElement(paneElement) {
        const search = (node) => {
            if (!node) return null;
            if (node.type === 'leaf' && node.element === paneElement) return node;
            if (node.type !== 'leaf') {
                return search(node.first) || search(node.second);
            }
            return null;
        };
        return search(this.splitRoot);
    }

    /**
     * Find the last (deepest-right) leaf in the split tree
     */
    findLastSplitLeaf(node) {
        if (!node) return null;
        if (node.type === 'leaf') return node;
        return this.findLastSplitLeaf(node.second) || this.findLastSplitLeaf(node.first);
    }

    /**
     * Find the first leaf in the split tree
     */
    findFirstSplitLeaf(node) {
        if (!node) return null;
        if (node.type === 'leaf') return node;
        return this.findFirstSplitLeaf(node.first) || this.findFirstSplitLeaf(node.second);
    }

    /**
     * Handle browser back/forward navigation
     */
    handlePopState() {
        // In split mode, back exits the split rather than navigating
        if (this.isSplitMode) { this.exitSplitMode(); return; }
        this.loadFromURL();
    }

    handleHashChange() {
        this.loadFromURL();
    }

    // Re-render the page from the current URL (browser back/forward, manual hash edits)
    async loadFromURL() {
        const info = this.getCardNameFromURL();
        await this.showCard(info?.cardName || 'menu', false, info?.headingId || null);
    }

    /**
     * Handle viewport resize
     */
    handleResize() {
        // Split mode: flexbox handles resize automatically
        if (this.isSplitMode) return;
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

// Helper to jump to an anchor within a card (for debugging and future extensions)
window.jumpToAnchor = (cardElementOrId, targetId) => {
    return app.jumpToAnchor(cardElementOrId, targetId);
};
