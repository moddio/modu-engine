/**
 * Sync Module
 *
 * Rollback networking for deterministic multiplayer.
 */

export {
    // Types
    PlayerInput,
    InputBuffer,
    Snapshot,
    RollbackConfig,
    RollbackManager,
    // Manager
    createRollbackManager,
    // Player Management
    addPlayer,
    addPlayerAtFrame,
    clearSnapshotsBefore,
    removePlayer,
    // Input Management
    addLocalInput,
    addRemoteInput,
    getInputsForFrame,
    // Snapshot Management
    saveSnapshot,
    loadSnapshot,
    // Rollback
    checkRollback,
    performRollback,
    advanceFrame,
    // Network Integration
    getInputsToSend,
    getSyncState,
    // Debugging
    getRollbackStats
} from './rollback';
