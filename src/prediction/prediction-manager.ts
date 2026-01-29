/**
 * Prediction Manager for Client-Side Prediction
 *
 * Orchestrates client-side prediction with rollback netcode:
 * - Manages local frame advancement independent of server
 * - Queues local inputs with delay offset
 * - Handles server tick confirmation and misprediction detection
 * - Executes rollback and resimulation when needed
 */

import { World, NetworkInput } from '../core/world';
import { RollbackBuffer, SparseSnapshot } from '../core/snapshot';
import { TimeSyncManager } from './time-sync';
import { InputHistory } from './input-history';
import { PredictionConfig, DEFAULT_PREDICTION_CONFIG, PredictionStats } from './types';

/**
 * Server input as received from network.
 */
export interface ServerInput {
    seq: number;
    clientId: string;
    data: any;
    frame?: number;
}

/**
 * PredictionManager orchestrates client-side prediction and rollback.
 *
 * The prediction flow:
 * 1. Local inputs are queued with inputDelayFrames offset
 * 2. advanceFrame() runs each tick: save state, collect inputs, simulate
 * 3. receiveServerTick() confirms inputs and detects mispredictions
 * 4. executeRollback() loads old state and resimulates with corrected inputs
 */
export class PredictionManager {
    /** Current predicted frame (ahead of server) */
    private _localFrame: number = 0;

    /** Last frame with all inputs confirmed by server */
    private _confirmedFrame: number = 0;

    /** Time synchronization manager */
    private timeSyncManager: TimeSyncManager;

    /** Input history for all clients */
    private inputHistory: InputHistory;

    /** Rollback buffer for state snapshots */
    private rollbackBuffer: RollbackBuffer;

    /** Prediction configuration */
    private config: PredictionConfig;

    /** Local client ID (numeric) */
    private localClientId: number = 0;

    /** Resolver function to convert string clientId to numeric ID (provided by Game) */
    private resolveClientId: ((clientId: string) => number) | null = null;

    /** Prediction statistics */
    private stats: PredictionStats = {
        rollbackCount: 0,
        framesResimulated: 0,
        avgRollbackDepth: 0,
        maxRollbackDepth: 0,
        currentPredictionDepth: 0
    };

    /** Whether prediction is currently enabled */
    private _enabled: boolean = false;

    /** Tick interval in milliseconds */
    private tickIntervalMs: number = 50;

    /** Reference to the world for simulation */
    private world: World;

    /** Callback to get inputs for simulation */
    private getInputsCallback: ((frame: number) => Map<number, Record<string, any>>) | null = null;

    /** Callback when rollback occurs */
    public onRollback: ((fromFrame: number, toFrame: number) => void) | null = null;

    constructor(
        world: World,
        config: Partial<PredictionConfig> = {}
    ) {
        this.world = world;
        this.config = { ...DEFAULT_PREDICTION_CONFIG, ...config };
        this.timeSyncManager = new TimeSyncManager();
        this.inputHistory = new InputHistory(this.config.maxRollbackFrames + 20);
        this.rollbackBuffer = new RollbackBuffer(this.config.maxRollbackFrames + 10);
    }

    /**
     * Enable prediction with optional config override.
     */
    enable(config?: Partial<PredictionConfig>): void {
        if (config) {
            this.config = { ...this.config, ...config };
        }
        this._enabled = true;
        this.config.enabled = true;
    }

    /**
     * Disable prediction.
     */
    disable(): void {
        this._enabled = false;
        this.config.enabled = false;
    }

    /**
     * Check if prediction is enabled.
     */
    get enabled(): boolean {
        return this._enabled && this.config.enabled;
    }

    /**
     * Get current local (predicted) frame.
     */
    get localFrame(): number {
        return this._localFrame;
    }

    /**
     * Get last confirmed frame.
     */
    get confirmedFrame(): number {
        return this._confirmedFrame;
    }

    /**
     * Get time sync manager for external access.
     */
    getTimeSyncManager(): TimeSyncManager {
        return this.timeSyncManager;
    }

    /**
     * Get prediction statistics.
     */
    getStats(): PredictionStats {
        this.stats.currentPredictionDepth = this._localFrame - this._confirmedFrame;
        return { ...this.stats };
    }

    /**
     * Set the function used to resolve string client IDs to numeric IDs.
     * This MUST use the same mapping as the Game/World to avoid ID mismatches.
     */
    setClientIdResolver(resolver: (clientId: string) => number): void {
        this.resolveClientId = resolver;
    }

    /**
     * Set local client ID (numeric, from Game's mapping).
     */
    setLocalClientId(numericId: number): void {
        this.localClientId = numericId;
        this.inputHistory.setLocalClientId(numericId);
    }

    /**
     * Set tick interval (for frame timing calculations).
     */
    setTickInterval(intervalMs: number): void {
        this.tickIntervalMs = intervalMs;
    }

    /**
     * Initialize prediction from a snapshot frame.
     * Call this after receiving INITIAL_STATE.
     */
    initialize(snapshotFrame: number, serverStartTime?: number): void {
        this._localFrame = snapshotFrame;
        this._confirmedFrame = snapshotFrame;

        if (serverStartTime) {
            this.timeSyncManager.setServerStartTime(serverStartTime);
        }

        // Reset state
        this.inputHistory.reset();
        this.stats = {
            rollbackCount: 0,
            framesResimulated: 0,
            avgRollbackDepth: 0,
            maxRollbackDepth: 0,
            currentPredictionDepth: 0
        };
    }

    /**
     * Resolve a string client ID to numeric using the Game's mapping.
     */
    private resolveId(clientId: string): number {
        if (!this.resolveClientId) {
            throw new Error('[CSP] No client ID resolver set');
        }
        return this.resolveClientId(clientId);
    }

    /**
     * Add a client to track for prediction (numeric ID from Game's mapping).
     */
    addClient(numericId: number): void {
        this.inputHistory.addClient(numericId);
    }

    /**
     * Remove a client from prediction tracking (numeric ID from Game's mapping).
     */
    removeClient(numericId: number): void {
        this.inputHistory.removeClient(numericId);
    }

    /**
     * Queue a local input with delay offset applied.
     *
     * The input will be applied at localFrame + inputDelayFrames.
     * This provides a buffer for network latency.
     */
    queueLocalInput(data: Record<string, any>): void {
        const targetFrame = this._localFrame + this.config.inputDelayFrames;
        this.inputHistory.storeLocalInput(targetFrame, this.localClientId, data);
    }

    /**
     * Advance one frame of prediction.
     *
     * This should be called at the tick rate (e.g., 20Hz).
     * Saves state before tick, collects inputs, runs simulation.
     */
    advanceFrame(): void {
        if (!this._enabled) return;

        // Check if we're too far ahead of confirmed frame
        const predictionDepth = this._localFrame - this._confirmedFrame;
        if (predictionDepth >= this.config.maxPredictionFrames) {
            // Wait for server to catch up
            return;
        }

        // Save state BEFORE tick for potential rollback
        // We save state at frame N-1 before running frame N
        const snapshot = this.world.getSparseSnapshot();
        this.rollbackBuffer.save(this._localFrame, snapshot);

        // Increment frame
        this._localFrame++;

        // Collect inputs for this frame
        const inputs = this.collectFrameInputs(this._localFrame);

        // Convert to NetworkInput format
        const networkInputs: NetworkInput[] = [];
        for (const [clientId, data] of inputs) {
            networkInputs.push({ clientId, data });
        }

        // Run deterministic tick
        this.world.tick(this._localFrame, networkInputs);
    }

    /**
     * Collect inputs for a frame (local confirmed + remote predicted).
     */
    private collectFrameInputs(frame: number): Map<number, Record<string, any>> {
        // Use callback if provided, otherwise use input history
        if (this.getInputsCallback) {
            return this.getInputsCallback(frame);
        }
        return this.inputHistory.getFrameInputs(frame);
    }

    /**
     * Set callback for collecting inputs.
     * This allows the Game class to provide inputs from its own tracking.
     */
    setInputsCallback(callback: (frame: number) => Map<number, Record<string, any>>): void {
        this.getInputsCallback = callback;
    }

    /**
     * Handle server tick with confirmed inputs.
     *
     * Confirms inputs from server, detects mispredictions,
     * and triggers rollback if needed.
     *
     * @returns true if rollback was executed
     */
    receiveServerTick(frame: number, serverInputs: ServerInput[]): boolean {
        if (!this._enabled) return false;

        let needsRollback = false;

        // Process each input from server
        for (const input of serverInputs) {
            // Skip non-game inputs (join, leave, etc.)
            if (input.data?.type === 'join' || input.data?.type === 'leave' ||
                input.data?.type === 'disconnect' || input.data?.type === 'reconnect') {
                continue;
            }

            const clientNum = this.resolveId(input.clientId);

            // Confirm input - returns true if prediction was wrong
            if (this.inputHistory.confirmInput(frame, clientNum, input.data)) {
                needsRollback = true;
            }
        }

        // Mark frame as confirmed
        this.inputHistory.markFrameConfirmed(frame);
        this._confirmedFrame = frame;

        // Execute rollback if we mispredicted and the frame has been simulated.
        // localFrame has already been ticked (advanceFrame increments then ticks),
        // so frame <= localFrame means we've simulated it with potentially wrong inputs.
        if (needsRollback && frame <= this._localFrame) {
            this.executeRollback(frame);
            return true;
        }

        return false;
    }

    /**
     * Execute rollback to a previous frame and resimulate forward.
     */
    executeRollback(toFrame: number): void {
        // Get snapshot from frame before the misprediction
        const snapshotFrame = toFrame - 1;
        const snapshot = this.rollbackBuffer.get(snapshotFrame);

        if (!snapshot) {
            console.warn(`[CSP] Cannot rollback to frame ${toFrame}: no snapshot for frame ${snapshotFrame}`);
            return;
        }

        // Track stats
        const framesToResim = this._localFrame - toFrame;
        this.stats.rollbackCount++;
        this.stats.framesResimulated += framesToResim;
        this.stats.avgRollbackDepth = this.stats.framesResimulated / this.stats.rollbackCount;
        if (framesToResim > this.stats.maxRollbackDepth) {
            this.stats.maxRollbackDepth = framesToResim;
        }

        // Notify callback
        if (this.onRollback) {
            this.onRollback(this._localFrame, toFrame);
        }

        // Load state from before misprediction
        this.world.loadSparseSnapshot(snapshot);

        // Resimulate from toFrame to localFrame with corrected inputs
        const targetFrame = this._localFrame;
        for (let f = toFrame; f <= targetFrame; f++) {
            // Collect corrected inputs (now confirmed where available)
            const inputs = this.collectFrameInputs(f);

            // Convert to NetworkInput format
            const networkInputs: NetworkInput[] = [];
            for (const [clientId, data] of inputs) {
                networkInputs.push({ clientId, data });
            }

            // Run tick
            this.world.tick(f, networkInputs);

            // Save corrected snapshot
            this.rollbackBuffer.save(f, this.world.getSparseSnapshot());
        }
    }

    /**
     * Get the adjusted tick interval based on drift correction.
     */
    getAdjustedTickInterval(): number {
        return this.tickIntervalMs * this.timeSyncManager.getTickRateMultiplier();
    }

    /**
     * Handle time sync response from server.
     */
    onTimeSync(sentTime: number, serverTime: number, receiveTime: number): void {
        this.timeSyncManager.onTimeResponse(sentTime, serverTime, receiveTime);
    }

    /**
     * Handle tick received for drift correction.
     */
    onTickReceived(): void {
        this.timeSyncManager.onTickReceived(this.tickIntervalMs);
    }

    /**
     * Check if time sync is complete.
     */
    isTimeSynced(): boolean {
        return this.timeSyncManager.isSynced();
    }

    /**
     * Check if we need more time sync samples.
     */
    needsMoreTimeSyncSamples(): boolean {
        return this.timeSyncManager.needsMoreSamples();
    }

    /**
     * Get estimated latency.
     */
    getEstimatedLatency(): number {
        return this.timeSyncManager.getEstimatedLatency();
    }

    /**
     * Calculate target frame based on server time.
     */
    getTargetFrame(): number {
        return this.timeSyncManager.getTargetFrame(this.tickIntervalMs);
    }

    /**
     * Reset all prediction state.
     */
    reset(): void {
        this._localFrame = 0;
        this._confirmedFrame = 0;
        this.inputHistory.reset();
        this.timeSyncManager.reset();
        this.stats = {
            rollbackCount: 0,
            framesResimulated: 0,
            avgRollbackDepth: 0,
            maxRollbackDepth: 0,
            currentPredictionDepth: 0
        };
    }
}
