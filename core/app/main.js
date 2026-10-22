/**
 * Entry point: builds the services, installs the features, and opens the page
 * the address points at.
 *
 * `app` is the registry the modules share. Each one gets it at creation and
 * calls the others through it (`app.view`, `app.pages`, ...), so none imports
 * another and the order they are created in is the only coupling.
 */

import { loadFonts, createMathService, createImageSizes, createSvgAssets } from '../render/browser.js';
import { createCanvasMeasurer } from '../text/measure.js';
import { createSelection } from '../edit/selection.js';
import { createInserter } from '../edit/insert.js';
import { createNoteMover } from '../edit/move.js';
import { createHoverOutline } from '../edit/outline.js';
import { createHover } from '../edit/hover.js';
import { createPrefs } from '../edit/prefs.js';
import { createSnapOverlay } from '../edit/snap-overlay.js';
import { createSnapper } from '../edit/snapper.js';
import { createToolbar } from '../edit/toolbar.js';
import { installKeys } from '../edit/keys.js';
import { createState } from './state.js';
import { createSettings } from './settings.js';
import { createNavigation } from './navigation.js';
import { createEnv } from './env.js';
import { createWidgets } from './widgets.js';
import { createView } from './view.js';
import { createPages } from './pages.js';
import { createSaver } from './saver.js';
import { createChrome } from './chrome.js';
import { createSketchEditing } from './sketch-edit.js';
import { createLightbox } from './lightbox.js';
import { createPersonal } from './personal.js';
import { createVaultBridge } from './vault-bridge.js';
import { installInteractions } from './interactions.js';
import { installPrint } from './print.js';
import { showToast } from './toast.js';
import { routeFromLocation } from './urls.js';
import '../figures/index.js';

const root = document.getElementById('root');
const state = createState();
const settings = createSettings({ document, storage: localStorage, prefersDark: matchMedia('(prefers-color-scheme: dark)').matches });

/** @type {Record<string, any>} */
const app = { document, window, root, state, settings, persist: new Map() };

app.measurer = createCanvasMeasurer();
app.math = createMathService({ document, katex: window.katex, fontSize: settings.values.fontSize });
app.images = createImageSizes(() => app.view.relayout());
app.drawings = createSvgAssets(() => app.view.relayout());

// backstage reaches the rest of the app only through callbacks, so it can be made first
app.personal = createPersonal({
    toast: (text) => showToast(document, text),
    openPage: (name) => app.pages.open(name),
    onChange: (event) => app.vault.onChange(event),
});

app.prefs = createPrefs(localStorage);
app.nav = createNavigation(app);
app.view = createView(app);
app.env = createEnv(app);
app.widgets = createWidgets(app);
app.saver = createSaver(app);
app.chrome = createChrome(app);
app.sketching = createSketchEditing(app);
app.lightbox = createLightbox({ document, images: () => [...root.querySelectorAll('img[data-full]')] });

app.vault = createVaultBridge(app);
app.pages = createPages(app);

// a change to text size or margin width needs a new layout; the theme is only a stylesheet switch
settings.subscribe((key) => { if (key !== 'theme') app.view.relayout(); });

installInteractions(app);
app.print = installPrint(app);
app.vault.watchPageLifecycle();

app.snapper = createSnapper({
    getLayout: () => state.layout,
    prefs: app.prefs,
    overlay: createSnapOverlay({ document, window }),
});
app.selection = createSelection({
    document, root, snapper: app.snapper,
    getSession: () => state.session,
    getLayout: () => state.layout,
    textWidth: () => state.layout?.geometry.text.width ?? 600,
    onEdited: () => app.saver.scheduleSave(),
    openSource: (start, end) => state.editor?.open(start, end),
});
app.hover = createHover({ document, root, active: () => document.body.classList.contains('editing') });
app.hoverOutline = createHoverOutline({ document, getLayout: () => state.layout, hover: app.hover });
createNoteMover({
    document, hover: app.hover, snapper: app.snapper,
    getSession: () => state.session,
    getLayout: () => state.layout,
    onEdited: () => app.saver.scheduleSave(),
});
app.inserter = createInserter({
    document, hover: app.hover,
    getSession: () => state.session,
    onInserted: (range) => state.editor?.open(range.start, range.end),
});

app.toolbar = createToolbar({
    document, prefs: app.prefs,
    getSession: () => state.session,
    onUndo: () => { state.editor?.close(); state.session?.undo(); app.saver.scheduleSave(); },
    onRedo: () => { state.editor?.close(); state.session?.redo(); app.saver.scheduleSave(); },
});
installKeys({ document, active: () => document.body.classList.contains('editing'), selection: app.selection });

// Leaving the editor leaves nothing of it behind.
let wasEditing = false;
new MutationObserver(() => {
    const editing = document.body.classList.contains('editing');
    if (editing === wasEditing) return;
    wasEditing = editing;
    app.toolbar.refresh();
    if (editing) return;
    app.selection.clear();
    app.hoverOutline.clear();
    app.inserter.hide();
    state.editor?.close();
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

async function start() {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'light' || theme === 'dark') settings.preview('theme', theme);
    settings.applyTheme();
    await Promise.all([loadFonts(document, undefined, { katex: !!window.katex }), app.pages.fetchManifest(), app.saver.probeDevServer()]);
    document.fonts.addEventListener('loadingdone', () => { app.math.invalidate(); app.view.relayout(); });
    app.saver.watchFile();
    const route = routeFromLocation(location);
    await app.pages.open(route.page, { push: false, hash: route.hash });
    app.personal.restore();
}

window.__v2 = { state, relayout: () => app.view.relayout(), openPage: (...a) => app.pages.open(...a), personal: app.personal, app };
start();
