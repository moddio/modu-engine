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
import { ComponentType, hasComponent } from '../../core/component';
import { Transform2D, Body2D, BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC, SHAPE_CIRCLE, SHAPE_RECT } from '../../components';
import { INDEX_MASK } from '../../core/constants';
import { toFixed, toFloat } from '../../math';

// Forward declaration for Game to avoid circular import
interface GameLike {
    world: World;
    physics: Physics2DSystem | null;
}

// Import physics engine primitives (same folder now)
import {
    World2D,
    createWorld2D,
    stepWorld2D,
    addBody2D,
    removeBody2D,
    RigidBody2D,
    BodyType2D,
    createBody2D,
    createCircle,
    createBox2DFromSize,
    resetBody2DIdCounter
} from '.';

/**
 * Collision handler type.
 */
export type CollisionHandler = (entityA: Entity, entityB: Entity) => void;

/**
 * Physics2D System configuration.
 */
export interface Physics2DSystemConfig {
    gravity?: { x: number; y: number };
    dt?: number;  // Timestep (default: 1/60)
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
export class Physics2DSystem {
    /** Physics world */
    readonly physicsWorld: World2D;

    /** ECS World reference */
    private world: World | null = null;

    /** Map entity ID to physics body */
    private entityToBody: Map<number, RigidBody2D> = new Map();

    /** Map body ID to entity ID */
    private bodyToEntity: Map<number, number> = new Map();

    /** Collision handlers by type pair */
    private collisionHandlers: Map<string, CollisionHandler> = new Map();

    /** Entities pending body creation */
    private pendingEntities: Set<number> = new Set();

    /**
     * Create a Physics2D system.
     *
     * @param gameOrConfig - Game instance (plugin mode) or config (standalone mode)
     * @param config - Config when using plugin mode
     */
    constructor(gameOrConfig?: GameLike | Physics2DSystemConfig, config?: Physics2DSystemConfig) {
        // Determine if first arg is a Game or config
        let actualConfig: Physics2DSystemConfig;
        let game: GameLike | null = null;

        if (gameOrConfig && 'world' in gameOrConfig) {
            // Plugin mode: first arg is Game
            game = gameOrConfig;
            actualConfig = config ?? {};
        } else {
            // Standalone mode: first arg is config
            actualConfig = (gameOrConfig as Physics2DSystemConfig) ?? {};
        }

        this.physicsWorld = createWorld2D(actualConfig.dt ?? 1 / 60);

        if (actualConfig.gravity) {
            this.physicsWorld.gravity = {
                x: toFixed(actualConfig.gravity.x),
                y: toFixed(actualConfig.gravity.y)
            };
        }

        // Set up collision callback via contactListener (for non-sensor collisions)
        const system = this;
        this.physicsWorld.contactListener = {
            onContact(bodyA: RigidBody2D, bodyB: RigidBody2D) {
                system.handleCollision(bodyA, bodyB);
            }
        };

        // Set up physics2d reference for sensor collisions
        // The physics world uses this for type-based collision handling
        (this.physicsWorld as any).physics2d = {
            handleCollision: (entityA: Entity, entityB: Entity) => {
                return this.handleCollisionByType(entityA, entityB);
            }
        };

        // Auto-attach if game was provided
        if (game) {
            this.attach(game.world);
            game.physics = this;
        }
    }

    /**
     * Attach to an ECS World.
     * Registers prePhysics and physics systems.
     */
    attach(world: World): this {
        this.world = world;

        // Register prePhysics system - sync component data to bodies
        world.addSystem(() => this.syncBodiesToPhysics(), { phase: 'prePhysics', order: 0 });

        // Register physics system - step simulation
        world.addSystem(() => this.step(), { phase: 'physics', order: 0 });

        // Register postPhysics system - sync results back to components
        world.addSystem(() => this.syncPhysicsToComponents(), { phase: 'postPhysics', order: 0 });

        return this;
    }

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
    onCollision(typeA: string, typeB: string, handler: CollisionHandler): this {
        const key1 = `${typeA}:${typeB}`;
        const key2 = `${typeB}:${typeA}`;

        this.collisionHandlers.set(key1, handler);

        // For different types, register reverse lookup that swaps arguments
        if (typeA !== typeB) {
            this.collisionHandlers.set(key2, (a, b) => handler(b, a));
        }

        return this;
    }

    /**
     * Set gravity.
     */
    setGravity(x: number, y: number): this {
        this.physicsWorld.gravity = { x: toFixed(x), y: toFixed(y) };
        return this;
    }

    /**
     * Create or get physics body for entity.
     */
    private ensureBody(entity: Entity): RigidBody2D | null {
        const eid = entity.eid;

        // Check if body already exists
        let body = this.entityToBody.get(eid);
        if (body) return body;

        // Check if entity has required components
        if (!entity.has(Transform2D) || !entity.has(Body2D)) {
            return null;
        }

        // Get component data
        const transform = entity.get(Transform2D);
        const bodyData = entity.get(Body2D);

        // Determine body type
        let bodyType: BodyType2D;
        switch (bodyData.bodyType) {
            case BODY_STATIC:
                bodyType = BodyType2D.Static;
                break;
            case BODY_KINEMATIC:
                bodyType = BodyType2D.Kinematic;
                break;
            default:
                bodyType = BodyType2D.Dynamic;
        }

        // Determine shape
        let shape;
        if (bodyData.shapeType === SHAPE_CIRCLE || bodyData.radius > 0) {
            shape = createCircle(bodyData.radius || 10);
        } else {
            shape = createBox2DFromSize(bodyData.width || 10, bodyData.height || 10);
        }

        // Create body
        body = createBody2D(bodyType, shape, transform.x, transform.y);
        body.angle = toFixed(transform.angle);
        body.linearVelocity = { x: toFixed(bodyData.vx), y: toFixed(bodyData.vy) };
        body.angularVelocity = toFixed(bodyData.angularVelocity);
        body.isSensor = bodyData.isSensor;
        body.lockRotation = bodyData.lockRotation;

        // CRITICAL: All new bodies start awake for determinism
        // Without this, late joiners would have awake bodies while existing clients
        // have sleeping bodies, causing physics simulation divergence
        body.isSleeping = false;
        body.sleepFrames = 0;

        // Store entity reference in body's userData
        body.userData = entity;
        body.label = eid.toString();

        // Add to physics world
        addBody2D(this.physicsWorld, body);

        // Track mapping
        this.entityToBody.set(eid, body);
        this.bodyToEntity.set(body.id, eid);

        return body;
    }

    /**
     * Remove physics body for entity.
     */
    removeBody(entity: Entity): void {
        const eid = entity.eid;
        const body = this.entityToBody.get(eid);

        if (body) {
            removeBody2D(this.physicsWorld, body);
            this.entityToBody.delete(eid);
            this.bodyToEntity.delete(body.id);
        }
    }

    /**
     * Sync component data to physics bodies (prePhysics).
     */
    private syncBodiesToPhysics(): void {
        if (!this.world) return;

        // Iterate all entities with Body2D
        for (const entity of this.world.query(Body2D)) {
            // Ensure body exists
            const body = this.ensureBody(entity);
            if (!body) continue;

            // Sync position from component for kinematic and static bodies
            // (both can be moved by game code, only dynamic bodies are physics-driven)
            const bodyData = entity.get(Body2D);
            if (bodyData.bodyType === BODY_KINEMATIC || bodyData.bodyType === BODY_STATIC) {
                const transform = entity.get(Transform2D);
                body.position.x = toFixed(transform.x);
                body.position.y = toFixed(transform.y);
                body.angle = toFixed(transform.angle);
            }

            // Apply impulses (instant velocity change)
            if (bodyData.impulseX !== 0 || bodyData.impulseY !== 0) {
                bodyData.vx += bodyData.impulseX;
                bodyData.vy += bodyData.impulseY;
                bodyData.impulseX = 0;
                bodyData.impulseY = 0;
            }

            // Apply forces (add to velocity)
            if (bodyData.forceX !== 0 || bodyData.forceY !== 0) {
                bodyData.vx += bodyData.forceX;
                bodyData.vy += bodyData.forceY;
                bodyData.forceX = 0;
                bodyData.forceY = 0;
            }

            // Apply damping
            if (bodyData.damping > 0) {
                const damp = 1 - bodyData.damping;
                bodyData.vx *= damp;
                bodyData.vy *= damp;
            }

            // Sync velocity for all body types
            const newVelX = toFixed(bodyData.vx);
            const newVelY = toFixed(bodyData.vy);
            body.linearVelocity.x = newVelX;
            body.linearVelocity.y = newVelY;

            // Sync angular velocity
            body.angularVelocity = toFixed(bodyData.angularVelocity);

            // Wake up body if velocity is non-zero (prevents sleeping bodies from ignoring velocity)
            if (newVelX !== 0 || newVelY !== 0) {
                body.isSleeping = false;
                body.sleepFrames = 0;
            }

            // Update shape radius if changed
            if (body.shape.type === 0) { // Circle
                const currentRadius = (body.shape as any).radius;
                const newRadius = toFixed(bodyData.radius);
                if (currentRadius !== newRadius) {
                    (body.shape as any).radius = newRadius;
                }
            }
        }

        // Clean up bodies for destroyed entities
        for (const [eid, body] of this.entityToBody) {
            if (this.world.isDestroyed(eid)) {
                removeBody2D(this.physicsWorld, body);
                this.entityToBody.delete(eid);
                this.bodyToEntity.delete(body.id);
            }
        }
    }

    /**
     * Step physics simulation.
     */
    private step(): void {
        stepWorld2D(this.physicsWorld);
    }

    /**
     * Sync physics results back to components (postPhysics).
     */
    private syncPhysicsToComponents(): void {
        for (const [eid, body] of this.entityToBody) {
            const entity = this.world?.getEntity(eid);
            if (!entity || entity.destroyed) continue;

            const transform = entity.get(Transform2D);
            const bodyData = entity.get(Body2D);

            // Sync position from physics
            transform.x = toFloat(body.position.x);
            transform.y = toFloat(body.position.y);

            // Sync angle based on lockRotation:
            // - If locked: game controls angle, sync physics FROM transform
            // - If not locked: physics controls angle, sync transform FROM physics
            if (body.lockRotation) {
                body.angle = toFixed(transform.angle);
            } else {
                transform.angle = toFloat(body.angle);
            }

            // Sync velocity (linear and angular)
            bodyData.vx = toFloat(body.linearVelocity.x);
            bodyData.vy = toFloat(body.linearVelocity.y);
            bodyData.angularVelocity = toFloat(body.angularVelocity);
        }
    }

    /**
     * Handle collision between two bodies.
     */
    private handleCollision(bodyA: RigidBody2D, bodyB: RigidBody2D): void {
        const entityA = bodyA.userData as Entity;
        const entityB = bodyB.userData as Entity;

        if (!entityA || !entityB) return;
        if (entityA.destroyed || entityB.destroyed) return;

        this.handleCollisionByType(entityA, entityB);
    }

    /**
     * Handle collision by entity types. Returns true if a handler was found.
     * Used by physics world for both regular and sensor collisions.
     */
    private handleCollisionByType(entityA: Entity, entityB: Entity): boolean {
        if (!entityA || !entityB) return false;
        if (entityA.destroyed || entityB.destroyed) return false;

        // Look up handler by type pair
        const key = `${entityA.type}:${entityB.type}`;
        const handler = this.collisionHandlers.get(key);

        if (handler) {
            handler(entityA, entityB);

            // For same-type collisions, call handler in reverse direction too
            // This lets handlers assume "first arg acts on second" without manual checks
            if (entityA.type === entityB.type && !entityA.destroyed && !entityB.destroyed) {
                handler(entityB, entityA);
            }
            return true;
        }
        return false;
    }

    /**
     * Get body for entity (for advanced use).
     */
    getBody(entity: Entity): RigidBody2D | undefined {
        return this.entityToBody.get(entity.eid);
    }

    /**
     * Get entity for body (for advanced use).
     */
    getEntityForBody(body: RigidBody2D): Entity | null {
        const eid = this.bodyToEntity.get(body.id);
        if (eid === undefined) return null;
        return this.world?.getEntity(eid) ?? null;
    }

    /**
     * Clear all physics state.
     * Used during snapshot restoration to ensure fresh physics state.
     */
    clear(): void {
        const bodyCount = this.entityToBody.size;
        for (const body of this.entityToBody.values()) {
            removeBody2D(this.physicsWorld, body);
        }
        this.entityToBody.clear();
        this.bodyToEntity.clear();

        // CRITICAL: Reset body ID counter to ensure deterministic body IDs
        // Without this, recreated bodies would have different IDs than the original,
        // potentially causing collision order differences and simulation divergence
        resetBody2DIdCounter();
        console.log(`[PHYSICS-CLEAR] Cleared ${bodyCount} bodies`);
    }

    /**
     * Wake all physics bodies.
     * Used after snapshot load/send to ensure deterministic state.
     * Without this, existing clients have sleeping bodies while late joiners
     * have awake bodies, causing physics divergence.
     */
    wakeAllBodies(): void {
        for (const body of this.physicsWorld.bodies) {
            body.isSleeping = false;
            body.sleepFrames = 0;
        }
    }

    /**
     * Force sync ALL physics bodies from ECS components.
     * CRITICAL: Must be called after snapshot load to ensure physics world
     * matches the restored ECS state.
     *
     * Normal syncBodiesToPhysics() only syncs kinematic/static bodies' positions.
     * This function syncs ALL body types' positions AND velocities from ECS components.
     *
     * NOTE: If entityToBody is empty (bodies not yet created), this will first
     * create all bodies via ensureBody() to ensure they exist before syncing.
     */
    syncAllFromComponents(): void {
        if (!this.world) return;

        // CRITICAL: If no bodies exist yet (e.g., after clear()), we need to create them first
        // Otherwise this sync does nothing and bodies get created with possibly wrong state
        // CRITICAL: Sort by entity ID to ensure deterministic body creation order
        // Without sorting, iteration order may differ between room creator and late joiners
        const entitiesWithBody2D = [...this.world.query(Body2D)].sort((a, b) => a.eid - b.eid);
        const bodiesExistedBefore = this.entityToBody.size;
        if (this.entityToBody.size === 0 && entitiesWithBody2D.length > 0) {
            console.log(`[PHYSICS-SYNC] Creating ${entitiesWithBody2D.length} bodies from scratch`);
            for (const entity of entitiesWithBody2D) {
                this.ensureBody(entity);
            }
        }

        // Now sync all bodies
        let syncedCount = 0;
        for (const [eid, body] of this.entityToBody) {
            const entity = this.world.getEntity(eid);
            if (!entity || entity.destroyed) continue;

            const transform = entity.get(Transform2D);
            const bodyData = entity.get(Body2D);

            // Log first few bodies for debugging
            if (syncedCount < 3) {
                console.log(`[PHYSICS-SYNC] Body ${eid}: pos(${transform.x.toFixed(1)},${transform.y.toFixed(1)}) -> physics`);
            }

            // Sync position and angle from Transform2D
            body.position.x = toFixed(transform.x);
            body.position.y = toFixed(transform.y);
            body.angle = toFixed(transform.angle);

            // Sync velocity (linear and angular) from Body2D
            body.linearVelocity.x = toFixed(bodyData.vx);
            body.linearVelocity.y = toFixed(bodyData.vy);
            body.angularVelocity = toFixed(bodyData.angularVelocity);

            // Wake the body to ensure it's active
            body.isSleeping = false;
            body.sleepFrames = 0;
            syncedCount++;
        }

        console.log(`[PHYSICS-SYNC] Synced ${syncedCount} bodies (existed before: ${bodiesExistedBefore})`);
    }
}

/**
 * Create a Physics2D system.
 */
export function createPhysics2DSystem(config: Physics2DSystemConfig = {}): Physics2DSystem {
    return new Physics2DSystem(config);
}
