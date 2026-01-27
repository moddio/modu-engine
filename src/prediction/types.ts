/**
 * Client-Side Prediction Types
 *
 * Type definitions for the prediction system including configuration,
 * input tracking, and frame state management.
 */

/**
 * Configuration for client-side prediction.
 */
export interface PredictionConfig {
    /** Number of frames to delay local input (default: 2) */
    inputDelayFrames: number;
    /** Maximum frames to predict ahead (default: 8) */
    maxPredictionFrames: number;
    /** Maximum frames to rollback (default: 10) */
    maxRollbackFrames: number;
    /** Whether prediction is enabled */
    enabled: boolean;
}

/**
 * Default prediction configuration.
 */
export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
    inputDelayFrames: 2,
    maxPredictionFrames: 8,
    maxRollbackFrames: 10,
    enabled: true
};

/**
 * Input data for a single client at a single frame.
 */
export interface FrameInput {
    /** Client who sent the input */
    clientId: number;
    /** The input data (game-specific) */
    data: Record<string, any>;
    /** Whether this input has been confirmed by the server */
    confirmed: boolean;
}

/**
 * All inputs for a single frame.
 */
export interface FrameInputSet {
    /** Frame number */
    frame: number;
    /** Inputs indexed by clientId */
    inputs: Map<number, FrameInput>;
    /** Whether all expected inputs for this frame have been confirmed */
    fullyConfirmed: boolean;
}

/**
 * Statistics for prediction/rollback debugging.
 */
export interface PredictionStats {
    /** Total number of rollbacks executed */
    rollbackCount: number;
    /** Total frames resimulated across all rollbacks */
    framesResimulated: number;
    /** Average frames per rollback */
    avgRollbackDepth: number;
    /** Maximum rollback depth seen */
    maxRollbackDepth: number;
    /** Current prediction depth (localFrame - confirmedFrame) */
    currentPredictionDepth: number;
}

/**
 * Time synchronization sample from NetStorm algorithm.
 */
export interface TimeSyncSample {
    /** Estimated one-way latency (RTT / 2) */
    latency: number;
    /** Calculated clock delta (serverTime - localTime) */
    delta: number;
    /** Timestamp when this sample was taken */
    timestamp: number;
}

/**
 * Time synchronization state for debugging.
 */
export interface TimeSyncStats {
    /** Current clock delta estimate */
    clockDelta: number;
    /** Whether initial sync is complete */
    synced: boolean;
    /** Number of samples collected */
    sampleCount: number;
    /** Current tick rate multiplier for drift correction */
    tickRateMultiplier: number;
    /** Estimated latency to server (ms) */
    estimatedLatency: number;
}
