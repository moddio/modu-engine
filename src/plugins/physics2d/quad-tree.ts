/**
 * QuadTree for Dynamic Spatial Partitioning
 *
 * Recursively subdivides space based on entity density.
 * Adapts to mixed entity sizes and non-uniform distributions.
 * Ideal for .io games where players grow from tiny to huge.
 */

import { RigidBody2D } from './rigid-body';
import { computeAABB2D } from './collision';
import { toFloat } from '../../math/fixed';

// ============================================
// Configuration
// ============================================

const DEFAULT_MAX_ENTITIES = 8;   // Max entities before subdivision
const DEFAULT_MAX_DEPTH = 8;      // Max tree depth (prevents infinite subdivision)

// ============================================
// AABB Helpers
// ============================================

interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function boundsContains(bounds: Bounds, x: number, y: number): boolean {
    return x >= bounds.minX && x <= bounds.maxX &&
           y >= bounds.minY && y <= bounds.maxY;
}

function boundsIntersects(a: Bounds, b: Bounds): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY;
}

function getBodyBounds(body: RigidBody2D): Bounds {
    const aabb = computeAABB2D(body);
    return {
        minX: toFloat(aabb.minX),
        minY: toFloat(aabb.minY),
        maxX: toFloat(aabb.maxX),
        maxY: toFloat(aabb.maxY)
    };
}

// ============================================
// QuadTree Node
// ============================================

class QuadTreeNode {
    bounds: Bounds;
    depth: number;
    maxEntities: number;
    maxDepth: number;

    // Entities stored in this node (entities that span multiple children stay here)
    entities: RigidBody2D[] = [];

    // Child quadrants: NW, NE, SW, SE (null until subdivided)
    children: [QuadTreeNode, QuadTreeNode, QuadTreeNode, QuadTreeNode] | null = null;

    constructor(bounds: Bounds, depth: number, maxEntities: number, maxDepth: number) {
        this.bounds = bounds;
        this.depth = depth;
        this.maxEntities = maxEntities;
        this.maxDepth = maxDepth;
    }

    /**
     * Insert an entity into the tree.
     */
    insert(body: RigidBody2D, bodyBounds: Bounds): void {
        // If we have children, try to insert into a child
        if (this.children) {
            const index = this.getChildIndex(bodyBounds);
            if (index !== -1) {
                this.children[index].insert(body, bodyBounds);
                return;
            }
            // Entity spans multiple quadrants - store in this node
            this.entities.push(body);
            return;
        }

        // No children yet - store in this node
        this.entities.push(body);

        // Subdivide if we have too many entities and haven't reached max depth
        if (this.entities.length > this.maxEntities && this.depth < this.maxDepth) {
            this.subdivide();
        }
    }

    /**
     * Subdivide this node into 4 children.
     */
    private subdivide(): void {
        const { minX, minY, maxX, maxY } = this.bounds;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        this.children = [
            new QuadTreeNode({ minX, minY, maxX: midX, maxY: midY }, this.depth + 1, this.maxEntities, this.maxDepth),           // NW (top-left)
            new QuadTreeNode({ minX: midX, minY, maxX, maxY: midY }, this.depth + 1, this.maxEntities, this.maxDepth),           // NE (top-right)
            new QuadTreeNode({ minX, minY: midY, maxX: midX, maxY }, this.depth + 1, this.maxEntities, this.maxDepth),           // SW (bottom-left)
            new QuadTreeNode({ minX: midX, minY: midY, maxX, maxY }, this.depth + 1, this.maxEntities, this.maxDepth),           // SE (bottom-right)
        ];

        // Re-insert entities into children
        const oldEntities = this.entities;
        this.entities = [];

        for (const body of oldEntities) {
            const bodyBounds = getBodyBounds(body);
            const index = this.getChildIndex(bodyBounds);
            if (index !== -1) {
                this.children[index].insert(body, bodyBounds);
            } else {
                // Entity spans multiple quadrants - keep in this node
                this.entities.push(body);
            }
        }
    }

    /**
     * Get the child index for an entity, or -1 if it spans multiple children.
     */
    private getChildIndex(bodyBounds: Bounds): number {
        const { minX, minY, maxX, maxY } = this.bounds;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        const inTop = bodyBounds.maxY <= midY;
        const inBottom = bodyBounds.minY >= midY;
        const inLeft = bodyBounds.maxX <= midX;
        const inRight = bodyBounds.minX >= midX;

        if (inTop && inLeft) return 0;  // NW
        if (inTop && inRight) return 1; // NE
        if (inBottom && inLeft) return 2; // SW
        if (inBottom && inRight) return 3; // SE

        return -1; // Spans multiple quadrants
    }

    /**
     * Query all entities that might collide with the given bounds.
     */
    query(queryBounds: Bounds, result: RigidBody2D[]): void {
        // Check entities in this node
        for (const body of this.entities) {
            result.push(body);
        }

        // Check children
        if (this.children) {
            for (const child of this.children) {
                if (boundsIntersects(child.bounds, queryBounds)) {
                    child.query(queryBounds, result);
                }
            }
        }
    }

    /**
     * Iterate all potential collision pairs (iterative version).
     * Uses stack-based traversal to avoid recursive overhead.
     */
    forEachPairIterative(callback: (a: RigidBody2D, b: RigidBody2D) => void): void {
        // Stack entries: [node, ancestorStartIndex]
        const stack: Array<{ node: QuadTreeNode; ancestorStart: number }> = [];
        const ancestors: RigidBody2D[] = [];

        stack.push({ node: this, ancestorStart: 0 });

        while (stack.length > 0) {
            const { node, ancestorStart } = stack.pop()!;

            // Trim ancestors to correct level
            ancestors.length = ancestorStart;

            // Check pairs within this node's entities
            const entities = node.entities;
            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    callback(entities[i], entities[j]);
                }
            }

            // Check this node's entities against ancestors
            for (let i = 0; i < ancestorStart; i++) {
                for (const entity of entities) {
                    callback(ancestors[i], entity);
                }
            }

            // Add this node's entities to ancestors for children
            const newAncestorStart = ancestors.length;
            for (const entity of entities) {
                ancestors.push(entity);
            }

            // Push children in reverse order (so NW is processed first)
            if (node.children) {
                for (let i = 3; i >= 0; i--) {
                    stack.push({ node: node.children[i], ancestorStart: ancestors.length });
                }
            }
        }
    }

    /**
     * Iterate all potential collision pairs.
     * Callback receives each unique pair exactly once.
     */
    forEachPair(callback: (a: RigidBody2D, b: RigidBody2D) => void, ancestors: RigidBody2D[] = []): void {
        this.forEachPairIterative(callback);
    }

    /**
     * Get statistics about this subtree.
     */
    getStats(): { nodeCount: number; maxDepth: number; entityCount: number } {
        let nodeCount = 1;
        let maxDepth = this.depth;
        let entityCount = this.entities.length;

        if (this.children) {
            for (const child of this.children) {
                const childStats = child.getStats();
                nodeCount += childStats.nodeCount;
                maxDepth = Math.max(maxDepth, childStats.maxDepth);
                entityCount += childStats.entityCount;
            }
        }

        return { nodeCount, maxDepth, entityCount };
    }
}

// ============================================
// QuadTree2D Public API
// ============================================

export class QuadTree2D {
    private root: QuadTreeNode | null = null;
    private maxEntities: number;
    private maxDepth: number;

    constructor(maxEntities: number = DEFAULT_MAX_ENTITIES, maxDepth: number = DEFAULT_MAX_DEPTH) {
        this.maxEntities = maxEntities;
        this.maxDepth = maxDepth;
    }

    /**
     * Clear the tree.
     */
    clear(): void {
        this.root = null;
    }

    /**
     * Insert all bodies into the tree.
     * Automatically computes world bounds from entities.
     */
    insertAll(bodies: RigidBody2D[]): void {
        if (bodies.length === 0) return;

        // Compute world bounds from all entities (with padding)
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const body of bodies) {
            const bounds = getBodyBounds(body);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        }

        // Add small padding to avoid edge cases
        const padding = 1;
        this.root = new QuadTreeNode(
            { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding },
            0,
            this.maxEntities,
            this.maxDepth
        );

        // Insert all bodies
        for (const body of bodies) {
            const bounds = getBodyBounds(body);
            this.root.insert(body, bounds);
        }
    }

    /**
     * Query entities that might collide with the given body.
     */
    queryNearby(body: RigidBody2D): RigidBody2D[] {
        if (!this.root) return [];
        const result: RigidBody2D[] = [];
        const bounds = getBodyBounds(body);
        this.root.query(bounds, result);
        return result.filter(b => b !== body);
    }

    /**
     * Iterate all potential collision pairs.
     * Each pair is visited exactly once.
     * Order is deterministic (depth-first, NW→NE→SW→SE).
     */
    forEachPair(callback: (a: RigidBody2D, b: RigidBody2D) => void): void {
        if (!this.root) return;
        this.root.forEachPair(callback);
    }

    /**
     * Get tree statistics for debugging.
     */
    getStats(): { nodeCount: number; maxDepth: number; entityCount: number } {
        if (!this.root) return { nodeCount: 0, maxDepth: 0, entityCount: 0 };
        return this.root.getStats();
    }
}
