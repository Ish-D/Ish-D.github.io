/**
 * Editor Module - In-browser markdown editor for Paper Cards
 *
 * Uses File System Access API (Chrome/Edge) to read/write directly to cards/ directory.
 * Edits cards directly on the canvas in real-time.
 */

import { CARD_TEMPLATE_WIDTH, CARD_TEMPLATE_HEIGHT, Z_INDEX_CARD_CAP } from './constants.js';

/**
 * FileSystemManager - Handles file system access and persistence
 */
export class FileSystemManager {
    constructor() {
        this.directoryHandle = null;
        this.DB_NAME = 'paper-cards-editor';
        this.STORE_NAME = 'handles';
    }

    /**
     * Check if File System Access API is supported
     */
    isSupported() {
        return 'showDirectoryPicker' in window;
    }

    /**
     * Open IndexedDB database
     */
    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME);
                }
            };
        });
    }

    /**
     * Store directory handle in IndexedDB for persistence
     */
    async storeHandle(handle) {
        try {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.put(handle, 'cardsDirectory');

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.warn('Failed to store directory handle:', e);
        }
    }

    /**
     * Retrieve stored directory handle from IndexedDB
     */
    async getStoredHandle() {
        try {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.get('cardsDirectory');

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.warn('Failed to get stored handle:', e);
            return null;
        }
    }

    /**
     * Try to restore directory handle from storage
     */
    async restoreHandle() {
        const handle = await this.getStoredHandle();
        if (handle) {
            // Verify we still have permission
            const permission = await handle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                this.directoryHandle = handle;
                return true;
            }
        }
        return false;
    }

    /**
     * Request directory access from user
     */
    async requestDirectoryAccess() {
        if (!this.isSupported()) {
            console.error('File System Access API not supported');
            return null;
        }

        // Show instructions to user
        alert('Please select your "cards" folder in the next dialog.\n\nNavigate to your project and select the "cards" directory (not individual files).');

        try {
            const handle = await window.showDirectoryPicker({
                id: 'paper-cards',
                mode: 'readwrite',
                startIn: 'documents'
            });

            // Verify this looks like the cards directory
            let hasMarkdownFiles = false;
            for await (const entry of handle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.md')) {
                    hasMarkdownFiles = true;
                    break;
                }
            }

            if (!hasMarkdownFiles) {
                const proceed = confirm('This folder doesn\'t appear to contain markdown files.\n\nAre you sure this is the correct "cards" folder?');
                if (!proceed) {
                    return null;
                }
            }

            this.directoryHandle = handle;
            await this.storeHandle(handle);
            return handle;
        } catch (e) {
            if (e.name === 'AbortError') {
                // User cancelled - not an error
                return null;
            }
            console.error('Failed to get directory access:', e);
            return null;
        }
    }

    /**
     * Ensure we have directory access, requesting if necessary
     */
    async ensureAccess() {
        if (this.directoryHandle) {
            // Verify permission is still valid
            const permission = await this.directoryHandle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                return true;
            }
            // Try to re-request permission
            const newPermission = await this.directoryHandle.requestPermission({ mode: 'readwrite' });
            if (newPermission === 'granted') {
                return true;
            }
        }

        // Need to request fresh access
        const handle = await this.requestDirectoryAccess();
        return handle !== null;
    }

    /**
     * Get file handle from directory
     */
    async getFileHandle(filename, create = false) {
        if (!this.directoryHandle) return null;

        const fullName = filename.endsWith('.md') ? filename : `${filename}.md`;

        try {
            return await this.directoryHandle.getFileHandle(fullName, { create });
        } catch (e) {
            if (e.name === 'NotFoundError' && !create) {
                return null;
            }
            throw e;
        }
    }

    /**
     * Read file contents
     */
    async readFile(filename) {
        const handle = await this.getFileHandle(filename);
        if (!handle) return null;

        const file = await handle.getFile();
        return await file.text();
    }

    /**
     * Write file contents
     */
    async writeFile(filename, content) {
        const handle = await this.getFileHandle(filename, true);
        if (!handle) {
            throw new Error('Could not get file handle');
        }

        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
    }

    /**
     * List all .md files in the directory
     */
    async listFiles() {
        if (!this.directoryHandle) return [];

        const files = [];
        try {
            for await (const entry of this.directoryHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.md')) {
                    files.push(entry.name.replace('.md', ''));
                }
            }
        } catch (e) {
            console.error('Failed to list files:', e);
        }

        return files.sort();
    }

    /**
     * Check if a file exists
     */
    async fileExists(filename) {
        const handle = await this.getFileHandle(filename, false);
        return handle !== null;
    }
}

/**
 * EditorCard - Source-only editor that updates cards on the canvas in real-time
 */
export class EditorCard {
    constructor(options = {}) {
        this.id = options.id || `editor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.x = options.x || 100;
        this.y = options.y || 100;
        this.width = options.width || 450;
        this.height = options.height || 500;
        this.rotation = options.rotation || 0;
        this.zIndex = options.zIndex || 1;
        this.pinned = options.pinned || false;

        // Editor state
        this.filename = options.filename || '';
        this.content = options.content || '';
        this.isDirty = false;
        this.lastSavedContent = '';

        // Target card being edited (on the canvas)
        this.targetCard = null;

        // References
        this.parser = options.parser;
        this.fsManager = options.fsManager;
        this.canvas = options.canvas;

        // Encryption support
        this.isPrivate = false;
        this.crypto = options.canvas?.crypto || null;

        // Autosave timer
        this.autosaveInterval = null;
        this.autosaveDelay = 30000; // 30 seconds

        // Debounce timer for real-time updates
        this.updateDebounceTimer = null;
        this.updateDebounceDelay = 100; // 100ms debounce

        // Create DOM element
        this.element = this.createElement();
        this.bindEvents();

        // Start autosave
        this.startAutosave();
    }

    createElement() {
        const card = document.createElement('div');
        card.className = 'card editor-card editor-source-only';
        card.id = this.id;
        card.dataset.cardId = this.id;

        if (this.pinned) {
            card.classList.add('pinned');
        }

        this.updateTransform(card);

        // Create container structure - source only, no preview
        const container = document.createElement('div');
        container.className = 'editor-container';

        container.innerHTML = `
            <!-- Toolbar -->
            <div class="editor-toolbar">
                <div class="editor-toolbar-buttons">
                    <button class="editor-btn save-btn" title="Save (Ctrl+S)">Save</button>
                    <button class="editor-btn new-btn" title="New Card">New</button>
                    <button class="editor-btn open-btn" title="Open File">Open</button>
                    <label class="editor-private-toggle" title="Encrypt this card (password protected)">
                        <input type="checkbox" class="private-checkbox">
                        <span class="private-label">&#128274; Private</span>
                    </label>
                </div>
                <input type="text" class="editor-filename"
                       placeholder="untitled"
                       value="${this.escapeHtml(this.filename)}"
                       spellcheck="false">
            </div>

            <!-- Insert Toolbar -->
            <div class="editor-insert-toolbar">
                <div class="insert-group">
                    <button class="insert-btn" data-insert="h1" title="Heading 1">H1</button>
                    <button class="insert-btn" data-insert="h2" title="Heading 2">H2</button>
                    <button class="insert-btn" data-insert="h3" title="Heading 3">H3</button>
                </div>
                <div class="insert-group">
                    <button class="insert-btn" data-insert="bold" title="Bold">B</button>
                    <button class="insert-btn" data-insert="italic" title="Italic"><em>I</em></button>
                    <button class="insert-btn" data-insert="code" title="Code">&lt;/&gt;</button>
                </div>
                <div class="insert-group">
                    <button class="insert-btn dropdown-toggle" data-dropdown="block" title="Blocks">Block ▾</button>
                    <button class="insert-btn dropdown-toggle" data-dropdown="margin" title="Margin">Margin ▾</button>
                    <button class="insert-btn dropdown-toggle" data-dropdown="link" title="Links &amp; References">Link ▾</button>
                    <button class="insert-btn dropdown-toggle" data-dropdown="insert" title="Insert Elements">Insert ▾</button>
                    <button class="insert-btn dropdown-toggle" data-dropdown="interactive" title="Interactive &amp; Dynamic">Active ▾</button>
                </div>
            </div>

            <!-- Dropdown Menus -->
            <div class="editor-dropdowns">
                <!-- Block Dropdown -->
                <div class="insert-dropdown" data-dropdown-id="block">
                    <button class="dropdown-item" data-insert="center">Center block</button>
                    <button class="dropdown-item" data-insert="style-block">Style block</button>
                    <button class="dropdown-item" data-insert="image-block">Image block</button>
                    <button class="dropdown-item" data-insert="gallery">Gallery</button>
                    <button class="dropdown-item" data-insert="quote-block">Quote block</button>
                    <button class="dropdown-item" data-insert="code-block">Code block</button>
                    <button class="dropdown-item" data-insert="hr">Horizontal rule</button>
                </div>

                <!-- Margin Dropdown -->
                <div class="insert-dropdown" data-dropdown-id="margin">
                    <div class="dropdown-section">
                        <div class="dropdown-title">Position</div>
                        <button class="dropdown-item" data-insert="margin-left">Left margin</button>
                        <button class="dropdown-item" data-insert="margin-right">Right margin</button>
                        <button class="dropdown-item" data-insert="margin-top">Top margin</button>
                        <button class="dropdown-item" data-insert="margin-bottom">Bottom margin</button>
                        <button class="dropdown-item" data-insert="note">Inline note</button>
                    </div>
                    <div class="dropdown-section">
                        <div class="dropdown-title">Type</div>
                        <button class="dropdown-item" data-insert="margin-absolute">Fixed position (absolute)</button>
                        <button class="dropdown-item" data-insert="margin-relative">Anchored (relative)</button>
                    </div>
                </div>

                <!-- Link & Refs Dropdown -->
                <div class="insert-dropdown" data-dropdown-id="link">
                    <div class="dropdown-section">
                        <div class="dropdown-title">Links</div>
                        <button class="dropdown-item" data-insert="card-link">Card link [[card]]</button>
                        <button class="dropdown-item" data-insert="card-link-display">Card link [[card|text]]</button>
                        <button class="dropdown-item" data-insert="card-link-full">Full link options</button>
                        <button class="dropdown-item" data-insert="external-link">External link [text](url)</button>
                        <button class="dropdown-item" data-insert="anchor">Anchor point</button>
                        <button class="dropdown-item" data-insert="jump">Jump to anchor</button>
                    </div>
                    <div class="dropdown-section">
                        <div class="dropdown-title">References</div>
                        <button class="dropdown-item" data-insert="citation">Citation</button>
                        <button class="dropdown-item" data-insert="bibliography">Bibliography</button>
                        <button class="dropdown-item" data-insert="toc">Table of contents</button>
                    </div>
                </div>

                <!-- Insert Dropdown -->
                <div class="insert-dropdown" data-dropdown-id="insert">
                    <div class="dropdown-section">
                        <div class="dropdown-title">Spacing &amp; Layout</div>
                        <button class="dropdown-item" data-insert="drop-cap">Drop cap</button>
                        <button class="dropdown-item" data-insert="tab">Tab indent</button>
                        <button class="dropdown-item" data-insert="break">Small break</button>
                        <button class="dropdown-item" data-insert="bigbreak">Big break</button>
                    </div>
                    <div class="dropdown-section">
                        <div class="dropdown-title">Placeholders</div>
                        <button class="dropdown-item" data-insert="date">Date</button>
                        <button class="dropdown-item" data-insert="tags">Tags</button>
                        <button class="dropdown-item" data-insert="summary">Summary</button>
                    </div>
                    <div class="dropdown-section">
                        <div class="dropdown-title">Text</div>
                        <button class="dropdown-item" data-insert="centered-text">Centered text</button>
                        <button class="dropdown-item" data-insert="inline-style">Styled text</button>
                        <button class="dropdown-item" data-insert="list-ul">Bullet list</button>
                        <button class="dropdown-item" data-insert="list-ol">Numbered list</button>
                        <button class="dropdown-item" data-insert="blockquote">Blockquote</button>
                        <button class="dropdown-item" data-insert="math-inline">Math (inline)</button>
                        <button class="dropdown-item" data-insert="math-display">Math (display)</button>
                    </div>
                </div>

                <!-- Interactive Dropdown -->
                <div class="insert-dropdown" data-dropdown-id="interactive">
                    <div class="dropdown-section">
                        <div class="dropdown-title">Controls</div>
                        <button class="dropdown-item" data-insert="toggle">Toggle switch</button>
                        <button class="dropdown-item" data-insert="slider">Slider</button>
                        <button class="dropdown-item" data-insert="button">Button</button>
                        <button class="dropdown-item" data-insert="input">Input field</button>
                        <button class="dropdown-item" data-insert="textarea">Textarea</button>
                    </div>
                    <div class="dropdown-section">
                        <div class="dropdown-title">Dynamic</div>
                        <button class="dropdown-item" data-insert="viz">Visualization</button>
                        <button class="dropdown-item" data-insert="embed">Embed</button>
                    </div>
                </div>
            </div>

            <!-- Source Editor (full height, no split) -->
            <div class="editor-source-pane">
                <textarea class="editor-textarea"
                          placeholder="Start writing markdown..."
                          spellcheck="false">${this.escapeHtml(this.content)}</textarea>
            </div>

            <!-- Status Bar -->
            <div class="editor-status">
                <span class="status-target">No card selected</span>
                <span class="status-save">${this.isDirty ? 'Unsaved' : 'Saved'}</span>
                <span class="status-words">0 words</span>
            </div>

            <!-- File picker dropdown (hidden by default) -->
            <div class="editor-file-picker" style="display: none;"></div>
        `;

        card.appendChild(container);

        // Add card handles for drag/scale/rotate
        this.addCardHandles(card);

        return card;
    }

    addCardHandles(card) {
        // Corner handles for scaling, rotation, and dragging
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
        });

        // Top middle actions (close)
        const topHandle = document.createElement('div');
        topHandle.className = 'card-top-handle';
        topHandle.innerHTML = `
            <button class="card-action-btn pin-btn" title="Pin">${this.pinned ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'}</button>
            <button class="card-action-btn delete-btn" title="Close">&times;</button>
        `;
        card.appendChild(topHandle);
    }

    updateTransform(element = this.element) {
        element.style.left = `${this.x}px`;
        element.style.top = `${this.y}px`;
        element.style.width = `${this.width}px`;
        element.style.height = `${this.height}px`;
        element.style.transform = `rotate(${this.rotation}deg)`;
        element.style.zIndex = this.zIndex;

        // Counter-rotate handles
        const counterRotation = -this.rotation;
        element.querySelectorAll('.card-handle, .card-rotate-handle, .card-drag-handle').forEach(handle => {
            handle.style.transform = `rotate(${counterRotation}deg)`;
        });

        const topHandle = element.querySelector('.card-top-handle');
        if (topHandle) {
            topHandle.style.transform = `translateX(-50%) rotate(${counterRotation}deg)`;
        }
    }

    bindEvents() {
        const textarea = this.element.querySelector('.editor-textarea');
        const filenameInput = this.element.querySelector('.editor-filename');

        // Real-time update on input (debounced)
        textarea.addEventListener('input', () => {
            this.content = textarea.value;
            this.isDirty = this.content !== this.lastSavedContent;
            this.updateStatus();
            this.scheduleTargetUpdate();
        });

        // Keyboard shortcuts
        textarea.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.save();
            }

            // Tab handling - insert spaces
            if (e.key === 'Tab') {
                e.preventDefault();
                this.insertAtCursor('    ');
            }
        });

        // Filename input
        filenameInput.addEventListener('input', () => {
            const newName = this.sanitizeFilename(filenameInput.value);
            if (newName !== this.filename) {
                this.filename = newName;
                this.isDirty = true;
                this.updateStatus();
            }
        });

        // Toolbar buttons
        this.element.querySelector('.save-btn').addEventListener('click', () => this.save());
        this.element.querySelector('.new-btn').addEventListener('click', () => this.newCard());
        this.element.querySelector('.open-btn').addEventListener('click', () => this.toggleFilePicker());

        // Private toggle
        const privateCheckbox = this.element.querySelector('.private-checkbox');
        if (privateCheckbox) {
            privateCheckbox.addEventListener('change', () => {
                this.isPrivate = privateCheckbox.checked;
                this.isDirty = true;
                this.updateStatus();
            });
        }

        // Insert toolbar buttons
        this.bindInsertToolbar();

        // Top handle close button
        const deleteBtn = this.element.querySelector('.card-top-handle .delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });
        }

        // Pin button
        const pinBtn = this.element.querySelector('.card-top-handle .pin-btn');
        if (pinBtn) {
            pinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePin();
            });
        }

        // Drag handles
        this.bindDragHandles();

        // Scale handles
        this.bindScaleHandles();

        // Rotate handles
        this.bindRotateHandles();

        // Bring to front on click
        this.element.addEventListener('mouseenter', () => this.bringToFront());
    }

    bindDragHandles() {
        let isDragging = false;
        let startMouseX, startMouseY, startX, startY;

        this.element.querySelectorAll('.card-drag-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                if (this.pinned) return;
                e.preventDefault();
                e.stopPropagation();

                isDragging = true;
                startMouseX = e.clientX;
                startMouseY = e.clientY;
                startX = this.x;
                startY = this.y;

                this.element.classList.add('dragging');
                this.bringToFront();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const zoom = this.canvas?.zoom || 1;
            const dx = (e.clientX - startMouseX) / zoom;
            const dy = (e.clientY - startMouseY) / zoom;

            this.x = startX + dx;
            this.y = startY + dy;
            this.updateTransform();
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.element.classList.remove('dragging');
            }
        });
    }

    bindScaleHandles() {
        let isScaling = false;
        let corner, startX, startY, startWidth, startHeight, startPosX, startPosY;

        this.element.querySelectorAll('.card-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                if (this.pinned) return;
                e.preventDefault();
                e.stopPropagation();

                isScaling = true;
                corner = handle.dataset.corner;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = this.width;
                startHeight = this.height;
                startPosX = this.x;
                startPosY = this.y;

                this.element.classList.add('dragging');
                this.bringToFront();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isScaling) return;

            const zoom = this.canvas?.zoom || 1;
            let dx = (e.clientX - startX) / zoom;
            let dy = (e.clientY - startY) / zoom;

            // Adjust based on corner
            let newWidth = startWidth;
            let newHeight = startHeight;
            let newX = startPosX;
            let newY = startPosY;

            if (corner.includes('r')) {
                newWidth = Math.max(350, startWidth + dx);
            }
            if (corner.includes('l')) {
                newWidth = Math.max(350, startWidth - dx);
                newX = startPosX + (startWidth - newWidth);
            }
            if (corner.includes('b')) {
                newHeight = Math.max(300, startHeight + dy);
            }
            if (corner.includes('t')) {
                newHeight = Math.max(300, startHeight - dy);
                newY = startPosY + (startHeight - newHeight);
            }

            this.width = newWidth;
            this.height = newHeight;
            this.x = newX;
            this.y = newY;
            this.updateTransform();
        });

        document.addEventListener('mouseup', () => {
            if (isScaling) {
                isScaling = false;
                this.element.classList.remove('dragging');
            }
        });
    }

    bindRotateHandles() {
        let isRotating = false;
        let centerX, centerY, startAngle, startRotation;

        this.element.querySelectorAll('.card-rotate-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                if (this.pinned) return;
                e.preventDefault();
                e.stopPropagation();

                isRotating = true;

                const rect = this.element.getBoundingClientRect();
                centerX = rect.left + rect.width / 2;
                centerY = rect.top + rect.height / 2;

                startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
                startRotation = this.rotation;

                this.element.classList.add('dragging');
                this.bringToFront();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isRotating) return;

            const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
            const deltaAngle = currentAngle - startAngle;

            this.rotation = startRotation + deltaAngle;
            this.updateTransform();
        });

        document.addEventListener('mouseup', () => {
            if (isRotating) {
                isRotating = false;
                this.element.classList.remove('dragging');
            }
        });
    }

    /**
     * Schedule a debounced update to the target card
     */
    scheduleTargetUpdate() {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        this.updateDebounceTimer = setTimeout(() => {
            this.updateTargetCard();
        }, this.updateDebounceDelay);
    }

    /**
     * Update the target card with current content
     */
    updateTargetCard() {
        if (!this.targetCard || !this.parser) return;

        try {
            const parsed = this.parser.parse(this.content);
            this.targetCard.setContent(parsed);

            // Re-bind interactive elements
            if (this.canvas && this.canvas.bindInteractiveElements) {
                this.canvas.bindInteractiveElements(this.targetCard.element);
            }
        } catch (e) {
            console.warn('Parse error during live update:', e.message);
        }
    }

    /**
     * Set the target card to edit
     */
    setTargetCard(card) {
        this.targetCard = card;
        this.updateStatus();
    }

    updateStatus() {
        const textarea = this.element.querySelector('.editor-textarea');
        const content = textarea?.value || '';

        // Word count
        const words = content.trim().split(/\s+/).filter(w => w).length;

        // Target info
        const targetInfo = this.targetCard
            ? `Editing: ${this.filename || 'untitled'}`
            : 'No card selected';

        this.element.querySelector('.status-target').textContent = targetInfo;
        this.element.querySelector('.status-save').textContent = this.isDirty ? 'Unsaved' : 'Saved';
        this.element.querySelector('.status-words').textContent = `${words} words`;
    }

    /**
     * Insert text at cursor position using execCommand for undo support
     */
    insertAtCursor(text) {
        const textarea = this.element.querySelector('.editor-textarea');
        textarea.focus();

        // Use execCommand to integrate with browser's undo stack
        // This allows Ctrl+Z to undo the insertion
        const success = document.execCommand('insertText', false, text);

        if (!success) {
            // Fallback for browsers that don't support execCommand on textareas
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + text.length;
        }

        this.content = textarea.value;
        this.isDirty = true;
        this.scheduleTargetUpdate();
        this.updateStatus();
    }

    async save() {
        const filenameInput = this.element.querySelector('.editor-filename');

        if (!this.filename.trim()) {
            filenameInput.focus();
            filenameInput.classList.add('error');
            setTimeout(() => filenameInput.classList.remove('error'), 1000);
            return false;
        }

        // Ensure we have directory access
        if (!await this.fsManager.ensureAccess()) {
            alert('Directory access required to save files. Please grant access to your cards folder.');
            return false;
        }

        try {
            let contentToSave = this.content;

            // If private, encrypt the content
            if (this.isPrivate && this.crypto) {
                contentToSave = await this.encryptContent(this.content);
                if (contentToSave === null) {
                    return false; // Encryption cancelled
                }
            }

            await this.fsManager.writeFile(this.filename, contentToSave);
            this.lastSavedContent = this.content;
            this.isDirty = false;

            // Update the target card's sourceFile if it was a new card
            if (this.targetCard) {
                this.targetCard.sourceFile = this.filename;
            }

            this.updateStatus();
            console.log(`Saved: ${this.filename}.md${this.isPrivate ? ' (encrypted)' : ''}`);
            return true;
        } catch (e) {
            console.error('Save failed:', e);
            alert('Failed to save file: ' + e.message);
            return false;
        }
    }

    /**
     * Encrypt content for saving as a private card
     * Returns the encrypted markdown or null if cancelled
     */
    async encryptContent(plainContent) {
        if (!this.crypto) {
            alert('Encryption not available');
            return null;
        }

        // Get password (use cached or prompt)
        let password = this.crypto.getCachedPassword();

        if (!password) {
            password = await this.promptForEncryptionPassword();
            if (!password) return null; // Cancelled
            this.crypto.cachePassword(password);
        }

        // Parse the content to separate frontmatter and body
        const match = plainContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

        let frontmatter = '';
        let body = plainContent;

        if (match) {
            frontmatter = match[1];
            body = match[2];
        }

        // Encrypt the body
        const encrypted = await this.crypto.encrypt(body, password);

        // Build encrypted frontmatter
        let encryptedFrontmatter = frontmatter;

        // Remove any existing encryption fields
        encryptedFrontmatter = encryptedFrontmatter
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                return !trimmed.startsWith('encrypted:') &&
                       !trimmed.startsWith('salt:') &&
                       !trimmed.startsWith('iv:');
            })
            .join('\n');

        // Add encryption fields
        encryptedFrontmatter += `\nencrypted: true\nsalt: ${encrypted.salt}\niv: ${encrypted.iv}`;

        // Return encrypted markdown
        return `---\n${encryptedFrontmatter.trim()}\n---\n${encrypted.ciphertext}`;
    }

    /**
     * Prompt for encryption password
     */
    async promptForEncryptionPassword() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'password-modal';
            modal.innerHTML = `
                <div class="password-dialog">
                    <div class="password-header">
                        <span class="password-icon">&#128274;</span>
                        <h3>Set Encryption Password</h3>
                    </div>
                    <p>Enter a password to encrypt this card:</p>
                    <input type="password" class="password-input" placeholder="Password" autofocus>
                    <input type="password" class="password-input password-confirm" placeholder="Confirm password">
                    <div class="password-error" style="display: none;">Passwords do not match</div>
                    <div class="password-buttons">
                        <button class="password-btn cancel">Cancel</button>
                        <button class="password-btn submit">Encrypt</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const input = modal.querySelector('.password-input');
            const confirmInput = modal.querySelector('.password-confirm');
            const errorDiv = modal.querySelector('.password-error');
            const submitBtn = modal.querySelector('.submit');
            const cancelBtn = modal.querySelector('.cancel');

            const submit = () => {
                const password = input.value;
                const confirm = confirmInput.value;

                if (!password) {
                    errorDiv.textContent = 'Password cannot be empty';
                    errorDiv.style.display = 'block';
                    return;
                }

                if (password !== confirm) {
                    errorDiv.textContent = 'Passwords do not match';
                    errorDiv.style.display = 'block';
                    confirmInput.value = '';
                    confirmInput.focus();
                    return;
                }

                modal.remove();
                resolve(password);
            };

            const cancel = () => {
                modal.remove();
                resolve(null);
            };

            submitBtn.addEventListener('click', submit);
            cancelBtn.addEventListener('click', cancel);
            confirmInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') cancel();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') cancel();
            });

            setTimeout(() => input.focus(), 50);
        });
    }

    /**
     * Create a new card on the canvas and start editing it
     */
    async newCard() {
        // Confirm if there are unsaved changes
        if (this.isDirty) {
            if (!confirm('You have unsaved changes. Create new card anyway?')) {
                return;
            }
        }

        const template = `---
width: ${CARD_TEMPLATE_WIDTH}
height: ${CARD_TEMPLATE_HEIGHT}
tags:
---

# Title

Your content here...
`;

        // Calculate position for new card (to the right of editor)
        const editorRight = this.x + this.width + 50;
        const editorY = this.y;

        // Parse the template to get metadata
        const parsed = this.parser.parse(template);
        const metadata = parsed.metadata || {};

        // Create a new card on the canvas
        const newCard = await this.canvas.createCard({
            x: editorRight,
            y: editorY,
            width: metadata.width || CARD_TEMPLATE_WIDTH,
            height: metadata.height || CARD_TEMPLATE_HEIGHT,
            content: parsed.content,
            margins: parsed.margins,
            sourceFile: null, // No file yet
            isDynamic: true   // Mark as dynamic until saved
        });

        // Update editor state
        this.filename = '';
        this.content = template;
        this.lastSavedContent = '';
        this.isDirty = true;
        this.targetCard = newCard;

        // Update UI
        this.element.querySelector('.editor-filename').value = '';
        this.element.querySelector('.editor-textarea').value = template;
        this.element.querySelector('.editor-filename').focus();
        this.updateStatus();
    }

    /**
     * Load a file and its corresponding card for editing
     */
    async loadFile(filename) {
        if (!await this.fsManager.ensureAccess()) {
            return false;
        }

        try {
            const content = await this.fsManager.readFile(filename);
            if (content === null) {
                alert(`File not found: ${filename}.md`);
                return false;
            }

            // Check if file is encrypted
            const isEncrypted = content.includes('encrypted: true');

            if (isEncrypted) {
                // For encrypted files, we need to decrypt for editing
                // but we'll show the decrypted content and re-encrypt on save
                const decrypted = await this.decryptForEditing(content);
                if (decrypted === null) {
                    return false; // Decryption cancelled or failed
                }

                // Set private flag and use decrypted content
                this.isPrivate = true;
                this.element.querySelector('.private-checkbox').checked = true;

                // Find or create the card on the canvas with decrypted content
                let card = this.findCardBySourceFile(filename);

                if (!card) {
                    const editorRight = this.x + this.width + 50;
                    card = await this.canvas.loadCardFromFile(filename, {
                        x: editorRight,
                        y: this.y
                    });
                }

                if (!card) {
                    alert(`Failed to load card: ${filename}`);
                    return false;
                }

                // Update editor state with decrypted content
                this.filename = filename;
                this.content = decrypted;
                this.lastSavedContent = decrypted;
                this.isDirty = false;
                this.targetCard = card;

                // Update UI
                this.element.querySelector('.editor-filename').value = filename;
                this.element.querySelector('.editor-textarea').value = decrypted;
                this.updateStatus();

                return true;
            }

            // Non-encrypted file - load normally
            this.isPrivate = false;
            this.element.querySelector('.private-checkbox').checked = false;

            // Find or create the card on the canvas
            let card = this.findCardBySourceFile(filename);

            if (!card) {
                // Load the card onto the canvas
                const editorRight = this.x + this.width + 50;
                card = await this.canvas.loadCardFromFile(filename, {
                    x: editorRight,
                    y: this.y
                });
            }

            if (!card) {
                alert(`Failed to load card: ${filename}`);
                return false;
            }

            // Update editor state
            this.filename = filename;
            this.content = content;
            this.lastSavedContent = content;
            this.isDirty = false;
            this.targetCard = card;

            // Update UI
            this.element.querySelector('.editor-filename').value = filename;
            this.element.querySelector('.editor-textarea').value = content;
            this.updateStatus();

            return true;
        } catch (e) {
            console.error('Load failed:', e);
            alert('Failed to load file: ' + e.message);
            return false;
        }
    }

    /**
     * Decrypt content for editing
     * Returns decrypted markdown (with clean frontmatter) or null if failed
     */
    async decryptForEditing(encryptedContent) {
        if (!this.crypto) {
            alert('Encryption not available');
            return null;
        }

        // Parse the encrypted format
        const match = encryptedContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
        if (!match) return null;

        const frontmatter = match[1];
        const ciphertext = match[2].trim();

        // Extract salt and iv
        const saltMatch = frontmatter.match(/salt:\s*(.+)/);
        const ivMatch = frontmatter.match(/iv:\s*(.+)/);

        if (!saltMatch || !ivMatch) {
            alert('Invalid encrypted file format');
            return null;
        }

        const encryptedData = {
            salt: saltMatch[1].trim(),
            iv: ivMatch[1].trim(),
            ciphertext: ciphertext
        };

        // Try cached password first
        let password = this.crypto.getCachedPassword();

        if (password) {
            try {
                const decryptedBody = await this.crypto.decrypt(encryptedData, password);
                return this.reconstructCleanMarkdown(frontmatter, decryptedBody);
            } catch (e) {
                this.crypto.clearPassword();
            }
        }

        // Prompt for password
        password = await this.promptForDecryptionPassword();
        if (!password) return null;

        try {
            const decryptedBody = await this.crypto.decrypt(encryptedData, password);
            this.crypto.cachePassword(password);
            return this.reconstructCleanMarkdown(frontmatter, decryptedBody);
        } catch (e) {
            alert('Wrong password. Please try again.');
            return null;
        }
    }

    /**
     * Reconstruct clean markdown (without encryption fields) for editing
     */
    reconstructCleanMarkdown(encryptedFrontmatter, decryptedBody) {
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
     * Prompt for decryption password
     */
    async promptForDecryptionPassword() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'password-modal';
            modal.innerHTML = `
                <div class="password-dialog">
                    <div class="password-header">
                        <span class="password-icon">&#128274;</span>
                        <h3>Encrypted File</h3>
                    </div>
                    <p>Enter password to edit this encrypted card:</p>
                    <input type="password" class="password-input" placeholder="Password" autofocus>
                    <div class="password-error" style="display: none;"></div>
                    <div class="password-buttons">
                        <button class="password-btn cancel">Cancel</button>
                        <button class="password-btn submit">Decrypt</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const input = modal.querySelector('.password-input');
            const submitBtn = modal.querySelector('.submit');
            const cancelBtn = modal.querySelector('.cancel');

            const submit = () => {
                const password = input.value;
                modal.remove();
                resolve(password || null);
            };

            const cancel = () => {
                modal.remove();
                resolve(null);
            };

            submitBtn.addEventListener('click', submit);
            cancelBtn.addEventListener('click', cancel);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') cancel();
            });

            setTimeout(() => input.focus(), 50);
        });
    }

    /**
     * Find a card on the canvas by its source file
     */
    findCardBySourceFile(filename) {
        if (!this.canvas || !this.canvas.cards) return null;

        for (const card of this.canvas.cards.values()) {
            if (card.sourceFile === filename) {
                return card;
            }
        }
        return null;
    }

    async toggleFilePicker() {
        const picker = this.element.querySelector('.editor-file-picker');

        if (picker.style.display !== 'none') {
            picker.style.display = 'none';
            return;
        }

        // Ensure we have directory access
        if (!await this.fsManager.ensureAccess()) {
            return;
        }

        const files = await this.fsManager.listFiles();

        if (files.length === 0) {
            picker.innerHTML = '<div class="editor-file-item" style="color: var(--color-text-secondary);">No files found</div>';
        } else {
            picker.innerHTML = files.map(f =>
                `<div class="editor-file-item" data-file="${this.escapeHtml(f)}">${this.escapeHtml(f)}</div>`
            ).join('');
        }

        picker.style.display = 'block';

        // Handle file selection
        picker.querySelectorAll('.editor-file-item[data-file]').forEach(item => {
            item.addEventListener('click', () => {
                this.loadFile(item.dataset.file);
                picker.style.display = 'none';
            });
        });

        // Close on click outside (after a small delay to avoid immediate close)
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!picker.contains(e.target)) {
                    picker.style.display = 'none';
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 100);
    }

    close() {
        if (this.isDirty) {
            if (!confirm('You have unsaved changes. Close anyway?')) {
                return;
            }
        }

        this.stopAutosave();

        // Clear debounce timer
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        // Dispatch close event
        this.element.dispatchEvent(new CustomEvent('editor-close', {
            bubbles: true,
            detail: { editorId: this.id }
        }));

        this.element.remove();
    }

    bringToFront() {
        // Get all cards and find max z-index, but exclude preview cards and cap at 9999
        // This matches the behavior of regular Card.js bringToFront()
        const allCards = document.querySelectorAll('.card:not(.card-preview)');
        let maxZ = 0;
        allCards.forEach(card => {
            const z = parseInt(card.style.zIndex || 0);
            if (z > maxZ) maxZ = z;
        });

        // Cap at 9999 to keep preview cards (10000+) always on top
        this.zIndex = Math.min(maxZ + 1, Z_INDEX_CARD_CAP);
        this.element.style.zIndex = this.zIndex;
    }

    togglePin() {
        this.pinned = !this.pinned;
        this.element.classList.toggle('pinned', this.pinned);

        const pinBtn = this.element.querySelector('.pin-btn');
        if (pinBtn) {
            pinBtn.innerHTML = this.pinned
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
        }
    }

    startAutosave() {
        this.autosaveInterval = setInterval(() => {
            if (this.isDirty && this.filename.trim()) {
                console.log('Autosaving...');
                this.save();
            }
        }, this.autosaveDelay);
    }

    stopAutosave() {
        if (this.autosaveInterval) {
            clearInterval(this.autosaveInterval);
            this.autosaveInterval = null;
        }
    }

    /**
     * Bind insert toolbar buttons and dropdowns
     */
    bindInsertToolbar() {
        // Direct insert buttons
        this.element.querySelectorAll('.insert-btn[data-insert]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const insertType = btn.dataset.insert;
                this.insertTemplate(insertType);
            });
        });

        // Dropdown toggles
        this.element.querySelectorAll('.dropdown-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dropdownId = btn.dataset.dropdown;
                this.toggleInsertDropdown(dropdownId);
            });
        });

        // Dropdown items
        this.element.querySelectorAll('.dropdown-item[data-insert]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const insertType = item.dataset.insert;
                this.insertTemplate(insertType);
                this.closeAllDropdowns();
            });
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.editor-insert-toolbar') && !e.target.closest('.editor-dropdowns')) {
                this.closeAllDropdowns();
            }
        });
    }

    /**
     * Toggle a dropdown menu
     */
    toggleInsertDropdown(dropdownId) {
        const dropdown = this.element.querySelector(`.insert-dropdown[data-dropdown-id="${dropdownId}"]`);
        const isOpen = dropdown?.classList.contains('open');

        // Close all dropdowns
        this.closeAllDropdowns();

        // Open the requested one if it wasn't already open
        if (!isOpen && dropdown) {
            dropdown.classList.add('open');

            // Position dropdown relative to the toggle button
            const toggleBtn = this.element.querySelector(`.dropdown-toggle[data-dropdown="${dropdownId}"]`);
            if (toggleBtn) {
                const btnRect = toggleBtn.getBoundingClientRect();
                const containerRect = this.element.querySelector('.editor-container').getBoundingClientRect();
                dropdown.style.left = `${btnRect.left - containerRect.left}px`;
            }
        }
    }

    /**
     * Close all dropdown menus
     */
    closeAllDropdowns() {
        this.element.querySelectorAll('.insert-dropdown').forEach(d => {
            d.classList.remove('open');
        });
    }

    /**
     * Insert a template at the cursor position, or wrap selected text
     * Uses execCommand for proper undo/redo support (Ctrl+Z / Ctrl+Shift+Z)
     */
    insertTemplate(type) {
        const template = this.getInsertTemplate(type);
        if (!template) return;

        const textarea = this.element.querySelector('.editor-textarea');
        textarea.focus();

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);

        if (selectedText && template.prefix !== undefined) {
            // Wrap selected text with prefix/suffix
            const wrappedText = template.prefix + selectedText + (template.suffix || '');

            // Use execCommand to integrate with browser's undo stack
            const success = document.execCommand('insertText', false, wrappedText);

            if (!success) {
                // Fallback for browsers that don't support execCommand
                textarea.value = textarea.value.substring(0, start) + wrappedText + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + wrappedText.length;
            }

            this.content = textarea.value;
            this.isDirty = true;
            this.scheduleTargetUpdate();
            this.updateStatus();
        } else {
            // No selection - insert full template
            this.insertAtCursor(template.text);

            // Optionally move cursor to a specific position within the template
            if (template.cursorOffset !== undefined) {
                const newPos = textarea.selectionStart - template.text.length + template.cursorOffset;
                textarea.selectionStart = textarea.selectionEnd = newPos;
            }
        }
    }

    /**
     * Get insert template for a given type
     */
    getInsertTemplate(type) {
        const templates = {
            // Headers - wrap selected text or insert placeholder
            'h1': {
                text: '# Heading 1\n',
                cursorOffset: 2,
                prefix: '# ',
                suffix: '\n'
            },
            'h2': {
                text: '## Heading 2\n',
                cursorOffset: 3,
                prefix: '## ',
                suffix: '\n'
            },
            'h3': {
                text: '### Heading 3\n',
                cursorOffset: 4,
                prefix: '### ',
                suffix: '\n'
            },

            // Formatting - wrap selected text
            'bold': {
                text: '**bold text**',
                cursorOffset: 2,
                prefix: '**',
                suffix: '**'
            },
            'italic': {
                text: '*italic text*',
                cursorOffset: 1,
                prefix: '*',
                suffix: '*'
            },
            'code': {
                text: '`code`',
                cursorOffset: 1,
                prefix: '`',
                suffix: '`'
            },

            // Margins - wrap selected text in margin block
            'margin-left': {
                text: `[[margin(left, type: absolute, orient: vertical)]]
{
Margin text here
}
`,
                cursorOffset: 52,
                prefix: `[[margin(left, type: absolute, orient: vertical)]]
{
`,
                suffix: `
}
`
            },
            'margin-right': {
                text: `[[margin(right, type: absolute, orient: vertical)]]
{
Margin text here
}
`,
                cursorOffset: 53,
                prefix: `[[margin(right, type: absolute, orient: vertical)]]
{
`,
                suffix: `
}
`
            },
            'margin-top': {
                text: `[[margin(top, type: absolute)]]
{
Top margin text
}
`,
                cursorOffset: 34,
                prefix: `[[margin(top, type: absolute)]]
{
`,
                suffix: `
}
`
            },
            'margin-bottom': {
                text: `[[margin(bottom, type: absolute)]]
{
Bottom margin text
}
`,
                cursorOffset: 37,
                prefix: `[[margin(bottom, type: absolute)]]
{
`,
                suffix: `
}
`
            },
            'margin-absolute': {
                text: `[[margin(left, type: absolute, orient: vertical, pos: 50)]]
{
Fixed position margin
}
`,
                cursorOffset: 62,
                prefix: `[[margin(left, type: absolute, orient: vertical, pos: 50)]]
{
`,
                suffix: `
}
`
            },
            'margin-relative': {
                text: `[[margin(right, type: relative, orient: vertical)]]
{
This margin scrolls with the content it's anchored to
}
`,
                cursorOffset: 54,
                prefix: `[[margin(right, type: relative, orient: vertical)]]
{
`,
                suffix: `
}
`
            },

            // Links - selected text becomes display text
            'card-link': {
                text: '[[card-name]]',
                cursorOffset: 2,
                prefix: '[[',
                suffix: ']]'
            },
            'card-link-display': {
                text: '[[card-name|Display Text]]',
                cursorOffset: 2,
                prefix: '[[card-name|',
                suffix: ']]'
            },
            'card-link-full': {
                text: '[[link(card-name, display: "Click here", size: 320x400, rel: 350:0)]]',
                cursorOffset: 7,
                prefix: '[[link(card-name, display: "',
                suffix: '", size: 320x400, rel: 350:0)]]'
            },
            'external-link': {
                text: '[link text](https://example.com)',
                cursorOffset: 1,
                prefix: '[',
                suffix: '](https://example.com)'
            },
            'anchor': {
                text: '[[anchor(section-id)]]{Anchor Text}',
                cursorOffset: 9,
                prefix: '[[anchor(section-id)]]{',
                suffix: '}'
            },
            'jump': {
                text: '[[jump(section-id)]]{Go to section}',
                cursorOffset: 7,
                prefix: '[[jump(section-id)]]{',
                suffix: '}'
            },

            // Blocks - wrap selected text
            'center': {
                text: `[[center]]
{
Centered content
}
`,
                cursorOffset: 13,
                prefix: `[[center]]
{
`,
                suffix: `
}
`
            },
            'style-block': {
                text: `[[style(background: #f5f5f5; padding: 16px; border-radius: 4px)]]
{
Styled content
}
`,
                cursorOffset: 68,
                prefix: `[[style(background: #f5f5f5; padding: 16px; border-radius: 4px)]]
{
`,
                suffix: `
}
`
            },
            'image-block': {
                text: `[[image(cards/images/photo.jpg, scale: 100%, fit: contain, align: center)]]
{
Optional caption
}
`,
                cursorOffset: 9,
                prefix: `[[image(cards/images/photo.jpg, scale: 100%, fit: contain, align: center)]]
{
`,
                suffix: `
}
`
            },
            'blockquote': {
                text: '> Quoted text\n',
                cursorOffset: 2,
                prefix: '> ',
                suffix: '\n'
            },
            'code-block': {
                text: '```\ncode here\n```\n',
                cursorOffset: 4,
                prefix: '```\n',
                suffix: '\n```\n'
            },
            'hr': { text: '\n---\n', cursorOffset: 5 },

            // Text
            'centered-text': {
                text: '->Centered text<-',
                cursorOffset: 2,
                prefix: '->',
                suffix: '<-'
            },
            'inline-style': {
                text: '[[style(color: red; font-weight: bold)]]{styled text}',
                cursorOffset: 9,
                prefix: '[[style(color: red; font-weight: bold)]]{',
                suffix: '}'
            },
            'list-ul': {
                text: '- Item 1\n- Item 2\n- Item 3\n',
                cursorOffset: 2,
                prefix: '- ',
                suffix: '\n'
            },
            'list-ol': {
                text: '1. First item\n2. Second item\n3. Third item\n',
                cursorOffset: 3,
                prefix: '1. ',
                suffix: '\n'
            },

            // References
            'citation': {
                text: '[[cite(https://example.com, Source Title)]]',
                cursorOffset: 7,
                prefix: '[[cite(https://example.com, ',
                suffix: ')]]'
            },
            'bibliography': { text: '\n[[bibliography]]\n', cursorOffset: 18 },
            'math-inline': {
                text: '$x = y$',
                cursorOffset: 1,
                prefix: '$',
                suffix: '$'
            },
            'math-display': {
                text: '\n$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n',
                cursorOffset: 4,
                prefix: '\n$$\n',
                suffix: '\n$$\n'
            },

            // Interactive
            'toggle': {
                text: '[[toggle(bind: settingName, on: true, off: false, label: Toggle Label)]]',
                cursorOffset: 15,
                prefix: '[[toggle(bind: settingName, on: true, off: false, label: ',
                suffix: ')]]'
            },
            'slider': {
                text: '[[slider(bind: settingName, min: 0, max: 100, step: 1, label: Slider Label, suffix: %)]]',
                cursorOffset: 15,
                prefix: '[[slider(bind: settingName, min: 0, max: 100, step: 1, label: ',
                suffix: ', suffix: %)]]'
            },
            'button': {
                text: '[[button(action: actionName, label: Button Text)]]',
                cursorOffset: 17,
                prefix: '[[button(action: actionName, label: ',
                suffix: ')]]'
            },
            'tags': { text: '[[tags]]', cursorOffset: 8 },

            // New templates
            'gallery': {
                text: `[[gallery(columns: 3, gap: 8)]]
{
path/to/image.jpg|alt text|label
}
`,
                cursorOffset: 35
            },
            'quote-block': {
                text: `[[quote(author: "Author Name")]]
{
Quote text here
}
`,
                cursorOffset: 18,
                prefix: `[[quote(author: "Author Name")]]
{
`,
                suffix: `
}
`
            },
            'note': {
                text: '[[note(right)]]{anchor text}{margin content}',
                cursorOffset: 16
            },
            'input': {
                text: '[[input(name: field, placeholder: "Enter text")]]',
                cursorOffset: 13
            },
            'textarea': {
                text: '[[textarea(name: field, placeholder: "Enter text", rows: 4)]]',
                cursorOffset: 15
            },
            'viz': {
                text: '[[viz(type: polynomial, width: 400, height: 300)]]',
                cursorOffset: 11
            },
            'embed': {
                text: '{{name}}',
                cursorOffset: 2
            },
            'drop-cap': {
                text: '[[drop(A)]]',
                cursorOffset: 7
            },
            'tab': { text: '[[tab]]', cursorOffset: 7 },
            'break': { text: '[[break]]', cursorOffset: 9 },
            'bigbreak': { text: '[[bigbreak]]', cursorOffset: 12 },
            'toc': { text: '[[toc]]', cursorOffset: 7 },
            'date': { text: '[[date]]', cursorOffset: 8 },
            'summary': {
                text: '[[summary]]{summary text}',
                cursorOffset: 12,
                prefix: '[[summary]]{',
                suffix: '}'
            }
        };

        return templates[type] || null;
    }

    sanitizeFilename(name) {
        // Remove file extension if present and sanitize
        return name
            .replace(/\.md$/i, '')
            .replace(/[^a-zA-Z0-9_-]/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    toJSON() {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            rotation: this.rotation,
            zIndex: this.zIndex,
            pinned: this.pinned,
            filename: this.filename,
            content: this.content,
            isDirty: this.isDirty,
            lastSavedContent: this.lastSavedContent,
            isPrivate: this.isPrivate,
            // Store target card ID for reconnection on restore
            targetCardId: this.targetCard?.id || null
        };
    }
}
