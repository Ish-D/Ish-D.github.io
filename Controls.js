/**
 * Controls.js - Declarative UI Control Configuration System
 *
 * This module defines all interactive controls (buttons, sliders, toggles)
 * in a single declarative configuration object. It makes it easy to add
 * new controls and prepares for future interactive visualizations.
 */

// ============================================
// CONSTANTS
// ============================================

/**
 * Default margin size as a percentage of card dimensions.
 * Used as the default for the margin slider and fallback values.
 */
export const DEFAULT_MARGIN_PERCENT = 7;

// ============================================
// SETTINGS CONFIGURATION
// ============================================

/**
 * Settings definitions with defaults, validation, and side effects.
 *
 * Each setting has:
 * - default: The default value
 * - type: 'string' | 'number' | 'boolean' for type coercion
 * - storage: localStorage key
 * - apply(value, context): Called on initial load and every change (for CSS vars)
 * - onSet(value, context): Called only when setting changes (for side effects)
 */
export const SettingsConfig = {
    theme: {
        default: 'light',
        type: 'string',
        storage: 'settings-theme',
        apply(value, context) {
            if (value === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
        }
    },

    fontSize: {
        default: 17,
        type: 'number',
        storage: 'settings-fontSize',
        apply(value, context) {
            // Base font size
            document.documentElement.style.setProperty('--font-size-base', `${value}px`);

            // Scale all font sizes proportionally based on default ratios (base = 17px)
            const scale = value / 17;

            // Headings (default: h1=32px, h2=26px, h3=20px)
            document.documentElement.style.setProperty('--font-size-h1', `${Math.round(32 * scale)}px`);
            document.documentElement.style.setProperty('--font-size-h2', `${Math.round(26 * scale)}px`);
            document.documentElement.style.setProperty('--font-size-h3', `${Math.round(20 * scale)}px`);

            // Code (default: 13px)
            document.documentElement.style.setProperty('--font-size-code', `${Math.round(13 * scale)}px`);

            // Margins (default: 11px, small: 10px)
            const marginFontSize = Math.max(9, Math.round(11 * scale));
            const marginSmallFontSize = Math.max(8, Math.round(10 * scale));
            document.documentElement.style.setProperty('--font-size-margin', `${marginFontSize}px`);
            document.documentElement.style.setProperty('--font-size-margin-small', `${marginSmallFontSize}px`);
            document.documentElement.style.setProperty('--font-size-margin-title', `${marginFontSize}px`);

            // Page number (default: 11px)
            document.documentElement.style.setProperty('--font-size-page-number', `${Math.max(9, Math.round(11 * scale))}px`);

            // Tags and date (default: tags=13px, date=12px)
            document.documentElement.style.setProperty('--font-size-tags', `${Math.max(9, Math.round(13 * scale))}px`);
            document.documentElement.style.setProperty('--font-size-date', `${Math.max(8, Math.round(12 * scale))}px`);
        }
    },

    lineHeight: {
        default: 1.3,
        type: 'number',
        storage: 'settings-lineHeight',
        apply(value, context) {
            document.documentElement.style.setProperty('--line-height-base', value);
            document.documentElement.style.setProperty('--line-height-margin', value);
        }
    },

    marginSize: {
        default: DEFAULT_MARGIN_PERCENT,
        type: 'number',
        storage: 'settings-marginSize',
        onSet(value, context) {
            context.updateAllCardMargins?.(value);
        }
    },

    cardShadow: {
        default: true,
        type: 'boolean',
        storage: 'settings-cardShadow',
        onSet(value, context) {
            context.updateCardShadows?.();
        }
    },

    showHandles: {
        default: false,
        type: 'boolean',
        storage: 'settings-showHandles',
        onSet(value, context) {
            context.updateHandleVisibility?.();
        }
    },

    showConnections: {
        default: false,
        type: 'boolean',
        storage: 'settings-showConnections',
        onSet(value, context) {
            context.updateConnectionsVisibility?.();
        }
    },

    connectionsAbove: {
        default: false,
        type: 'boolean',
        storage: 'settings-connectionsAbove',
        onSet(value, context) {
            context.updateConnectionsLayer?.();
        }
    },

    showPreviews: {
        default: false,
        type: 'boolean',
        storage: 'settings-showPreviews',
        onSet(value, context) {
            if (!value) {
                context.clearPreviewCard?.();
            }
        }
    },

    readerMode: {
        default: false,
        type: 'boolean',
        storage: 'settings-readerMode',
        onSet(value, context) {
            if (value) {
                // Get current card to enter reader mode with
                const currentCard = context.cards?.size > 0
                    ? Array.from(context.cards.values())[0]?.sourceFile
                    : 'menu';
                context.enterReaderMode?.(currentCard || 'menu');
            } else {
                context.exitReaderMode?.();
            }
        }
    }
};

// ============================================
// ACTIONS CONFIGURATION
// ============================================

/**
 * Action handlers for buttons.
 * Each receives: (context, buttonElement)
 *
 * To add a new action, simply add it here:
 *
 * myAction: {
 *     label: 'My Action',
 *     handler(context, button) {
 *         // Access cards, settings, etc. via context
 *         context.cards.forEach(card => { ... });
 *     }
 * }
 *
 * Then use in markdown: [[button(action: myAction, label: My Action)]]
 */
export const ActionsConfig = {
    clearPage: {
        label: 'Clear Page',
        handler(context, button) {
            // Clear saved state from localStorage
            localStorage.removeItem('paper-canvas-state');

            // Remove all cards
            context.cards.forEach((card, id) => {
                context.removeConnectionsForCard?.(id);
                card.element.remove();
            });
            context.cards.clear();

            // Clear connections
            context.connections?.clear();
            if (context.connectionsSvg) {
                context.connectionsSvg.querySelectorAll('.connection-line')
                    .forEach(line => line.remove());
            }

            // Reset canvas transform
            context.resetCanvasTransform?.();

            // Load fresh menu
            context.loadMenuCard?.();
        }
    },

    resetSettings: {
        label: 'Reset to Defaults',
        handler(context, button) {
            // Settings to skip onSet callbacks for (View Mode options that have disruptive side effects)
            const skipOnSetFor = ['theme', 'readerMode'];

            // Reset each setting to its default value
            Object.entries(SettingsConfig).forEach(([key, config]) => {
                // Update the settings object directly
                if (context.settings) {
                    context.settings[key] = config.default;
                }
                // Update localStorage
                localStorage.setItem(config.storage, config.default);

                // Run apply() for CSS variable updates
                if (config.apply) {
                    config.apply(config.default, context);
                }

                // Run onSet() for side effects, except for View Mode options
                if (config.onSet && !skipOnSetFor.includes(key)) {
                    config.onSet(config.default, context);
                }
            });

            // Sync all settings cards to reflect the reset
            context.syncAllSettingsCards?.();
        }
    },

    submitContactForm: {
        label: 'Send',
        async handler(context, button) {
            const card = button.closest('.card');
            const cardContent = card.querySelector('.card-content');

            const nameInput = cardContent.querySelector('input[name="name"]');
            const subjectInput = cardContent.querySelector('input[name="_subject"]');
            const messageInput = cardContent.querySelector('textarea[name="message"]');

            if (!nameInput.value.trim() || !messageInput.value.trim()) {
                // Show error state briefly
                [nameInput, messageInput].forEach(input => {
                    if (!input.value.trim()) {
                        input.style.borderColor = '#c41e3a';
                        setTimeout(() => input.style.borderColor = '', 2000);
                    }
                });
                return;
            }

            const data = {
                name: nameInput.value,
                _subject: subjectInput.value || 'Contact Form',
                message: messageInput.value
            };

            button.disabled = true;
            button.textContent = 'Sending...';

            try {
                const response = await fetch('https://formspree.io/f/mgokjyon', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    // Replace card content with "Sent"
                    cardContent.innerHTML = '<div class="form-success"><p>Sent</p></div>';
                } else {
                    throw new Error('Failed');
                }
            } catch (e) {
                button.textContent = 'Error - Retry';
                button.disabled = false;
            }
        }
    }
};

// ============================================
// CONTROL TYPES (Toggle, Slider, Button)
// ============================================

/**
 * Control type handlers.
 * Each handler receives: (element, config, context)
 * - element: The DOM element to bind
 * - config: The setting's configuration from SettingsConfig (if applicable)
 * - context: { getSetting, setSetting, cards, canvas, executeAction, ... }
 *
 * To add a new control type (e.g., color picker):
 *
 * controlsManager.registerControlType('colorPicker', {
 *     selector: '.color-picker[data-bind]',
 *     init(element, config, context) { ... },
 *     bind(element, config, context) { ... },
 *     sync(element, config, context) { ... }
 * });
 */
export const ControlTypes = {
    toggle: {
        selector: '.settings-toggle[data-bind]',

        init(element, config, context) {
            const bind = element.dataset.bind;
            const onValue = element.dataset.on || 'true';

            // Set initial state - handle both string and boolean comparisons
            const currentValue = context.getSetting(bind);
            const isOn = this.isOnState(currentValue, onValue);
            element.classList.toggle('active', isOn);
        },

        bind(element, config, context) {
            const bind = element.dataset.bind;
            const onValue = element.dataset.on || 'true';
            const offValue = element.dataset.off || 'false';

            element.addEventListener('click', () => {
                const isCurrentlyOn = element.classList.contains('active');
                // Convert to appropriate type
                let newValue = isCurrentlyOn ? offValue : onValue;
                if (newValue === 'true') newValue = true;
                if (newValue === 'false') newValue = false;

                context.setSetting(bind, newValue);
                element.classList.toggle('active', !isCurrentlyOn);
            });
        },

        sync(element, config, context) {
            const bind = element.dataset.bind;
            const onValue = element.dataset.on || 'true';
            const currentValue = context.getSetting(bind);
            const isOn = this.isOnState(currentValue, onValue);
            element.classList.toggle('active', isOn);
        },

        isOnState(currentValue, onValue) {
            return String(currentValue) === String(onValue) ||
                   (onValue === 'true' && currentValue === true) ||
                   (onValue === 'dark' && currentValue === 'dark');
        }
    },

    slider: {
        selector: '.settings-slider[data-bind]',

        init(element, config, context) {
            const bind = element.dataset.bind;
            const suffix = element.dataset.suffix || '';
            const currentValue = context.getSetting(bind);

            if (currentValue !== undefined) {
                element.value = currentValue;
            }

            // Update display value
            const valueDisplay = element.closest('.card, .settings-overlay')
                ?.querySelector(`[data-value-for="${bind}"]`);
            if (valueDisplay) {
                valueDisplay.textContent = `${element.value}${suffix}`;
            }
        },

        bind(element, config, context) {
            const bind = element.dataset.bind;
            const suffix = element.dataset.suffix || '';

            element.addEventListener('input', () => {
                const value = element.step && element.step.includes('.')
                    ? parseFloat(element.value)
                    : parseInt(element.value);

                context.setSetting(bind, value);

                const valueDisplay = element.closest('.card, .settings-overlay')
                    ?.querySelector(`[data-value-for="${bind}"]`);
                if (valueDisplay) {
                    valueDisplay.textContent = `${value}${suffix}`;
                }
            });
        },

        sync(element, config, context) {
            const bind = element.dataset.bind;
            const suffix = element.dataset.suffix || '';
            const currentValue = context.getSetting(bind);

            if (currentValue !== undefined) {
                element.value = currentValue;
            }

            const valueDisplay = element.closest('.card, .settings-overlay')
                ?.querySelector(`[data-value-for="${bind}"]`);
            if (valueDisplay) {
                valueDisplay.textContent = `${element.value}${suffix}`;
            }
        }
    },

    button: {
        selector: '.settings-btn-action[data-action]',

        init(element, config, context) {
            // Buttons don't need initial state
        },

        bind(element, config, context) {
            const action = element.dataset.action;

            element.addEventListener('click', () => {
                context.executeAction(action, element);
            });
        },

        sync(element, config, context) {
            // Buttons don't need sync
        }
    }
};

// ============================================
// CONTROLS MANAGER
// ============================================

/**
 * ControlsManager - Binds and manages all interactive controls.
 *
 * This class provides:
 * - createContext(paperCanvas): Build a limited context object for handlers
 * - bindInteractiveElements(container, paperCanvas): Bind all controls in a container
 * - syncInteractiveElements(container, paperCanvas): Sync all controls with current state
 * - loadSettings(): Load all settings from localStorage
 * - applySettings(settings, context): Apply all settings (CSS vars, etc.)
 *
 * For extensibility:
 * - registerControlType(name, handler): Add a new control type
 * - registerAction(name, config): Add a new button action
 * - registerSetting(name, config): Add a new setting
 */
export class ControlsManager {
    constructor() {
        this.controlTypes = { ...ControlTypes };
        this.settingsConfig = { ...SettingsConfig };
        this.actionsConfig = { ...ActionsConfig };
    }

    /**
     * Register a custom control type for extensibility.
     *
     * Example:
     * controlsManager.registerControlType('colorPicker', {
     *     selector: '.color-picker[data-bind]',
     *     init(element, config, context) { ... },
     *     bind(element, config, context) { ... },
     *     sync(element, config, context) { ... }
     * });
     */
    registerControlType(name, handler) {
        this.controlTypes[name] = handler;
    }

    /**
     * Register a custom action.
     *
     * Example:
     * controlsManager.registerAction('exportCanvas', {
     *     label: 'Export',
     *     handler(context, button) { ... }
     * });
     */
    registerAction(name, config) {
        this.actionsConfig[name] = config;
    }

    /**
     * Register a custom setting.
     *
     * Example:
     * controlsManager.registerSetting('accentColor', {
     *     default: '#0066cc',
     *     type: 'string',
     *     storage: 'settings-accentColor',
     *     apply(value, context) {
     *         document.documentElement.style.setProperty('--accent-color', value);
     *     }
     * });
     */
    registerSetting(name, config) {
        this.settingsConfig[name] = config;
    }

    /**
     * Create context object from PaperCanvas instance.
     * This provides a limited, explicit interface for handlers.
     */
    createContext(paperCanvas) {
        const self = this;
        return {
            // Core settings API
            getSetting: (key) => paperCanvas.getSetting(key),
            setSetting: (key, value) => paperCanvas.setSetting(key, value),

            // Read-only data access
            cards: paperCanvas.cards,
            canvas: paperCanvas.canvas,
            connections: paperCanvas.connections,
            connectionsSvg: paperCanvas.connectionsSvg,

            // Action execution
            executeAction: (name, button) => {
                const action = self.actionsConfig[name];
                if (action?.handler) {
                    action.handler(self.createContext(paperCanvas), button);
                }
            },

            // Limited side-effect methods
            updateCardShadows: () => paperCanvas.updateCardShadows?.(),
            updateHandleVisibility: () => paperCanvas.updateHandleVisibility?.(),
            updateConnectionsVisibility: () => paperCanvas.updateConnectionsVisibility?.(),
            updateConnectionsLayer: () => paperCanvas.updateConnectionsLayer?.(),
            updateAllCardMargins: (v) => paperCanvas.updateAllCardMargins?.(v),
            clearPreviewCard: () => paperCanvas.clearPreviewCard?.(),
            enterReaderMode: (card) => paperCanvas.enterReaderMode?.(card),
            exitReaderMode: () => paperCanvas.exitReaderMode?.(),
            removeConnectionsForCard: (id) => paperCanvas.removeConnectionsForCard?.(id),
            syncAllSettingsCards: () => paperCanvas.syncAllSettingsCards?.(),
            loadMenuCard: () => paperCanvas.loadMenuCard?.(),
            resetCanvasTransform: () => {
                paperCanvas.panX = 0;
                paperCanvas.panY = 0;
                paperCanvas.zoom = 1;
                paperCanvas.rotation = 0;
                paperCanvas.pageCounter = 0;
                paperCanvas.zIndexCounter = 1000;
                paperCanvas.updateCanvasTransform?.();
            }
        };
    }

    /**
     * Bind all interactive elements in a container.
     */
    bindInteractiveElements(container, paperCanvas) {
        const context = this.createContext(paperCanvas);

        Object.values(this.controlTypes).forEach(controlType => {
            container.querySelectorAll(controlType.selector).forEach(element => {
                const bind = element.dataset.bind;
                const config = bind ? this.settingsConfig[bind] : null;

                controlType.init(element, config, context);
                controlType.bind(element, config, context);
            });
        });
    }

    /**
     * Sync all interactive elements with current state.
     */
    syncInteractiveElements(container, paperCanvas) {
        const context = this.createContext(paperCanvas);

        Object.values(this.controlTypes).forEach(controlType => {
            if (controlType.sync) {
                container.querySelectorAll(controlType.selector).forEach(element => {
                    const bind = element.dataset.bind;
                    const config = bind ? this.settingsConfig[bind] : null;
                    controlType.sync(element, config, context);
                });
            }
        });
    }

    /**
     * Initialize settings from localStorage.
     */
    loadSettings() {
        const settings = {};

        Object.entries(this.settingsConfig).forEach(([key, config]) => {
            const stored = localStorage.getItem(config.storage);

            if (stored === null) {
                settings[key] = config.default;
            } else {
                // Type coercion based on config
                switch (config.type) {
                    case 'number':
                        // Handle floats vs ints based on default
                        settings[key] = config.default % 1 === 0
                            ? parseInt(stored)
                            : parseFloat(stored);
                        break;
                    case 'boolean':
                        settings[key] = stored === 'true';
                        break;
                    default:
                        settings[key] = stored;
                }
            }
        });

        return settings;
    }

    /**
     * Apply all settings (call on init and after changes).
     * This runs each setting's apply() function if defined.
     */
    applySettings(settings, context) {
        Object.entries(this.settingsConfig).forEach(([key, config]) => {
            if (config.apply && settings[key] !== undefined) {
                config.apply(settings[key], context);
            }
        });
    }

    /**
     * Get the config for a specific setting.
     */
    getSettingConfig(key) {
        return this.settingsConfig[key];
    }

    /**
     * Get the config for a specific action.
     */
    getActionConfig(name) {
        return this.actionsConfig[name];
    }
}

// Default singleton instance
export const controlsManager = new ControlsManager();
