/**
 * Small async key-value stores for the vault's local cache: encrypted blobs
 * and writes that have not reached GitHub yet.
 */

/** In-memory store; also the interface the others follow. */
export function createMemoryKV() {
    const map = new Map();
    return {
        async get(key) { return map.get(key); },
        async set(key, value) { map.set(key, value); },
        async delete(key) { map.delete(key); },
        async keys(prefix = '') { return [...map.keys()].filter(k => k.startsWith(prefix)); },
    };
}

/** IndexedDB-backed store. Values may be anything structured-clone accepts, including CryptoKey. */
export function createIdbKV(name = 'v2-vault', factory = globalThis.indexedDB) {
    let opened = null;
    const open = () => opened ??= new Promise((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('kv');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    async function run(mode, action) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('kv', mode);
            const request = action(tx.objectStore('kv'));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    return {
        get: (key) => run('readonly', s => s.get(key)),
        set: (key, value) => run('readwrite', s => s.put(value, key)),
        delete: (key) => run('readwrite', s => s.delete(key)),
        async keys(prefix = '') {
            const all = await run('readonly', s => s.getAllKeys());
            return all.filter(k => typeof k === 'string' && k.startsWith(prefix));
        },
    };
}
