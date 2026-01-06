/**
 * Sparse Snapshot System
 *
 * Efficient snapshot encoding using entity bitmaps.
 * Only active entities are stored, not MAX_ENTITIES slots.
 */
import { ComponentType } from './component';
import { EntityIdAllocatorState } from './entity-id';
/**
 * Sparse snapshot format.
 * Much smaller than full snapshot when entity count << MAX_ENTITIES.
 */
export interface SparseSnapshot {
    /** Frame number */
    frame: number;
    /** Sequence number (for network ordering) */
    seq: number;
    /** Bitmap: which entity indices are active */
    entityMask: Uint32Array;
    /** Entity metadata (type, clientId) indexed by position in packed arrays */
    entityMeta: EntityMeta[];
    /** Packed component data for each component type */
    componentData: Map<string, ArrayBuffer>;
    /** Entity count (for quick reference) */
    entityCount: number;
    /** Allocator state for deterministic ID recycling */
    allocator: EntityIdAllocatorState;
    /** String registry for late joiners */
    strings: {
        tables: Record<string, Record<string, number>>;
        nextIds: Record<string, number>;
    };
    /** RNG state */
    rng?: {
        s0: number;
        s1: number;
    };
}
/**
 * Entity metadata stored per-entity in snapshot.
 */
export interface EntityMeta {
    eid: number;
    type: string;
    clientId?: number;
}
/**
 * Sparse snapshot encoder/decoder.
 */
export declare class SparseSnapshotCodec {
    /**
     * Encode world state to sparse snapshot.
     */
    encode(activeEids: number[], getEntityType: (eid: number) => string, getEntityClientId: (eid: number) => number | undefined, getComponentsForEntity: (eid: number) => ComponentType[], allocatorState: EntityIdAllocatorState, stringsState: {
        tables: Record<string, Record<string, number>>;
        nextIds: Record<string, number>;
    }, frame?: number, seq?: number, rng?: {
        s0: number;
        s1: number;
    }): SparseSnapshot;
    /**
     * Decode sparse snapshot back to world state.
     */
    decode(snapshot: SparseSnapshot, clearWorld: () => void, setAllocatorState: (state: EntityIdAllocatorState) => void, setStringsState: (state: {
        tables: Record<string, Record<string, number>>;
        nextIds: Record<string, number>;
    }) => void, createEntity: (eid: number, type: string, clientId?: number) => void, setRng?: (rng: {
        s0: number;
        s1: number;
    }) => void): void;
    /**
     * Calculate snapshot size in bytes.
     */
    getSize(snapshot: SparseSnapshot): number;
    /**
     * Serialize snapshot to binary for network transfer.
     */
    toBinary(snapshot: SparseSnapshot): ArrayBuffer;
    /**
     * Deserialize snapshot from binary.
     */
    fromBinary(buffer: ArrayBuffer): SparseSnapshot;
}
/**
 * Rollback buffer - stores snapshots for rewinding state.
 */
export declare class RollbackBuffer {
    private maxFrames;
    private snapshots;
    private codec;
    constructor(maxFrames?: number);
    /**
     * Save a snapshot for a frame.
     */
    save(frame: number, snapshot: SparseSnapshot): void;
    /**
     * Get snapshot for a frame.
     */
    get(frame: number): SparseSnapshot | undefined;
    /**
     * Check if snapshot exists for frame.
     */
    has(frame: number): boolean;
    /**
     * Get oldest available frame.
     */
    getOldestFrame(): number | undefined;
    /**
     * Get newest available frame.
     */
    getNewestFrame(): number | undefined;
    /**
     * Clear all snapshots.
     */
    clear(): void;
    /**
     * Get number of stored snapshots.
     */
    get size(): number;
}
