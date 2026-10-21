/**
 * Contents rail: once the contents box at the top of a page has scrolled out
 * of view, a slim rail of ticks docks at the left edge. It marks the current
 * section, opens into the full list on hover, focus or click, and can be
 * hidden. On narrow screens it is a small button instead.
 */

const STORAGE_KEY = 'v2-toc';
/** Scroll distance over which the rail fades in after the contents box leaves. */
const FADE_PX = 160;

/** Index of the last entry whose position is at or above `y`; -1 before the first. */
export function currentSection(entries, y) {
    let lo = 0;
    let hi = entries.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (entries[mid].y <= y) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found;
}

/**
 * @param {Object} deps
 * @param {Document} deps.document
 * @param {Window} deps.window
 * @param {(id: string) => void} deps.goTo   scroll to a heading
 */
export function createTocRail({ document, window, goTo }) {
    const root = document.createElement('nav');
    root.className = 'toc-rail';
    root.setAttribute('aria-label', 'Contents');
    root.hidden = true;
    document.body.appendChild(root);

    let entries = [];
    let boxBottom = Infinity;
    let narrow = false;
    let mode = readMode();
    let active = -2;
    let ticking = false;

    function readMode() {
        try { return window.localStorage.getItem(STORAGE_KEY) || 'ticks'; } catch { return 'ticks'; }
    }
    function writeMode(next) {
        mode = next;
        try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
        render();
    }

    function build() {
        root.textContent = '';
        const list = document.createElement('ol');
        list.className = 'toc-list';
        entries.forEach((entry, i) => {
            const item = document.createElement('li');
            item.className = `toc-item toc-l${entry.level}`;
            item.dataset.index = String(i);
            const link = document.createElement('a');
            link.href = `#${entry.id}`;
            link.dataset.jump = entry.id;
            link.title = entry.text;
            const tick = document.createElement('span');
            tick.className = 'toc-tick';
            const label = document.createElement('span');
            label.className = 'toc-label';
            label.textContent = `${entry.number}  ${entry.text}`;
            link.append(tick, label);
            link.addEventListener('click', (e) => { e.preventDefault(); goTo(entry.id); });
            item.appendChild(link);
            list.appendChild(item);
        });

        const controls = document.createElement('div');
        controls.className = 'toc-controls';
        const pin = document.createElement('button');
        pin.className = 'toc-pin';
        pin.type = 'button';
        pin.title = 'Keep the contents open';
        pin.textContent = '▤';
        pin.addEventListener('click', () => writeMode(mode === 'open' ? 'ticks' : 'open'));
        const hide = document.createElement('button');
        hide.className = 'toc-hide';
        hide.type = 'button';
        hide.title = 'Hide the contents';
        hide.textContent = '×';
        hide.addEventListener('click', () => writeMode('hidden'));
        controls.append(pin, hide);
        root.append(controls, list);
    }

    /** 0 while the contents box is on screen, 1 once it has scrolled away; fades the rail in between. */
    function progress() {
        if (entries.length === 0 || boxBottom === null) return 0;
        return Math.min(1, Math.max(0, (window.scrollY - (boxBottom - FADE_PX * 1.5)) / FADE_PX));
    }

    function render() {
        const p = progress();
        root.hidden = entries.length === 0;
        root.style.setProperty('--p', p.toFixed(3));
        root.classList.toggle('live', p > 0.15);
        root.dataset.mode = narrow ? (mode === 'open' ? 'open' : 'button') : mode;
        root.classList.toggle('narrow', narrow);
        if (p === 0) return;
        const index = currentSection(entries, window.scrollY + 120);
        if (index !== active) {
            active = index;
            for (const li of root.querySelectorAll('.toc-item')) {
                li.classList.toggle('current', Number(li.dataset.index) === index);
            }
        }
    }

    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        const run = () => { ticking = false; render(); };
        window.requestAnimationFrame ? window.requestAnimationFrame(run) : run();
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    const handle = document.createElement('button');
    handle.className = 'toc-handle';
    handle.type = 'button';
    handle.title = 'Contents';
    handle.textContent = '≡';
    handle.addEventListener('click', () => writeMode(mode === 'open' ? (narrow ? 'button' : 'ticks') : 'open'));
    root.appendChild(handle);

    return {
        /** Call after every layout. `tocRect` is the contents box on the page, or null if the page has none. */
        update({ outline, anchors, tocRect, isNarrow }) {
            narrow = isNarrow;
            entries = tocRect ? outline.filter(o => anchors.has(o.id)).map(o => ({ ...o, y: anchors.get(o.id).y })) : [];
            boxBottom = tocRect ? tocRect.y + tocRect.height : null;
            build();
            root.appendChild(handle);
            active = -2;
            render();
        },
        dispose() {
            window.removeEventListener('scroll', onScroll);
            root.remove();
        },
        get mode() { return mode; },
    };
}
