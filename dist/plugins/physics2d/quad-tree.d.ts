/**
 * QuadTree for Dynamic Spatial Partitioning
 *
 * Recursively subdivides space based on entity density.
 * Adapts to mixed entity sizes and non-uniform distributions.
 * Ideal for .io games where players grow from tiny to huge.
 */
import { RigidBody2D } from './rigid-body';
export declare class QuadTree2D {
    private root;
    private maxEntities;
    private maxDepth;
    constructor(maxEntities?: number, maxDepth?: number);
    /**
     * Clear the tree.
     */
    clear(): void;
    /**
     * Insert all bodies into the tree.
     * Automatically computes world bounds from entities.
     */
    insertAll(bodies: RigidBody2D[]): void;
    /**
     * Query entities that might collide with the given body.
     */
    queryNearby(body: RigidBody2D): RigidBody2D[];
    /**
     * Iterate all potential collision pairs.
     * Each pair is visited exactly once.
     * Order is deterministic (depth-first, NW→NE→SW→SE).
     */
    forEachPair(callback: (a: RigidBody2D, b: RigidBody2D) => void): void;
    /**
     * Get tree statistics for debugging.
     */
    getStats(): {
        nodeCount: number;
        maxDepth: number;
        entityCount: number;
    };
}
