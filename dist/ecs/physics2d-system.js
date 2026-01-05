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
import { Transform2D, Body2D, BODY_STATIC, BODY_KINEMATIC, SHAPE_CIRCLE } from './components';
import { toFixed, toFloat } from '../math';
// Import physics engine primitives
import { createWorld2D, stepWorld2D, addBody2D, removeBody2D, BodyType2D, createBody2D, createCircle, createBox2DFromSize, resetBody2DIdCounter } from '../components/physics2d';
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
    /**
     * Create a Physics2D system.
     *
     * @param gameOrConfig - Game instance (plugin mode) or config (standalone mode)
     * @param config - Config when using plugin mode
     */
    constructor(gameOrConfig, config) {
        /** ECS World reference */
        this.world = null;
        /** Map entity ID to physics body */
        this.entityToBody = new Map();
        /** Map body ID to entity ID */
        this.bodyToEntity = new Map();
        /** Collision handlers by type pair */
        this.collisionHandlers = new Map();
        /** Entities pending body creation */
        this.pendingEntities = new Set();
        // Determine if first arg is a Game or config
        let actualConfig;
        let game = null;
        if (gameOrConfig && 'world' in gameOrConfig) {
            // Plugin mode: first arg is Game
            game = gameOrConfig;
            actualConfig = config ?? {};
        }
        else {
            // Standalone mode: first arg is config
            actualConfig = gameOrConfig ?? {};
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
            onContact(bodyA, bodyB) {
                system.handleCollision(bodyA, bodyB);
            }
        };
        // Set up physics2d reference for sensor collisions
        // The physics world uses this for type-based collision handling
        this.physicsWorld.physics2d = {
            handleCollision: (entityA, entityB) => {
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
    attach(world) {
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
    onCollision(typeA, typeB, handler) {
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
    setGravity(x, y) {
        this.physicsWorld.gravity = { x: toFixed(x), y: toFixed(y) };
        return this;
    }
    /**
     * Create or get physics body for entity.
     */
    ensureBody(entity) {
        const eid = entity.eid;
        // Check if body already exists
        let body = this.entityToBody.get(eid);
        if (body)
            return body;
        // Check if entity has required components
        if (!entity.has(Transform2D) || !entity.has(Body2D)) {
            return null;
        }
        // Get component data
        const transform = entity.get(Transform2D);
        const bodyData = entity.get(Body2D);
        // Determine body type
        let bodyType;
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
        }
        else {
            shape = createBox2DFromSize(bodyData.width || 10, bodyData.height || 10);
        }
        // Create body
        body = createBody2D(bodyType, shape, transform.x, transform.y);
        body.angle = toFixed(transform.angle);
        body.linearVelocity = { x: toFixed(bodyData.vx), y: toFixed(bodyData.vy) };
        body.isSensor = bodyData.isSensor;
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
    removeBody(entity) {
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
    syncBodiesToPhysics() {
        if (!this.world)
            return;
        // Iterate all entities with Body2D
        for (const entity of this.world.query(Body2D)) {
            // Ensure body exists
            const body = this.ensureBody(entity);
            if (!body)
                continue;
            // For kinematic bodies, sync position from component
            // (they're controlled by game logic, not physics)
            const bodyData = entity.get(Body2D);
            if (bodyData.bodyType === BODY_KINEMATIC) {
                const transform = entity.get(Transform2D);
                body.position.x = toFixed(transform.x);
                body.position.y = toFixed(transform.y);
                body.angle = toFixed(transform.angle);
            }
            // Sync velocity for all body types
            const newVelX = toFixed(bodyData.vx);
            const newVelY = toFixed(bodyData.vy);
            body.linearVelocity.x = newVelX;
            body.linearVelocity.y = newVelY;
            // Wake up body if velocity is non-zero (prevents sleeping bodies from ignoring velocity)
            if (newVelX !== 0 || newVelY !== 0) {
                body.isSleeping = false;
                body.sleepFrames = 0;
            }
            // Update shape radius if changed
            if (body.shape.type === 0) { // Circle
                const currentRadius = body.shape.radius;
                const newRadius = toFixed(bodyData.radius);
                if (currentRadius !== newRadius) {
                    body.shape.radius = newRadius;
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
    step() {
        stepWorld2D(this.physicsWorld);
    }
    /**
     * Sync physics results back to components (postPhysics).
     */
    syncPhysicsToComponents() {
        for (const [eid, body] of this.entityToBody) {
            const entity = this.world?.getEntity(eid);
            if (!entity || entity.destroyed)
                continue;
            const transform = entity.get(Transform2D);
            const bodyData = entity.get(Body2D);
            // Sync position and angle from physics
            transform.x = toFloat(body.position.x);
            transform.y = toFloat(body.position.y);
            transform.angle = toFloat(body.angle);
            // Sync velocity
            bodyData.vx = toFloat(body.linearVelocity.x);
            bodyData.vy = toFloat(body.linearVelocity.y);
        }
    }
    /**
     * Handle collision between two bodies.
     */
    handleCollision(bodyA, bodyB) {
        const entityA = bodyA.userData;
        const entityB = bodyB.userData;
        if (!entityA || !entityB)
            return;
        if (entityA.destroyed || entityB.destroyed)
            return;
        this.handleCollisionByType(entityA, entityB);
    }
    /**
     * Handle collision by entity types. Returns true if a handler was found.
     * Used by physics world for both regular and sensor collisions.
     */
    handleCollisionByType(entityA, entityB) {
        if (!entityA || !entityB)
            return false;
        if (entityA.destroyed || entityB.destroyed)
            return false;
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
    getBody(entity) {
        return this.entityToBody.get(entity.eid);
    }
    /**
     * Get entity for body (for advanced use).
     */
    getEntityForBody(body) {
        const eid = this.bodyToEntity.get(body.id);
        if (eid === undefined)
            return null;
        return this.world?.getEntity(eid) ?? null;
    }
    /**
     * Clear all physics state.
     * Used during snapshot restoration to ensure fresh physics state.
     */
    clear() {
        for (const body of this.entityToBody.values()) {
            removeBody2D(this.physicsWorld, body);
        }
        this.entityToBody.clear();
        this.bodyToEntity.clear();
        // CRITICAL: Reset body ID counter to ensure deterministic body IDs
        // Without this, recreated bodies would have different IDs than the original,
        // potentially causing collision order differences and simulation divergence
        resetBody2DIdCounter();
    }
    /**
     * Wake all physics bodies.
     * Used after snapshot load/send to ensure deterministic state.
     * Without this, existing clients have sleeping bodies while late joiners
     * have awake bodies, causing physics divergence.
     */
    wakeAllBodies() {
        for (const body of this.physicsWorld.bodies) {
            body.isSleeping = false;
            body.sleepFrames = 0;
        }
    }
}
/**
 * Create a Physics2D system.
 */
export function createPhysics2DSystem(config = {}) {
    return new Physics2DSystem(config);
}
