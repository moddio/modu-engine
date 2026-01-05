/**
 * Physics2D System for ECS
 *
 * Integrates the deterministic 2D physics engine with the ECS.
 * This system:
 * - Reads Transform2D + Body2D components
 * - Creates/manages physics bodies internally
 * - Steps the physics simulation
 * - Writes results back to Transform2D component
 * - Handles collision callbacks
 */
import { World } from '../../core/world';
import { Entity } from '../../core/entity';
interface GameLike {
    world: World;
    physics: Physics2DSystem | null;
}
import { World2D, RigidBody2D } from '.';
/**
 * Collision handler type.
 */
export type CollisionHandler = (entityA: Entity, entityB: Entity) => void;
/**
 * Physics2D System configuration.
 */
export interface Physics2DSystemConfig {
    gravity?: {
        x: number;
        y: number;
    };
    dt?: number;
}
/**
 * Physics2D System - manages physics simulation for ECS entities.
 *
 * Can be used as a plugin via game.addPlugin() or standalone via attach().
 *
 * @example
 * // Plugin pattern (recommended)
 * const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });
 *
 * // Standalone pattern (legacy)
 * const physics = createPhysics2DSystem({ gravity: { x: 0, y: 0 } });
 * physics.attach(game.world);
 * game.physics = physics;
 */
export declare class Physics2DSystem {
    /** Physics world */
    readonly physicsWorld: World2D;
    /** ECS World reference */
    private world;
    /** Map entity ID to physics body */
    private entityToBody;
    /** Map body ID to entity ID */
    private bodyToEntity;
    /** Collision handlers by type pair */
    private collisionHandlers;
    /** Entities pending body creation */
    private pendingEntities;
    /**
     * Create a Physics2D system.
     *
     * @param gameOrConfig - Game instance (plugin mode) or config (standalone mode)
     * @param config - Config when using plugin mode
     */
    constructor(gameOrConfig?: GameLike | Physics2DSystemConfig, config?: Physics2DSystemConfig);
    /**
     * Attach to an ECS World.
     * Registers prePhysics and physics systems.
     */
    attach(world: World): this;
    /**
     * Register collision handler for two entity types.
     *
     * For different types (e.g., 'cell', 'food'), the handler is called once
     * with arguments in the registered order.
     *
     * For same types (e.g., 'cell', 'cell'), the handler is called twice -
     * once as (A, B) and once as (B, A). This lets you write "first acts on second"
     * logic without manually checking both directions.
     *
     * @example
     * // Cell eats food - called once per collision
     * physics.onCollision('cell', 'food', (cell, food) => {
     *     food.destroy();
     * });
     *
     * // Cell eats smaller cell - called twice, just check if first > second
     * physics.onCollision('cell', 'cell', (eater, prey) => {
     *     if (eater.get(Sprite).radius > prey.get(Sprite).radius * 1.2) {
     *         prey.destroy();
     *     }
     * });
     */
    onCollision(typeA: string, typeB: string, handler: CollisionHandler): this;
    /**
     * Set gravity.
     */
    setGravity(x: number, y: number): this;
    /**
     * Create or get physics body for entity.
     */
    private ensureBody;
    /**
     * Remove physics body for entity.
     */
    removeBody(entity: Entity): void;
    /**
     * Sync component data to physics bodies (prePhysics).
     */
    private syncBodiesToPhysics;
    /**
     * Step physics simulation.
     */
    private step;
    /**
     * Sync physics results back to components (postPhysics).
     */
    private syncPhysicsToComponents;
    /**
     * Handle collision between two bodies.
     */
    private handleCollision;
    /**
     * Handle collision by entity types. Returns true if a handler was found.
     * Used by physics world for both regular and sensor collisions.
     */
    private handleCollisionByType;
    /**
     * Get body for entity (for advanced use).
     */
    getBody(entity: Entity): RigidBody2D | undefined;
    /**
     * Get entity for body (for advanced use).
     */
    getEntityForBody(body: RigidBody2D): Entity | null;
    /**
     * Clear all physics state.
     * Used during snapshot restoration to ensure fresh physics state.
     */
    clear(): void;
    /**
     * Wake all physics bodies.
     * Used after snapshot load/send to ensure deterministic state.
     * Without this, existing clients have sleeping bodies while late joiners
     * have awake bodies, causing physics divergence.
     */
    wakeAllBodies(): void;
}
/**
 * Create a Physics2D system.
 */
export declare function createPhysics2DSystem(config?: Physics2DSystemConfig): Physics2DSystem;
export {};
