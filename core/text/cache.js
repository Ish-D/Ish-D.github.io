/**
 * Bounded memo with O(1) eviction: entries live in two generations of up to `limit / 2` each.
 * When the current generation fills it becomes the old one and the previous old one is dropped;
 * a hit in the old generation is copied forward.
 * @template K, V
 * @param {number} limit max distinct entries kept
 * @returns {{ get(key: K): V | undefined, set(key: K, value: V): void }}
 */
export function createBoundedCache(limit) {
    if (!(limit >= 2)) throw new RangeError(`Cache limit must be >= 2, got ${limit}`);
    const generationSize = Math.floor(limit / 2);
    let current = new Map();
    let previous = new Map();

    function set(key, value) {
        if (current.size >= generationSize) {
            previous = current;
            current = new Map();
        }
        current.set(key, value);
    }

    return {
        get(key) {
            const value = current.get(key);
            if (value !== undefined) return value;
            const old = previous.get(key);
            if (old !== undefined) set(key, old);
            return old;
        },
        set,
    };
}
