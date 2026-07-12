/**
 * Companion script for about.md.
 *
 * Builds a collage at the bottom of the About page: the higuchi image is split
 * across several pieces, each rendered as a real card so it can be dragged and
 * rotated. The reader hides card chrome by default; styles.css re-enables the
 * drag and rotate handles for these pieces (see `.about-piece`).
 *
 * Pieces are placed so the image reconstructs centered in the reading column
 * and their edges spill sideways into the margins. They're contained vertically
 * so the collage sits below the text rather than over it. Everything is torn
 * down when the reader navigates away, so it disappears on leave.
 */
import { Card } from '../Card.js';
import { scatterImage } from '../ImageScatter.js';

const IMAGE_SRC = '/images/higuchi.png';
const PIECES = 12;
const BASE = 350; // px; reconstructed image size, capped so it never exceeds the viewport

export function init(container) {
    const content = container.querySelector('.card-content');
    if (!content) return;

    // Lets the pieces spill horizontally past the reading column into the margins.
    container.classList.add('about-page');

    const wrapper = document.createElement('div');
    wrapper.className = 'about-scatter';
    content.appendChild(wrapper);

    const pieces = [];
    const blobUrls = [];
    let built = false;
    let disposed = false;

    const build = async (size) => {
        built = true;

        let specs;
        try {
            specs = await scatterImage(IMAGE_SRC, PIECES, size, size, size / 2, size / 2);
        } catch (e) {
            console.error('about-scatter: failed to build collage', e);
            return;
        }
        if (disposed) {
            specs.forEach(s => URL.revokeObjectURL(s.dataUrl));
            return;
        }

        // Vertical extent of the rotated pieces, so we can shift the whole collage
        // down until its topmost edge sits at the wrapper's top (nothing overhangs
        // upward onto the text) and size the wrapper to hold it.
        let minTop = Infinity, maxBottom = -Infinity;
        for (const s of specs) {
            const centerY = s.y + s.height / 2;
            const rad = s.rotation * Math.PI / 180;
            const extentY = Math.abs((s.width / 2) * Math.sin(rad)) + Math.abs((s.height / 2) * Math.cos(rad));
            minTop = Math.min(minTop, centerY - extentY);
            maxBottom = Math.max(maxBottom, centerY + extentY);
        }
        const shiftY = -minTop;

        wrapper.style.width = `${size}px`;
        wrapper.style.height = `${maxBottom - minTop}px`;

        for (const spec of specs) {
            const card = new Card({
                x: spec.x,               // left/right edges spill into the margins
                y: spec.y + shiftY,      // contained vertically, below the text
                width: spec.width,
                height: spec.height,
                rotation: spec.rotation,
                zIndex: spec.zIndex,
                image: spec.dataUrl,
            });
            card.element.classList.add('about-piece');
            wrapper.appendChild(card.element);
            pieces.push(card);
            blobUrls.push(spec.dataUrl);
        }
    };

    // Build once the page has laid out, sized to the image cap (never wider than
    // the viewport). Pieces are placed once and not rebuilt on later resizes.
    const resizeObserver = new ResizeObserver(() => {
        if (built) return;
        if (content.clientWidth > 0) build(Math.min(BASE, container.clientWidth));
    });
    resizeObserver.observe(content);

    // Tear everything down when the About page is removed.
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        resizeObserver.disconnect();
        removalObserver?.disconnect();
        pieces.forEach(p => p.destroy());
        blobUrls.forEach(url => URL.revokeObjectURL(url));
    };

    let removalObserver = null;
    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
        removalObserver = new MutationObserver((mutations) => {
            const gone = mutations.some(m =>
                Array.from(m.removedNodes).some(n => n === container || n.contains?.(wrapper))
            );
            if (gone) dispose();
        });
        removalObserver.observe(pageContainer, { childList: true });
    }
}
