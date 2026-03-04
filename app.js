import { Card } from './Card.js';
import { MarkdownParser } from './MarkdownParser.js';
import { CardCrypto } from './Crypto.js';
import { controlsManager, SettingsConfig } from './Controls.js';
import { vizManager } from './Visualizations.js';
import { Z_INDEX_BASE, Z_INDEX_CARD_CAP, Z_INDEX_PREVIEW, CARD_DEFAULT_WIDTH, CARD_TEMPLATE_WIDTH, CARD_TEMPLATE_HEIGHT, DEFAULT_MARGIN_PERCENT, isMobile } from './constants.js';

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

        // Live-reload file watcher
        this.fileWatcher = new FileWatcherClient(this);

        // Editor support - initialized dynamically on localhost only
        this.fsManager = null;
        this.editorCards = new Map();

        // State persistence
        this.saveDebounceTimer = null;
        this.SAVE_DEBOUNCE_MS = 1000; // 1 second debounce
        this.isRestoring = false; // Flag to prevent saves during restoration

        this.init();
    }

    async init() {
        // Check if this is a hard refresh (flag set before reload)
        if (sessionStorage.getItem('paper-canvas-hard-refresh')) {
            sessionStorage.removeItem('paper-canvas-hard-refresh');
            localStorage.removeItem('paper-canvas-state');
            // Also clear saved settings so they reset to defaults
            Object.values(SettingsConfig).forEach(config => {
                localStorage.removeItem(config.storage);
            });
        }

        this.bindCanvasEvents();
        this.initSettings();
        this.initConnectionsLayer();
        this.initEditor();

        // Load drop cap metrics for per-letter spacing
        this.loadDropcapMetrics();

        // Listen for hard refresh (Ctrl+Shift+R / Cmd+Shift+R) to clear saved state
        window.addEventListener('keydown', (e) => {
            const isHardRefresh = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r');
            if (isHardRefresh) {
                // Set flag that will persist through the refresh
                sessionStorage.setItem('paper-canvas-hard-refresh', 'true');
            }
        });

        // Save state immediately before page unload (refresh, close, navigate away)
        // This ensures state is persisted even if the debounce timer hasn't fired
        window.addEventListener('beforeunload', () => {
            // Cancel any pending debounced save
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
            }
            // Save immediately (unless we're restoring)
            if (!this.isRestoring) {
                this.saveCanvasState();
            }
        });

        // Connect to live-reload WebSocket server
        this.fileWatcher.connect();

        // Build comprehensive tag index from all files first
        await this.buildGlobalTagIndex();

        this.initContentProviders(); // Initialize the content provider system

        // Bind browser history navigation
        window.addEventListener('popstate', (e) => this.handlePopState(e));

        // Bind hash change for direct URL edits (address bar changes)
        window.addEventListener('hashchange', () => this.handleHashChange());

        // Bind swipe gestures for reader mode
        this.bindReaderModeSwipes();

        // Bind viewport resize for reader mode
        window.addEventListener('resize', () => this.handleResize());

        // Check URL for direct card routing (takes priority over saved state)
        const urlInfo = this.getCardNameFromURL();

        if (urlInfo) {
            // URL specifies a card - clear any saved state and load that card
            localStorage.removeItem('paper-canvas-state');

            if (urlInfo.readerMode) {
                // Enter reader mode directly from URL
                await this.enterReaderMode(urlInfo.cardName, false);
                // Scroll to heading if specified
                if (urlInfo.headingId) {
                    this.scrollToHeadingInReaderMode(urlInfo.headingId);
                }
            } else {
                // Normal mode with specific card
                // Reset canvas view
                this.panX = 0;
                this.panY = 0;
                this.zoom = 1;
                this.rotation = 0;
                this.updateCanvasTransform();

                // Load card filling most of the viewport
                const card = await this.loadCardFromFile(urlInfo.cardName, { fillViewport: true });
                if (!card) {
                    // Card not found, fall back to menu
                    console.warn(`Card "${urlInfo.cardName}" not found, loading menu`);
                    await this.loadMenuCard();
                } else if (urlInfo.headingId) {
                    // Scroll to heading if specified
                    this.scrollToHeadingInCard(card, urlInfo.headingId);
                }
            }
        } else {
            // No URL card specified - try to restore saved state
            const savedState = this.loadSavedState();

            if (savedState && savedState.cards && savedState.cards.length > 0) {
                // Restore saved canvas state
                await this.restoreCanvasState(savedState);
            } else {
                // No saved state, load the menu
                await this.loadMenuCard();
            }
        }
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
        // Check pathname first (for SPA-configured servers)
        const path = window.location.pathname;
        const pathCard = decodeURIComponent(path.replace(/^\/+|\/+$/g, ''));
        if (pathCard) {
            // Check for reader mode prefix in pathname
            if (pathCard.startsWith('r/')) {
                const rest = pathCard.slice(2);
                const [cardName, headingId] = this.parseCardAndHeading(rest);
                return { cardName, readerMode: true, headingId };
            }
            const [cardName, headingId] = this.parseCardAndHeading(pathCard);
            return { cardName, readerMode: false, headingId };
        }

        // Check hash (works with any static server: /#journal or #journal)
        const hash = window.location.hash;
        const hashCard = decodeURIComponent(hash.replace(/^#\/?/, ''));
        if (hashCard) {
            // Check for reader mode prefix in hash (e.g., #/r/journal or #r/journal)
            if (hashCard.startsWith('r/')) {
                const rest = hashCard.slice(2);
                const [cardName, headingId] = this.parseCardAndHeading(rest);
                return { cardName, readerMode: true, headingId };
            }
            const [cardName, headingId] = this.parseCardAndHeading(hashCard);
            return { cardName, readerMode: false, headingId };
        }

        // Check query parameter (?page=journal)
        const params = new URLSearchParams(window.location.search);
        const queryCard = params.get('page');
        if (queryCard) {
            const decoded = decodeURIComponent(queryCard);
            if (decoded.startsWith('r/')) {
                const rest = decoded.slice(2);
                const [cardName, headingId] = this.parseCardAndHeading(rest);
                return { cardName, readerMode: true, headingId };
            }
            const [cardName, headingId] = this.parseCardAndHeading(decoded);
            return { cardName, readerMode: false, headingId };
        }

        return null;
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

    /**
     * Scroll to a heading in reader mode.
     */
    scrollToHeadingInReaderMode(headingId) {
        // Small delay to ensure DOM is fully rendered
        setTimeout(() => {
            const readerContent = document.querySelector('.reader-mode-content');
            const targetElement = readerContent?.querySelector(`#${CSS.escape(headingId)}`);
            if (readerContent && targetElement) {
                const containerRect = readerContent.getBoundingClientRect();
                const targetRect = targetElement.getBoundingClientRect();
                const scrollOffset = targetRect.top - containerRect.top + readerContent.scrollTop;
                readerContent.scrollTo({
                    top: scrollOffset - 20,
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

    async addScatterCards(centerX, centerY) {
        // Remove any existing scatter cards
        const toRemove = [];
        this.cards.forEach((card, id) => {
            if (card.element.dataset.scatterGroup) {
                toRemove.push(id);
            }
        });
        toRemove.forEach(id => {
            const card = this.cards.get(id);
            const img = card.element.querySelector('.card-image');
            if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
            card.element.remove();
            this.cards.delete(id);
        });

        const { scatterImage } = await import('./ImageScatter.js');
        const specs = await scatterImage('images/higuchi.png', 8, 420, 0, centerX, centerY);

        const groupId = Date.now().toString();
        specs.forEach(spec => {
            const card = this.createCard({
                x: spec.x,
                y: spec.y,
                width: spec.width,
                height: spec.height,
                rotation: spec.rotation,
                extra: { image: spec.dataUrl },
            });
            card.zIndex = spec.zIndex;
            card.element.style.zIndex = spec.zIndex;
            card.element.dataset.scatterGroup = groupId;
            const imgContainer = card.element.querySelector('.card-image-container');
            if (imgContainer) imgContainer.style.height = '100%';
        });
    }

    bindCanvasEvents() {
        // Canvas panning with left mouse on empty space
        this.canvas.addEventListener('mousedown', (e) => {
            // Check if clicking on a card or its children
            const isCard = e.target.closest('.card');

            // Ignore canvas interactions when locked (reader mode)
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
            // Ignore canvas interactions when locked (reader mode)
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

            // Reader mode: navigate to menu instead of deleting
            if (this.isReaderMode) {
                e.preventDefault();
                this.navigateReaderMode('menu');
                return;
            }

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

                // Reader mode: in-place navigation for card links
                if (this.isReaderMode && cardName && !embedUrl) {
                    e.preventDefault();
                    e.stopPropagation();
                    await this.navigateReaderMode(cardName);
                    return;
                }

                // If there's a preview card, make it permanent
                if (this.previewCard && this.previewCardLink === cardLink) {
                    this.previewCard.element.classList.remove('card-preview');
                    this.previewCard = null;
                    this.previewCardLink = null;
                    return;
                }

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
                    this.openCard(cardName, parentCard, options, e);
                }
            }
        });

        // Handle card link hover - sophisticated preview system with delays
        this.previewLoadingId = 0; // Track loading to prevent race conditions
        this.previewShowTimeout = null; // Timeout for delayed showing
        this.previewHideTimeout = null; // Timeout for delayed hiding
        this.pendingPreviewLink = null; // Track which link we're waiting to show preview for

        // Get preview timing from CSS custom properties
        this.getPreviewTimings = () => {
            const styles = getComputedStyle(document.documentElement);
            const delayStr = styles.getPropertyValue('--preview-delay').trim();
            const lingerStr = styles.getPropertyValue('--preview-linger').trim();

            const delay = parseInt(delayStr) || 1000;
            const linger = parseInt(lingerStr) || 1000;

            return { delay, linger };
        };

        // Clear all preview timeouts
        this.clearPreviewTimeouts = () => {
            if (this.previewShowTimeout) {
                clearTimeout(this.previewShowTimeout);
                this.previewShowTimeout = null;
            }
            if (this.previewHideTimeout) {
                clearTimeout(this.previewHideTimeout);
                this.previewHideTimeout = null;
            }
        };

        // Show preview for a specific link after delay
        this.showPreviewAfterDelay = async (cardLink, mouseEvent) => {
            const cardName = cardLink.dataset.card;
            const timings = this.getPreviewTimings();

            // Track that we're pending a preview for this link
            this.pendingPreviewLink = cardLink;

            // Increment loading ID for this specific show attempt
            const loadId = ++this.previewLoadingId;

            this.previewShowTimeout = setTimeout(async () => {
                // Check if this show is still valid and we're still pending for the same link
                if (loadId !== this.previewLoadingId || this.pendingPreviewLink !== cardLink) {
                    return;
                }

                // Calculate position from the mouse event
                const rect = this.canvas.getBoundingClientRect();
                const cursorX = (mouseEvent.clientX - rect.left - this.panX) / this.zoom;
                const cursorY = (mouseEvent.clientY - rect.top - this.panY) / this.zoom;

                const previewSize = 400;
                const offset = 50;
                const previewX = cursorX + offset;
                const previewY = cursorY + offset;

                // Load the preview card
                const previewCard = await this.loadCardFromFile(cardName, {
                    x: previewX,
                    y: previewY,
                    width: previewSize,
                    height: previewSize,
                    rotation: 0,
                    marginTB: 8,
                    marginLR: 8,
                    isPreview: true  // Mark as preview to avoid incrementing page counter
                });

                // Check if this load is still valid
                if (loadId !== this.previewLoadingId || !previewCard || this.pendingPreviewLink !== cardLink) {
                    if (previewCard) {
                        this.cards.delete(previewCard.id);
                        previewCard.element.remove();
                    }
                    return;
                }

                // Set up the preview card
                previewCard.element.classList.add('card-preview');
                previewCard.zIndex = Z_INDEX_PREVIEW;
                previewCard.element.style.zIndex = Z_INDEX_PREVIEW;
                this.previewCard = previewCard;
                this.previewCardLink = cardLink;
                this.pendingPreviewLink = null; // No longer pending, now active

                // Add hover listeners to the preview card itself
                this.bindPreviewCardHover(previewCard);

                this.previewShowTimeout = null;
            }, timings.delay);
        };

        // Bind hover events to preview card to keep it visible when hovered
        this.bindPreviewCardHover = (previewCard) => {
            const previewElement = previewCard.element;

            previewElement.addEventListener('mouseenter', () => {
                // Mouse entered preview card - cancel any pending hide
                this.clearPreviewTimeouts();
            });

            previewElement.addEventListener('mouseleave', () => {
                // Mouse left preview card - start hide timer
                this.hidePreviewAfterDelay();
            });
        };

        // Hide preview after linger delay
        this.hidePreviewAfterDelay = () => {
            const timings = this.getPreviewTimings();

            // Cancel any pending show
            if (this.previewShowTimeout) {
                clearTimeout(this.previewShowTimeout);
                this.previewShowTimeout = null;
                this.pendingPreviewLink = null;
            }

            this.previewHideTimeout = setTimeout(() => {
                this.clearPreviewCard();
                this.previewHideTimeout = null;
            }, timings.linger);
        };

        // Handle card link mouse enter
        this.canvas.addEventListener('mouseenter', (e) => {
            const cardLink = e.target.closest('.card-link');
            if (!cardLink || !cardLink.dataset.card) return;

            // Check if previews are disabled
            if (!this.getSetting('showPreviews')) return;

            // Don't preview embed links
            if (cardLink.dataset.url) return;

            // Check if this link is inside a preview card - if so, ignore it
            const parentCard = cardLink.closest('.card');
            if (parentCard && parentCard.classList.contains('card-preview')) {
                return; // Don't create previews from links inside preview cards
            }

            // If we're already showing a preview for this same link, do nothing
            if (this.previewCardLink === cardLink && this.previewCard) return;

            // If we're already pending for this same link, do nothing
            if (this.pendingPreviewLink === cardLink) return;

            // Clear any existing timeouts
            this.clearPreviewTimeouts();

            // Clear any existing preview from different link
            if (this.previewCardLink !== cardLink) {
                this.clearPreviewCard();
            }

            // Clear any pending preview from different link
            this.pendingPreviewLink = null;

            // Start delayed show for this link
            this.showPreviewAfterDelay(cardLink, e);
        }, true);

        // Handle card link mouse leave
        this.canvas.addEventListener('mouseleave', (e) => {
            const cardLink = e.target.closest('.card-link');
            if (!cardLink) return;

            // Handle leaving a link we're pending a preview for
            if (this.pendingPreviewLink === cardLink) {
                // Cancel the pending preview
                this.clearPreviewTimeouts();
                this.pendingPreviewLink = null;
                this.previewLoadingId++; // Cancel any in-progress loads
                return;
            }

            // Handle leaving a link with an active preview
            if (this.previewCardLink === cardLink && this.previewCard) {
                // Start hide timer for active preview
                this.hidePreviewAfterDelay();
            }
        }, true);

        // Handle tag clicks
        this.canvas.addEventListener('tag-click', async (e) => {
            const { tagName, card } = e.detail;

            // Register the tag page dynamically
            const tagCardName = this.registerTagPage(tagName, card);

            // Reader mode: navigate in-place
            if (this.isReaderMode) {
                await this.navigateReaderMode(tagCardName);
                return;
            }

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
                            const newUrl = `#/${card.sourceFile}/${targetId}`;
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
                        const newUrl = `#/${card.sourceFile}/${targetId}`;
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
                        const url = `${window.location.origin}${window.location.pathname}#/${card.sourceFile}/${headingId}`;
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

    clearPreviewCard() {
        // Clear any pending timeouts
        this.clearPreviewTimeouts();

        // Clear pending state
        this.pendingPreviewLink = null;

        if (this.previewCard) {
            this.removeConnectionsForCard(this.previewCard.id);
            this.cards.delete(this.previewCard.id);
            this.previewCard.element.remove();
            this.previewCard = null;
            this.previewCardLink = null;
        }
    }

    getPreviewPosition(parentCard, options, e) {
        let x, y;

        if (options.absX !== null && options.absY !== null) {
            x = options.absX;
            y = options.absY;
        } else if (options.relX !== null && options.relY !== null && parentCard) {
            x = parentCard.x + options.relX;
            y = parentCard.y + options.relY;
        } else if (parentCard) {
            x = parentCard.x + parentCard.width + 40;
            y = parentCard.y;
        } else {
            x = this.defaultOffset.x;
            y = this.defaultOffset.y;
        }

        return {
            x: x,
            y: y,
            width: options.width,
            height: options.height,
            rotation: options.rotation || 0,
            marginTB: options.marginTB,
            marginLR: options.marginLR,
            parentCard: options.parentCard
        };
    }

    getCardById(id) {
        return this.cards.get(id) || null;
    }

    getNextPageNumber() {
        this.pageCounter++;
        return String(this.pageCounter).padStart(2, '0');
    }

    // Get page number for preview cards without incrementing the counter
    getPreviewPageNumber() {
        const nextNumber = this.pageCounter + 1;
        return String(nextNumber).padStart(2, '0');
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
                // Reader mode cards get a slightly larger margin
                if (card.isReaderMode) {
                    const marginMultiplier = isMobile() ? 1.4 : 1.1;
                    const readerMargin = Math.min(45, this.settings.marginSize * marginMultiplier);
                    card.updateMarginSize(readerMargin);
                } else {
                    card.updateMarginSize(this.settings.marginSize);
                }
            }
        }

        // Bind any interactive elements in this card
        this.bindInteractiveElements(card.element);

        // Schedule state save
        this.scheduleSave();

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
        });

        console.log(`Live-reload: Updated ${cards.length} card(s) displaying "${fileName}"`);
    }

    // Content provider system - abstraction layer for card content
    async getCardContent(cardName) {
        // Check if this is a dynamic content provider
        if (this.contentProviders && this.contentProviders[cardName]) {
            return await this.contentProviders[cardName]();
        }

        // Default: load from markdown file
        try {
            const cacheBuster = `?t=${Date.now()}`;
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

        const pageNumber = positionOptions.isPreview ? this.getPreviewPageNumber() : this.getNextPageNumber();
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
        // Load card list dynamically
        // 1. Localhost: /api/cards endpoint (server scans directory)
        // 2. Production: manifest.json (reliable for static hosting)
        // 3. Fallback: GitHub API (rate-limited, less reliable)
        let cardFiles = [];

        if (this.isLocal) {
            // Localhost: use server API
            try {
                const response = await fetch('/api/cards');
                if (response.ok) {
                    const data = await response.json();
                    cardFiles = data.cards || [];
                }
            } catch (e) {}
        }

        // Production: use manifest.json (most reliable for static hosting)
        if (cardFiles.length === 0) {
            try {
                const response = await fetch(`cards/manifest.json?t=${Date.now()}`);
                if (response.ok) {
                    const manifest = await response.json();
                    cardFiles = manifest.cards || [];
                }
            } catch (e) {
                console.warn('Failed to load manifest.json:', e);
            }
        }

        // Fallback: GitHub API (rate-limited, less reliable)
        if (cardFiles.length === 0) {
            const hostname = window.location.hostname;
            if (hostname.endsWith('.github.io')) {
                const username = hostname.replace('.github.io', '');
                const repoName = `${username}.github.io`;
                try {
                    const response = await fetch(
                        `https://api.github.com/repos/${username}/${repoName}/contents/cards`,
                        { headers: { 'Accept': 'application/vnd.github.v3+json' } }
                    );
                    if (response.ok) {
                        const files = await response.json();
                        cardFiles = files
                            .filter(f => f.name.endsWith('.md'))
                            .map(f => f.name.replace('.md', ''))
                            .sort();
                    }
                } catch (e) {
                    console.warn('GitHub API request failed:', e);
                }
            }
        }

        if (cardFiles.length === 0) {
            console.warn('No cards found');
            return;
        }

        this.globalTagIndex = {}; // Individual tags (subtags)
        this.mainTagIndex = {};   // Main tags
        this.fileTagCache.clear();

        // Process each file
        for (const cardName of cardFiles) {
            try {
                const response = await fetch(`cards/${cardName}.md?t=${Date.now()}`);
                if (!response.ok) {
                    console.warn(`Could not fetch ${cardName}.md`);
                    continue;
                }

                const content = await response.text();

                // Skip encrypted/private cards - they shouldn't appear in public indexes
                if (content.includes('encrypted: true')) {
                    continue;
                }

                // Parse frontmatter to extract tags
                const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
                if (frontmatterMatch) {
                    const frontmatter = frontmatterMatch[1];
                    const tagsMatch = frontmatter.match(/tags:\s*(.+)/);

                    // Parse display name from front matter (falls back to filename)
                    const nameMatch = frontmatter.match(/name:\s*(.+)/);
                    const displayName = nameMatch ? nameMatch[1].trim() : cardName;

                    // Parse date from front matter (format: MM-DD-YYYY)
                    const dateMatch = frontmatter.match(/date:\s*(\d{2}-\d{2}-\d{4})/);
                    let dateValue = null;
                    if (dateMatch) {
                        const [month, day, year] = dateMatch[1].split('-').map(Number);
                        dateValue = new Date(year, month - 1, day);
                    }

                    if (tagsMatch) {
                        const tagsStr = tagsMatch[1].trim();

                        // Parse new [subtag, mainTag] format
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
                            tags: subtags,           // Only subtags (for display)
                            mainTags: mainTags,      // Main tags (for indexing)
                            subtagToMain: subtagToMain,
                            sourceFile: cardName,
                            title: displayName,      // Display name from front matter
                            date: dateValue          // Date for sorting (null if not specified)
                        };

                        // Store in cache for later use
                        this.fileTagCache.set(cardName, cardData);

                        // Add to individual tag index (for specific tag pages)
                        subtags.forEach(tag => {
                            if (!this.globalTagIndex[tag]) {
                                this.globalTagIndex[tag] = [];
                            }
                            const existing = this.globalTagIndex[tag].find(item => item.sourceFile === cardName);
                            if (!existing) {
                                this.globalTagIndex[tag].push(cardData);
                            }
                        });

                        // Add to main tag index (for overview)
                        mainTags.forEach(mainTag => {
                            if (!this.mainTagIndex[mainTag]) {
                                this.mainTagIndex[mainTag] = [];
                            }
                            const existing = this.mainTagIndex[mainTag].find(item => item.sourceFile === cardName);
                            if (!existing) {
                                this.mainTagIndex[mainTag].push(cardData);
                            }
                        });
                    }
                }
            } catch (error) {
                console.warn(`Error processing ${cardName}:`, error);
            }
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
            // Tags overview page - kept for backwards compatibility
            'tags': async () => {
                return await this.generateTagsContent();
            },

            // Writing page - kept for backwards compatibility
            'writing': async () => {
                return await this.generateWritingContent();
            },

            // Individual tag pages (pattern: tag-{tagName})
            // This will be handled by a more flexible system
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
            // Get all cards with this tag from global index
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

        // Assign page number - use preview numbering if this is a preview card
        const pageNumber = positionOptions.isPreview ? this.getPreviewPageNumber() : this.getNextPageNumber();

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
            isDynamic: contentData.isDynamic || false
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

        return card;
    }

    async openCard(cardName, parentCard = null, options = {}, clickEvent = null) {
        let x, y;
        const jitter = options.jitter || 0;

        // Special handling for 'about' card: position left of menu with scatter image right of menu
        if (cardName === 'about' && parentCard) {
            const aboutW = options.width || 500;
            const aboutH = options.height || 600;
            const menuCenterX = parentCard.x + parentCard.width / 2;
            const menuCenterY = parentCard.y + parentCard.height / 2;

            x = menuCenterX - aboutW - 80;
            y = menuCenterY - aboutH / 2;

            await this.loadCardFromFile(cardName, {
                x: x,
                y: y,
                width: options.width,
                height: options.height,
                rotation: options.rotation,
                marginTB: options.marginTB,
                marginLR: options.marginLR,
                parentCard: parentCard
            });

            // Add scattered image to the right of menu
            const scatterCenterX = menuCenterX + parentCard.width / 2 + 300;
            const scatterCenterY = menuCenterY;
            await this.addScatterCards(scatterCenterX, scatterCenterY);
            return;
        }

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

        // Reader mode runtime state (can be URL-driven or toggle-driven)
        this.isReaderMode = false;
        this.canvasLocked = false;
        this.readerModeCurrentCard = null;

        // Track connections between cards (parentId -> [childIds])
        this.connections = new Map();

        // Apply saved settings immediately
        this.applySettings();

        // Bind settings button
        const settingsBtn = document.getElementById('settings-btn');
        settingsBtn.addEventListener('click', () => this.openSettingsCard());
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

    async openSettingsCard() {
        // In reader mode, open settings as a centered overlay
        if (this.isReaderMode) {
            await this.openSettingsOverlay();
            return;
        }

        // Calculate position further from the corner with some jitter for multiple cards
        const btnRect = document.getElementById('settings-btn').getBoundingClientRect();
        const baseX = (btnRect.left + 100 - this.panX) / this.zoom;
        const baseY = (btnRect.top - 450 - this.panY) / this.zoom;

        // Add some jitter so multiple settings cards don't stack exactly
        const jitterX = (Math.random() - 0.5) * 100;
        const jitterY = (Math.random() - 0.5) * 100;

        const x = baseX + jitterX;
        const y = Math.max(40, baseY + jitterY);

        // Load settings card from file
        const card = await this.loadCardFromFile('settings', {
            x: x,
            y: y
        });

        if (card) {
            card.element.setAttribute('data-settings-card', 'true');
        }
    }

    /**
     * Open settings as a centered overlay in reader mode
     */
    async openSettingsOverlay() {
        // Check if overlay already exists
        if (document.getElementById('settings-overlay')) {
            return;
        }

        // Create overlay backdrop
        const overlay = document.createElement('div');
        overlay.id = 'settings-overlay';
        overlay.className = 'settings-overlay';

        // Create settings card container
        const container = document.createElement('div');
        container.className = 'settings-overlay-card';

        // Load settings content
        const contentData = await this.getCardContent('settings');
        if (!contentData) return;

        const parsed = this.parser.parse(contentData.content);
        if (!parsed) return;

        // Build card content
        container.innerHTML = `
            <div class="settings-overlay-header">
                <span>Settings</span>
                <button class="settings-overlay-close">&times;</button>
            </div>
            <div class="settings-overlay-content">
                ${parsed.content}
            </div>
        `;

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        // Hide Card Display section in reader mode
        this.hideReaderModeOnlySettings(container);

        // Bind interactive elements
        this.bindInteractiveElements(container);

        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.closeSettingsOverlay();
            }
        });

        // Close button
        container.querySelector('.settings-overlay-close').addEventListener('click', () => {
            this.closeSettingsOverlay();
        });

        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeSettingsOverlay();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    /**
     * Close the settings overlay
     */
    closeSettingsOverlay() {
        const overlay = document.getElementById('settings-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * Hide settings sections that don't apply in reader mode
     * Removes the "Card Display" section and its contents
     * @param {HTMLElement} container - The settings container element
     */
    hideReaderModeOnlySettings(container) {
        if (!this.isReaderMode) return;

        // Find the "Card Display" heading
        const headings = container.querySelectorAll('h2');
        for (const heading of headings) {
            if (heading.textContent.trim() === 'Card Display') {
                // Collect all elements to remove (heading + siblings until next h2 or hr)
                const elementsToRemove = [heading];
                let sibling = heading.nextElementSibling;

                while (sibling && sibling.tagName !== 'H2' && sibling.tagName !== 'HR') {
                    elementsToRemove.push(sibling);
                    sibling = sibling.nextElementSibling;
                }

                // Remove all collected elements
                elementsToRemove.forEach(el => el.remove());
                break;
            }
        }
    }

    /**
     * Initialize editor functionality (localhost only)
     */
    async initEditor() {
        const editBtn = document.getElementById('edit-btn');

        // Hide editor on production - only available locally
        if (!this.isLocal) {
            if (editBtn) {
                editBtn.style.display = 'none';
            }
            return;
        }

        // Dynamically import editor module (only on localhost)
        try {
            const { EditorCard, FileSystemManager } = await import('./Editor.js');
            this.EditorCard = EditorCard;
            this.fsManager = new FileSystemManager();

            // Bind edit button
            if (editBtn) {
                editBtn.addEventListener('click', () => this.openEditorCard());
            }

            // Try to restore directory handle from storage
            this.fsManager.restoreHandle();

            // Listen for editor close events
            document.addEventListener('editor-close', (e) => {
                const editorId = e.detail.editorId;
                this.editorCards.delete(editorId);
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
            if (editBtn) {
                editBtn.style.display = 'none';
            }
        }
    }

    /**
     * Open editor card (localhost only)
     * @param {string} filename - Optional filename to open
     */
    async openEditorCard(filename = null) {
        // Editor only available locally
        if (!this.isLocal || !this.EditorCard) {
            console.warn('Editor is only available on localhost');
            return null;
        }

        // Check if File System Access API is supported
        if (!this.fsManager || !this.fsManager.isSupported()) {
            alert('Editor requires File System Access API. Please use Chrome or Edge.');
            return null;
        }

        // Calculate position with jitter for multiple editors
        const btnRect = document.getElementById('edit-btn')?.getBoundingClientRect()
            || document.getElementById('settings-btn').getBoundingClientRect();
        const baseX = (btnRect.left + 120 - this.panX) / this.zoom;
        const baseY = (btnRect.top - 500 - this.panY) / this.zoom;

        // Add jitter so multiple editors don't stack exactly
        const jitterX = (Math.random() - 0.5) * 100;
        const jitterY = (Math.random() - 0.5) * 100;

        const x = baseX + jitterX + (this.editorCards.size * 30);
        const y = Math.max(40, baseY + jitterY + (this.editorCards.size * 30));

        const editor = new this.EditorCard({
            x,
            y,
            width: 900,
            height: 600,
            parser: this.parser,
            fsManager: this.fsManager,
            canvas: this,
            zIndex: ++this.zIndexCounter
        });

        this.editorCards.set(editor.id, editor);
        this.canvasContent.appendChild(editor.element);

        // Load file if specified
        if (filename) {
            await editor.loadFile(filename);
        }

        return editor;
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
        // In reader mode, apply the same multiplier used when creating the card
        const marginMultiplier = isMobile() ? 1.4 : 1.1;
        const readerModeMargin = Math.min(45, marginPercent * marginMultiplier);

        this.cards.forEach(card => {
            if (card.updateMarginSize) {
                // Reader mode cards use a multiplied margin
                const effective = card.element.classList.contains('card-reader-mode')
                    ? readerModeMargin
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
    exportCards() {
        const cardsArray = [];
        this.cards.forEach(card => {
            cardsArray.push(card.toJSON());
        });
        return JSON.stringify(cardsArray, null, 2);
    }



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
        }
    }

    /**
     * Schedule a debounced save of canvas state
     */
    scheduleSave() {
        // Don't save during restoration
        if (this.isRestoring) return;

        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveCanvasState();
        }, this.SAVE_DEBOUNCE_MS);
    }

    /**
     * Save the complete canvas state to localStorage
     */
    saveCanvasState() {
        const state = {
            version: 1,
            savedAt: Date.now(),
            canvas: {
                panX: this.panX,
                panY: this.panY,
                zoom: this.zoom,
                rotation: this.rotation
            },
            counters: {
                pageCounter: this.pageCounter,
                zIndexCounter: this.zIndexCounter
            },
            cards: [],
            connections: [],
            editorCards: []
        };

        // Serialize cards (skip preview and scatter cards)
        this.cards.forEach(card => {
            if (card.element.classList.contains('card-preview')) return;
            if (card.element.dataset.scatterGroup) return;
            state.cards.push(card.toJSON());
        });

        // Serialize editor cards
        this.editorCards.forEach(editor => {
            state.editorCards.push(editor.toJSON());
        });

        // Serialize connections (Map<string, Set<string>> -> Array)
        this.connections.forEach((children, parentId) => {
            children.forEach(childId => {
                state.connections.push({ parent: parentId, child: childId });
            });
        });

        try {
            localStorage.setItem('paper-canvas-state', JSON.stringify(state));
        } catch (e) {
            console.error('Failed to save canvas state:', e);
        }
    }

    /**
     * Load saved canvas state from localStorage
     * @returns {Object|null} The saved state or null if not found/invalid
     */
    loadSavedState() {
        try {
            const raw = localStorage.getItem('paper-canvas-state');
            if (!raw) return null;

            const state = JSON.parse(raw);

            // Validate version
            if (state.version !== 1) {
                console.warn('Unsupported canvas state version, clearing...');
                localStorage.removeItem('paper-canvas-state');
                return null;
            }

            return state;
        } catch (e) {
            console.error('Failed to load saved state:', e);
            localStorage.removeItem('paper-canvas-state');
            return null;
        }
    }

    /**
     * Restore the complete canvas state from saved data
     * @param {Object} state - The saved state object
     */
    async restoreCanvasState(state) {
        // Prevent saves during restoration
        this.isRestoring = true;

        try {
            // 0. Clear any existing cards from DOM to prevent stacking on refresh
            this.cards.forEach(card => card.element.remove());
            this.cards.clear();
            this.editorCards.forEach(editor => editor.element.remove());
            this.editorCards.clear();

            // 1. Restore canvas transform
            this.panX = state.canvas.panX;
            this.panY = state.canvas.panY;
            this.zoom = state.canvas.zoom;
            this.rotation = state.canvas.rotation;
            this.updateCanvasTransform();

            // 2. Restore counters
            this.pageCounter = state.counters.pageCounter;
            this.zIndexCounter = state.counters.zIndexCounter;

            // 3. Restore cards
            const cardIdMap = new Map(); // Map old IDs to new card objects
            for (const cardState of state.cards) {
                const card = await this.restoreCard(cardState);
                if (card) {
                    cardIdMap.set(cardState.id, card);
                }
            }

            // 4. Restore connections
            for (const conn of state.connections) {
                const parentCard = cardIdMap.get(conn.parent);
                const childCard = cardIdMap.get(conn.child);
                if (parentCard && childCard) {
                    // Add connection without triggering save
                    if (!this.connections.has(parentCard.id)) {
                        this.connections.set(parentCard.id, new Set());
                    }
                    this.connections.get(parentCard.id).add(childCard.id);
                    this.createConnectionLine(parentCard.id, childCard.id);
                    this.updateConnectionLine(parentCard.id, childCard.id);
                }
            }

            // 5. Restore editor cards (if any and if EditorCard is available)
            if (state.editorCards && state.editorCards.length > 0 && this.EditorCard) {
                for (const editorState of state.editorCards) {
                    const editor = new this.EditorCard({
                        id: editorState.id,
                        x: editorState.x,
                        y: editorState.y,
                        width: editorState.width,
                        height: editorState.height,
                        rotation: editorState.rotation,
                        zIndex: editorState.zIndex,
                        pinned: editorState.pinned,
                        filename: editorState.filename,
                        content: editorState.content,
                        parser: this.parser,
                        fsManager: this.fsManager,
                        canvas: this
                    });

                    // Restore additional state
                    editor.isDirty = editorState.isDirty;
                    editor.lastSavedContent = editorState.lastSavedContent;
                    editor.isPrivate = editorState.isPrivate;

                    // Update the private checkbox UI if needed
                    const privateCheckbox = editor.element.querySelector('.private-checkbox');
                    if (privateCheckbox) {
                        privateCheckbox.checked = editor.isPrivate;
                    }

                    // Update the textarea with content
                    const textarea = editor.element.querySelector('.editor-textarea');
                    if (textarea) {
                        textarea.value = editorState.content;
                    }

                    // Update the filename input
                    const filenameInput = editor.element.querySelector('.editor-filename');
                    if (filenameInput) {
                        filenameInput.value = editorState.filename;
                    }

                    // Reconnect to target card if it exists
                    if (editorState.targetCardId) {
                        const targetCard = cardIdMap.get(editorState.targetCardId);
                        if (targetCard) {
                            editor.targetCard = targetCard;
                        }
                    }

                    // Update status display
                    editor.updateStatus();

                    // Add to editor cards map and DOM
                    this.editorCards.set(editor.id, editor);
                    this.canvasContent.appendChild(editor.element);
                }
            }

            // 6. Restore scroll positions (after DOM is ready)
            // Use a promise to ensure isRestoring stays true until RAF completes
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    state.cards.forEach(savedCard => {
                        const card = cardIdMap.get(savedCard.id);
                        if (card) {
                            const contentEl = card.element.querySelector('.card-content');
                            if (contentEl) {
                                contentEl.scrollTop = savedCard.scrollTop || 0;
                                contentEl.scrollLeft = savedCard.scrollLeft || 0;
                            }
                        }
                    });
                    resolve();
                });
            });
        } finally {
            // Re-enable saving after restoration is fully complete
            this.isRestoring = false;
        }
    }

    /**
     * Restore a single card from saved state
     * @param {Object} cardState - The saved card state
     * @returns {Card|null} The restored card or null
     */
    async restoreCard(cardState) {
        // Skip preview cards (shouldn't be in saved state, but safeguard)
        if (cardState.id && cardState.id.includes('preview')) return null;

        // Handle encrypted cards that were locked
        if (cardState.isLocked && cardState.encryptedData) {
            return this.restoreLockedCard(cardState);
        }

        // Handle dynamic content (tag pages) - need to re-register provider
        if (cardState.isDynamic && cardState.sourceFile) {
            const tagMatch = cardState.sourceFile.match(/^dynamic:tag-(.+)$/);
            if (tagMatch) {
                const tagName = tagMatch[1];
                this.registerTagPage(tagName, null);
                const cardName = `tag-${tagName}`;

                const card = await this.loadCardFromFile(cardName, {
                    x: cardState.x,
                    y: cardState.y,
                    width: cardState.width,
                    height: cardState.height,
                    rotation: cardState.rotation + this.rotation, // Account for canvas rotation
                    skipSave: true
                });

                if (card) {
                    card.id = cardState.id;
                    card.element.id = cardState.id;
                    card.pageNumber = cardState.pageNumber;
                    card.zIndex = cardState.zIndex;
                    card.element.style.zIndex = cardState.zIndex;
                    this.cards.delete(card.id);
                    this.cards.set(cardState.id, card);
                }
                return card;
            }

            // Handle tags overview page
            if (cardState.sourceFile === 'dynamic:tags-overview') {
                const card = await this.loadCardFromFile('tags', {
                    x: cardState.x,
                    y: cardState.y,
                    width: cardState.width,
                    height: cardState.height,
                    rotation: cardState.rotation + this.rotation,
                    skipSave: true
                });

                if (card) {
                    card.id = cardState.id;
                    card.element.id = cardState.id;
                    card.pageNumber = cardState.pageNumber;
                    card.zIndex = cardState.zIndex;
                    card.element.style.zIndex = cardState.zIndex;
                    this.cards.delete(card.id);
                    this.cards.set(cardState.id, card);
                }
                return card;
            }
        }

        // Handle file-based cards
        if (cardState.sourceFile && !cardState.isDynamic) {
            const card = await this.loadCardFromFile(cardState.sourceFile, {
                x: cardState.x,
                y: cardState.y,
                width: cardState.width,
                height: cardState.height,
                rotation: cardState.rotation + this.rotation, // Account for canvas rotation
                marginTB: cardState.marginTB,
                marginLR: cardState.marginLR,
                skipSave: true
            });

            if (card) {
                // Update card with preserved state
                const oldId = card.id;
                card.id = cardState.id;
                card.element.id = cardState.id;
                card.pageNumber = cardState.pageNumber;
                card.pinned = cardState.pinned;
                card.zIndex = cardState.zIndex;
                card.scale = cardState.scale;
                card.marginLeftSize = cardState.marginLeftSize;
                card.marginRightSize = cardState.marginRightSize;
                card.marginTopSize = cardState.marginTopSize;
                card.marginBottomSize = cardState.marginBottomSize;

                // Apply margin sizes to DOM
                this.applyMarginSizes(card);

                if (cardState.pinned) {
                    card.element.classList.add('pinned');
                }
                card.element.style.zIndex = cardState.zIndex;

                // Update cards map with correct ID
                this.cards.delete(oldId);
                this.cards.set(cardState.id, card);
            }
            return card;
        }

        // Handle embed cards
        if (cardState.embedUrl) {
            const card = this.addCard({
                x: cardState.x,
                y: cardState.y,
                width: cardState.width,
                height: cardState.height,
                rotation: cardState.rotation,
                pageNumber: cardState.pageNumber,
                embedUrl: cardState.embedUrl
            });

            const oldId = card.id;
            card.id = cardState.id;
            card.element.id = cardState.id;
            card.zIndex = cardState.zIndex;
            card.element.style.zIndex = cardState.zIndex;

            this.cards.delete(oldId);
            this.cards.set(cardState.id, card);
            return card;
        }

        // Fallback: recreate from saved content
        const card = this.addCard({
            x: cardState.x,
            y: cardState.y,
            width: cardState.width,
            height: cardState.height,
            rotation: cardState.rotation,
            scale: cardState.scale,
            pageNumber: cardState.pageNumber,
            content: cardState.content,
            margins: cardState.margins,
            marginTB: cardState.marginTB,
            marginLR: cardState.marginLR,
            image: cardState.image,
            caption: cardState.caption,
            progressBar: cardState.progressBar,
            wordCount: cardState.wordCount,
            readTime: cardState.readTime,
            tags: cardState.tags,
            showTags: cardState.showTags
        });

        const oldId = card.id;
        card.id = cardState.id;
        card.element.id = cardState.id;
        card.pinned = cardState.pinned;
        card.zIndex = cardState.zIndex;
        card.element.style.zIndex = cardState.zIndex;

        if (cardState.pinned) {
            card.element.classList.add('pinned');
        }

        this.cards.delete(oldId);
        this.cards.set(cardState.id, card);
        return card;
    }

    /**
     * Restore a locked (encrypted) card
     * @param {Object} cardState - The saved card state
     * @returns {Card} The locked card
     */
    restoreLockedCard(cardState) {
        const card = this.createLockedCard(
            cardState.sourceFile,
            {
                isEncrypted: true,
                encryptedData: cardState.encryptedData,
                sourceFile: cardState.sourceFile,
                metadata: {}
            },
            {
                x: cardState.x,
                y: cardState.y,
                width: cardState.width,
                height: cardState.height,
                rotation: cardState.rotation
            }
        );

        if (card) {
            const oldId = card.id;
            card.id = cardState.id;
            card.element.id = cardState.id;
            card.zIndex = cardState.zIndex;
            card.element.style.zIndex = cardState.zIndex;

            this.cards.delete(oldId);
            this.cards.set(cardState.id, card);
        }
        return card;
    }

    /**
     * Apply saved margin sizes to a card's DOM
     * @param {Card} card - The card to update
     */
    applyMarginSizes(card) {
        const container = card.element.querySelector('.card-container');
        if (!container) return;

        if (card.marginLeftSize || card.marginRightSize) {
            const left = card.marginLeftSize || 100;
            const right = card.marginRightSize || 100;
            container.style.gridTemplateColumns = `${left}px 1fr ${right}px`;
        }

        if (card.marginTopSize || card.marginBottomSize) {
            const top = card.marginTopSize || 40;
            const bottom = card.marginBottomSize || 40;
            container.style.gridTemplateRows = `${top}px 1fr ${bottom}px`;
        }
    }

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
    highlightJumpTarget(targetElement) {
        // Get highlight duration from CSS custom property
        const styles = getComputedStyle(document.documentElement);
        const durationStr = styles.getPropertyValue('--jump-highlight-duration').trim();

        // Parse duration - handle both "5000ms" and "5000" formats
        let duration = 2000; // Default
        if (durationStr) {
            const numericValue = parseFloat(durationStr.replace(/ms$/, ''));
            if (!isNaN(numericValue)) {
                duration = numericValue;
            }
        }

        // Calculate when to start fade-out (60% through the total duration)
        const fadeStartDelay = duration * 0.6;

        // Clear any existing highlight
        targetElement.classList.remove('jump-target-highlight', 'fade-out');

        // Add highlight class
        targetElement.classList.add('jump-target-highlight');

        // Start fade out after staying visible for 60% of the duration
        setTimeout(() => {
            targetElement.classList.add('fade-out');
        }, fadeStartDelay);

        // Remove all highlight classes after the full duration
        setTimeout(() => {
            targetElement.classList.remove('jump-target-highlight', 'fade-out');
        }, duration);
    }

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
    // Reader Mode Methods
    // ============================================

    /**
     * Lock canvas - disable pan, zoom, rotate
     */
    lockCanvas() {
        this.canvasLocked = true;
        this.canvas.style.cursor = 'default';

        // Reset transform for reader mode
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
     * Enter reader mode with a specific card
     * @param {string} cardName - The card to display
     * @param {boolean} pushHistory - Whether to push to browser history
     */
    async enterReaderMode(cardName, pushHistory = true) {
        this.isReaderMode = true;
        this.lockCanvas();
        this.clearAllCards();
        this.canvas.classList.add('reader-mode');
        document.body.classList.add('reader-mode-active');

        // Sync settings to reflect reader mode is active
        this.settings.readerMode = true;
        localStorage.setItem('settings-readerMode', 'true');
        this.syncAllSettingsCards();

        const card = await this.loadCardInReaderMode(cardName);
        if (card) {
            this.readerModeCurrentCard = card;
            const url = `#/r/${cardName}`;
            if (pushHistory) {
                window.history.pushState({ readerMode: true, cardName }, '', url);
            } else {
                window.history.replaceState({ readerMode: true, cardName }, '', url);
            }
        }
    }

    /**
     * Exit reader mode, restoring normal canvas behavior
     */
    exitReaderMode() {
        this.isReaderMode = false;
        this.unlockCanvas();
        this.canvas.classList.remove('reader-mode');
        document.body.classList.remove('reader-mode-active');

        const currentCard = this.readerModeCurrentCard?.sourceFile;
        this.clearAllCards();
        this.readerModeCurrentCard = null;

        // Update settings to reflect we're not in reader mode
        this.settings.readerMode = false;
        localStorage.setItem('settings-readerMode', 'false');
        this.syncAllSettingsCards();

        if (currentCard) {
            window.history.replaceState(null, '', `#/${currentCard}`);
            this.loadCardFromFile(currentCard, { fillViewport: true });
        } else {
            this.loadMenuCard();
        }
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
        this.clearPreviewCard();

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
     * Get appropriate margin for reader mode based on viewport
     */
    getReaderModeMargin() {
        // No margin - cards take up full screen
        return 0;
    }

    /**
     * Load a card specifically for reader mode display
     */
    async loadCardInReaderMode(cardName) {
        const contentData = await this.getCardContent(cardName);
        if (!contentData) return null;

        // Handle encrypted content
        if (contentData.isEncrypted) {
            const decryptedBody = await this.tryAutoDecrypt(contentData.encryptedData);
            if (decryptedBody) {
                const fullMarkdown = this.reconstructDecryptedMarkdown(
                    contentData.encryptedData.originalFrontmatter,
                    decryptedBody
                );
                contentData.content = fullMarkdown;
                contentData.isEncrypted = false;
            } else {
                // Show locked card in reader mode style
                return this.createLockedCardReaderMode(cardName, contentData);
            }
        }

        const parsed = this.parser.parse(contentData.content);
        if (!parsed) return null;

        const margin = this.getReaderModeMargin();

        const card = this.addCard({
            x: margin,
            y: margin,
            width: window.innerWidth - (margin * 2),
            height: window.innerHeight - (margin * 2),
            rotation: 0,
            pageNumber: null, // No page number in reader mode
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
            isDynamic: contentData.isDynamic || false,
            isReaderMode: true
        });

        card.element.classList.add('card-reader-mode');

        // Bind interactive elements
        this.bindInteractiveElements(card.element);

        // Register for live-reload
        if (!contentData.isDynamic && contentData.sourceFile) {
            this.fileWatcher.watch(contentData.sourceFile);
        }

        return card;
    }

    /**
     * Create a locked card in reader mode for encrypted content
     */
    createLockedCardReaderMode(cardName, contentData) {
        const margin = this.getReaderModeMargin();

        // Create a simple locked card display
        const lockedContent = `
            <div class="locked-card-content">
                <div class="lock-icon">🔒</div>
                <h2>Encrypted Card</h2>
                <p>This card is encrypted. Enter password to unlock.</p>
                <input type="password" class="password-input" placeholder="Password" autocomplete="current-password">
                <button class="unlock-btn">Unlock</button>
            </div>
        `;

        const card = this.addCard({
            x: margin,
            y: margin,
            width: window.innerWidth - (margin * 2),
            height: window.innerHeight - (margin * 2),
            rotation: 0,
            pageNumber: null,
            content: lockedContent,
            sourceFile: cardName,
            isReaderMode: true
        });

        card.element.classList.add('card-reader-mode', 'card-locked');

        // Bind unlock button
        const unlockBtn = card.element.querySelector('.unlock-btn');
        const passwordInput = card.element.querySelector('.password-input');

        if (unlockBtn && passwordInput) {
            const tryUnlock = async () => {
                const password = passwordInput.value;
                if (password) {
                    try {
                        const decrypted = await this.crypto.decrypt(
                            contentData.encryptedData.encryptedContent,
                            password,
                            contentData.encryptedData.salt,
                            contentData.encryptedData.iv
                        );
                        if (decrypted) {
                            // Cache password for future
                            this.crypto.cachePassword(cardName, password);
                            // Reload the card
                            this.navigateReaderMode(cardName);
                        }
                    } catch (e) {
                        passwordInput.classList.add('error');
                        setTimeout(() => passwordInput.classList.remove('error'), 500);
                    }
                }
            };

            unlockBtn.addEventListener('click', tryUnlock);
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') tryUnlock();
            });
        }

        return card;
    }

    /**
     * Navigate to a new card in reader mode (in-place replacement)
     */
    async navigateReaderMode(cardName) {
        this.clearAllCards();
        const card = await this.loadCardInReaderMode(cardName);
        if (card) {
            this.readerModeCurrentCard = card;
            window.history.pushState({ readerMode: true, cardName }, '', `#/r/${cardName}`);
        }
    }

    /**
     * Handle browser back/forward navigation
     */
    handlePopState(event) {
        const state = event.state;

        if (state?.readerMode) {
            // Navigate to the specified card in reader mode
            this.enterReaderMode(state.cardName, false);
            if (state.headingId) {
                this.scrollToHeadingInReaderMode(state.headingId);
            }
        } else if (this.isReaderMode) {
            // Exiting reader mode via back button
            this.exitReaderMode();
        } else {
            // Normal mode navigation
            const urlInfo = this.getCardNameFromURL();
            if (urlInfo) {
                this.clearAllCards();
                this.loadCardFromFile(urlInfo.cardName, { fillViewport: true }).then(card => {
                    if (card && urlInfo.headingId) {
                        this.scrollToHeadingInCard(card, urlInfo.headingId);
                    }
                });
            } else {
                // Navigating to plain URL (no card specified)
                // Clear cards and load menu
                this.clearAllCards();
                this.loadMenuCard();
            }
        }
    }

    /**
     * Handle hash changes from direct URL edits in the address bar.
     * Unlike popstate, hashchange fires when the user types a new hash URL.
     */
    handleHashChange() {
        const urlInfo = this.getCardNameFromURL();

        if (urlInfo?.readerMode) {
            if (!this.isReaderMode || this.readerModeCurrentCard?.sourceFile !== urlInfo.cardName) {
                this.enterReaderMode(urlInfo.cardName, false);
            }
        } else if (this.isReaderMode) {
            this.exitReaderMode();
        } else if (urlInfo) {
            this.clearAllCards();
            this.loadCardFromFile(urlInfo.cardName, { fillViewport: true }).then(card => {
                if (card && urlInfo.headingId) {
                    this.scrollToHeadingInCard(card, urlInfo.headingId);
                }
            });
        } else {
            this.clearAllCards();
            this.loadMenuCard();
        }
    }

    /**
     * Handle viewport resize - especially important for reader mode
     */
    handleResize() {
        if (this.isReaderMode && this.readerModeCurrentCard) {
            const margin = this.getReaderModeMargin();
            const card = this.readerModeCurrentCard;

            // Update card dimensions to match new viewport
            card.width = window.innerWidth - (margin * 2);
            card.height = window.innerHeight - (margin * 2);
            card.x = margin;
            card.y = margin;
            card.updateTransform();
        }
    }

    /**
     * Bind swipe gestures for reader mode navigation
     */
    bindReaderModeSwipes() {
        let touchStartX = 0;
        let touchStartY = 0;
        const SWIPE_THRESHOLD = 100;
        const EDGE_ZONE = 50; // pixels from left edge

        this.canvas.addEventListener('touchstart', (e) => {
            if (!this.isReaderMode) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        this.canvas.addEventListener('touchend', (e) => {
            if (!this.isReaderMode) return;

            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            // Swipe right from left edge = go back
            if (touchStartX < EDGE_ZONE &&
                deltaX > SWIPE_THRESHOLD &&
                Math.abs(deltaX) > Math.abs(deltaY)) {
                window.history.back();
            }
        }, { passive: true });
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
