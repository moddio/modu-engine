/**
 * Sync Module
 *
 * Distributed state synchronization for deterministic multiplayer.
 * Uses consensus-based verification (stateHash + partitioned delta) instead of rollback.
 */

// Distributed state sync
export {
    // Delta computation
    StateDelta,
    CreatedEntity,
    PartitionDelta,
    computeStateDelta,
    computeSnapshotHash,
    serializeDelta,
    deserializeDelta,
    getPartition,
    deserializePartition,
    assemblePartitions,
    applyDelta,
    isDeltaEmpty,
    getDeltaSize,
    getEntityPartition
} from './state-delta';

export {
    // Partition assignment
    PartitionAssignment,
    DegradationTier,
    computePartitionAssignment,
    computePartitionCount,
    computePartitionSeed,
    weightedRandomPick,
    isClientAssigned,
    getClientPartitions,
    computeDegradationTier
} from './partition';
