/**
 * Prediction Buffer
 *
 * Stores recent frame states for client-side prediction and rollback.
 * When server confirms inputs differ from predictions, we can:
 * 1. Load the snapshot from the confirmed frame
 * 2. Apply correct inputs
 * 3. Resimulate forward to current frame
 *
 * Uses a ring buffer to prevent unbounded memory growth.
 */
// ============================================
// Prediction Buffer
// ============================================
export class PredictionBuffer {
    /**
     * Create a prediction buffer.
     * @param maxSize - Maximum frames to store (default: 120 = 6 seconds at 20fps)
     */
    constructor(maxSize = 120) {
        /** Ring buffer of prediction frames */
        this.buffer = [];
        /** Oldest frame number in buffer (for fast range checks) */
        this.oldestFrame = 0;
        /** Newest frame number in buffer */
        this.newestFrame = -1;
        this.maxSize = maxSize;
    }
    /**
     * Store a prediction frame.
     * Automatically discards old frames if buffer is full.
     */
    push(frame) {
        // Deep copy snapshot to prevent mutation
        const entry = {
            frame: frame.frame,
            commandStates: this.deepCopyStates(frame.commandStates),
            snapshot: this.deepCopy(frame.snapshot),
            inputSeq: frame.inputSeq
        };
        // Add to buffer
        this.buffer.push(entry);
        // Update range tracking
        if (this.buffer.length === 1) {
            this.oldestFrame = frame.frame;
        }
        this.newestFrame = frame.frame;
        // Trim if over max size
        while (this.buffer.length > this.maxSize) {
            this.buffer.shift();
            this.oldestFrame = this.buffer.length > 0 ? this.buffer[0].frame : 0;
        }
    }
    /**
     * Get prediction for a specific frame.
     * @returns The prediction frame, or null if not found.
     */
    get(frame) {
        // Quick range check
        if (frame < this.oldestFrame || frame > this.newestFrame) {
            return null;
        }
        // Binary search (frames are in order)
        let lo = 0;
        let hi = this.buffer.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const midFrame = this.buffer[mid].frame;
            if (midFrame === frame) {
                return this.buffer[mid];
            }
            else if (midFrame < frame) {
                lo = mid + 1;
            }
            else {
                hi = mid - 1;
            }
        }
        return null;
    }
    /**
     * Discard all frames older than the specified frame.
     * Call this after server confirms inputs to free memory.
     */
    discardBefore(frame) {
        // Find first frame >= target
        let i = 0;
        while (i < this.buffer.length && this.buffer[i].frame < frame) {
            i++;
        }
        // Remove older frames
        if (i > 0) {
            this.buffer.splice(0, i);
            this.oldestFrame = this.buffer.length > 0 ? this.buffer[0].frame : 0;
        }
    }
    /**
     * Get all frames from startFrame to endFrame (inclusive).
     * Used during resimulation after rollback.
     */
    getRange(startFrame, endFrame) {
        return this.buffer.filter(f => f.frame >= startFrame && f.frame <= endFrame);
    }
    /**
     * Clear all predictions.
     * Call on disconnect or game reset.
     */
    clear() {
        this.buffer = [];
        this.oldestFrame = 0;
        this.newestFrame = -1;
    }
    /**
     * Get the number of stored frames.
     */
    get size() {
        return this.buffer.length;
    }
    /**
     * Check if buffer has data for a frame range.
     */
    hasRange(startFrame, endFrame) {
        return startFrame >= this.oldestFrame && endFrame <= this.newestFrame;
    }
    /**
     * Deep copy command states.
     */
    deepCopyStates(states) {
        const result = {};
        for (const [key, value] of Object.entries(states)) {
            if (typeof value === 'object') {
                result[key] = { x: value.x, y: value.y };
            }
            else {
                result[key] = value;
            }
        }
        return result;
    }
    /**
     * Deep copy any value (for snapshots).
     * Handles nested objects and arrays.
     */
    deepCopy(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value !== 'object') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map(item => this.deepCopy(item));
        }
        if (value instanceof Map) {
            const result = new Map();
            for (const [k, v] of value) {
                result.set(k, this.deepCopy(v));
            }
            return result;
        }
        if (value instanceof Set) {
            const result = new Set();
            for (const v of value) {
                result.add(this.deepCopy(v));
            }
            return result;
        }
        // Plain object
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = this.deepCopy(v);
        }
        return result;
    }
}
// ============================================
// Delta Encoding for Network
// ============================================
/**
 * Compute delta between two command states.
 * Returns only changed values.
 */
export function computeDelta(prev, curr) {
    if (!prev) {
        // No previous state - send everything
        return curr;
    }
    const delta = {};
    let hasChanges = false;
    // Check for changes
    for (const [key, currValue] of Object.entries(curr)) {
        const prevValue = prev[key];
        if (typeof currValue === 'object') {
            // Position comparison
            const prevPos = prevValue;
            if (!prevPos || prevPos.x !== currValue.x || prevPos.y !== currValue.y) {
                delta[key] = currValue;
                hasChanges = true;
            }
        }
        else {
            // Boolean comparison
            if (prevValue !== currValue) {
                delta[key] = currValue;
                hasChanges = true;
            }
        }
    }
    // Check for removed commands (in prev but not in curr)
    for (const key of Object.keys(prev)) {
        if (!(key in curr)) {
            delta[key] = null; // Indicates removed
            hasChanges = true;
        }
    }
    return hasChanges ? delta : null;
}
/**
 * Apply delta to previous state to get new state.
 */
export function applyDelta(prev, delta) {
    const result = { ...prev };
    for (const [key, value] of Object.entries(delta)) {
        if (value === null) {
            // Remove
            delete result[key];
        }
        else if (typeof value === 'object') {
            // Position - copy to avoid mutation
            result[key] = { x: value.x, y: value.y };
        }
        else {
            // Boolean
            result[key] = value;
        }
    }
    return result;
}
