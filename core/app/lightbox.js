/**
 * Full-size view of a page's images. Opens on an image, steps through the
 * others with the arrow keys, closes on Escape or a click.
 */

/**
 * @param {{ document: Document, images: () => HTMLImageElement[] }} deps  `images` lists the viewable images in page order
 */
export function createLightbox({ document, images }) {
    let layer = null;
    let index = 0;
    let list = [];

    const captionOf = (img) => img.closest('figure')?.querySelector('figcaption, .caption')?.textContent ?? img.alt ?? '';

    function show() {
        const img = list[index];
        layer.querySelector('img').src = img.dataset.full;
        layer.querySelector('.lightbox-caption').textContent = captionOf(img);
        layer.classList.toggle('single', list.length < 2);
    }

    function step(by) {
        index = (index + by + list.length) % list.length;
        show();
    }

    function onKey(e) {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowRight') step(1);
        else if (e.key === 'ArrowLeft') step(-1);
        else return;
        e.preventDefault();
    }

    function close() {
        document.removeEventListener('keydown', onKey);
        layer?.remove();
        layer = null;
    }

    return {
        get isOpen() { return !!layer; },
        open(img) {
            list = images();
            index = Math.max(0, list.indexOf(img));
            if (!list.length) return;
            close();
            layer = document.createElement('div');
            layer.className = 'lightbox';
            const view = document.createElement('img');
            view.alt = '';
            const caption = document.createElement('div');
            caption.className = 'lightbox-caption';
            layer.append(view, caption);
            layer.addEventListener('click', (e) => {
                const x = e.clientX / document.defaultView.innerWidth;
                if (list.length > 1 && e.target === view && x < 0.25) step(-1);
                else if (list.length > 1 && e.target === view && x > 0.75) step(1);
                else close();
            });
            document.body.appendChild(layer);
            document.addEventListener('keydown', onKey);
            show();
        },
        close,
    };
}
