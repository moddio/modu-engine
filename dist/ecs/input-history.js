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
 * Internal FrameInput implementation.
 */
class FrameInputImpl {
    constructor(frame) {
        this.frame = frame;
        this.inputs = new Map();
        this.confirmed = false;
    }
    /**
     * Get inputs sorted by clientId for deterministic iteration.
     */
    getSortedInputs() {
        const entries = Array.from(this.inputs.entries());
        // Sort by clientId (numeric) for determinism
        entries.sort((a, b) => a[0] - b[0]);
        return entries;
    }
}
/**
 * InputHistory stores inputs for resimulation during rollback.
 */
export class InputHistory {
    /**
     * Create InputHistory with optional max frame limit.
     * @param maxFrames Maximum frames to keep (default 120)
     */
    constructor(maxFrames = 120) {
        /** Stored frames: frame number -> FrameInput */
        this.history = new Map();
        this.maxFrames = maxFrames;
    }
    /**
     * Store input for a frame from a client.
     * Used for local predictions before server confirmation.
     *
     * @param frame Frame number
     * @param clientId Client ID (numeric)
     * @param input Input data
     */
    setInput(frame, clientId, input) {
        let frameInput = this.history.get(frame);
        if (!frameInput) {
            frameInput = new FrameInputImpl(frame);
            this.history.set(frame, frameInput);
        }
        frameInput.inputs.set(clientId, input);
    }
    /**
     * Mark a frame as server-confirmed with authoritative inputs.
     * This replaces any local predictions with server-provided data.
     *
     * @param frame Frame number
     * @param inputs Map of clientId -> input data from server
     */
    confirmFrame(frame, inputs) {
        // Create new frame or replace existing
        const frameInput = new FrameInputImpl(frame);
        frameInput.confirmed = true;
        // Copy all server inputs
        for (const [clientId, data] of inputs) {
            frameInput.inputs.set(clientId, data);
        }
        this.history.set(frame, frameInput);
    }
    /**
     * Get input data for a specific frame.
     *
     * @param frame Frame number
     * @returns FrameInput or undefined if not found
     */
    getFrame(frame) {
        return this.history.get(frame);
    }
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
    getRange(fromFrame, toFrame) {
        if (fromFrame > toFrame) {
            return [];
        }
        const result = [];
        // Collect all frames in range
        for (const [frame, frameInput] of this.history) {
            if (frame >= fromFrame && frame <= toFrame) {
                result.push(frameInput);
            }
        }
        // Sort by frame number for deterministic order
        result.sort((a, b) => a.frame - b.frame);
        return result;
    }
    /**
     * Remove frames before the specified frame number.
     * Called to limit memory usage.
     *
     * @param beforeFrame Remove all frames with frame < beforeFrame
     */
    prune(beforeFrame) {
        // Collect frames to remove (avoid modifying during iteration)
        const toRemove = [];
        for (const frame of this.history.keys()) {
            if (frame < beforeFrame) {
                toRemove.push(frame);
            }
        }
        // Remove collected frames
        for (const frame of toRemove) {
            this.history.delete(frame);
        }
    }
    /**
     * Serialize for snapshots (late joiner sync).
     * CRITICAL: Must produce identical output across all clients.
     *
     * @returns Serializable state object
     */
    getState() {
        const frames = [];
        // Sort frames by frame number for deterministic serialization
        const sortedFrames = Array.from(this.history.entries())
            .sort((a, b) => a[0] - b[0]);
        for (const [, frameInput] of sortedFrames) {
            // Sort inputs by clientId for deterministic serialization
            const sortedInputs = frameInput.getSortedInputs().map(([clientId, data]) => ({
                clientId,
                data
            }));
            frames.push({
                frame: frameInput.frame,
                inputs: sortedInputs,
                confirmed: frameInput.confirmed
            });
        }
        return { frames };
    }
    /**
     * Restore from serialized state (for late joiner sync).
     * Clears existing data before restoring.
     *
     * @param state Previously serialized state
     */
    setState(state) {
        // Clear existing data
        this.history.clear();
        // Restore frames
        for (const frameData of state.frames) {
            const frameInput = new FrameInputImpl(frameData.frame);
            frameInput.confirmed = frameData.confirmed;
            for (const { clientId, data } of frameData.inputs) {
                frameInput.inputs.set(clientId, data);
            }
            this.history.set(frameData.frame, frameInput);
        }
    }
    /**
     * Get the number of frames currently stored.
     * Useful for debugging and monitoring memory usage.
     */
    get size() {
        return this.history.size;
    }
    /**
     * Clear all stored history.
     */
    clear() {
        this.history.clear();
    }
}
