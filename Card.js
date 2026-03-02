import { DEFAULT_MARGIN_PERCENT } from './Controls.js';

/**
 * Card class - Handles creation and interaction of paper cards
 *
 * Margin types:
 * - "absolute": Fixed position, doesn't move with scroll (titles, page numbers)
 * - "relative": Moves with content scroll, anchored to specific content
 */
export class Card {
    constructor(options = {}) {
        this.id = options.id || `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.x = options.x || 100;
        this.y = options.y || 100;
        this.width = options.width || 280;
        this.height = options.height || 360;
        this.rotation = options.rotation || 0;
        this.scale = options.scale || 1;
        this.pageNumber = options.pageNumber || '00';
        this.pinned = options.pinned || false;
        this.zIndex = options.zIndex || 1;

        // Content
        this.content = options.content || '';
        this.margins = options.margins || {
            left: [],
            right: [],
            top: [],
            bottom: []
        };

        // Image card
        this.image = options.image || null;
        this.caption = options.caption || '';

        // Embed card (iframe)
        this.embedUrl = options.embedUrl || null;

        // Custom margin sizes (as percentage of card dimensions)
        this.marginTB = options.marginTB ?? null;  // Top/bottom as % of height
        this.marginLR = options.marginLR ?? null;  // Left/right as % of width

        // Dynamic margin percentage (used for scaling margins with card size)
        this.marginPercent = null;

        // Track previous dimensions for resize detection
        this.prevWidth = this.width;
        this.prevHeight = this.height;

        // Reading stats options
        this.progressBar = options.progressBar || false;
        this.wordCount = options.wordCount || false;
        this.readTime = options.readTime || false;
        this.showReadingStats = this.progressBar || this.wordCount || this.readTime;

        // Tags
        this.tags = options.tags || [];
        this.showTags = options.showTags || false;

        // Date (for [[date]] directive)
        this.date = options.date || null;

        // Source file tracking (for live-reload)
        this.sourceFile = options.sourceFile || null;
        this.isDynamic = options.isDynamic || false;

        // Reader mode flag
        this.isReaderMode = options.isReaderMode || false;

        // State
        this.isDragging = false;
        this.isRotating = false;
        this.isScaling = false;
        this.startX = 0;
        this.startY = 0;
        this.startRotation = 0;
        this.startScale = 0;
        this.startWidth = 0;
        this.startHeight = 0;

        // Margin layout registry — tracks all margin items per side for collision resolution
        this.marginItemRegistry = { left: [], right: [], top: [], bottom: [] };
        this.cachedMarginMetrics = {};
        this.marginLayoutPending = false;

        // Create DOM element
        this.element = this.createElement();
        this.bindEvents();

        // Initial positioning of margins
        requestAnimationFrame(() => {
            this.cacheMarginMetrics();
            this.updateMarginLayout();
            this.updateProgressBar();
            // Also render LaTeX and highlight code in margins after DOM is ready
            this.renderLaTeX();
            this.highlightCode();
        });
    }

    createElement() {
        const card = document.createElement('div');
        card.className = 'card';
        card.id = this.id;
        card.dataset.cardId = this.id;

        if (this.pinned) {
            card.classList.add('pinned');
        }

        if (this.isReaderMode) {
            card.classList.add('card-reader-mode');
        }

        this.updateTransform(card);

        // Create container structure
        const container = document.createElement('div');
        container.className = 'card-container';

        // Apply margin sizes (default or custom if specified)
        const marginLR = this.marginLR !== null ? this.marginLR : DEFAULT_MARGIN_PERCENT;
        const marginTB = this.marginTB !== null ? this.marginTB : DEFAULT_MARGIN_PERCENT;

        const lrSize = `${(marginLR / 100) * this.width}px`;
        const tbSize = `${(marginTB / 100) * this.height}px`;

        container.style.gridTemplateColumns = `${lrSize} 1fr ${lrSize}`;
        container.style.gridTemplateRows = `${tbSize} 1fr ${tbSize}`;

        // Margins - now with separate containers for absolute and relative items
        const marginTop = this.createMarginElement('top', this.margins.top);
        const marginLeft = this.createMarginElement('left', this.margins.left);
        const marginRight = this.createMarginElement('right', this.margins.right);
        const marginBottom = this.createMarginElement('bottom', this.margins.bottom, true);

        // Main content
        const content = document.createElement('div');
        content.className = 'card-content';

        if (this.image) {
            // Image cards have simpler structure
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            content.style.padding = '0';
            content.style.display = 'flex';
            content.style.flexDirection = 'column';
            content.style.height = '100%';
            content.innerHTML = `
                <div class="card-image-container">
                    <img src="${this.image}" alt="${this.caption}" class="card-image">
                </div>
                ${this.caption ? `<div class="card-image-caption">${this.caption}</div>` : ''}
            `;
            container.appendChild(content);

            // Add page number for image cards
            if (this.pageNumber) {
                const pageNumberEl = document.createElement('span');
                pageNumberEl.className = 'card-page-number-absolute';
                pageNumberEl.textContent = this.pageNumber;
                container.appendChild(pageNumberEl);
            }

            card.appendChild(container);
        } else if (this.embedUrl) {
            // Embed cards contain an iframe with fallback
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            content.style.padding = '0';
            content.style.display = 'flex';
            content.style.flexDirection = 'column';
            content.style.height = '100%';
            content.innerHTML = `
                <div class="card-embed-toolbar">
                    <span class="card-embed-url" title="${this.embedUrl}">${this.getDisplayUrl(this.embedUrl)}</span>
                </div>
                <div class="card-embed-container">
                    <iframe src="${this.embedUrl}" class="card-embed-iframe"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen></iframe>
                    <div class="card-embed-fallback">
                        <p>This site cannot be embedded.</p>
                        <a href="${this.embedUrl}" target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>
                    </div>
                </div>
            `;
            container.appendChild(content);
            card.appendChild(container);

            // Try to detect embedding failure
            setTimeout(() => {
                this.checkEmbedStatus();
            }, 100);
        } else {
            // Set content HTML
            content.innerHTML = this.content;

            // Process [[tags]] placeholders after setting content
            if (this.tags.length > 0) {
                const tagPlaceholders = content.querySelectorAll('[data-tags-placeholder="true"]');
                tagPlaceholders.forEach(placeholder => {
                    // More thorough tag cleaning - handle any whitespace issues
                    const cleanTags = this.tags
                        .map(tag => tag.replace(/\s+/g, ' ').trim()) // Replace multiple spaces with single space, then trim
                        .filter(tag => tag.length > 0);

                    const tagsHTML = cleanTags
                        .map((tag, index) => {
                            const comma = index < cleanTags.length - 1 ? ', ' : '';
                            return `<span class="card-tag" data-tag="${tag}">${tag}${comma}</span>`;
                        })
                        .join('');

                    placeholder.innerHTML = tagsHTML;
                    placeholder.classList.add('card-tags-inline');
                });
            }

            // Process [[date]] placeholders after setting content
            if (this.date) {
                const datePlaceholders = content.querySelectorAll('[data-date-placeholder="true"]');
                datePlaceholders.forEach(placeholder => {
                    // Format date as "Month Day, Year" (e.g., "January 29, 2026")
                    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                                    'July', 'August', 'September', 'October', 'November', 'December'];
                    const month = months[this.date.getMonth()];
                    const day = this.date.getDate();
                    const year = this.date.getFullYear();
                    const formattedDate = `${month} ${day}, ${year}`;

                    placeholder.textContent = formattedDate;
                    placeholder.classList.add('card-date-inline');
                });
            }

            // Render LaTeX and highlight code in content after DOM is ready
            requestAnimationFrame(() => {
                this.renderLaTeX();
                this.highlightCode();
            });

            // Assemble container with margins
            container.appendChild(marginTop);
            container.appendChild(marginLeft);
            container.appendChild(content);
            container.appendChild(marginRight);
            container.appendChild(marginBottom);

            // Add margin resize handles (between margins and content)
            const marginResizeLeft = document.createElement('div');
            marginResizeLeft.className = 'margin-resize-handle margin-resize-left';
            marginResizeLeft.dataset.marginSide = 'left';
            container.appendChild(marginResizeLeft);

            const marginResizeRight = document.createElement('div');
            marginResizeRight.className = 'margin-resize-handle margin-resize-right';
            marginResizeRight.dataset.marginSide = 'right';
            container.appendChild(marginResizeRight);

            const marginResizeTop = document.createElement('div');
            marginResizeTop.className = 'margin-resize-handle margin-resize-top';
            marginResizeTop.dataset.marginSide = 'top';
            container.appendChild(marginResizeTop);

            const marginResizeBottom = document.createElement('div');
            marginResizeBottom.className = 'margin-resize-handle margin-resize-bottom';
            marginResizeBottom.dataset.marginSide = 'bottom';
            container.appendChild(marginResizeBottom);

            // Add reading stats indicator if any option is enabled
            if (this.showReadingStats) {
                const statsIndicator = document.createElement('span');
                statsIndicator.className = 'card-reading-stats';
                container.appendChild(statsIndicator);
            }

            // Add page number inside container so it gets clipped by fold animations
            if (this.pageNumber) {
                const pageNumberEl = document.createElement('span');
                pageNumberEl.className = 'card-page-number-absolute';
                pageNumberEl.textContent = this.pageNumber;
                container.appendChild(pageNumberEl);
            }

            card.appendChild(container);
        }

        // Add corner handles for scaling, rotation, and dragging
        const corners = ['tl', 'tr', 'bl', 'br'];
        corners.forEach(corner => {
            // Drag handles (inside corners)
            const dragHandle = document.createElement('div');
            dragHandle.className = `card-drag-handle card-drag-handle-${corner}`;
            dragHandle.dataset.dragCorner = corner;
            card.appendChild(dragHandle);

            // Scale handles (on corners)
            const handle = document.createElement('div');
            handle.className = `card-handle card-handle-${corner}`;
            handle.dataset.corner = corner;
            card.appendChild(handle);

            // Rotation handles (outside corners)
            const rotateHandle = document.createElement('div');
            rotateHandle.className = `card-rotate-handle card-rotate-handle-${corner}`;
            rotateHandle.dataset.rotateCorner = corner;
            card.appendChild(rotateHandle);

            // Corner fold effect elements
            const fold = document.createElement('div');
            fold.className = `card-corner-fold card-corner-fold-${corner}`;
            card.appendChild(fold);
        });

        // Top middle actions (pin/delete)
        const topHandle = document.createElement('div');
        topHandle.className = 'card-top-handle';

        // Add external link button for embed cards
        const externalBtn = this.embedUrl
            ? `<a href="${this.embedUrl}" target="_blank" rel="noopener noreferrer" class="card-action-btn external-btn" title="Open in new tab">↗</a>`
            : '';

        topHandle.innerHTML = `
            ${externalBtn}
            <button class="card-action-btn pin-btn" title="Pin">📌</button>
            <button class="card-action-btn delete-btn" title="Delete">×</button>
        `;
        card.appendChild(topHandle);

        return card;
    }

    createMarginElement(side, items, includePageNumber = false) {
        const margin = document.createElement('div');
        margin.className = `card-margin card-margin-${side}`;

        // Clear registry for this side
        this.marginItemRegistry[side] = [];

        if (items && items.length > 0) {
            const container = document.createElement('div');
            container.className = 'margin-items-container';

            items.forEach((item, index) => {
                const html = this.renderMarginItem(item, item.type, side);
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html;
                const el = wrapper.firstElementChild;
                el.dataset.marginOrder = index;

                // Store raw HTML for overflow arrow card spawning
                el.dataset.rawHtml = item.html || '';

                container.appendChild(el);

                // Register item for layout algorithm
                this.marginItemRegistry[side].push({
                    element: el,
                    type: item.type,
                    anchorId: item.anchor || null,
                    pos: item.pos !== null && item.pos !== undefined ? item.pos : null,
                    maxh: item.maxh || null,
                    desiredPos: 0,
                    actualPos: 0,
                    size: 0,
                    heightDirty: true,
                    order: index
                });
            });

            margin.appendChild(container);
        }

        return margin;
    }

    renderMarginItem(item, type, side) {
        const anchorAttr = item.anchor ? `data-anchor="${item.anchor}"` : '';
        const typeClass = `margin-type-${type}`;
        const orientationClass = `margin-orientation-${item.orientation || 'auto'}`;
        const maxhAttr = item.maxh ? `data-maxh="${item.maxh}"` : '';

        // Position is now handled by updateMarginLayout(), not inline styles
        let html = `<div class="margin-item margin-annotation ${typeClass} ${orientationClass}" ${anchorAttr} ${maxhAttr} data-margin-side="${side}" data-margin-type="${type}" data-orientation="${item.orientation || 'auto'}"${item.pos !== null && item.pos !== undefined ? ` data-pos="${item.pos}"` : ''}>`;

        // Determine size style based on orientation
        // For vertical text (in left/right margins), size controls max-height
        // For horizontal text (in left/right margins), size controls max-height too
        // For top/bottom margins, size controls max-width
        let sizeStyle = '';
        if (item.size) {
            if (side === 'top' || side === 'bottom') {
                sizeStyle = `max-width: ${item.size}px;`;
            } else {
                sizeStyle = `max-height: ${item.size}px;`;
            }
        }

        // Scrollable content wrapper with optional size override
        html += `<div class="margin-item-content"${sizeStyle ? ` style="${sizeStyle}"` : ''}>`;

        // Use pre-rendered HTML from parser (supports full DSL including styles)
        html += item.html || '';

        html += '</div>'; // close margin-item-content

        // Overflow arrow — shown when content exceeds max height
        html += '<div class="margin-overflow-arrow" title="Open in card">\u2192</div>';

        // Add resize handles based on side and orientation
        if (side === 'left' || side === 'right') {
            html += '<div class="margin-item-resize-handle resize-vertical"></div>';
        } else {
            html += '<div class="margin-item-resize-handle resize-horizontal"></div>';
        }

        html += '</div>';
        return html;
    }

    updateTransform(element = this.element) {
        element.style.left = `${this.x}px`;
        element.style.top = `${this.y}px`;
        element.style.width = `${this.width}px`;
        element.style.height = `${this.height}px`;
        element.style.transform = `rotate(${this.rotation}deg) scale(${this.scale})`;
        element.style.zIndex = this.zIndex;

        // Dynamically scale margins if card was resized
        if (this.marginPercent !== null && (this.width !== this.prevWidth || this.height !== this.prevHeight)) {
            this.updateMarginSize(this.marginPercent);
            this.prevWidth = this.width;
            this.prevHeight = this.height;
        }

        // Counter-rotate handles so they stay visually fixed regardless of card rotation
        const counterRotation = -this.rotation;
        element.querySelectorAll('.card-handle, .card-rotate-handle, .card-drag-handle').forEach(handle => {
            handle.style.transform = `rotate(${counterRotation}deg)`;
        });

        // Top handle needs translateX(-50%) for centering plus counter-rotation
        const topHandle = element.querySelector('.card-top-handle');
        if (topHandle) {
            topHandle.style.transform = `translateX(-50%) rotate(${counterRotation}deg)`;
        }

        // Notify app about card movement for connection updates
        if (window.paperCanvas && window.paperCanvas.updateAllConnections) {
            window.paperCanvas.updateAllConnections();
        }
    }

    bindEvents() {
        // Drag handles in corners
        this.element.querySelectorAll('.card-drag-handle').forEach(handle => {
            handle.addEventListener('mousedown', this.onDragHandleStart.bind(this));
            handle.addEventListener('touchstart', this.onDragHandleTouchStart.bind(this), { passive: false });
        });

        // Bring to front on hover
        this.element.addEventListener('mouseenter', () => {
            this.bringToFront();
        });

        // Bring to front on touch
        this.element.addEventListener('touchstart', () => {
            this.bringToFront();
        }, { passive: true });

        // Scale handles
        this.element.querySelectorAll('.card-handle').forEach(handle => {
            handle.addEventListener('mousedown', this.onScaleStart.bind(this));
            handle.addEventListener('touchstart', this.onScaleTouchStart.bind(this), { passive: false });
        });

        // Rotate handles
        this.element.querySelectorAll('.card-rotate-handle').forEach(handle => {
            handle.addEventListener('mousedown', this.onRotateStart.bind(this));
            handle.addEventListener('touchstart', this.onRotateTouchStart.bind(this), { passive: false });
        });

        // Corner fold unfold animation
        // Track animation state per corner to prevent interruption
        this.cornerAnimationState = {}; // { corner: 'idle' | 'folding' | 'unfolding' }
        this.cornerAnimationTimeout = {}; // timeout IDs per corner
        this.cornerHovered = {}; // whether corner is currently hovered

        this.element.querySelectorAll('.card-handle, .card-rotate-handle').forEach(handle => {
            handle.addEventListener('mouseenter', (e) => {
                const corner = handle.dataset.corner || handle.dataset.rotateCorner;
                if (corner) {
                    this.cornerHovered[corner] = true;
                    this.updateCornerFold(corner);
                }
            });

            handle.addEventListener('mouseleave', (e) => {
                const corner = handle.dataset.corner || handle.dataset.rotateCorner;
                if (corner) {
                    // Don't unfold if we're currently scaling/rotating this corner
                    if ((this.isScaling && this.scalingCorner === corner) ||
                        (this.isRotating && this.rotatingCorner === corner)) {
                        return;
                    }

                    this.cornerHovered[corner] = false;
                    this.updateCornerFold(corner);
                }
            });
        });

        // Pin button
        this.element.querySelector('.pin-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePin();
        });

        // Delete button
        this.element.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.delete();
        });

        // Global mouse events
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));

        // Global touch events
        document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.onTouchEnd.bind(this));
        document.addEventListener('touchcancel', this.onTouchEnd.bind(this));

        // Scroll synchronization for relative margin items
        const content = this.element.querySelector('.card-content');
        if (content) {
            content.addEventListener('scroll', this.onContentScroll.bind(this));
        }

        // Margin item resize handles
        this.element.querySelectorAll('.margin-item-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', this.onMarginItemResizeStart.bind(this));
            handle.addEventListener('touchstart', this.onMarginItemResizeTouchStart.bind(this), { passive: false });
        });

        // Handle wheel scrolling for vertical margin content
        this.element.querySelectorAll('.margin-orientation-vertical .margin-item-content').forEach(content => {
            content.addEventListener('wheel', this.onVerticalMarginWheel.bind(this), { passive: false });
        });

        // Margin area resize handles (for resizing the margin columns/rows)
        this.element.querySelectorAll('.margin-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', this.onMarginAreaResizeStart.bind(this));
            handle.addEventListener('touchstart', this.onMarginAreaResizeTouchStart.bind(this), { passive: false });
        });

        // Tag click handlers
        this.element.querySelectorAll('.card-tag').forEach(tag => {
            tag.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const tagName = tag.dataset.tag;

                // Dispatch custom event for tag click
                this.element.dispatchEvent(new CustomEvent('tag-click', {
                    bubbles: true,
                    detail: { tagName: tagName, card: this }
                }));
            });
        });

        // ResizeObserver for margin items — remeasure when content size changes
        this.marginResizeObserver = new ResizeObserver((entries) => {
            let dirty = false;
            for (const entry of entries) {
                for (const side of ['left', 'right', 'top', 'bottom']) {
                    const item = this.marginItemRegistry[side]?.find(i => i.element === entry.target);
                    if (item) {
                        item.heightDirty = true;
                        dirty = true;
                        break;
                    }
                }
            }
            if (dirty) {
                this.updateMarginLayout();
            }
        });

        // Observe all margin item elements
        for (const side of ['left', 'right', 'top', 'bottom']) {
            for (const item of this.marginItemRegistry[side]) {
                this.marginResizeObserver.observe(item.element);
            }
        }
    }

    onDragHandleStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        this.isDragging = true;
        this.element.classList.add('dragging');

        // Store initial mouse position and card position
        this.dragStartMouseX = e.clientX;
        this.dragStartMouseY = e.clientY;
        this.dragStartX = this.x;
        this.dragStartY = this.y;

        // Bring to front
        this.bringToFront();
    }

    onScaleStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        this.isScaling = true;
        this.scalingCorner = e.target.dataset.corner;

        this.startX = e.clientX;
        this.startY = e.clientY;
        this.startWidth = this.width;
        this.startHeight = this.height;
        this.startPosX = this.x;
        this.startPosY = this.y;

        // Store the initial center position (in canvas content space)
        this.startCenterX = this.x + this.width / 2;
        this.startCenterY = this.y + this.height / 2;

        this.element.classList.add('dragging');
        this.bringToFront();
    }

    onRotateStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        this.isRotating = true;
        this.rotatingCorner = e.target.dataset.rotateCorner;

        // Get center of card
        const rect = this.element.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;

        // Calculate initial angle
        this.startAngle = Math.atan2(
            e.clientY - this.centerY,
            e.clientX - this.centerX
        ) * (180 / Math.PI);

        this.startRotation = this.rotation;

        this.element.classList.add('dragging');
        this.bringToFront();
    }

    // Touch event handlers
    onDragHandleTouchStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];
        this.isDragging = true;
        this.isTouchDragging = true;
        this.element.classList.add('dragging');

        this.dragStartMouseX = touch.clientX;
        this.dragStartMouseY = touch.clientY;
        this.dragStartX = this.x;
        this.dragStartY = this.y;

        this.bringToFront();
    }

    onScaleTouchStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];
        this.isScaling = true;
        this.isTouchScaling = true;
        this.scalingCorner = e.target.dataset.corner;

        this.startX = touch.clientX;
        this.startY = touch.clientY;
        this.startWidth = this.width;
        this.startHeight = this.height;
        this.startPosX = this.x;
        this.startPosY = this.y;

        this.startCenterX = this.x + this.width / 2;
        this.startCenterY = this.y + this.height / 2;

        this.element.classList.add('dragging');
        this.bringToFront();
    }

    onRotateTouchStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];
        this.isRotating = true;
        this.isTouchRotating = true;
        this.rotatingCorner = e.target.dataset.rotateCorner;

        const rect = this.element.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;

        this.startAngle = Math.atan2(
            touch.clientY - this.centerY,
            touch.clientX - this.centerX
        ) * (180 / Math.PI);

        this.startRotation = this.rotation;

        this.element.classList.add('dragging');
        this.bringToFront();
    }

    onTouchMove(e) {
        if (!this.isDragging && !this.isScaling && !this.isRotating &&
            !this.isResizingMarginItem && !this.isResizingMarginArea) return;

        if (e.touches.length < 1) return;

        const touch = e.touches[0];

        // Create a fake mouse event with touch coordinates
        const fakeEvent = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            target: e.target
        };

        // Prevent scrolling while doing card operations
        if (this.isDragging || this.isScaling || this.isRotating ||
            this.isResizingMarginItem || this.isResizingMarginArea) {
            e.preventDefault();
        }

        // Reuse the mouse move logic
        this.onMouseMove(fakeEvent);
    }

    onTouchEnd(e) {
        // Clear touch flags
        this.isTouchDragging = false;
        this.isTouchScaling = false;
        this.isTouchRotating = false;

        // Reuse mouse up logic
        this.onMouseUp(e);
    }

    onMarginItemResizeTouchStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];

        this.isResizingMarginItem = true;
        this.resizingMarginItem = e.target.closest('.margin-item');
        this.resizingMarginItem.classList.add('resizing');
        e.target.classList.add('active');

        this.marginItemResizeStartX = touch.clientX;
        this.marginItemResizeStartY = touch.clientY;

        this.marginItemResizeDirection = e.target.classList.contains('resize-vertical') ? 'vertical' : 'horizontal';

        const contentEl = this.resizingMarginItem.querySelector('.margin-item-content');

        if (this.marginItemResizeDirection === 'vertical') {
            const currentHeight = contentEl.style.maxHeight;
            this.marginItemResizeStartSize = currentHeight
                ? parseInt(currentHeight)
                : contentEl.offsetHeight;
        } else {
            const currentWidth = contentEl.style.maxWidth;
            this.marginItemResizeStartSize = currentWidth
                ? parseInt(currentWidth)
                : contentEl.offsetWidth;
        }

        this.resizingMarginSide = this.resizingMarginItem.dataset.marginSide;

        this.bringToFront();
    }

    onMarginAreaResizeTouchStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];

        this.isResizingMarginArea = true;
        this.resizingMarginAreaSide = e.target.dataset.marginSide;
        e.target.classList.add('active');

        this.marginAreaResizeStartX = touch.clientX;
        this.marginAreaResizeStartY = touch.clientY;

        const container = this.element.querySelector('.card-container');
        const computedStyle = getComputedStyle(container);

        this.marginAreaStartSizes = {
            left: this.marginLeftSize || 100,
            right: this.marginRightSize || 100,
            top: this.marginTopSize || null,
            bottom: this.marginBottomSize || null
        };

        const cols = computedStyle.gridTemplateColumns.split(' ');
        if (cols.length >= 3) {
            this.marginAreaStartSizes.left = parseFloat(cols[0]) || 100;
            this.marginAreaStartSizes.right = parseFloat(cols[2]) || 100;
        }

        const rows = computedStyle.gridTemplateRows.split(' ');
        if (rows.length >= 3) {
            this.marginAreaStartSizes.top = parseFloat(rows[0]) || 40;
            this.marginAreaStartSizes.bottom = parseFloat(rows[2]) || 40;
        }

        this.bringToFront();
    }

    onMouseMove(e) {
        if (this.isDragging) {
            // Get canvas transforms from the global PaperCanvas
            const canvas = window.paperCanvas;
            const zoom = canvas ? canvas.zoom : 1;
            const rotation = canvas ? canvas.rotation : 0;
            const rotationRad = -rotation * Math.PI / 180; // Negative for inverse transform

            // Calculate screen-space delta
            const screenDx = e.clientX - this.dragStartMouseX;
            const screenDy = e.clientY - this.dragStartMouseY;

            // Transform delta from screen space to content space
            // First account for rotation (inverse rotation)
            const cos = Math.cos(rotationRad);
            const sin = Math.sin(rotationRad);
            const rotatedDx = screenDx * cos - screenDy * sin;
            const rotatedDy = screenDx * sin + screenDy * cos;

            // Then account for zoom
            const contentDx = rotatedDx / zoom;
            const contentDy = rotatedDy / zoom;

            this.x = this.dragStartX + contentDx;
            this.y = this.dragStartY + contentDy;
            this.updateTransform();
        } else if (this.isScaling) {
            // Get canvas transforms
            const canvas = window.paperCanvas;
            const canvasZoom = canvas ? canvas.zoom : 1;
            const canvasRotation = canvas ? canvas.rotation : 0;
            const canvasRotationRad = -canvasRotation * Math.PI / 180;

            // Calculate screen-space delta
            const screenDx = e.clientX - this.startX;
            const screenDy = e.clientY - this.startY;

            // Transform to canvas content space (account for canvas rotation and zoom)
            const canvasCos = Math.cos(canvasRotationRad);
            const canvasSin = Math.sin(canvasRotationRad);
            const contentDx = (screenDx * canvasCos - screenDy * canvasSin) / canvasZoom;
            const contentDy = (screenDx * canvasSin + screenDy * canvasCos) / canvasZoom;

            // Account for card's own rotation when scaling
            const rad = this.rotation * (Math.PI / 180);
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            // Rotate the delta to account for card rotation
            const rotatedDx = contentDx * cos + contentDy * sin;
            const rotatedDy = -contentDx * sin + contentDy * cos;

            const corner = this.scalingCorner;
            const minSize = 150;

            // Calculate width/height changes based on corner
            // For center-based scaling, opposite corners contribute opposite deltas
            let widthDelta = 0;
            let heightDelta = 0;

            if (corner.includes('r')) {
                widthDelta = rotatedDx * 2; // *2 because center stays fixed
            } else if (corner.includes('l')) {
                widthDelta = -rotatedDx * 2;
            }

            if (corner.includes('b')) {
                heightDelta = rotatedDy * 2;
            } else if (corner.includes('t')) {
                heightDelta = -rotatedDy * 2;
            }

            // Calculate new dimensions
            const newWidth = Math.max(minSize, this.startWidth + widthDelta);
            const newHeight = Math.max(minSize, this.startHeight + heightDelta);

            // Update position to keep center fixed
            // The card's x,y is top-left corner, so we need to offset from center
            this.width = newWidth;
            this.height = newHeight;
            this.x = this.startCenterX - newWidth / 2;
            this.y = this.startCenterY - newHeight / 2;

            this.updateTransform();
        } else if (this.isRotating) {
            const currentAngle = Math.atan2(
                e.clientY - this.centerY,
                e.clientX - this.centerX
            ) * (180 / Math.PI);

            let angleDelta = currentAngle - this.startAngle;
            this.rotation = this.startRotation + angleDelta;

            // Snap to 0, 90, 180, 270 if close
            const snapAngles = [0, 90, 180, 270, -90, -180, -270];
            const snapThreshold = 5;

            for (const snapAngle of snapAngles) {
                if (Math.abs(this.rotation - snapAngle) < snapThreshold) {
                    this.rotation = snapAngle;
                    break;
                }
            }

            this.updateTransform();
        } else if (this.isResizingMarginItem) {
            // Get canvas transforms
            const canvas = window.paperCanvas;
            const zoom = canvas ? canvas.zoom : 1;
            const canvasRotation = canvas ? canvas.rotation : 0;
            const canvasRotationRad = -canvasRotation * Math.PI / 180;

            // Calculate screen-space delta
            const screenDx = e.clientX - this.marginItemResizeStartX;
            const screenDy = e.clientY - this.marginItemResizeStartY;

            // Transform to canvas content space
            const canvasCos = Math.cos(canvasRotationRad);
            const canvasSin = Math.sin(canvasRotationRad);
            const contentDx = (screenDx * canvasCos - screenDy * canvasSin) / zoom;
            const contentDy = (screenDx * canvasSin + screenDy * canvasCos) / zoom;

            // Also account for card rotation
            const cardRad = -this.rotation * Math.PI / 180;
            const cardCos = Math.cos(cardRad);
            const cardSin = Math.sin(cardRad);
            const localDx = contentDx * cardCos - contentDy * cardSin;
            const localDy = contentDx * cardSin + contentDy * cardCos;

            const contentEl = this.resizingMarginItem.querySelector('.margin-item-content');
            const minSize = 40;
            const maxSize = 400;

            if (this.marginItemResizeDirection === 'vertical') {
                // Resizing height - dragging down increases height
                const newHeight = Math.min(maxSize, Math.max(minSize, this.marginItemResizeStartSize + localDy));
                contentEl.style.maxHeight = `${newHeight}px`;
            } else {
                // Resizing width
                let newWidth;
                if (this.resizingMarginSide === 'left') {
                    // Left margin: dragging right increases width
                    newWidth = this.marginItemResizeStartSize + localDx;
                } else if (this.resizingMarginSide === 'right') {
                    // Right margin: dragging left increases width
                    newWidth = this.marginItemResizeStartSize - localDx;
                } else {
                    // Top/bottom: dragging right increases width
                    newWidth = this.marginItemResizeStartSize + localDx;
                }
                newWidth = Math.min(maxSize, Math.max(minSize, newWidth));
                contentEl.style.maxWidth = `${newWidth}px`;
            }
        } else if (this.isResizingMarginArea) {
            // Get canvas transforms
            const canvas = window.paperCanvas;
            const zoom = canvas ? canvas.zoom : 1;
            const rotation = canvas ? canvas.rotation : 0;
            const rotationRad = -rotation * Math.PI / 180;

            // Calculate screen-space delta
            const screenDx = e.clientX - this.marginAreaResizeStartX;
            const screenDy = e.clientY - this.marginAreaResizeStartY;

            // Transform to content space (account for canvas rotation and zoom)
            const cos = Math.cos(rotationRad);
            const sin = Math.sin(rotationRad);
            const contentDx = (screenDx * cos - screenDy * sin) / zoom;
            const contentDy = (screenDx * sin + screenDy * cos) / zoom;

            // Also account for card rotation
            const cardRad = -this.rotation * Math.PI / 180;
            const cardCos = Math.cos(cardRad);
            const cardSin = Math.sin(cardRad);
            const localDx = contentDx * cardCos - contentDy * cardSin;
            const localDy = contentDx * cardSin + contentDy * cardCos;

            const container = this.element.querySelector('.card-container');
            const side = this.resizingMarginAreaSide;
            const minSize = 20;
            const maxSize = 200;

            if (side === 'left') {
                // Dragging right increases left margin
                const newSize = Math.min(maxSize, Math.max(minSize, this.marginAreaStartSizes.left + localDx));
                this.marginLeftSize = newSize;
                container.style.gridTemplateColumns = `${newSize}px 1fr ${this.marginRightSize || this.marginAreaStartSizes.right}px`;
            } else if (side === 'right') {
                // Dragging left increases right margin
                const newSize = Math.min(maxSize, Math.max(minSize, this.marginAreaStartSizes.right - localDx));
                this.marginRightSize = newSize;
                container.style.gridTemplateColumns = `${this.marginLeftSize || this.marginAreaStartSizes.left}px 1fr ${newSize}px`;
            } else if (side === 'top') {
                // Dragging down increases top margin
                const newSize = Math.min(maxSize, Math.max(minSize, this.marginAreaStartSizes.top + localDy));
                this.marginTopSize = newSize;
                container.style.gridTemplateRows = `${newSize}px 1fr ${this.marginBottomSize || this.marginAreaStartSizes.bottom}px`;
            } else if (side === 'bottom') {
                // Dragging up increases bottom margin
                const newSize = Math.min(maxSize, Math.max(minSize, this.marginAreaStartSizes.bottom - localDy));
                this.marginBottomSize = newSize;
                container.style.gridTemplateRows = `${this.marginTopSize || this.marginAreaStartSizes.top}px 1fr ${newSize}px`;
            }
        }
    }

    onMouseUp(e) {
        // Track if we had a state-changing operation
        const hadStateChange = this.isDragging || this.isScaling || this.isRotating ||
                               this.isResizingMarginItem || this.isResizingMarginArea;

        // If we were scaling or rotating, trigger unfold through the state machine
        if (this.isScaling && this.scalingCorner) {
            const corner = this.scalingCorner;
            this.cornerHovered[corner] = false;
            // Force state to folded so unfold can proceed
            this.cornerAnimationState[corner] = 'folded';
            this.updateCornerFold(corner);
        }
        if (this.isRotating && this.rotatingCorner) {
            const corner = this.rotatingCorner;
            this.cornerHovered[corner] = false;
            // Force state to folded so unfold can proceed
            this.cornerAnimationState[corner] = 'folded';
            this.updateCornerFold(corner);
        }

        this.isDragging = false;
        this.isScaling = false;
        this.isRotating = false;
        this.scalingCorner = null;
        this.rotatingCorner = null;
        this.element.classList.remove('dragging');

        // Clean up margin item resize
        if (this.isResizingMarginItem) {
            this.resizingMarginItem.classList.remove('resizing');
            const handle = this.resizingMarginItem.querySelector('.margin-item-resize-handle');
            if (handle) handle.classList.remove('active');
            this.isResizingMarginItem = false;
            this.resizingMarginItem = null;
        }

        // Clean up margin area resize
        if (this.isResizingMarginArea) {
            // Dispatch event with the new margin size percentage for global setting sync
            const marginPercent = this.getMarginSizePercent();
            this.element.dispatchEvent(new CustomEvent('margin-size-changed', {
                bubbles: true,
                detail: { marginPercent: marginPercent, card: this }
            }));

            this.isResizingMarginArea = false;
            this.resizingMarginAreaSide = null;
            const activeHandle = this.element.querySelector('.margin-resize-handle.active');
            if (activeHandle) activeHandle.classList.remove('active');
        }

        // Dispatch state change event for persistence
        if (hadStateChange) {
            this.element.dispatchEvent(new CustomEvent('card-state-changed', { bubbles: true }));
        }
    }

    onContentScroll(e) {
        // rAF throttle margin layout to avoid layout thrashing during scroll
        if (!this.marginLayoutPending) {
            this.marginLayoutPending = true;
            requestAnimationFrame(() => {
                this.updateMarginLayout();
                this.marginLayoutPending = false;
            });
        }
        this.updateReadingStats();
        // Dispatch state change for scroll position persistence
        this.element.dispatchEvent(new CustomEvent('card-state-changed', { bubbles: true }));
    }

    updateProgressBar() {
        this.updateReadingStats();
    }

    updateReadingStats() {
        if (!this.showReadingStats) return;

        const content = this.element.querySelector('.card-content');
        const statsElement = this.element.querySelector('.card-reading-stats');
        if (!content || !statsElement) return;

        const parts = [];

        // Word count
        if (this.wordCount) {
            const text = content.textContent || '';
            const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
            parts.push(`${words} words`);
        }

        // Read time (average 200 words per minute)
        if (this.readTime) {
            const text = content.textContent || '';
            const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
            const minutes = Math.max(1, Math.round(words / 200));
            parts.push(`${minutes}m`);
        }

        // Progress percentage
        if (this.progressBar) {
            const scrollTop = content.scrollTop;
            const scrollHeight = content.scrollHeight - content.clientHeight;

            if (scrollHeight <= 0) {
                parts.push('100%');
            } else {
                const progress = Math.round((scrollTop / scrollHeight) * 100);
                parts.push(`${progress}%`);
            }
        }

        statsElement.textContent = parts.join(' | ');
    }

    onMarginItemResizeStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        this.isResizingMarginItem = true;
        this.resizingMarginItem = e.target.closest('.margin-item');
        this.resizingMarginItem.classList.add('resizing');
        e.target.classList.add('active');

        this.marginItemResizeStartX = e.clientX;
        this.marginItemResizeStartY = e.clientY;

        // Determine resize direction from handle class
        this.marginItemResizeDirection = e.target.classList.contains('resize-vertical') ? 'vertical' : 'horizontal';

        // Get the content element we're resizing
        const contentEl = this.resizingMarginItem.querySelector('.margin-item-content');

        // Get current size based on resize direction
        if (this.marginItemResizeDirection === 'vertical') {
            // Resizing height
            const currentHeight = contentEl.style.maxHeight;
            this.marginItemResizeStartSize = currentHeight
                ? parseInt(currentHeight)
                : contentEl.offsetHeight;
        } else {
            // Resizing width
            const currentWidth = contentEl.style.maxWidth;
            this.marginItemResizeStartSize = currentWidth
                ? parseInt(currentWidth)
                : contentEl.offsetWidth;
        }

        // Determine side
        this.resizingMarginSide = this.resizingMarginItem.dataset.marginSide;

        this.bringToFront();
    }

    onVerticalMarginWheel(e) {
        const content = e.currentTarget;

        // Prevent default to stop page/canvas scroll
        e.preventDefault();
        e.stopPropagation();

        // Speed multiplier for more responsive scrolling
        const speedMultiplier = 3;

        // Both margins scroll in the same direction for natural feel
        const delta = -e.deltaY * speedMultiplier;

        // With vertical-rl writing mode, overflow is typically horizontal
        if (content.scrollWidth > content.clientWidth) {
            content.scrollLeft += delta;
        } else if (content.scrollHeight > content.clientHeight) {
            content.scrollTop += delta;
        }
    }

    onMarginAreaResizeStart(e) {
        if (this.pinned) return;

        e.preventDefault();
        e.stopPropagation();

        this.isResizingMarginArea = true;
        this.resizingMarginAreaSide = e.target.dataset.marginSide;
        e.target.classList.add('active');

        this.marginAreaResizeStartX = e.clientX;
        this.marginAreaResizeStartY = e.clientY;

        // Get the container and current grid template
        const container = this.element.querySelector('.card-container');
        const computedStyle = getComputedStyle(container);

        // Store current margin sizes
        this.marginAreaStartSizes = {
            left: this.marginLeftSize || 100,
            right: this.marginRightSize || 100,
            top: this.marginTopSize || null,
            bottom: this.marginBottomSize || null
        };

        // Parse current grid template columns to get actual margin widths
        const cols = computedStyle.gridTemplateColumns.split(' ');
        if (cols.length >= 3) {
            this.marginAreaStartSizes.left = parseFloat(cols[0]) || 100;
            this.marginAreaStartSizes.right = parseFloat(cols[2]) || 100;
        }

        // Parse grid template rows for top/bottom
        const rows = computedStyle.gridTemplateRows.split(' ');
        if (rows.length >= 3) {
            this.marginAreaStartSizes.top = parseFloat(rows[0]) || 40;
            this.marginAreaStartSizes.bottom = parseFloat(rows[2]) || 40;
        }

        this.bringToFront();
    }

    /**
     * Cache layout metrics to avoid getComputedStyle on every scroll
     */
    cacheMarginMetrics() {
        const content = this.element.querySelector('.card-content');
        if (!content) return;

        this.cachedMarginMetrics.contentPaddingTop = parseInt(getComputedStyle(content).paddingTop) || 0;
        this.cachedMarginMetrics.cardHeight = this.element.getBoundingClientRect().height;

        for (const side of ['left', 'right', 'top', 'bottom']) {
            const marginArea = this.element.querySelector(`.card-margin-${side}`);
            if (marginArea) {
                this.cachedMarginMetrics[`${side}PaddingTop`] = parseInt(getComputedStyle(marginArea).paddingTop) || 0;
                this.cachedMarginMetrics[`${side}Height`] = marginArea.clientHeight;
                this.cachedMarginMetrics[`${side}PaddingLeft`] = parseInt(getComputedStyle(marginArea).paddingLeft) || 0;
                this.cachedMarginMetrics[`${side}Width`] = marginArea.clientWidth;
            }
        }

        // Mark all items for height remeasurement
        for (const side of ['left', 'right', 'top', 'bottom']) {
            for (const item of this.marginItemRegistry[side]) {
                item.heightDirty = true;
            }
        }
    }

    /**
     * Resolve a maxh value to pixels.
     * Accepts "20%" (percentage of card height) or "50px" or "50" (pixels).
     * Returns null if not specified (will use default).
     */
    resolveMaxH(maxhStr, cardHeight) {
        if (!maxhStr) return null;
        const str = String(maxhStr).trim();
        if (str.endsWith('%')) {
            const pct = parseFloat(str) / 100;
            return cardHeight * pct;
        }
        return parseFloat(str) || null;
    }

    /**
     * Unified margin layout algorithm — positions all margin items on all sides,
     * prevents overlap using distribute-evenly collision resolution, and manages
     * max height constraints with overflow arrows.
     */
    updateMarginLayout() {
        const content = this.element.querySelector('.card-content');
        if (!content) return;

        const scrollTop = content.scrollTop;
        const contentPaddingTop = this.cachedMarginMetrics.contentPaddingTop ??
            (parseInt(getComputedStyle(content).paddingTop) || 0);
        const cardHeight = this.cachedMarginMetrics.cardHeight || this.element.getBoundingClientRect().height;

        const DEFAULT_MAXH_PERCENT = 0.25; // 25% of card height
        const DEFAULT_MAXH_PERCENT_VERTICAL = 0.15; // 15% of card height for vertical text
        const MIN_GAP = 12; // Noticeable gap between margin items

        for (const side of ['left', 'right', 'top', 'bottom']) {
            const registry = this.marginItemRegistry[side];
            if (!registry || registry.length === 0) continue;

            const isHorizontalAxis = (side === 'top' || side === 'bottom');
            const marginPaddingTop = this.cachedMarginMetrics[`${side}PaddingTop`] ??
                (() => {
                    const el = this.element.querySelector(`.card-margin-${side}`);
                    return el ? parseInt(getComputedStyle(el).paddingTop) || 0 : 0;
                })();
            const marginAreaSize = isHorizontalAxis
                ? (this.cachedMarginMetrics[`${side}Width`] ??
                    this.element.querySelector(`.card-margin-${side}`)?.clientWidth ?? 200)
                : (this.cachedMarginMetrics[`${side}Height`] ??
                    this.element.querySelector(`.card-margin-${side}`)?.clientHeight ?? 300);

            // Phase 1: Compute max heights and constrain items
            for (const item of registry) {
                const isVerticalText = item.element.classList.contains('margin-orientation-vertical');
                const defaultPercent = isVerticalText ? DEFAULT_MAXH_PERCENT_VERTICAL : DEFAULT_MAXH_PERCENT;
                const resolvedMaxH = this.resolveMaxH(item.maxh, cardHeight);
                const maxH = resolvedMaxH || (cardHeight * defaultPercent);

                const contentEl = item.element.querySelector('.margin-item-content');
                const arrowEl = item.element.querySelector('.margin-overflow-arrow');

                if (contentEl) {
                    if (isHorizontalAxis) {
                        contentEl.style.maxWidth = `${maxH}px`;
                        item.element.style.maxWidth = `${maxH}px`;
                    } else {
                        contentEl.style.maxHeight = `${maxH}px`;
                        item.element.style.maxHeight = `${maxH}px`;
                    }

                    // Check if content overflows — show/hide arrow
                    const isOverflowing = isHorizontalAxis
                        ? contentEl.scrollWidth > contentEl.clientWidth
                        : contentEl.scrollHeight > contentEl.clientHeight;

                    if (arrowEl) {
                        if (isOverflowing) {
                            arrowEl.classList.add('visible');
                        } else {
                            arrowEl.classList.remove('visible');
                        }
                    }
                }
            }

            // Phase 2: Measure sizes
            for (const item of registry) {
                const rect = item.element.getBoundingClientRect();
                item.size = isHorizontalAxis ? rect.width : rect.height;
                if (item.size === 0) item.size = 16;
                item.heightDirty = false;
            }

            // Phase 3: Compute desired positions
            let absoluteStack = 0;
            const anchorStacks = {}; // anchorId -> next stacked position
            for (const item of registry) {
                if (item.type === 'relative' && item.anchorId) {
                    const anchor = content.querySelector(`[data-anchor-id="${item.anchorId}"]`);
                    if (anchor) {
                        const anchorOffset = anchor.offsetTop;
                        const anchorHeight = anchor.offsetHeight || 0;
                        const visibleTop = anchorOffset - scrollTop;
                        // Align margin item above the anchor element
                        const basePos = visibleTop + marginPaddingTop - contentPaddingTop
                            - item.size * 1.5;

                        // Stack same-anchor items sequentially
                        if (anchorStacks[item.anchorId] !== undefined) {
                            item.desiredPos = anchorStacks[item.anchorId];
                        } else {
                            item.desiredPos = basePos;
                        }
                        anchorStacks[item.anchorId] = item.desiredPos + item.size + MIN_GAP;
                    } else {
                        item.desiredPos = absoluteStack;
                    }
                } else if (item.pos !== null) {
                    item.desiredPos = item.pos;
                } else {
                    item.desiredPos = absoluteStack;
                }
                absoluteStack = item.desiredPos + item.size + MIN_GAP;
            }

            // Phase 4: Resolve collisions.
            // Absolute and relative items are handled independently.
            // Relative items scroll freely at their anchor position and pass
            // BEHIND absolute items (lower z-index). Only same-type items
            // have collision resolution between them.
            const absoluteItems = registry.filter(item => item.type !== 'relative');
            const relativeItems = registry.filter(item => item.type === 'relative');

            this.resolveCollisionsSameType(absoluteItems, MIN_GAP, marginAreaSize, false);
            this.resolveCollisionsSameType(relativeItems, MIN_GAP, marginAreaSize, true);

            // Phase 5: Apply positions and z-index layering
            for (const item of registry) {
                if (isHorizontalAxis) {
                    item.element.style.left = `${item.actualPos}px`;
                } else {
                    item.element.style.top = `${item.actualPos}px`;
                }

                // Absolute items always render on top of relative items
                if (item.type === 'relative') {
                    item.element.style.zIndex = '1';
                } else {
                    item.element.style.zIndex = '2';
                }
            }

            // Phase 6: Clip relative items where they overlap absolute items.
            // For each relative item, compute a clip-path that hides any region
            // covered by an absolute item.
            if (absoluteItems.length > 0 && relativeItems.length > 0) {
                for (const relItem of relativeItems) {
                    const relStart = relItem.actualPos;
                    const relEnd = relStart + relItem.size;

                    // Collect absolute regions that overlap this relative item
                    const clips = [];
                    for (const absItem of absoluteItems) {
                        const absStart = absItem.actualPos;
                        const absEnd = absStart + absItem.size;

                        // Check if they overlap
                        if (absStart < relEnd && absEnd > relStart) {
                            // Overlap region relative to the relative item's own coordinate space
                            const clipStart = Math.max(0, absStart - relStart);
                            const clipEnd = Math.min(relItem.size, absEnd - relStart);
                            clips.push({ start: clipStart, end: clipEnd });
                        }
                    }

                    if (clips.length === 0) {
                        relItem.element.style.clipPath = '';
                        continue;
                    }

                    // Sort clips by start position
                    clips.sort((a, b) => a.start - b.start);

                    // Build a polygon clip-path that includes only the visible
                    // (non-overlapped) regions. The polygon traces the outline
                    // of the item while cutting out the absolute-covered bands.
                    if (isHorizontalAxis) {
                        // Horizontal axis: cut out vertical bands (left/right clips)
                        const points = [];
                        // Top edge left-to-right, skipping clipped bands
                        let x = 0;
                        for (const clip of clips) {
                            if (clip.start > x) {
                                points.push(`${x}px 0%`);
                                points.push(`${clip.start}px 0%`);
                            }
                            points.push(`${clip.start}px 100%`);
                            points.push(`${clip.end}px 100%`);
                            points.push(`${clip.end}px 0%`);
                            x = clip.end;
                        }
                        // Remaining visible area after last clip
                        if (x < relItem.size) {
                            points.push(`${x}px 0%`);
                            points.push(`100% 0%`);
                            points.push(`100% 100%`);
                        }
                        // Close back along bottom
                        points.push(`0% 100%`);
                        relItem.element.style.clipPath = `polygon(${points.join(', ')})`;
                    } else {
                        // Vertical axis (left/right margins): cut out horizontal bands.
                        // Build a polygon that is the full item rectangle minus
                        // horizontal strips where absolute items overlap.
                        // Approach: list visible vertical segments, build a polygon
                        // going down the right edge through visible parts, then
                        // back up the left edge.

                        // Merge overlapping clips
                        const merged = [clips[0]];
                        for (let i = 1; i < clips.length; i++) {
                            const last = merged[merged.length - 1];
                            if (clips[i].start <= last.end) {
                                last.end = Math.max(last.end, clips[i].end);
                            } else {
                                merged.push({ ...clips[i] });
                            }
                        }

                        // Build visible segments (gaps between clips, plus before first and after last)
                        const visible = [];
                        let cursor = 0;
                        for (const clip of merged) {
                            if (clip.start > cursor) {
                                visible.push({ start: cursor, end: clip.start });
                            }
                            cursor = clip.end;
                        }
                        if (cursor < relItem.size) {
                            visible.push({ start: cursor, end: relItem.size });
                        }

                        if (visible.length === 0) {
                            // Entirely hidden
                            relItem.element.style.clipPath = 'polygon(0 0, 0 0, 0 0)';
                        } else {
                            // Build polygon: for each visible segment, add a rectangle
                            // We use an inset approach instead for simplicity with
                            // multiple segments — use polygon with all visible rects
                            const points = [];
                            for (const seg of visible) {
                                const y1 = (seg.start / relItem.size * 100).toFixed(2);
                                const y2 = (seg.end / relItem.size * 100).toFixed(2);
                                points.push(`0% ${y1}%`);
                                points.push(`100% ${y1}%`);
                                points.push(`100% ${y2}%`);
                                points.push(`0% ${y2}%`);
                            }
                            relItem.element.style.clipPath = `polygon(evenodd, ${points.join(', ')})`;
                        }
                    }
                }
            } else {
                // No absolute items — clear any clip-paths on relative items
                for (const relItem of relativeItems) {
                    relItem.element.style.clipPath = '';
                }
            }
        }
    }

    /**
     * Collision resolution within a single type group (all absolute or all relative).
     *
     * Absolute items with explicit `pos` are locked in place; others are placed
     * at their desired position and pushed to the nearest free spot if they overlap.
     * Relative items are all flexible — they keep source order when pushed apart.
     */
    resolveCollisionsSameType(items, minGap, areaSize, isRelative = false) {
        if (items.length === 0) return;

        // Occupied intervals sorted by start position.
        const occupied = [];

        const insertOccupied = (start, size) => {
            const entry = { start, end: start + size };
            let lo = 0, hi = occupied.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (occupied[mid].start < entry.start) lo = mid + 1;
                else hi = mid;
            }
            occupied.splice(lo, 0, entry);
        };

        const findFreePosition = (desiredPos, size) => {
            const wouldOverlap = (pos) => {
                const itemEnd = pos + size;
                for (const occ of occupied) {
                    if (itemEnd + minGap <= occ.start || pos >= occ.end + minGap) continue;
                    return true;
                }
                return false;
            };

            const clampedDesired = isRelative ? desiredPos : Math.max(0, desiredPos);
            if (!wouldOverlap(clampedDesired)) return clampedDesired;

            let bestPos = null;
            let bestDist = Infinity;

            // Try placing just after each occupied interval
            for (const occ of occupied) {
                const candidate = occ.end + minGap;
                if ((isRelative || candidate >= 0) && !wouldOverlap(candidate)) {
                    const dist = Math.abs(candidate - desiredPos);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestPos = candidate;
                    }
                }
            }

            // Try placing just before each occupied interval
            for (const occ of occupied) {
                const candidate = occ.start - size - minGap;
                if ((isRelative || candidate >= 0) && !wouldOverlap(candidate)) {
                    const dist = Math.abs(candidate - desiredPos);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestPos = candidate;
                    }
                }
            }

            // Try at position 0 (only meaningful for absolute items)
            if (!isRelative && !wouldOverlap(0)) {
                const dist = Math.abs(desiredPos);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestPos = 0;
                }
            }

            if (bestPos === null) {
                const lastEnd = occupied.length > 0 ? occupied[occupied.length - 1].end + minGap : 0;
                bestPos = lastEnd;
            }

            return bestPos;
        };

        // Pass 1: Lock fixed items (absolute with explicit pos)
        for (const item of items) {
            if (item.type !== 'relative' && item.pos !== null) {
                item.actualPos = Math.max(0, item.desiredPos);
                item.fixed = true;
                insertOccupied(item.actualPos, item.size);
            } else {
                item.fixed = false;
            }
        }

        // Pass 2: Place flex items in source order (preserves natural ordering
        // so items don't swap positions during scroll)
        const flexItems = items.filter(item => !item.fixed);
        flexItems.sort((a, b) => a.order - b.order);

        for (const item of flexItems) {
            item.actualPos = findFreePosition(item.desiredPos, item.size);
            insertOccupied(item.actualPos, item.size);
        }
    }

    // Keep old name as alias for compatibility
    updateRelativeMargins() {
        this.updateMarginLayout();
    }

    bringToFront() {
        // Get all cards and find max z-index, but exclude preview cards and cap at 9999
        // This ensures preview cards (z-index 10000+) always stay on top
        const allCards = document.querySelectorAll('.card:not(.card-preview)');
        let maxZ = 0;
        allCards.forEach(card => {
            const z = parseInt(card.style.zIndex || 0);
            if (z > maxZ) maxZ = z;
        });

        // Cap regular cards at 9999 to keep preview cards (10000+) always on top
        this.zIndex = Math.min(maxZ + 1, 9999);
        this.element.style.zIndex = this.zIndex;
    }

    updateCornerFold(corner) {
        const FOLD_DURATION = 400;   // matches CSS animation duration
        const UNFOLD_DURATION = 500; // matches CSS animation duration

        const state = this.cornerAnimationState[corner] || 'idle';
        const isHovered = this.cornerHovered[corner];

        if (isHovered) {
            // Want to fold
            if (state === 'idle') {
                // Clear any pending timeout
                if (this.cornerAnimationTimeout[corner]) {
                    clearTimeout(this.cornerAnimationTimeout[corner]);
                }

                // Start folding immediately
                this.element.classList.remove(`unfolding-${corner}`);
                this.element.classList.add(`folding-${corner}`);
                this.cornerAnimationState[corner] = 'folding';

                // After animation completes, mark as folded
                this.cornerAnimationTimeout[corner] = setTimeout(() => {
                    this.cornerAnimationState[corner] = 'folded';
                    // Check if hover state changed during animation
                    if (!this.cornerHovered[corner]) {
                        this.updateCornerFold(corner);
                    }
                }, FOLD_DURATION);

            } else if (state === 'unfolding') {
                // Clear the unfold timeout
                if (this.cornerAnimationTimeout[corner]) {
                    clearTimeout(this.cornerAnimationTimeout[corner]);
                }

                // Currently unfolding, need to reverse to folding
                this.element.classList.remove(`unfolding-${corner}`);
                this.element.classList.add(`folding-${corner}`);
                this.cornerAnimationState[corner] = 'folding';

                this.cornerAnimationTimeout[corner] = setTimeout(() => {
                    this.cornerAnimationState[corner] = 'folded';
                    if (!this.cornerHovered[corner]) {
                        this.updateCornerFold(corner);
                    }
                }, FOLD_DURATION);
            }
            // If already folding or folded, do nothing

        } else {
            // Want to unfold
            if (state === 'folded') {
                // Clear any pending timeout
                if (this.cornerAnimationTimeout[corner]) {
                    clearTimeout(this.cornerAnimationTimeout[corner]);
                }

                // Start unfolding immediately
                this.element.classList.remove(`folding-${corner}`);
                this.element.classList.add(`unfolding-${corner}`);
                this.cornerAnimationState[corner] = 'unfolding';

                this.cornerAnimationTimeout[corner] = setTimeout(() => {
                    this.element.classList.remove(`unfolding-${corner}`);
                    this.cornerAnimationState[corner] = 'idle';
                    // Check if hover state changed during animation
                    if (this.cornerHovered[corner]) {
                        this.updateCornerFold(corner);
                    }
                }, UNFOLD_DURATION);

            } else if (state === 'folding') {
                // Currently folding - don't interrupt, let it finish
                // The folding timeout will check cornerHovered when done and trigger unfold
            }
            // If idle or unfolding, nothing to do
        }
    }

    togglePin() {
        this.pinned = !this.pinned;
        this.element.classList.toggle('pinned', this.pinned);

        const pinBtn = this.element.querySelector('.pin-btn');
        pinBtn.textContent = this.pinned ? '📍' : '📌';

        // Dispatch state change for persistence
        this.element.dispatchEvent(new CustomEvent('card-state-changed', { bubbles: true }));
    }

    delete() {
        // Dispose any 3D visualizations before removal
        this.element.querySelectorAll('.viz-container').forEach(container => {
            if (container._viz3dState?.dispose) {
                container._viz3dState.dispose();
            }
        });

        // Dispatch event before removal
        this.element.dispatchEvent(new CustomEvent('card-delete', {
            bubbles: true,
            detail: { cardId: this.id }
        }));

        this.element.remove();
    }

    /**
     * Update card content with new parsed data (for live-reload)
     * @param {Object|string} parsed - Either parsed object {content, margins, metadata} or HTML string
     */
    setContent(parsed) {
        const contentEl = this.element.querySelector('.card-content');
        if (!contentEl) return;

        // Handle both string (legacy) and object (new) formats
        const isFullUpdate = typeof parsed === 'object' && parsed !== null;
        const newContent = isFullUpdate ? parsed.content : parsed;
        const newMargins = isFullUpdate ? parsed.margins : null;

        // Preserve scroll position (as percentage for content length changes)
        const scrollTop = contentEl.scrollTop;
        const scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
        const scrollPercent = scrollHeight > 0 ? scrollTop / scrollHeight : 0;

        // Update main content
        this.content = newContent;
        contentEl.innerHTML = newContent;

        // Update margins if provided
        if (newMargins) {
            this.margins = newMargins;
            this.updateMargins(newMargins);
        }

        // Restore scroll, re-render, and update
        requestAnimationFrame(() => {
            // Restore scroll position proportionally
            const newScrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
            if (newScrollHeight > 0) {
                contentEl.scrollTop = scrollPercent * newScrollHeight;
            }

            // Re-render LaTeX and highlight code
            this.renderLaTeX();
            this.highlightCode();

            // Update relative margins
            this.cacheMarginMetrics();
            this.updateMarginLayout();

            // Update progress bar if enabled
            this.updateProgressBar();
        });
    }

    /**
     * Update margin elements with new content
     * @param {Object} margins - Margins object with left, right, top, bottom arrays
     */
    updateMargins(margins) {
        // Disconnect existing ResizeObserver before rebuilding
        if (this.marginResizeObserver) {
            this.marginResizeObserver.disconnect();
        }

        ['left', 'right', 'top', 'bottom'].forEach(side => {
            const marginEl = this.element.querySelector(`.card-margin-${side}`);
            if (!marginEl) return;

            const items = margins[side] || [];

            // Clear existing content (but preserve page number for bottom margin)
            const pageNumEl = marginEl.querySelector('.page-number');
            marginEl.innerHTML = '';

            // Clear registry for this side
            this.marginItemRegistry[side] = [];

            // Rebuild with unified container
            if (items.length > 0) {
                const container = document.createElement('div');
                container.className = 'margin-items-container';

                items.forEach((item, index) => {
                    const html = this.renderMarginItem(item, item.type, side);
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = html;
                    const el = wrapper.firstElementChild;
                    el.dataset.marginOrder = index;
                    el.dataset.rawHtml = item.html || '';

                    container.appendChild(el);

                    // Register item
                    this.marginItemRegistry[side].push({
                        element: el,
                        type: item.type,
                        anchorId: item.anchor || null,
                        pos: item.pos !== null && item.pos !== undefined ? item.pos : null,
                        maxh: item.maxh || null,
                        desiredPos: 0,
                        actualPos: 0,
                        size: 0,
                        heightDirty: true,
                        order: index
                    });
                });

                marginEl.appendChild(container);
            }

            // Re-add page number if it existed (bottom margin)
            if (pageNumEl) {
                marginEl.appendChild(pageNumEl);
            }
        });

        // Re-bind margin resize handlers
        this.element.querySelectorAll('.margin-item-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', this.onMarginItemResizeStart.bind(this));
            handle.addEventListener('touchstart', this.onMarginItemResizeTouchStart.bind(this), { passive: false });
        });

        // Re-bind vertical margin wheel handlers
        this.element.querySelectorAll('.margin-orientation-vertical .margin-item-content').forEach(content => {
            content.addEventListener('wheel', this.onVerticalMarginWheel.bind(this), { passive: false });
        });

        // Re-observe all margin items with ResizeObserver
        if (this.marginResizeObserver) {
            for (const side of ['left', 'right', 'top', 'bottom']) {
                for (const item of this.marginItemRegistry[side]) {
                    this.marginResizeObserver.observe(item.element);
                }
            }
        }

        // Re-run layout
        this.cacheMarginMetrics();
        this.updateMarginLayout();
    }

    /**
     * Render LaTeX expressions using KaTeX
     * Processes all math elements in the card content and margins
     */
    renderLaTeX() {
        // Check if KaTeX is available
        if (typeof window.katex === 'undefined' && typeof window.renderMathInElement === 'undefined') {
            // KaTeX not loaded yet, try again with simple retry
            const retryDelay = 100;
            this.katexRetryCount = (this.katexRetryCount || 0) + 1;

            if (this.katexRetryCount < 10) { // Max 10 retries (1 second)
                setTimeout(() => this.renderLaTeX(), retryDelay);
                return;
            } else {
                console.error('KaTeX failed to load after retries');
                return;
            }
        }

        this.katexRetryCount = 0; // Reset retry count on success

        // Use auto-render on the entire card element if available
        if (typeof window.renderMathInElement !== 'undefined') {
            try {
                window.renderMathInElement(this.element, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false }
                    ],
                    throwOnError: false
                });
                return;
            } catch (error) {
                console.warn('Auto-render failed:', error);
            }
        }

        // Fallback to manual processing
        this.renderLaTeXManually();
    }

    /**
     * Highlight code blocks using Prism.js
     */
    highlightCode() {
        // Check if Prism is available
        if (typeof window.Prism === 'undefined') {
            return;
        }

        // Highlight all code blocks in the card (including in margins)
        const codeBlocks = this.element.querySelectorAll('pre code[class*="language-"]');
        codeBlocks.forEach(block => {
            window.Prism.highlightElement(block);
        });
    }

    /**
     * Manual LaTeX rendering for fallback
     */
    renderLaTeXManually() {
        // Process LaTeX in main content
        const contentEl = this.element.querySelector('.card-content');
        if (contentEl) {
            this.renderLaTeXInElement(contentEl);
        }

        // Process LaTeX in all margin content
        this.element.querySelectorAll('.margin-item-content').forEach(marginContent => {
            this.renderLaTeXInElement(marginContent);
        });
    }

    /**
     * Render LaTeX in a specific element
     */
    renderLaTeXInElement(container) {
        if (!container) return;

        // Find all LaTeX elements that haven't been processed yet
        const mathElements = container.querySelectorAll('.katex-math:not(.katex-processed)');

        if (mathElements.length === 0) return;

        // Try auto-render first (simpler approach)
        if (typeof window.renderMathInElement !== 'undefined') {
            try {
                window.renderMathInElement(container, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false }
                    ],
                    throwOnError: false
                });

                // Mark all as processed
                mathElements.forEach(element => {
                    element.classList.add('katex-processed');
                });
                return;
            } catch (error) {
                console.warn('Auto-render failed, falling back to manual rendering:', error);
            }
        }

        // Fallback to manual rendering
        if (typeof window.katex !== 'undefined') {
            mathElements.forEach((element) => {
                try {
                    const latex = element.textContent;
                    const isDisplay = element.dataset.mathType === 'display';

                    // Render LaTeX with KaTeX
                    window.katex.render(latex, element, {
                        throwOnError: false,
                        displayMode: isDisplay,
                        output: 'html',
                        strict: false
                    });

                    // Mark as processed to avoid re-processing
                    element.classList.add('katex-processed');
                } catch (error) {
                    console.warn('KaTeX rendering error:', error);
                    // Show error in a user-friendly way
                    element.textContent = `[Math Error: ${element.textContent}]`;
                    element.style.color = 'red';
                    element.classList.add('katex-processed');
                }
            });
        }
    }

    /**
     * Get a shortened display URL for the toolbar
     */
    getDisplayUrl(url) {
        try {
            const parsed = new URL(url);
            let display = parsed.hostname.replace(/^www\./, '');
            if (parsed.pathname && parsed.pathname !== '/') {
                const path = parsed.pathname.length > 20
                    ? parsed.pathname.slice(0, 20) + '...'
                    : parsed.pathname;
                display += path;
            }
            return display;
        } catch {
            return url.slice(0, 30) + (url.length > 30 ? '...' : '');
        }
    }

    /**
     * Check if the iframe loaded successfully and show fallback if not
     */
    checkEmbedStatus() {
        const iframe = this.element.querySelector('.card-embed-iframe');
        const fallback = this.element.querySelector('.card-embed-fallback');
        if (!iframe || !fallback) return;

        // Listen for load event
        iframe.addEventListener('load', () => {
            // Try to access iframe content - will fail if blocked
            try {
                // This will throw if cross-origin and blocked
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                // If we can access it and it's empty/error, show fallback
                if (doc && doc.body && doc.body.innerHTML === '') {
                    fallback.classList.add('visible');
                }
            } catch (e) {
                // Cross-origin - can't check, assume it loaded
                // The iframe will show its own error or the content
            }
        });

        // Listen for error event (doesn't always fire for X-Frame-Options blocks)
        iframe.addEventListener('error', () => {
            fallback.classList.add('visible');
        });
    }

    /**
     * Update margin size based on a percentage value (from global settings)
     * @param {number} marginPercent - Margin size as percentage (0-25)
     */
    updateMarginSize(marginPercent) {
        const container = this.element.querySelector('.card-container');
        if (!container) return;

        // Store the percentage for dynamic scaling on resize
        this.marginPercent = marginPercent;

        // Calculate pixel values from percentage
        const lrSize = (marginPercent / 100) * this.width;
        const tbSize = (marginPercent / 100) * this.height;

        // Update stored values
        this.marginLeftSize = lrSize;
        this.marginRightSize = lrSize;
        this.marginTopSize = tbSize;
        this.marginBottomSize = tbSize;

        // Update grid template
        container.style.gridTemplateColumns = `${lrSize}px 1fr ${lrSize}px`;
        container.style.gridTemplateRows = `${tbSize}px 1fr ${tbSize}px`;
    }

    /**
     * Get the current margin size as a percentage (average of all margins)
     * @returns {number} Margin percentage (0-25 range)
     */
    getMarginSizePercent() {
        const container = this.element.querySelector('.card-container');
        if (!container) return 10; // Default

        const computedStyle = getComputedStyle(container);
        const cols = computedStyle.gridTemplateColumns.split(' ');

        if (cols.length >= 3) {
            const leftSize = parseFloat(cols[0]) || 0;
            // Calculate percentage based on card width
            const percent = (leftSize / this.width) * 100;
            return Math.round(Math.min(25, Math.max(0, percent)));
        }

        return 10; // Default
    }

    toJSON() {
        const contentEl = this.element.querySelector('.card-content');

        return {
            id: this.id,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            rotation: this.rotation,
            scale: this.scale,
            pageNumber: this.pageNumber,
            pinned: this.pinned,
            content: this.content,
            margins: this.margins,
            image: this.image,
            caption: this.caption,
            embedUrl: this.embedUrl,
            marginTB: this.marginTB,
            marginLR: this.marginLR,
            progressBar: this.progressBar,
            wordCount: this.wordCount,
            readTime: this.readTime,
            zIndex: this.zIndex,
            tags: this.tags,
            showTags: this.showTags,
            // State persistence fields
            sourceFile: this.sourceFile,
            isDynamic: this.isDynamic,
            // User-resized margin areas
            marginLeftSize: this.marginLeftSize,
            marginRightSize: this.marginRightSize,
            marginTopSize: this.marginTopSize,
            marginBottomSize: this.marginBottomSize,
            // Scroll position
            scrollTop: contentEl ? contentEl.scrollTop : 0,
            scrollLeft: contentEl ? contentEl.scrollLeft : 0,
            // Encrypted card state
            isLocked: this.isLocked || false,
            encryptedData: this.encryptedData || null
        };
    }
}
