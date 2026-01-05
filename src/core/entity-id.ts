/**
 * Entity ID Allocator
 *
 * Manages entity ID allocation with generation counters for ABA safety.
 * Entity ID format: [12 bits generation][20 bits index]
 */

import {
    MAX_ENTITIES,
    INDEX_MASK,
    INDEX_BITS,
    MAX_GENERATION,
    GENERATION_BITS
} from './constants';

export interface EntityIdAllocatorState {
    nextIndex: number;
    freeList: number[];
    generations: number[];
}

export class EntityIdAllocator {
    /** Generation counter for each entity slot */
    private generations: Uint16Array;

    /** Free list of available indices (sorted ascending for determinism) */
    private freeList: number[] = [];

    /** Next index to allocate if free list is empty */
    private nextIndex: number = 0;

    constructor() {
        this.generations = new Uint16Array(MAX_ENTITIES);
    }

    /**
     * Allocate a new entity ID.
     * Returns entity ID with generation encoded.
     */
    allocate(): number {
        let index: number;

        if (this.freeList.length > 0) {
            // Always take the LOWEST available index for determinism
            index = this.freeList.shift()!;
        } else {
            if (this.nextIndex >= MAX_ENTITIES) {
                throw new Error(
                    `Entity limit exceeded (MAX_ENTITIES=${MAX_ENTITIES}). ` +
                    `Consider destroying unused entities or increasing the limit.`
                );
            }
            index = this.nextIndex++;
        }

        const generation = this.generations[index];
        return (generation << INDEX_BITS) | index;
    }

    /**
     * Free an entity ID, returning it to the pool.
     * Increments generation to invalidate stale references.
     */
    free(eid: number): void {
        const index = eid & INDEX_MASK;

        // Increment generation (wrap at max)
        this.generations[index] = ((this.generations[index] + 1) & MAX_GENERATION) as number;

        // Binary search insert to maintain sorted order (deterministic)
        const insertIdx = this.findInsertIndex(index);
        this.freeList.splice(insertIdx, 0, index);
    }

    /**
     * Check if an entity ID is still valid (generation matches).
     */
    isValid(eid: number): boolean {
        const index = eid & INDEX_MASK;
        const generation = eid >>> INDEX_BITS;
        return index < this.nextIndex && this.generations[index] === generation;
    }

    /**
     * Get the index portion of an entity ID.
     */
    getIndex(eid: number): number {
        return eid & INDEX_MASK;
    }

    /**
     * Get the generation portion of an entity ID.
     */
    getGeneration(eid: number): number {
        return eid >>> INDEX_BITS;
    }

    /**
     * Get current state for snapshotting.
     */
    getState(): EntityIdAllocatorState {
        return {
            nextIndex: this.nextIndex,
            freeList: [...this.freeList],
            generations: Array.from(this.generations.slice(0, this.nextIndex))
        };
    }

    /**
     * Restore state from snapshot.
     */
    setState(state: EntityIdAllocatorState): void {
        this.nextIndex = state.nextIndex;
        this.freeList = [...state.freeList];

        // Restore generations
        for (let i = 0; i < state.generations.length; i++) {
            this.generations[i] = state.generations[i];
        }
    }

    /**
     * Reset allocator to initial state.
     */
    reset(): void {
        this.nextIndex = 0;
        this.freeList = [];
        this.generations.fill(0);
    }

    /**
     * Get number of active entities.
     */
    getActiveCount(): number {
        return this.nextIndex - this.freeList.length;
    }

    /**
     * Binary search to find insert position for sorted free list.
     */
    /**
     * Get next ID that will be allocated (for snapshots).
     */
    getNextId(): number {
        return this.nextIndex;
    }

    /**
     * Set next ID (for snapshot restore).
     */
    setNextId(id: number): void {
        this.nextIndex = id;
    }

    /**
     * Allocate a specific entity ID (for snapshot restore).
     * This bypasses normal allocation and marks the specific eid as used.
     * Returns the requested eid.
     */
    allocateSpecific(eid: number): number {
        const index = eid & INDEX_MASK;
        const generation = eid >>> INDEX_BITS;

        // Extend nextIndex if needed
        if (index >= this.nextIndex) {
            this.nextIndex = index + 1;
        }

        // Remove from free list if present
        const freeIdx = this.freeList.indexOf(index);
        if (freeIdx !== -1) {
            this.freeList.splice(freeIdx, 1);
        }

        // Set the generation
        this.generations[index] = generation;

        return eid;
    }

    private findInsertIndex(index: number): number {
        let lo = 0;
        let hi = this.freeList.length;

        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.freeList[mid] < index) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        return lo;
    }
}
