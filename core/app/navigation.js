/**
 * Moving around a page: scrolling to anchors and keeping the reader's place
 * when the layout changes.
 */

export function createNavigation(app) {
    const { state, window, document } = app;

    /** Scrolls so the anchor sits near the top and flashes the line. */
    function scrollToAnchor(id, smooth = true) {
        const pos = state.layout?.anchors.get(id);
        if (!pos) return false;
        window.scrollTo({ top: Math.max(0, pos.y - 90), behavior: smooth ? 'smooth' : 'auto' });
        const { geometry, styles } = state.layout;
        const flash = document.createElement('div');
        flash.className = 'flash';
        flash.style.cssText = `position:absolute;left:${geometry.text.x - 8}px;top:${pos.y - 4}px;width:${geometry.text.width + 16}px;height:${styles.lineHeight + 8}px;pointer-events:none`;
        state.docEl.appendChild(flash);
        setTimeout(() => flash.remove(), 1500);
        return true;
    }

    /** The block at the top of the screen and how far into it we are. */
    function captureScroll() {
        const y = window.scrollY;
        const block = state.layout?.blocks.find(b => (b.type === 'paragraph' || b.type === 'heading') && b.node && b.bottom > y);
        return block ? { start: block.node.start, offset: y - block.top } : null;
    }

    function restoreScroll(place) {
        if (!place || !state.layout) return;
        const block = state.layout.blocks.find(b => b.node && b.node.start === place.start && (b.type === 'paragraph' || b.type === 'heading'));
        if (block) window.scrollTo(0, block.top + place.offset);
    }

    return { scrollToAnchor, captureScroll, restoreScroll };
}
