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
export interface PlayerInput {
    frame: number;
    playerId: string;
    data: any;
    predicted: boolean;
}
export interface InputBuffer {
    inputs: Map<number, PlayerInput[]>;
    lastConfirmedFrame: number;
    lastReceivedFrame: Map<string, number>;
}
export interface Snapshot {
    frame: number;
    state: any;
}
export interface RollbackConfig {
    inputDelay: number;
    maxRollbackFrames: number;
    maxPredictionFrames: number;
    snapshotInterval: number;
}
export interface RollbackManager {
    currentFrame: number;
    localPlayerId: string;
    players: Set<string>;
    config: RollbackConfig;
    inputBuffer: InputBuffer;
    localInputQueue: PlayerInput[];
    snapshots: Map<number, Snapshot>;
    /** Save entire state (entities, physics, game data) - returns opaque state */
    saveState: () => any;
    /** Restore entire state */
    loadState: (state: any) => void;
    /** Execute one frame: apply inputs, step physics, update entities */
    tick: (frame: number, inputs: PlayerInput[]) => void;
    /** Compute sync checksum for state verification */
    computeChecksum: () => number;
    /** Frame that needs rollback due to prediction mismatch (set by addInputToBuffer) */
    pendingRollbackFrame?: number;
    rollbackCount: number;
    maxRollbackDepth: number;
    predictionMisses: number;
}
export declare function createRollbackManager(localPlayerId: string, config?: Partial<RollbackConfig>): RollbackManager;
export declare function addPlayer(manager: RollbackManager, playerId: string): void;
/**
 * Add a player who joins mid-game at a specific frame.
 * This properly initializes lastReceivedFrame and updates lastConfirmedFrame
 * to prevent the confirmation logic from getting stuck on frames before
 * the player joined (where they have no inputs).
 */
export declare function addPlayerAtFrame(manager: RollbackManager, playerId: string, joinFrame: number): void;
/**
 * Clear snapshots older than a given frame.
 * Use this when adding a new player dynamically - it prevents rollback to
 * frames before the player's body existed in the physics world.
 *
 * Without this, a rollback to a snapshot without the player's body would cause
 * desync because the re-simulation would not include that player's physics.
 */
export declare function clearSnapshotsBefore(manager: RollbackManager, frame: number): void;
export declare function removePlayer(manager: RollbackManager, playerId: string): void;
/** Add local input (will be delayed by inputDelay frames) */
export declare function addLocalInput(manager: RollbackManager, data: any): void;
/** Add remote input received from network */
export declare function addRemoteInput(manager: RollbackManager, frame: number, playerId: string, data: any): void;
/** Get inputs for a specific frame, predicting if necessary */
export declare function getInputsForFrame(manager: RollbackManager, frame: number): PlayerInput[];
export declare function saveSnapshot(manager: RollbackManager): void;
export declare function loadSnapshot(manager: RollbackManager, frame: number): boolean;
/** Check if rollback is needed and return the frame to rollback to */
export declare function checkRollback(manager: RollbackManager): number | null;
/** Perform rollback and resimulation */
export declare function performRollback(manager: RollbackManager, toFrame: number): void;
/** Advance simulation by one frame */
export declare function advanceFrame(manager: RollbackManager): {
    inputs: PlayerInput[];
    didRollback: boolean;
};
/** Get local inputs that need to be sent to network */
export declare function getInputsToSend(manager: RollbackManager): PlayerInput[];
/** Get sync state for network (frame + checksum) */
export declare function getSyncState(manager: RollbackManager): {
    frame: number;
    checksum: number;
};
export declare function getRollbackStats(manager: RollbackManager): {
    currentFrame: number;
    confirmedFrame: number;
    rollbackCount: number;
    maxRollbackDepth: number;
    predictionMisses: number;
    snapshotCount: number;
    inputBufferSize: number;
};
