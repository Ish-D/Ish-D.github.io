/**
 * Line slots: the free line boxes a paragraph can use, in reading order.
 *
 * A column is cut into bands one line high. Each band yields one slot per free
 * interval left after subtracting wrapped shapes, so text can run on both sides
 * of an obstacle. When a column runs out of bands, reading continues in the
 * next column.
 */

import { blockedOver, freeIntervals } from './geometry.js';

/** A column with this many consecutive blocked bands is treated as exhausted. */
const MAX_EMPTY_BANDS = 5000;

/**
 * @typedef {Object} Column
 * @property {number} x
 * @property {number} width
 * @property {number} top
 * @property {number} bottom      Infinity for an open-ended column
 */

/**
 * @typedef {Object} Slot
 * @property {number} x
 * @property {number} y           top of the line box
 * @property {number} width
 * @property {number} column
 */

/**
 * @param {Object} config
 * @param {Column[]} config.columns
 * @param {number} config.lineHeight
 * @param {import('./geometry.js').Shape[]} [config.shapes]    read live: shapes added later affect later bands
 * @param {number} [config.minSlot]      free intervals narrower than this are skipped
 * @param {number} [config.grid]         if set, band tops are rounded up to multiples of this from the column top
 */
export function createSlotCursor({ columns, lineHeight, shapes = [], minSlot = 0, grid = 0 }) {
    let col = 0;
    let y = columns[0].top;
    let pending = [];
    let emptyBands = 0;

    const snap = (c, value) => {
        if (!grid) return value;
        const steps = Math.ceil((value - columns[c].top) / grid - 1e-9);
        return columns[c].top + Math.max(0, steps) * grid;
    };

    return {
        /** Moves to the first band in column `c` whose top is at or below `at`. */
        seek(c, at) {
            col = c;
            y = snap(c, at);
            pending = [];
            emptyBands = 0;
        },

        /** @returns {Slot | null} null once every column is exhausted */
        next() {
            for (;;) {
                if (pending.length) return pending.shift();
                if (col >= columns.length) return null;
                const c = columns[col];
                if (y + lineHeight > c.bottom + 1e-6 || emptyBands > MAX_EMPTY_BANDS) {
                    col++;
                    emptyBands = 0;
                    if (col >= columns.length) return null;
                    y = snap(col, columns[col].top);
                    continue;
                }
                const bandTop = y;
                y += lineHeight;
                const blocked = blockedOver(shapes, bandTop, bandTop + lineHeight, c.x, c.x + c.width);
                const free = freeIntervals(c.x, c.x + c.width, blocked, Math.min(minSlot, c.width));
                emptyBands = free.length === 0 ? emptyBands + 1 : 0;
                for (const [a, b] of free) pending.push({ x: a, width: b - a, y: bandTop, column: col });
            }
        },

        save() { return { col, y, pending: pending.slice() }; },
        restore(state) { col = state.col; y = state.y; pending = state.pending.slice(); },
    };
}

/**
 * Lazily materialized slots for one paragraph, with the width lookup the
 * line breaker needs. Lines past the available slots reuse the last width.
 * @param {ReturnType<typeof createSlotCursor>} cursor
 * @param {Column[]} [columns]   lets `edges` tell which sides of a slot are the edges of its column
 */
export function slotStream(cursor, columns) {
    const slots = [];
    let done = false;

    const fill = (index) => {
        while (!done && slots.length <= index) {
            const s = cursor.next();
            if (!s) done = true;
            else slots.push(s);
        }
    };

    return {
        slots,
        /** The widest column the paragraph can be set in, when nothing is in the way. */
        measure: columns?.length ? Math.max(...columns.map(c => c.width)) : undefined,
        get(index) { fill(index); return slots[index] ?? null; },
        width(index) {
            fill(index);
            const s = slots[index] ?? slots[slots.length - 1];
            return s ? s.width : 0;
        },
        /** Whether the slot of line `index` starts at the left edge of its column, and ends at the right edge. */
        edges(index) {
            fill(index);
            const s = slots[index] ?? slots[slots.length - 1];
            const c = s && columns?.[s.column];
            if (!c) return { left: true, right: true };
            return { left: Math.abs(s.x - c.x) < 0.5, right: Math.abs(s.x + s.width - (c.x + c.width)) < 0.5 };
        },
        get exhausted() { return done; },
    };
}
