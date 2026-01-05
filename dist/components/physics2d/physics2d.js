/**
 * Physics2D - High-level physics system for games
 *
 * Provides a clean API for physics configuration and type-based collision handling.
 * Collision handlers registered here are automatically restored after snapshots.
 *
 * Usage:
 *   const game = Modu.init();
 *   game.physics = new Physics2D({ gravity: { x: 0, y: 0 } });
 *
 *   game.physics.onCollision('cell', 'food', (cell, food) => {
 *       cell.body.setRadius(cell.sync.radius + 1);
 *       food.destroy();
 *   });
 */
import { createWorld2D, stepWorld2D } from './world';
import { toFixed } from '../../math/fixed';
/**
 * Physics2D system - manages 2D physics world and collision handling
 */
export class Physics2D {
    constructor(config = {}) {
        /** Type-based collision handlers: Map<"typeA:typeB", handler> */
        this.collisionHandlers = new Map();
        this.world = createWorld2D(config.dt ?? 1 / 60);
        if (config.gravity) {
            this.world.gravity = {
                x: toFixed(config.gravity.x),
                y: toFixed(config.gravity.y)
            };
        }
    }
    /**
     * Register a collision handler for two entity types.
     * Handler is called when entities of these types collide.
     * Handlers are automatically restored after snapshot - no onSnapshot needed.
     *
     * @param typeA - First entity type
     * @param typeB - Second entity type
     * @param handler - Callback receiving (entityA, entityB).
     *                  entityA is always the one with typeA, entityB with typeB.
     *
     * @example
     * game.physics.onCollision('cell', 'food', (cell, food) => {
     *     cell.body.setRadius(cell.sync.radius + food.sync.radius * 0.05);
     *     food.destroy();
     * });
     */
    onCollision(typeA, typeB, handler) {
        // Store both directions for lookup
        const key1 = `${typeA}:${typeB}`;
        const key2 = `${typeB}:${typeA}`;
        this.collisionHandlers.set(key1, handler);
        // For reverse lookup, wrap handler to swap arguments
        if (typeA !== typeB) {
            this.collisionHandlers.set(key2, (a, b) => handler(b, a));
        }
        return this;
    }
    /**
     * Get collision handler for two entity types.
     * Returns the handler with entities in correct order for the registered callback.
     */
    getCollisionHandler(typeA, typeB) {
        return this.collisionHandlers.get(`${typeA}:${typeB}`);
    }
    /**
     * Check if a collision handler exists for these types.
     */
    hasCollisionHandler(typeA, typeB) {
        return this.collisionHandlers.has(`${typeA}:${typeB}`) ||
            this.collisionHandlers.has(`${typeB}:${typeA}`);
    }
    /**
     * Handle collision between two entities using registered type handlers.
     * Called by the physics world during step.
     *
     * @returns true if a handler was found and called
     */
    handleCollision(entityA, entityB) {
        if (!entityA?.type || !entityB?.type)
            return false;
        const handler = this.getCollisionHandler(entityA.type, entityB.type);
        if (handler) {
            handler(entityA, entityB);
            return true;
        }
        return false;
    }
    /**
     * Step the physics simulation.
     * Collision handlers are called during this step.
     */
    step() {
        stepWorld2D(this.world);
    }
    /**
     * Set gravity.
     */
    setGravity(x, y) {
        this.world.gravity = { x: toFixed(x), y: toFixed(y) };
        return this;
    }
}
