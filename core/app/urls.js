/**
 * Where things live: asset paths, photograph variants, and which page an
 * address points at.
 */

export const HOME_PAGE = 'menu';

export const assetUrl = (path) => (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('/') ? path : `/${path}`);

/** Photographs have web-sized copies in images/photography/web/; pages show those and link to the original. */
const WEB_VARIANT = /^\/?images\/photography\/(?!web\/)([^/]+)\.[A-Za-z0-9]+$/;
export const displayUrl = (path) => {
    const m = WEB_VARIANT.exec(path);
    return m ? `/images/photography/web/${m[1]}.jpg` : assetUrl(path);
};

const argOf = (node, key) => node.args?.items.find(a => a.key === key)?.value;
const positional = (node) => node.args?.items.find(a => a.key === null)?.value;

/** Source path of an image node or directive. */
export function imageSrc(node) {
    if (node.type === 'image') return node.src;
    return positional(node) ?? argOf(node, 'src') ?? '';
}

/** True for `[[drawing(file.svg)]]`; false for strokes drawn inline. */
export const hasDrawingSource = (node) => !!(positional(node) ?? argOf(node, 'src'));
export const drawingUrl = (node) => assetUrl(positional(node) ?? argOf(node, 'src') ?? '');

/**
 * Page and anchor an address points at: ?page=, the older #/page/heading
 * and /page forms, else the home page.
 * @param {{ search: string, hash: string, pathname: string }} location
 */
export function routeFromLocation({ search, hash, pathname }) {
    const named = new URLSearchParams(search).get('page');
    if (named) return { page: named, hash };
    const legacy = /^#\/(?:c\/)?([^/]+)(?:\/(.+))?$/.exec(decodeURIComponent(hash));
    if (legacy) return { page: legacy[1], hash: legacy[2] ? `#${legacy[2]}` : '' };
    const path = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, ''));
    if (path && !path.includes('.')) return { page: path, hash };
    return { page: HOME_PAGE, hash };
}

/**
 * Where a page lives: a path (`/lab/`), which is what a shared link or a search result points at, so the page comes with
 * its title and preview. Private pages (`~id`) have no page of their own and keep the query form.
 */
export function pageUrl(page, hash = '') {
    if (page.startsWith('~')) return `/?page=${encodeURIComponent(page)}${hash}`;
    if (page === HOME_PAGE) return `/${hash}`;
    return `/${page.split('/').map(encodeURIComponent).join('/')}/${hash}`;
}
