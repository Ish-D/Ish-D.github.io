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
        this.marginTB = options.marginTB || null;  // Top/bottom as % of height
        this.marginLR = options.marginLR || null;  // Left/right as % of width

        // Reading progress bar
        this.progressBar = options.progressBar || false;

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

        // Create DOM element
        this.element = this.createElement();
        this.bindEvents();

        // Initial positioning of relative margins
        requestAnimationFrame(() => {
            this.updateRelativeMargins();
            this.updateProgressBar();
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

        this.updateTransform(card);

        // Create container structure
        const container = document.createElement('div');
        container.className = 'card-container';

        // Apply margin sizes (default 10% or custom if specified)
        const marginLR = this.marginLR !== null ? this.marginLR : 10;
        const marginTB = this.marginTB !== null ? this.marginTB : 10;

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
            content.innerHTML = this.content;

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

            // Add reading progress bar if enabled
            if (this.progressBar) {
                const progressIndicator = document.createElement('span');
                progressIndicator.className = 'card-progress-indicator';
                progressIndicator.textContent = '0%';
                container.appendChild(progressIndicator);
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

        // Separate items by type
        const absoluteItems = items ? items.filter(item => item.type !== 'relative') : [];
        const relativeItems = items ? items.filter(item => item.type === 'relative') : [];

        // Container for absolute items (fixed position)
        if (absoluteItems.length > 0 || includePageNumber) {
            const absoluteContainer = document.createElement('div');
            absoluteContainer.className = 'margin-absolute-container';

            if (includePageNumber && this.pageNumber) {
                absoluteContainer.innerHTML = `<span class="page-number">${this.pageNumber}</span>`;
            }

            absoluteItems.forEach(item => {
                absoluteContainer.innerHTML += this.renderMarginItem(item, 'absolute', side);
            });

            margin.appendChild(absoluteContainer);
        }

        // Container for relative items (scroll-synced)
        if (relativeItems.length > 0) {
            const relativeContainer = document.createElement('div');
            relativeContainer.className = 'margin-relative-container';

            relativeItems.forEach(item => {
                relativeContainer.innerHTML += this.renderMarginItem(item, 'relative', side);
            });

            margin.appendChild(relativeContainer);
        }

        return margin;
    }

    renderMarginItem(item, type, side) {
        const anchorAttr = item.anchor ? `data-anchor="${item.anchor}"` : '';
        const typeClass = `margin-type-${type}`;
        const orientationClass = `margin-orientation-${item.orientation || 'auto'}`;

        // Position offset for absolute margins (pos parameter)
        // For left/right margins: offset from top
        // For top/bottom margins: offset from left
        let posStyle = '';
        if (item.pos !== null && item.pos !== undefined && type === 'absolute') {
            if (side === 'left' || side === 'right') {
                posStyle = `top: ${item.pos}px;`;
            } else {
                posStyle = `left: ${item.pos}px;`;
            }
        }

        let html = `<div class="margin-item margin-annotation ${typeClass} ${orientationClass}" ${anchorAttr} data-margin-side="${side}" data-orientation="${item.orientation || 'auto'}"${posStyle ? ` style="${posStyle}"` : ''}>`;

        // Determine size style based on orientation
        // For vertical text (in left/right margins), size controls max-height
        // For horizontal text (in left/right margins), size controls max-height too
        // For top/bottom margins, size controls max-width
        let sizeStyle = '';
        if (item.size) {
            if (side === 'top' || side === 'bottom') {
                // Top/bottom margins: size controls width
                sizeStyle = `max-width: ${item.size}px;`;
            } else {
                // Left/right margins: size controls height
                sizeStyle = `max-height: ${item.size}px;`;
            }
        }

        // Scrollable content wrapper with optional size override
        html += `<div class="margin-item-content"${sizeStyle ? ` style="${sizeStyle}"` : ''}>`;

        // Use pre-rendered HTML from parser (supports full DSL including styles)
        html += item.html || '';

        html += '</div>'; // close margin-item-content

        // Add resize handles based on side and orientation
        // Left/right margins with horizontal text: resize height (vertical handle)
        // Left/right margins with vertical text: resize height (vertical handle)
        // Top/bottom margins: resize width (horizontal handle)
        if (side === 'left' || side === 'right') {
            // For left/right margins, allow resizing the height of the content area
            html += '<div class="margin-item-resize-handle resize-vertical"></div>';
        } else {
            // For top/bottom margins, allow resizing the width
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
            this.isResizingMarginArea = false;
            this.resizingMarginAreaSide = null;
            const activeHandle = this.element.querySelector('.margin-resize-handle.active');
            if (activeHandle) activeHandle.classList.remove('active');
        }
    }

    onContentScroll(e) {
        this.updateRelativeMargins();
        this.updateProgressBar();
    }

    updateProgressBar() {
        if (!this.progressBar) return;

        const content = this.element.querySelector('.card-content');
        const progressIndicator = this.element.querySelector('.card-progress-indicator');
        if (!content || !progressIndicator) return;

        const scrollTop = content.scrollTop;
        const scrollHeight = content.scrollHeight - content.clientHeight;

        if (scrollHeight <= 0) {
            // Content doesn't scroll, show full progress
            progressIndicator.textContent = '100%';
        } else {
            const progress = Math.round((scrollTop / scrollHeight) * 100);
            progressIndicator.textContent = `${progress}%`;
        }
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

    updateRelativeMargins() {
        const content = this.element.querySelector('.card-content');
        if (!content) return;

        // Get content's scroll position and padding
        const scrollTop = content.scrollTop;
        const contentPaddingTop = parseInt(getComputedStyle(content).paddingTop) || 0;

        // Find all relative margin items with anchors
        this.element.querySelectorAll('.margin-type-relative[data-anchor]').forEach(marginItem => {
            const anchorId = marginItem.dataset.anchor;
            const anchor = content.querySelector(`[data-anchor-id="${anchorId}"]`);

            if (anchor) {
                // Use offsetTop which is unaffected by CSS transforms
                // This gives position relative to the content's scrollable area
                const anchorOffsetTop = anchor.offsetTop;

                // Calculate visible position: anchor's offset minus scroll position
                const visibleTop = anchorOffsetTop - scrollTop;

                // Get margin area padding to align properly
                const marginArea = marginItem.closest('.card-margin');
                if (marginArea) {
                    const marginPaddingTop = parseInt(getComputedStyle(marginArea).paddingTop) || 0;

                    // Adjust for difference between content padding and margin padding
                    const topPosition = visibleTop + marginPaddingTop - contentPaddingTop;

                    marginItem.style.top = `${topPosition}px`;
                }
            }
        });
    }

    bringToFront() {
        // Get all cards and find max z-index
        const allCards = document.querySelectorAll('.card');
        let maxZ = 0;
        allCards.forEach(card => {
            const z = parseInt(card.style.zIndex || 0);
            if (z > maxZ) maxZ = z;
        });

        this.zIndex = maxZ + 1;
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
    }

    delete() {
        // Dispatch event before removal
        this.element.dispatchEvent(new CustomEvent('card-delete', {
            bubbles: true,
            detail: { cardId: this.id }
        }));

        this.element.remove();
    }

    setContent(html) {
        this.content = html;
        const contentEl = this.element.querySelector('.card-content');
        if (contentEl) {
            contentEl.innerHTML = html;
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

    toJSON() {
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
            zIndex: this.zIndex
        };
    }
}
