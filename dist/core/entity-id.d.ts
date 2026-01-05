/**
 * Entity ID Allocator
 *
 * Manages entity ID allocation with generation counters for ABA safety.
 * Entity ID format: [12 bits generation][20 bits index]
 */
export interface EntityIdAllocatorState {
    nextIndex: number;
    freeList: number[];
    generations: number[];
}
export declare class EntityIdAllocator {
    /** Generation counter for each entity slot */
    private generations;
    /** Free list of available indices (sorted ascending for determinism) */
    private freeList;
    /** Next index to allocate if free list is empty */
    private nextIndex;
    constructor();
    /**
     * Allocate a new entity ID.
     * Returns entity ID with generation encoded.
     */
    allocate(): number;
    /**
     * Free an entity ID, returning it to the pool.
     * Increments generation to invalidate stale references.
     */
    free(eid: number): void;
    /**
     * Check if an entity ID is still valid (generation matches).
     */
    isValid(eid: number): boolean;
    /**
     * Get the index portion of an entity ID.
     */
    getIndex(eid: number): number;
    /**
     * Get the generation portion of an entity ID.
     */
    getGeneration(eid: number): number;
    /**
     * Get current state for snapshotting.
     */
    getState(): EntityIdAllocatorState;
    /**
     * Restore state from snapshot.
     */
    setState(state: EntityIdAllocatorState): void;
    /**
     * Reset allocator to initial state.
     */
    reset(): void;
    /**
     * Get number of active entities.
     */
    getActiveCount(): number;
    /**
     * Binary search to find insert position for sorted free list.
     */
    /**
     * Get next ID that will be allocated (for snapshots).
     */
    getNextId(): number;
    /**
     * Set next ID (for snapshot restore).
     */
    setNextId(id: number): void;
    /**
     * Allocate a specific entity ID (for snapshot restore).
     * This bypasses normal allocation and marks the specific eid as used.
     * Returns the requested eid.
     */
    allocateSpecific(eid: number): number;
    private findInsertIndex;
}
