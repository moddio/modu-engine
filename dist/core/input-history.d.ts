/**
 * InputHistory - Stores confirmed server inputs for rollback resimulation
 *
 * This class is CRITICAL for determinism in rollback netcode. It stores all
 * inputs (both predictions and server-confirmed) so that resimulation can
 * replay the exact same sequence of inputs after a rollback.
 *
 * Key guarantees:
 * 1. Inputs are stored per-frame with deterministic iteration order (sorted by clientId)
 * 2. Server-confirmed inputs replace any local predictions
 * 3. Serialization produces bit-exact snapshots for late joiners
 * 4. Memory is bounded by maxFrames through pruning
 */
/**
 * Input data for a single frame, containing all client inputs.
 */
export interface FrameInput {
    /** The frame number */
    frame: number;
    /** Client inputs for this frame (clientId -> input data) */
    inputs: Map<number, Record<string, any>>;
    /** Whether this frame has been confirmed by the server */
    confirmed: boolean;
    /**
     * Get inputs in deterministic (sorted) order for resimulation.
     * CRITICAL: Iteration order must be identical across all clients.
     */
    getSortedInputs(): Array<[number, Record<string, any>]>;
}
/**
 * Serialized state for snapshots.
 */
export interface InputHistoryState {
    frames: Array<{
        frame: number;
        inputs: Array<{
            clientId: number;
            data: Record<string, any>;
        }>;
        confirmed: boolean;
    }>;
}
/**
 * InputHistory stores inputs for resimulation during rollback.
 */
export declare class InputHistory {
    /** Stored frames: frame number -> FrameInput */
    private history;
    /** Maximum frames to keep (for memory management) */
    private maxFrames;
    /**
     * Create InputHistory with optional max frame limit.
     * @param maxFrames Maximum frames to keep (default 120)
     */
    constructor(maxFrames?: number);
    /**
     * Store input for a frame from a client.
     * Used for local predictions before server confirmation.
     *
     * @param frame Frame number
     * @param clientId Client ID (numeric)
     * @param input Input data
     */
    setInput(frame: number, clientId: number, input: Record<string, any>): void;
    /**
     * Mark a frame as server-confirmed with authoritative inputs.
     * This replaces any local predictions with server-provided data.
     *
     * @param frame Frame number
     * @param inputs Map of clientId -> input data from server
     */
    confirmFrame(frame: number, inputs: Map<number, Record<string, any>>): void;
    /**
     * Get input data for a specific frame.
     *
     * @param frame Frame number
     * @returns FrameInput or undefined if not found
     */
    getFrame(frame: number): FrameInput | undefined;
    /**
     * Get ordered frames for resimulation.
     * Returns frames in ascending order, skipping any missing frames.
     *
     * CRITICAL: Order must be deterministic for rollback to work.
     *
     * @param fromFrame Start frame (inclusive)
     * @param toFrame End frame (inclusive)
     * @returns Array of FrameInput in ascending frame order
     */
    getRange(fromFrame: number, toFrame: number): FrameInput[];
    /**
     * Remove frames before the specified frame number.
     * Called to limit memory usage.
     *
     * @param beforeFrame Remove all frames with frame < beforeFrame
     */
    prune(beforeFrame: number): void;
    /**
     * Serialize for snapshots (late joiner sync).
     * CRITICAL: Must produce identical output across all clients.
     *
     * @returns Serializable state object
     */
    getState(): InputHistoryState;
    /**
     * Restore from serialized state (for late joiner sync).
     * Clears existing data before restoring.
     *
     * @param state Previously serialized state
     */
    setState(state: InputHistoryState): void;
    /**
     * Get the number of frames currently stored.
     * Useful for debugging and monitoring memory usage.
     */
    get size(): number;
    /**
     * Clear all stored history.
     */
    clear(): void;
}
