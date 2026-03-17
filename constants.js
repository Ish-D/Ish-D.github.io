/**
 * Shared constants used across multiple modules.
 * Centralizes values that were previously duplicated in app.js, Card.js, Editor.js, Controls.js.
 */

// Mobile detection
export const MOBILE_BREAKPOINT = 768;
export function isMobile() {
    return window.innerWidth < MOBILE_BREAKPOINT;
}

// Z-index layering system
export const Z_INDEX_BASE = 1000;        // Starting z-index counter for cards
export const Z_INDEX_CARD_CAP = 9999;    // Max z-index for regular cards
export const Z_INDEX_PREVIEW = 10000;    // Z-index for preview cards (always on top)

// Default card dimensions (used in Card.js constructor fallbacks)
export const CARD_DEFAULT_WIDTH = 280;
export const CARD_DEFAULT_HEIGHT = 360;

// Template card dimensions (used when creating cards from links/menus/editor)
export const CARD_TEMPLATE_WIDTH = 320;
export const CARD_TEMPLATE_HEIGHT = 400;

// Default margin size as a percentage of card dimensions
export const DEFAULT_MARGIN_PERCENT = isMobile() ? 1 : 28;

// Split mode constants
export const SPLIT_DIVIDER_SIZE = 1;       // Divider thickness in px
export const SPLIT_MIN_PANE_RATIO = 0.1;   // Min 10% when dragging dividers
