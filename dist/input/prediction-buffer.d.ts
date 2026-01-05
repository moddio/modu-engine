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
export interface PredictionFrame {
    /** The simulation frame this prediction was made for */
    frame: number;
    /** Command states at this frame (what we predicted) */
    commandStates: Record<string, boolean | {
        x: number;
        y: number;
    }>;
    /** Complete game state snapshot (for rollback) */
    snapshot: any;
    /** Sequence number of input sent to server */
    inputSeq: number;
}
export declare class PredictionBuffer {
    /** Ring buffer of prediction frames */
    private buffer;
    /** Maximum frames to store */
    private maxSize;
    /** Oldest frame number in buffer (for fast range checks) */
    private oldestFrame;
    /** Newest frame number in buffer */
    private newestFrame;
    /**
     * Create a prediction buffer.
     * @param maxSize - Maximum frames to store (default: 120 = 6 seconds at 20fps)
     */
    constructor(maxSize?: number);
    /**
     * Store a prediction frame.
     * Automatically discards old frames if buffer is full.
     */
    push(frame: PredictionFrame): void;
    /**
     * Get prediction for a specific frame.
     * @returns The prediction frame, or null if not found.
     */
    get(frame: number): PredictionFrame | null;
    /**
     * Discard all frames older than the specified frame.
     * Call this after server confirms inputs to free memory.
     */
    discardBefore(frame: number): void;
    /**
     * Get all frames from startFrame to endFrame (inclusive).
     * Used during resimulation after rollback.
     */
    getRange(startFrame: number, endFrame: number): PredictionFrame[];
    /**
     * Clear all predictions.
     * Call on disconnect or game reset.
     */
    clear(): void;
    /**
     * Get the number of stored frames.
     */
    get size(): number;
    /**
     * Check if buffer has data for a frame range.
     */
    hasRange(startFrame: number, endFrame: number): boolean;
    /**
     * Deep copy command states.
     */
    private deepCopyStates;
    /**
     * Deep copy any value (for snapshots).
     * Handles nested objects and arrays.
     */
    private deepCopy;
}
/**
 * Compute delta between two command states.
 * Returns only changed values.
 */
export declare function computeDelta(prev: Record<string, boolean | {
    x: number;
    y: number;
}> | null, curr: Record<string, boolean | {
    x: number;
    y: number;
}>): Record<string, boolean | {
    x: number;
    y: number;
} | null> | null;
/**
 * Apply delta to previous state to get new state.
 */
export declare function applyDelta(prev: Record<string, boolean | {
    x: number;
    y: number;
}>, delta: Record<string, boolean | {
    x: number;
    y: number;
} | null>): Record<string, boolean | {
    x: number;
    y: number;
}>;
