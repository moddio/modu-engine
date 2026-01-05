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
import { World2D } from './world';
import { Entity } from '../../entity/entity';
export interface Physics2DConfig {
    gravity?: {
        x: number;
        y: number;
    };
    /** Timestep in seconds (default: 1/60) */
    dt?: number;
}
export type CollisionHandler = (entityA: Entity, entityB: Entity) => void;
/**
 * Physics2D system - manages 2D physics world and collision handling
 */
export declare class Physics2D {
    /** The underlying physics world */
    readonly world: World2D;
    /** Type-based collision handlers: Map<"typeA:typeB", handler> */
    private collisionHandlers;
    constructor(config?: Physics2DConfig);
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
    onCollision(typeA: string, typeB: string, handler: CollisionHandler): this;
    /**
     * Get collision handler for two entity types.
     * Returns the handler with entities in correct order for the registered callback.
     */
    getCollisionHandler(typeA: string, typeB: string): CollisionHandler | undefined;
    /**
     * Check if a collision handler exists for these types.
     */
    hasCollisionHandler(typeA: string, typeB: string): boolean;
    /**
     * Handle collision between two entities using registered type handlers.
     * Called by the physics world during step.
     *
     * @returns true if a handler was found and called
     */
    handleCollision(entityA: Entity, entityB: Entity): boolean;
    /**
     * Step the physics simulation.
     * Collision handlers are called during this step.
     */
    step(): void;
    /**
     * Set gravity.
     */
    setGravity(x: number, y: number): this;
}
