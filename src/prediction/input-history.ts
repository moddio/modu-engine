/**
 * Input History for Client-Side Prediction
 *
 * Stores input history for all clients indexed by frame. Used for:
 * - Storing local inputs with delay offset
 * - Confirming server inputs and detecting mispredictions
 * - Predicting remote inputs using repeat-last strategy
 * - Providing inputs for rollback resimulation
 */

import { FrameInput, FrameInputSet, PredictionConfig, DEFAULT_PREDICTION_CONFIG } from './types';

/**
 * Default history buffer size (frames to keep).
 * Should be larger than maxRollbackFrames + some buffer.
 */
const DEFAULT_HISTORY_SIZE = 64;

/**
 * InputHistory manages input state for all clients across frames.
 *
 * Key features:
 * - Circular buffer storage for memory efficiency
 * - Tracks confirmed vs predicted inputs
 * - Detects mispredictions when server confirms inputs
 * - Provides repeat-last prediction for missing remote inputs
 */
export class InputHistory {
    /** Circular buffer of frame input sets */
    private buffer: (FrameInputSet | null)[];

    /** Buffer size (number of frames to keep) */
    private bufferSize: number;

    /** Oldest frame in the buffer */
    private oldestFrame: number = 0;

    /** Newest frame in the buffer */
    private newestFrame: number = -1;

    /** Last known input for each client (for repeat-last prediction) */
    private lastKnownInputs: Map<number, Record<string, any>> = new Map();

    /** Set of active client IDs (for knowing who to predict) */
    private activeClients: Set<number> = new Set();

    /** Local client ID */
    private localClientId: number = 0;

    constructor(bufferSize: number = DEFAULT_HISTORY_SIZE) {
        this.bufferSize = bufferSize;
        this.buffer = new Array(bufferSize).fill(null);
    }

    /**
     * Set the local client ID.
     */
    setLocalClientId(clientId: number): void {
        this.localClientId = clientId;
        this.activeClients.add(clientId);
    }

    /**
     * Add a client to the active set.
     */
    addClient(clientId: number): void {
        this.activeClients.add(clientId);
    }

    /**
     * Remove a client from the active set.
     */
    removeClient(clientId: number): void {
        this.activeClients.delete(clientId);
        this.lastKnownInputs.delete(clientId);
    }

    /**
     * Get the buffer index for a frame.
     */
    private getIndex(frame: number): number {
        return frame % this.bufferSize;
    }

    /**
     * Get or create a FrameInputSet for a frame.
     */
    private getOrCreateFrameSet(frame: number): FrameInputSet {
        const index = this.getIndex(frame);
        let frameSet = this.buffer[index];

        if (!frameSet || frameSet.frame !== frame) {
            // Create new frame set (overwrites old data in circular buffer)
            frameSet = {
                frame,
                inputs: new Map(),
                fullyConfirmed: false
            };
            this.buffer[index] = frameSet;
        }

        // Update frame tracking
        if (frame > this.newestFrame) {
            this.newestFrame = frame;
        }
        if (this.oldestFrame === 0 || frame < this.oldestFrame) {
            this.oldestFrame = frame;
        }

        return frameSet;
    }

    /**
     * Get the FrameInputSet for a frame (if it exists).
     */
    private getFrameSet(frame: number): FrameInputSet | null {
        const index = this.getIndex(frame);
        const frameSet = this.buffer[index];
        if (frameSet && frameSet.frame === frame) {
            return frameSet;
        }
        return null;
    }

    /**
     * Store a local input for a future frame (with delay offset applied).
     *
     * @param frame - Target frame for the input (after delay)
     * @param clientId - Local client ID
     * @param data - Input data
     */
    storeLocalInput(frame: number, clientId: number, data: Record<string, any>): void {
        const frameSet = this.getOrCreateFrameSet(frame);

        frameSet.inputs.set(clientId, {
            clientId,
            data,
            confirmed: true  // Local inputs are immediately "confirmed" (we know what we sent)
        });

        // Update last known input for this client
        this.lastKnownInputs.set(clientId, data);
    }

    /**
     * Store a predicted input for a remote client.
     *
     * @param frame - Frame for the prediction
     * @param clientId - Remote client ID
     * @param data - Predicted input data
     */
    storePredictedInput(frame: number, clientId: number, data: Record<string, any>): void {
        const frameSet = this.getOrCreateFrameSet(frame);

        // Don't overwrite confirmed inputs
        const existing = frameSet.inputs.get(clientId);
        if (existing && existing.confirmed) {
            return;
        }

        frameSet.inputs.set(clientId, {
            clientId,
            data,
            confirmed: false
        });
    }

    /**
     * Confirm an input from the server.
     * Returns true if the confirmed input differs from the prediction (misprediction).
     *
     * @param frame - Frame the input applies to
     * @param clientId - Client who sent the input
     * @param data - Confirmed input data from server
     * @returns true if this was a misprediction, false if prediction was correct
     */
    confirmInput(frame: number, clientId: number, data: Record<string, any>): boolean {
        const frameSet = this.getOrCreateFrameSet(frame);
        const existing = frameSet.inputs.get(clientId);

        // Update last known input for this client
        this.lastKnownInputs.set(clientId, data);

        // Store confirmed input
        frameSet.inputs.set(clientId, {
            clientId,
            data,
            confirmed: true
        });

        // Check for misprediction
        if (existing && !existing.confirmed) {
            // Had a prediction - compare with confirmed data
            return !this.inputsEqual(existing.data, data);
        }

        // No prediction existed - not a misprediction (though this is unusual)
        return false;
    }

    /**
     * Compare two input data objects for equality.
     */
    private inputsEqual(a: Record<string, any>, b: Record<string, any>): boolean {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) {
            return false;
        }

        for (const key of keysA) {
            if (a[key] !== b[key]) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get predicted input for a client at a frame using repeat-last strategy.
     *
     * @param frame - Frame to predict for
     * @param clientId - Client to predict for
     * @returns Predicted input data
     */
    getPredictedInput(frame: number, clientId: number): Record<string, any> {
        // First check if we already have an input for this frame
        const frameSet = this.getFrameSet(frame);
        if (frameSet) {
            const input = frameSet.inputs.get(clientId);
            if (input) {
                return input.data;
            }
        }

        // Use repeat-last strategy: return last known input for this client
        const lastKnown = this.lastKnownInputs.get(clientId);
        if (lastKnown) {
            return lastKnown;
        }

        // No history - return empty input
        return {};
    }

    /**
     * Get all inputs for a frame (for simulation).
     * Fills in predictions for any missing clients.
     *
     * @param frame - Frame to get inputs for
     * @returns Map of clientId to input data
     */
    getFrameInputs(frame: number): Map<number, Record<string, any>> {
        const result = new Map<number, Record<string, any>>();
        const frameSet = this.getFrameSet(frame);

        // Add all existing inputs
        if (frameSet) {
            for (const [clientId, input] of frameSet.inputs) {
                result.set(clientId, input.data);
            }
        }

        // Fill in predictions for missing active clients
        for (const clientId of this.activeClients) {
            if (!result.has(clientId)) {
                result.set(clientId, this.getPredictedInput(frame, clientId));
            }
        }

        return result;
    }

    /**
     * Get the oldest frame that has unconfirmed inputs.
     * Returns -1 if all inputs are confirmed.
     */
    getOldestUnconfirmedFrame(): number {
        for (let frame = this.oldestFrame; frame <= this.newestFrame; frame++) {
            const frameSet = this.getFrameSet(frame);
            if (frameSet && !frameSet.fullyConfirmed) {
                // Check if any input is unconfirmed
                for (const input of frameSet.inputs.values()) {
                    if (!input.confirmed) {
                        return frame;
                    }
                }
            }
        }
        return -1;
    }

    /**
     * Mark a frame as fully confirmed (all inputs received from server).
     */
    markFrameConfirmed(frame: number): void {
        const frameSet = this.getFrameSet(frame);
        if (frameSet) {
            frameSet.fullyConfirmed = true;
        }
    }

    /**
     * Check if a frame has all inputs confirmed.
     */
    isFrameConfirmed(frame: number): boolean {
        const frameSet = this.getFrameSet(frame);
        if (!frameSet) {
            return false;
        }

        if (frameSet.fullyConfirmed) {
            return true;
        }

        // Check all inputs
        for (const input of frameSet.inputs.values()) {
            if (!input.confirmed) {
                return false;
            }
        }

        return true;
    }

    /**
     * Clear history for frames older than the given frame.
     * Call this after confirmed frames are no longer needed for rollback.
     */
    clearOldFrames(beforeFrame: number): void {
        for (let frame = this.oldestFrame; frame < beforeFrame; frame++) {
            const index = this.getIndex(frame);
            if (this.buffer[index]?.frame === frame) {
                this.buffer[index] = null;
            }
        }
        this.oldestFrame = beforeFrame;
    }

    /**
     * Get the newest frame in history.
     */
    getNewestFrame(): number {
        return this.newestFrame;
    }

    /**
     * Get the oldest frame in history.
     */
    getOldestFrame(): number {
        return this.oldestFrame;
    }

    /**
     * Get active client IDs.
     */
    getActiveClients(): Set<number> {
        return new Set(this.activeClients);
    }

    /**
     * Check if we have any input for a client at a frame.
     */
    hasInput(frame: number, clientId: number): boolean {
        const frameSet = this.getFrameSet(frame);
        return frameSet !== null && frameSet.inputs.has(clientId);
    }

    /**
     * Check if an input is confirmed.
     */
    isInputConfirmed(frame: number, clientId: number): boolean {
        const frameSet = this.getFrameSet(frame);
        if (!frameSet) return false;
        const input = frameSet.inputs.get(clientId);
        return input?.confirmed ?? false;
    }

    /**
     * Reset all state.
     */
    reset(): void {
        this.buffer = new Array(this.bufferSize).fill(null);
        this.oldestFrame = 0;
        this.newestFrame = -1;
        this.lastKnownInputs.clear();
        this.activeClients.clear();
        if (this.localClientId) {
            this.activeClients.add(this.localClientId);
        }
    }

    /**
     * Get debug info about the input history state.
     */
    getDebugInfo(): {
        oldestFrame: number;
        newestFrame: number;
        activeClients: number;
        framesWithData: number;
    } {
        let framesWithData = 0;
        for (const frameSet of this.buffer) {
            if (frameSet !== null) {
                framesWithData++;
            }
        }

        return {
            oldestFrame: this.oldestFrame,
            newestFrame: this.newestFrame,
            activeClients: this.activeClients.size,
            framesWithData
        };
    }
}
