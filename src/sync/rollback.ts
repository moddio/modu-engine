/**
 * Rollback Networking for Deterministic Multiplayer
 *
 * Implements GGPO-style rollback netcode:
 * - Input delay buffer
 * - State snapshots for rollback
 * - Resimulation when late inputs arrive
 * - Input prediction for remote players
 *
 * Physics-agnostic: the game provides callbacks for state save/load/tick.
 * Works with modu-network for transport.
 */

// Debug flag - set to true to enable verbose rollback logging
const DEBUG_ROLLBACK = false;

// ============================================
// Input Types
// ============================================

export interface PlayerInput {
    frame: number;
    playerId: string;
    data: any;           // Game-specific input data
    predicted: boolean;  // Was this input predicted?
}

export interface InputBuffer {
    inputs: Map<number, PlayerInput[]>;  // frame -> inputs for that frame
    lastConfirmedFrame: number;
    lastReceivedFrame: Map<string, number>;  // playerId -> last frame we have confirmed input for
}

// ============================================
// Snapshot Storage
// ============================================

export interface Snapshot {
    frame: number;
    state: any;  // Opaque state - game decides what to save (entities, physics, etc.)
}

// ============================================
// Rollback Manager
// ============================================

export interface RollbackConfig {
    inputDelay: number;        // Frames of local input delay (default: 2)
    maxRollbackFrames: number; // Maximum frames to roll back (default: 8)
    maxPredictionFrames: number; // Maximum frames to predict ahead (default: 8)
    snapshotInterval: number;  // Save snapshot every N frames (default: 1)
}

export interface RollbackManager {
    // State
    currentFrame: number;
    localPlayerId: string;
    players: Set<string>;

    // Configuration
    config: RollbackConfig;

    // Input management
    inputBuffer: InputBuffer;
    localInputQueue: PlayerInput[];  // Delayed local inputs

    // Snapshot management
    snapshots: Map<number, Snapshot>;

    // Callbacks (game provides these)
    /** Save entire state (entities, physics, game data) - returns opaque state */
    saveState: () => any;
    /** Restore entire state */
    loadState: (state: any) => void;
    /** Execute one frame: apply inputs, step physics, update entities */
    tick: (frame: number, inputs: PlayerInput[]) => void;
    /** Compute sync checksum for state verification */
    computeChecksum: () => number;

    // Rollback tracking
    /** Frame that needs rollback due to prediction mismatch (set by addInputToBuffer) */
    pendingRollbackFrame?: number;

    // Stats
    rollbackCount: number;
    maxRollbackDepth: number;
    predictionMisses: number;
}

export function createRollbackManager(
    localPlayerId: string,
    config: Partial<RollbackConfig> = {}
): RollbackManager {
    const inputDelay = config.inputDelay ?? 2;

    return {
        currentFrame: 0,
        localPlayerId,
        players: new Set([localPlayerId]),

        config: {
            inputDelay,
            maxRollbackFrames: config.maxRollbackFrames ?? 8,
            maxPredictionFrames: config.maxPredictionFrames ?? 8,
            snapshotInterval: config.snapshotInterval ?? 1,
        },

        inputBuffer: {
            inputs: new Map(),
            lastConfirmedFrame: -1,
            // Initialize lastReceivedFrame for local player
            // This prevents confirmedFrame from being stuck at -1
            lastReceivedFrame: new Map([[localPlayerId, 0]]),
        },

        localInputQueue: [],

        snapshots: new Map(),

        // These must be set by the game
        saveState: () => ({}),
        loadState: () => { },
        tick: () => { },
        computeChecksum: () => 0,

        rollbackCount: 0,
        maxRollbackDepth: 0,
        predictionMisses: 0,
    };
}

// ============================================
// Player Management
// ============================================

export function addPlayer(manager: RollbackManager, playerId: string): void {
    manager.players.add(playerId);
    manager.inputBuffer.lastReceivedFrame.set(playerId, -1);
}

/**
 * Add a player who joins mid-game at a specific frame.
 * This properly initializes lastReceivedFrame and updates lastConfirmedFrame
 * to prevent the confirmation logic from getting stuck on frames before
 * the player joined (where they have no inputs).
 */
export function addPlayerAtFrame(manager: RollbackManager, playerId: string, joinFrame: number): void {
    manager.players.add(playerId);
    manager.inputBuffer.lastReceivedFrame.set(playerId, joinFrame);

    // Update lastConfirmedFrame to skip frames before this player joined
    // Otherwise updateConfirmedFrame will fail because the new player
    // has no inputs for frames before their join
    if (joinFrame - 1 > manager.inputBuffer.lastConfirmedFrame) {
        manager.inputBuffer.lastConfirmedFrame = joinFrame - 1;
    }
}

/**
 * Clear snapshots older than a given frame.
 * Use this when adding a new player dynamically - it prevents rollback to
 * frames before the player's body existed in the physics world.
 *
 * Without this, a rollback to a snapshot without the player's body would cause
 * desync because the re-simulation would not include that player's physics.
 */
export function clearSnapshotsBefore(manager: RollbackManager, frame: number): void {
    for (const snapshotFrame of manager.snapshots.keys()) {
        if (snapshotFrame < frame) {
            manager.snapshots.delete(snapshotFrame);
        }
    }
    // Also clear inputs before this frame to prevent rollback triggering
    for (const inputFrame of manager.inputBuffer.inputs.keys()) {
        if (inputFrame < frame) {
            manager.inputBuffer.inputs.delete(inputFrame);
        }
    }
}

export function removePlayer(manager: RollbackManager, playerId: string): void {
    manager.players.delete(playerId);
    manager.inputBuffer.lastReceivedFrame.delete(playerId);
}

// ============================================
// Input Management
// ============================================

/** Add local input (will be delayed by inputDelay frames) */
export function addLocalInput(manager: RollbackManager, data: any): void {
    const { currentFrame, config, localPlayerId, inputBuffer } = manager;
    const targetFrame = currentFrame + config.inputDelay;

    // Add CONFIRMED input for the target frame (when input will be "official")
    const input: PlayerInput = {
        frame: targetFrame,
        playerId: localPlayerId,
        data,
        predicted: false,
    };

    manager.localInputQueue.push(input);
    addInputToBuffer(manager, input);

    // Update lastReceivedFrame for local player
    // This is critical for confirmedFrame calculation
    const lastReceived = inputBuffer.lastReceivedFrame.get(localPlayerId) ?? -1;
    if (targetFrame > lastReceived) {
        inputBuffer.lastReceivedFrame.set(localPlayerId, targetFrame);
    }

    // KEY FOR ZERO PERCEIVED LATENCY:
    // Also add PREDICTIONS for frames between current and target.
    // This gives immediate local response while maintaining network sync.
    //
    // For LOCAL player predictions:
    // - We MUST update existing predictions with the latest input data
    // - When we send input for frame N+delay, remote clients backfill frames N to N+delay-1
    // - If we don't update our own predictions, we desync because remote has new data, we have old
    //
    // For REMOTE player predictions (handled in addRemoteInput):
    // - Only add if no prediction exists, to avoid overwriting with outdated data
    for (let f = currentFrame; f < targetFrame; f++) {
        const frameInputs = inputBuffer.inputs.get(f);
        const existingInput = frameInputs?.find(i => i.playerId === localPlayerId);

        // For local player: always update predictions with latest input
        // (Remote players receive this same data via backfill in addRemoteInput)
        if (!existingInput) {
            // No input exists - add new prediction
            const prediction: PlayerInput = {
                frame: f,
                playerId: localPlayerId,
                data,
                predicted: true,
            };
            addInputToBuffer(manager, prediction);
        } else if (existingInput.predicted) {
            // Existing prediction - update with latest data
            existingInput.data = data;
        } else if (f === currentFrame) {
            // CRITICAL FIX: For the CURRENT frame, also update confirmed inputs!
            // The "confirmed" input was scheduled from a previous frame (currentFrame - inputDelay).
            // But the player's CURRENT input (what they're pressing NOW) should take precedence
            // for the frame we're about to simulate. This gives zero-latency local response.
            // Without this, old scheduled inputs would override the player's current intent.
            existingInput.data = data;
        }
        // For future confirmed inputs (f > currentFrame), don't touch - they're properly scheduled
    }
}

/** Add remote input received from network */
export function addRemoteInput(manager: RollbackManager, frame: number, playerId: string, data: any): void {
    const { config, inputBuffer, currentFrame } = manager;

    const input: PlayerInput = {
        frame,
        playerId,
        data,
        predicted: false,
    };

    addInputToBuffer(manager, input);

    // CRITICAL FOR ZERO-LATENCY SYNC:
    // When remote player sent input for frame F, they ALSO predicted the same input
    // for frames (F - inputDelay) to (F - 1) via addLocalInput's zero-latency feature.
    // We need to match this by adding predictions here, which will trigger rollback
    // if our existing predictions were different.
    //
    // This ensures: when remote player pressed W at frame 100 (confirmed at 104),
    // we also add W predictions for frames 100-103, which triggers rollback if
    // we predicted differently.
    const predictionStartFrame = Math.max(0, frame - config.inputDelay);
    const predictionEndFrame = frame; // exclusive

    for (let f = predictionStartFrame; f < predictionEndFrame; f++) {
        // Backfill frames that are either:
        // 1. In the past (already simulated) - need rollback
        // 2. In the near future (within inputDelay) - will be simulated soon with wrong prediction
        // Only skip frames that are too old to rollback
        const isPastFrame = f <= currentFrame;
        const isFutureButSoon = f > currentFrame && f < currentFrame + config.inputDelay;
        const isTooOld = f < currentFrame - config.maxRollbackFrames;

        if ((isPastFrame || isFutureButSoon) && !isTooOld) {
            const frameInputs = inputBuffer.inputs.get(f);

            // Check for existing confirmed input
            const existingConfirmed = frameInputs?.find(i => i.playerId === playerId && !i.predicted);
            if (existingConfirmed) {
                // CRITICAL FIX: For the CURRENT frame, update confirmed inputs with newer data!
                // The existing confirmed was scheduled from inputDelay frames ago.
                // The new backfill represents the player's actual input for this frame.
                // Without this, old scheduled inputs override the player's current intent.
                if (f === currentFrame) {
                    existingConfirmed.data = data;
                }
                continue;
            }

            // Add as CONFIRMED input (predicted: false)
            // The remote player used this input for their local prediction, so it's authoritative.
            // addInputToBuffer will handle checking for prediction mismatch and setting needsRollback.
            const backfilledInput: PlayerInput = {
                frame: f,
                playerId,
                data,
                predicted: false,
            };

            addInputToBuffer(manager, backfilledInput);
        }
    }

    // Update last received frame for this player
    const lastReceived = inputBuffer.lastReceivedFrame.get(playerId) ?? -1;
    if (frame > lastReceived) {
        inputBuffer.lastReceivedFrame.set(playerId, frame);
    }
}

function addInputToBuffer(manager: RollbackManager, input: PlayerInput): void {
    const { inputBuffer } = manager;

    if (!inputBuffer.inputs.has(input.frame)) {
        inputBuffer.inputs.set(input.frame, []);
    }

    const frameInputs = inputBuffer.inputs.get(input.frame)!;

    // Replace any existing input from this player for this frame
    const existingIdx = frameInputs.findIndex(i => i.playerId === input.playerId);
    if (existingIdx >= 0) {
        const existing = frameInputs[existingIdx];
        // Check if this was a prediction that's now confirmed
        if (existing.predicted && !input.predicted) {
            // Check if prediction was correct (compare only discrete inputs, not continuous values like yaw)
            if (inputsDifferSignificantly(existing.data, input.data)) {
                manager.predictionMisses++;
                // Store the earliest frame needing rollback directly on manager
                // This ensures we don't miss it even if the frame is outside the scan window
                const pendingRollback = manager.pendingRollbackFrame;
                if (pendingRollback === undefined || input.frame < pendingRollback) {
                    manager.pendingRollbackFrame = input.frame;
                }
                if (DEBUG_ROLLBACK) {
                    console.log(`[MISMATCH] frame=${input.frame} player=${input.playerId} predicted=${JSON.stringify(existing.data)} actual=${JSON.stringify(input.data)}`);
                }
            }
        }
        frameInputs[existingIdx] = input;
    } else {
        frameInputs.push(input);
    }
}

/** Compare inputs, ignoring continuously-changing values like yaw/pitch */
function inputsDifferSignificantly(a: any, b: any): boolean {
    if (!a && !b) return false;
    if (!a || !b) return true;

    // Compare ALL discrete inputs - any boolean or action key
    // Continuous values to ignore: yaw, pitch, shootDirX/Y/Z, rotX/Y/Z, lookX/Y
    // yawFp is the fixed-point version of yaw used in the browser demo
    const continuousKeys = new Set([
        'yaw', 'yawFp', 'pitch', 'pitchFp', 'roll', 'rollFp',
        'shootDirX', 'shootDirY', 'shootDirZ',
        'lookX', 'lookY',
        'rotX', 'rotY', 'rotZ',
        'mouseX', 'mouseY',
        'aimX', 'aimY', 'aimZ'
    ]);

    // Compare all keys in both objects
    const allKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);

    for (const key of allKeys) {
        // Skip continuous values
        if (continuousKeys.has(key)) continue;

        // Compare the values
        if (a[key] !== b[key]) {
            return true;
        }
    }

    return false;
}

/** Get inputs for a specific frame, predicting if necessary */
export function getInputsForFrame(manager: RollbackManager, frame: number): PlayerInput[] {
    const { inputBuffer, players, localPlayerId } = manager;
    const inputs: PlayerInput[] = [];

    // CRITICAL: Sort players for deterministic iteration order
    // Without this, Set insertion order differs per client, causing simulation divergence
    const sortedPlayers = Array.from(players).sort();

    for (const playerId of sortedPlayers) {
        const frameInputs = inputBuffer.inputs.get(frame);

        // 1. First check for confirmed input
        const confirmed = frameInputs?.find(i => i.playerId === playerId && !i.predicted);
        if (confirmed) {
            inputs.push(confirmed);
            continue;
        }

        // 2. Then check for EXISTING prediction (from addLocalInput's zero-latency prediction)
        // This is CRITICAL for immediate local response - addLocalInput adds predictions
        // for frames currentFrame to currentFrame+inputDelay-1, so we must USE them here
        const existingPrediction = frameInputs?.find(i => i.playerId === playerId && i.predicted);
        if (existingPrediction) {
            inputs.push(existingPrediction);
            continue;
        }

        // 3. Only create new prediction from history if nothing exists
        const predicted = predictInput(manager, frame, playerId);
        inputs.push(predicted);
        addInputToBuffer(manager, predicted);
    }

    return inputs;
}

/** Predict input for a player based on their last known input */
function predictInput(manager: RollbackManager, frame: number, playerId: string): PlayerInput {
    const { inputBuffer } = manager;

    // Find the most recent confirmed input from this player
    let lastInput: PlayerInput | null = null;

    for (let f = frame - 1; f >= Math.max(0, frame - 60); f--) {
        const frameInputs = inputBuffer.inputs.get(f);
        const input = frameInputs?.find(i => i.playerId === playerId && !i.predicted);
        if (input) {
            lastInput = input;
            break;
        }
    }

    // Predict: repeat last input, or use neutral defaults if no input exists
    // CRITICAL: Default to neutral state (no movement, no actions) rather than empty object
    // Empty object causes issues because fields like yawFp would be missing
    const predictedData = lastInput ? { ...lastInput.data } : {
        w: false, a: false, s: false, d: false, jump: false, yawFp: 0
    };

    return {
        frame,
        playerId,
        data: predictedData,
        predicted: true,
    };
}

// ============================================
// Snapshot Management
// ============================================

export function saveSnapshot(manager: RollbackManager): void {
    const { currentFrame, config, snapshots } = manager;

    // Only save on interval
    if (currentFrame % config.snapshotInterval !== 0) return;

    const snapshot: Snapshot = {
        frame: currentFrame,
        state: manager.saveState(),
    };

    snapshots.set(currentFrame, snapshot);

    // Clean up old snapshots (keep last maxRollbackFrames + some buffer)
    const keepFrom = currentFrame - config.maxRollbackFrames - 10;
    for (const frame of snapshots.keys()) {
        if (frame < keepFrom) {
            snapshots.delete(frame);
        }
    }
}

export function loadSnapshot(manager: RollbackManager, frame: number): boolean {
    const snapshot = manager.snapshots.get(frame);
    if (!snapshot) return false;

    manager.loadState(snapshot.state);
    return true;
}

// ============================================
// Rollback Logic
// ============================================

/** Check if rollback is needed and return the frame to rollback to */
export function checkRollback(manager: RollbackManager): number | null {
    const { currentFrame, config } = manager;

    // Check if there's a pending rollback frame stored by addInputToBuffer
    const pendingRollback = manager.pendingRollbackFrame;
    if (pendingRollback !== undefined) {
        // Clear the pending rollback
        manager.pendingRollbackFrame = undefined;

        // Only rollback if within the max rollback window
        if (currentFrame - pendingRollback <= config.maxRollbackFrames) {
            return pendingRollback;
        } else if (DEBUG_ROLLBACK) {
            console.warn(`[ROLLBACK_MISSED] frame=${pendingRollback} is too old (current=${currentFrame}, max=${config.maxRollbackFrames})`);
        }
    }

    return null;
}

/** Perform rollback and resimulation */
export function performRollback(
    manager: RollbackManager,
    toFrame: number
): void {
    const { currentFrame } = manager;

    // Find nearest snapshot at or before toFrame
    let snapshotFrame = toFrame;
    while (snapshotFrame >= 0 && !manager.snapshots.has(snapshotFrame)) {
        snapshotFrame--;
    }

    if (snapshotFrame < 0) {
        if (DEBUG_ROLLBACK) console.warn('[ROLLBACK] No snapshot found for rollback');
        return;
    }

    // Load snapshot
    if (!loadSnapshot(manager, snapshotFrame)) {
        if (DEBUG_ROLLBACK) console.warn('[ROLLBACK] Failed to load snapshot');
        return;
    }

    manager.rollbackCount++;
    const rollbackDepth = currentFrame - snapshotFrame;
    if (rollbackDepth > manager.maxRollbackDepth) {
        manager.maxRollbackDepth = rollbackDepth;
    }

    if (DEBUG_ROLLBACK) {
        console.log(`[ROLLBACK] Rolling back from ${currentFrame} to ${snapshotFrame} (${rollbackDepth} frames), available snapshots: ${[...manager.snapshots.keys()].sort((a,b)=>a-b).join(',')}`);
    }

    // Resimulate from snapshot to current frame
    for (let frame = snapshotFrame; frame < currentFrame; frame++) {
        manager.currentFrame = frame;

        // Save snapshot BEFORE tick
        saveSnapshot(manager);

        // Get inputs for this frame (now with confirmed inputs)
        const inputs = getInputsForFrame(manager, frame);

        // Execute frame (game applies inputs and steps physics)
        manager.tick(frame, inputs);

        manager.currentFrame = frame + 1;
    }
}

// ============================================
// Frame Advance
// ============================================

/** Advance simulation by one frame */
export function advanceFrame(
    manager: RollbackManager
): { inputs: PlayerInput[]; didRollback: boolean } {
    let didRollback = false;

    // Check if we need to rollback
    const rollbackTo = checkRollback(manager);
    if (rollbackTo !== null && rollbackTo < manager.currentFrame) {
        performRollback(manager, rollbackTo);
        didRollback = true;
    }

    // Save snapshot before advancing
    saveSnapshot(manager);

    // Get inputs for current frame
    const inputs = getInputsForFrame(manager, manager.currentFrame);

    // Execute frame (game applies inputs and steps physics)
    manager.tick(manager.currentFrame, inputs);

    // Advance frame counter
    manager.currentFrame++;

    // Update last confirmed frame
    updateConfirmedFrame(manager);

    // Clean up old inputs
    cleanupInputs(manager);

    return { inputs, didRollback };
}

function updateConfirmedFrame(manager: RollbackManager): void {
    const { inputBuffer, players, currentFrame, config } = manager;

    // Start from the next unconfirmed frame
    // Skip very early frames that won't have inputs due to inputDelay
    const startFrame = Math.max(
        inputBuffer.lastConfirmedFrame + 1,
        config.inputDelay  // First frame that could possibly have inputs
    );

    // DETERMINISM: Sort players for consistent iteration order
    const sortedPlayers = Array.from(players).sort();

    // Find the latest frame where all players have confirmed inputs
    for (let frame = startFrame; frame < currentFrame; frame++) {
        const frameInputs = inputBuffer.inputs.get(frame);
        if (!frameInputs) {
            // No inputs for this frame yet, can't confirm further
            break;
        }

        let allConfirmed = true;
        for (const playerId of sortedPlayers) {
            const input = frameInputs.find(i => i.playerId === playerId && !i.predicted);
            if (!input) {
                allConfirmed = false;
                break;
            }
        }

        if (allConfirmed) {
            inputBuffer.lastConfirmedFrame = frame;
        } else {
            // Can't confirm this frame, stop checking
            break;
        }
    }
}

function cleanupInputs(manager: RollbackManager): void {
    const { inputBuffer, config, currentFrame } = manager;

    // Keep inputs for potential rollback
    const keepFrom = currentFrame - config.maxRollbackFrames - 10;

    for (const frame of inputBuffer.inputs.keys()) {
        if (frame < keepFrom) {
            inputBuffer.inputs.delete(frame);
        }
    }
}

// ============================================
// Network Integration
// ============================================

/** Get local inputs that need to be sent to network */
export function getInputsToSend(manager: RollbackManager): PlayerInput[] {
    // Return inputs from local queue that are ready to send
    const ready = manager.localInputQueue.filter(i => i.frame <= manager.currentFrame + manager.config.inputDelay);

    // Remove sent inputs from queue
    manager.localInputQueue = manager.localInputQueue.filter(i => i.frame > manager.currentFrame + manager.config.inputDelay);

    return ready;
}

/** Get sync state for network (frame + checksum) */
export function getSyncState(manager: RollbackManager): { frame: number; checksum: number } {
    return {
        frame: manager.currentFrame,
        checksum: manager.computeChecksum()
    };
}

// ============================================
// Debugging
// ============================================

export function getRollbackStats(manager: RollbackManager): {
    currentFrame: number;
    confirmedFrame: number;
    rollbackCount: number;
    maxRollbackDepth: number;
    predictionMisses: number;
    snapshotCount: number;
    inputBufferSize: number;
} {
    return {
        currentFrame: manager.currentFrame,
        confirmedFrame: manager.inputBuffer.lastConfirmedFrame,
        rollbackCount: manager.rollbackCount,
        maxRollbackDepth: manager.maxRollbackDepth,
        predictionMisses: manager.predictionMisses,
        snapshotCount: manager.snapshots.size,
        inputBufferSize: manager.inputBuffer.inputs.size,
    };
}
