/**
 * The open page and everything that depends on it. One object, created once;
 * the modules in this folder read and write it through `app.state`.
 */

import { createStore } from '../runtime/store.js';

export function createState() {
    return {
        // the open page
        page: null,
        session: null,       // editable source of the page, or null when a message is shown
        fallbackDoc: null,   // message document shown when there is no session
        publicSource: '',    // text of the public file when the page is public and not yet a vault page
        vaultPage: null,     // { id, slug } when the page is kept in the vault
        manifest: null,

        // rendering
        layout: null,
        docEl: null,
        store: createStore(), // article variables of the open page
        liveStops: [],
        unbindVars: null,
        detachScrub: null,
        expandedNotes: new Set(),
        formValues: new Map(),
        timing: null,

        // editing
        editor: null,
        editing: null,
        sketching: false,
        canEdit: false,
        canSave: false,      // a dev server that accepts saves is answering
        lastSaved: '',
        saveStatus: '',
        scriptRan: false,
    };
}
