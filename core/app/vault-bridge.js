/**
 * Connects backstage to the page: save status, unlocking and locking,
 * changes that arrive from another device, and flushing when the tab leaves.
 */

const SAVE_TEXT = { saved: 'saved', pending: 'unsaved', saving: 'saving…', offline: 'offline, will retry' };

export function createVaultBridge(app) {
    const { state, personal } = app;

    /** Handler for events from the backstage store. */
    function onChange(event) {
        switch (event.type) {
            case 'status':
                if (state.vaultPage) app.saver.setStatus(event.state === 'error' ? (event.message || 'could not save') : SAVE_TEXT[event.state]);
                break;
            case 'unlocked':
            case 'locked':
                state.canEdit = state.canSave || personal.unlocked || new URLSearchParams(location.search).has('edit');
                if (!personal.unlocked) state.editor?.setEnabled(false);
                // a draft may exist for the page on screen, and a private page may now be readable
                if (state.page && (state.page.startsWith('~') || personal.unlocked)) app.pages.open(state.page, { push: false, keepScroll: true });
                else app.chrome.build();
                break;
            case 'merged':
            case 'conflict':
                if (event.id === state.vaultPage?.id) state.session?.reset(event.text);
                break;
        }
    }

    function watchPageLifecycle() {
        document.addEventListener('visibilitychange', async () => {
            if (!personal.unlocked) return;
            if (document.hidden) {
                personal.store.flush().catch(() => {});
            } else if (state.vaultPage && !state.editor?.active) {
                const fresh = await personal.store.refresh(state.vaultPage.id).catch(() => null);
                if (fresh && fresh.text !== state.session?.source) state.session.reset(fresh.text);
            }
        });
        addEventListener('pagehide', () => personal.store?.flush().catch(() => {}));
        addEventListener('online', () => personal.store?.retry().catch(() => {}));
    }

    return { onChange, watchPageLifecycle };
}
