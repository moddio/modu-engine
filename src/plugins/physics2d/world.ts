/**
 * 2D Physics World
 *
 * Manages the 2D physics simulation including gravity, collision detection,
 * and integration of velocities and positions.
 */

import { Fixed, FP_ONE, FP_HALF, toFixed, toFloat, fpMul, fpDiv, fpAbs } from '../../math/fixed';
import { aabb2DOverlap, Shape2D, Shape2DType, CircleShape, BoxShape2D } from './shapes';
import { RigidBody2D, BodyType2D, Vec2, vec2, vec2Zero, vec2Add, vec2Scale, vec2LengthSq, createBody2D, setBody2DIdCounter, getBody2DIdCounter } from './rigid-body';
import { Contact2D, computeAABB2D, detectCollision2D, resolveCollision2D } from './collision';
import { shouldCollide, CollisionFilter, DEFAULT_FILTER } from './layers';
import { TriggerState, TriggerEvent } from './trigger';
import { SpatialHash2D } from './spatial-hash';

// ============================================
// Constants
// ============================================

const GRAVITY_2D: Vec2 = { x: 0, y: toFixed(-30) };  // -30 units/s² (down in Y)
const LINEAR_DAMPING = toFixed(0.1);
const ANGULAR_DAMPING = toFixed(0.1);
const SLEEP_THRESHOLD = toFixed(0.12);
const SLEEP_FRAMES_REQUIRED = 20;

// Default spatial hash cell size - should be >= largest entity diameter
const DEFAULT_CELL_SIZE = 64;

// ============================================
// Trigger Event 2D
// ============================================

export interface TriggerEvent2D {
    trigger: RigidBody2D;
    other: RigidBody2D;
}

// ============================================
// Contact Listener
// ============================================

export interface ContactListener2D {
    onContact(bodyA: RigidBody2D, bodyB: RigidBody2D): void;
}

// ============================================
// World Interface
// ============================================

export interface World2D {
    bodies: RigidBody2D[];
    gravity: Vec2;
    dt: Fixed;
    contactListener?: ContactListener2D;
    /** Reference to Physics2D system for type-based collision handling */
    physics2d?: any;
    /** Step the physics simulation */
    step(): void;
}

export function createWorld2D(dt: number = 1 / 60): World2D {
    const world: World2D = {
        bodies: [],
        gravity: { x: GRAVITY_2D.x, y: GRAVITY_2D.y },
        dt: toFixed(dt),
        step() {
            stepWorld2D(world);
        }
    };
    return world;
}

export function addBody2D(world: World2D, body: RigidBody2D): void {
    world.bodies.push(body);
}

export function removeBody2D(world: World2D, body: RigidBody2D): void {
    const index = world.bodies.indexOf(body);
    if (index >= 0) {
        world.bodies.splice(index, 1);
    }
}

// ============================================
// World Step
// ============================================

export function stepWorld2D(world: World2D): { contacts: Contact2D[]; triggers: TriggerEvent2D[] } {
    const { gravity, dt } = world;
    const contacts: Contact2D[] = [];
    const triggerOverlaps: TriggerEvent2D[] = [];

    // Collect collision pairs for deterministic callback firing AFTER detection
    const collisionPairs: Array<{ entityA: any; entityB: any; labelA: string; labelB: string }> = [];

    // Sort bodies by label for deterministic collision processing
    const bodies = [...world.bodies].sort((a, b) => a.label.localeCompare(b.label));

    // Integrate velocities (apply gravity)
    for (const body of bodies) {
        if (body.type !== BodyType2D.Dynamic) continue;
        if (body.isSleeping) continue;

        // Apply gravity
        body.linearVelocity = vec2Add(body.linearVelocity, vec2Scale(gravity, dt));

        // Apply damping
        const linearDamp = (FP_ONE - LINEAR_DAMPING) as Fixed;
        const angularDamp = (FP_ONE - ANGULAR_DAMPING) as Fixed;

        body.linearVelocity = vec2Scale(body.linearVelocity, linearDamp);
        body.angularVelocity = fpMul(body.angularVelocity, angularDamp);
    }

    // Collision detection using spatial hash for O(1) broad phase
    // Cell size should be >= largest entity diameter for optimal performance
    const spatialHash = new SpatialHash2D(DEFAULT_CELL_SIZE);
    spatialHash.insertAll(bodies);

    // Process potential collision pairs directly (no intermediate array allocation)
    spatialHash.forEachPair((bodyA, bodyB) => {
        // Skip static-static (no collision needed)
        if (bodyA.type === BodyType2D.Static && bodyB.type === BodyType2D.Static) return;
        if (!shouldCollide(bodyA.filter, bodyB.filter)) return;

        // Broad phase: AABB overlap test (spatial hash gives candidates, still need precise AABB)
        const aabbA = computeAABB2D(bodyA);
        const aabbB = computeAABB2D(bodyB);
        if (!aabb2DOverlap(aabbA, aabbB)) return;

        // Narrow phase: precise collision detection
        const contact = detectCollision2D(bodyA, bodyB);

        if (!contact) return;

        // Collect entity pairs for callback firing (all collisions including sensors)
        const entityA = bodyA.userData;
        const entityB = bodyB.userData;
        if (entityA || entityB) {
            collisionPairs.push({
                entityA,
                entityB,
                labelA: bodyA.label,
                labelB: bodyB.label
            });
        }

        // Sensors: detect overlap but skip physics response
        if (bodyA.isSensor || bodyB.isSensor) {
            if (bodyA.isSensor) triggerOverlaps.push({ trigger: bodyA, other: bodyB });
            if (bodyB.isSensor) triggerOverlaps.push({ trigger: bodyB, other: bodyA });
            return;
        }

        // Store contact and fire contact listener
        contacts.push(contact);
        if (world.contactListener) world.contactListener.onContact(bodyA, bodyB);

        // Resolve collision (position + velocity)
        resolveCollision2D(contact);
    });

    // Fire entity collision callbacks AFTER all detection is complete
    // Sort by both labels to ensure deterministic ordering across clients
    collisionPairs.sort((a, b) => {
        const cmp = a.labelA.localeCompare(b.labelA);
        return cmp !== 0 ? cmp : a.labelB.localeCompare(b.labelB);
    });

    for (const pair of collisionPairs) {
        // Check active status at callback time (may have changed during earlier callbacks)
        if (pair.entityA?.active === false || pair.entityB?.active === false) continue;

        // Try Physics2D type-based handlers first (preferred - auto-restored)
        if (world.physics2d?.handleCollision?.(pair.entityA, pair.entityB)) {
            continue; // Handler found and called, skip entity.onCollision
        }

        // Fall back to entity.onCollision (legacy - requires manual restore in onSnapshot)
        if (pair.entityA?.onCollision) {
            pair.entityA.onCollision(pair.entityB);
        }
        if (pair.entityB?.onCollision) {
            pair.entityB.onCollision(pair.entityA);
        }
    }

    // Integrate positions
    for (const body of bodies) {
        if (body.type === BodyType2D.Static) continue;
        if (body.isSleeping) continue;

        // Clamp tiny velocities
        const linearClamp = toFixed(0.05);
        const angularClamp = toFixed(0.01);

        if (fpAbs(body.linearVelocity.x) < linearClamp) body.linearVelocity.x = 0;
        if (fpAbs(body.linearVelocity.y) < linearClamp) body.linearVelocity.y = 0;
        if (fpAbs(body.angularVelocity) < angularClamp) body.angularVelocity = 0;

        // Update position
        body.position = vec2Add(body.position, vec2Scale(body.linearVelocity, dt));

        // Update angle
        if (!body.lockRotation && body.angularVelocity !== 0) {
            body.angle = (body.angle + fpMul(body.angularVelocity, dt)) as Fixed;
        }

        // Sleep detection
        const speedSq = vec2LengthSq(body.linearVelocity);
        const angSpeedSq = fpMul(body.angularVelocity, body.angularVelocity);
        const sleepThreshSq = fpMul(SLEEP_THRESHOLD, SLEEP_THRESHOLD);

        if (speedSq < sleepThreshSq && angSpeedSq < sleepThreshSq) {
            body.sleepFrames++;
            if (body.sleepFrames >= SLEEP_FRAMES_REQUIRED) {
                body.isSleeping = true;
                body.linearVelocity = vec2Zero();
                body.angularVelocity = 0;
            }
        } else {
            body.sleepFrames = 0;
            body.isSleeping = false;
        }
    }

    return { contacts, triggers: triggerOverlaps };
}

// ============================================
// State Serialization
// ============================================

/**
 * Serialized shape data for snapshots.
 * Contains all information needed to recreate a shape.
 */
export interface ShapeState2D {
    type: Shape2DType;
    // Circle
    radius?: Fixed;
    // Box
    halfWidth?: Fixed;
    halfHeight?: Fixed;
}

/**
 * Complete body state for snapshots.
 * Contains ALL information needed to recreate a body from scratch.
 * This is critical for late joiners who have an empty world.
 */
export interface BodyState2D {
    // Identity
    id: number;
    label: string;
    bodyType: BodyType2D;

    // Shape (required for body creation)
    shape: ShapeState2D;

    // Transform
    px: Fixed;
    py: Fixed;
    angle: Fixed;

    // Velocity
    vx: Fixed;
    vy: Fixed;
    av: Fixed;

    // Material properties
    mass: Fixed;
    restitution: Fixed;
    friction: Fixed;

    // State flags
    isSleeping: boolean;
    sleepFrames: number;
    lockRotation: boolean;
    isSensor: boolean;
    isBullet: boolean;

    // Collision filter
    filter: CollisionFilter;

    // User data (game-specific)
    userData?: any;
}

export interface WorldState2D {
    bodies: BodyState2D[];
}

export interface WorldStateWithHash2D {
    state: WorldState2D;
    hash: number;
}

/**
 * Serialize a shape to ShapeState2D.
 */
function serializeShape(shape: Shape2D): ShapeState2D {
    if (shape.type === Shape2DType.Circle) {
        return {
            type: Shape2DType.Circle,
            radius: (shape as CircleShape).radius,
        };
    } else {
        const box = shape as BoxShape2D;
        return {
            type: Shape2DType.Box,
            halfWidth: box.halfWidth,
            halfHeight: box.halfHeight,
        };
    }
}

/**
 * Deserialize ShapeState2D back to Shape2D.
 */
function deserializeShape(state: ShapeState2D): Shape2D {
    if (state.type === Shape2DType.Circle) {
        return {
            type: Shape2DType.Circle,
            radius: state.radius!,
        } as CircleShape;
    } else {
        return {
            type: Shape2DType.Box,
            halfWidth: state.halfWidth!,
            halfHeight: state.halfHeight!,
        } as BoxShape2D;
    }
}

/**
 * Serialize a single body to BodyState2D.
 * Contains ALL information needed to recreate the body.
 */
function serializeBody(b: RigidBody2D): BodyState2D {
    return {
        id: b.id,
        label: b.label,
        bodyType: b.type,
        shape: serializeShape(b.shape),
        px: b.position.x,
        py: b.position.y,
        angle: b.angle,
        vx: b.linearVelocity.x,
        vy: b.linearVelocity.y,
        av: b.angularVelocity,
        mass: b.mass,
        restitution: b.restitution,
        friction: b.friction,
        isSleeping: b.isSleeping,
        sleepFrames: b.sleepFrames,
        lockRotation: b.lockRotation,
        isSensor: b.isSensor,
        isBullet: b.isBullet,
        filter: { ...b.filter },
        userData: b.userData,
    };
}

/**
 * Save world state - use saveWorldStateWithHash2D for efficiency when you need both
 */
export function saveWorldState2D(world: World2D): WorldState2D {
    return {
        bodies: world.bodies.map(serializeBody)
    };
}

/**
 * Save world state AND compute hash in a single pass.
 * More efficient than calling saveWorldState2D + separate hash function.
 */
export function saveWorldStateWithHash2D(world: World2D): WorldStateWithHash2D {
    const bodies: BodyState2D[] = [];
    let hash = 0;

    // Single pass: serialize and hash simultaneously
    for (const b of world.bodies) {
        const bs = serializeBody(b);
        bodies.push(bs);

        // Compute hash inline - include all determinism-relevant state
        hash = ((hash << 5) - hash + bs.id) >>> 0;
        hash = ((hash << 5) - hash + bs.bodyType) >>> 0;
        hash = ((hash << 5) - hash + bs.shape.type) >>> 0;
        if (bs.shape.radius !== undefined) {
            hash = ((hash << 5) - hash + bs.shape.radius) >>> 0;
        }
        if (bs.shape.halfWidth !== undefined) {
            hash = ((hash << 5) - hash + bs.shape.halfWidth) >>> 0;
            hash = ((hash << 5) - hash + bs.shape.halfHeight!) >>> 0;
        }
        hash = ((hash << 5) - hash + bs.px) >>> 0;
        hash = ((hash << 5) - hash + bs.py) >>> 0;
        hash = ((hash << 5) - hash + bs.vx) >>> 0;
        hash = ((hash << 5) - hash + bs.vy) >>> 0;
        hash = ((hash << 5) - hash + bs.angle) >>> 0;
        hash = ((hash << 5) - hash + bs.av) >>> 0;
        hash = ((hash << 5) - hash + bs.mass) >>> 0;
    }

    return { state: { bodies }, hash };
}

/**
 * Create a body from serialized state.
 * This is used for late joiners who need to recreate bodies from scratch.
 */
function createBodyFromState(bs: BodyState2D): RigidBody2D {
    const shape = deserializeShape(bs.shape);

    // We need to create the body with the correct ID
    // Temporarily set the counter to ensure consistent IDs
    const savedCounter = getBody2DIdCounter();

    // Create body at position (0, 0) - we'll set exact position after
    // Use toFloat to convert fixed-point back to float for createBody2D
    const body = createBody2D(bs.bodyType, shape, 0, 0, bs.label);

    // Override the auto-generated ID with the snapshot ID
    body.id = bs.id;

    // Restore the counter (createBody2D incremented it)
    // The next new body will use the max ID from snapshot + 1
    setBody2DIdCounter(savedCounter);

    // Set all properties from snapshot
    body.position = { x: bs.px, y: bs.py };
    body.angle = bs.angle;
    body.linearVelocity = { x: bs.vx, y: bs.vy };
    body.angularVelocity = bs.av;

    // Mass properties - need to recalculate invMass and inertia
    body.mass = bs.mass;
    body.invMass = bs.mass > 0 ? fpDiv(FP_ONE, bs.mass) : 0;

    // Recalculate inertia based on shape and mass
    if (bs.bodyType === BodyType2D.Dynamic && bs.mass > 0) {
        if (shape.type === Shape2DType.Circle) {
            const r = (shape as CircleShape).radius;
            body.inertia = fpMul(fpMul(bs.mass, FP_HALF), fpMul(r, r));
        } else {
            const box = shape as BoxShape2D;
            const w = (box.halfWidth << 1) as Fixed;
            const h = (box.halfHeight << 1) as Fixed;
            const FP_ONE_TWELFTH = 5461 as Fixed;
            body.inertia = fpMul(fpMul(bs.mass, FP_ONE_TWELFTH), (fpMul(w, w) + fpMul(h, h)) as Fixed);
        }
        body.invInertia = body.inertia > 0 ? fpDiv(FP_ONE, body.inertia) : 0;
    }

    // Material
    body.restitution = bs.restitution;
    body.friction = bs.friction;

    // State
    body.isSleeping = bs.isSleeping;
    body.sleepFrames = bs.sleepFrames;
    body.lockRotation = bs.lockRotation;
    body.isSensor = bs.isSensor;
    body.isBullet = bs.isBullet ?? false;

    // Collision filter
    body.filter = { ...bs.filter };

    // User data
    body.userData = bs.userData;

    return body;
}

/**
 * Load world state from snapshot.
 *
 * IMPORTANT: This function fully recreates the world from the snapshot.
 * It handles both:
 * 1. Existing worlds (rollback) - updates existing bodies, removes/adds as needed
 * 2. Empty worlds (late joiners) - creates all bodies from scratch
 *
 * The snapshot contains complete body information including shape data,
 * so bodies can be fully recreated without any prior state.
 */
export function loadWorldState2D(world: World2D, state: WorldState2D): void {
    // Sort snapshot bodies by label for deterministic iteration
    const sortedBodies = [...state.bodies].sort((a, b) => a.label.localeCompare(b.label));

    // Build a set of labels in the snapshot
    const snapshotLabels = new Set(sortedBodies.map(bs => bs.label));

    // Remove bodies not in snapshot
    for (let i = world.bodies.length - 1; i >= 0; i--) {
        if (!snapshotLabels.has(world.bodies[i].label)) {
            world.bodies.splice(i, 1);
        }
    }

    // Build map of existing bodies
    const bodyMap = new Map(world.bodies.map(b => [b.label, b]));

    // Track the highest ID we see to update the counter
    let maxId = 0;

    for (const bs of sortedBodies) {
        if (bs.id > maxId) maxId = bs.id;

        const existingBody = bodyMap.get(bs.label);

        if (existingBody) {
            // Update existing body
            existingBody.position = { x: bs.px, y: bs.py };
            existingBody.angle = bs.angle;
            existingBody.linearVelocity = { x: bs.vx, y: bs.vy };
            existingBody.angularVelocity = bs.av;
            existingBody.isSleeping = bs.isSleeping;
            existingBody.sleepFrames = bs.sleepFrames;
            existingBody.lockRotation = bs.lockRotation;
            existingBody.isSensor = bs.isSensor;
            existingBody.restitution = bs.restitution;
            existingBody.friction = bs.friction;
            existingBody.filter = { ...bs.filter };
            if (bs.userData !== undefined) {
                existingBody.userData = bs.userData;
            }
        } else {
            // Create new body from snapshot - this is critical for late joiners
            const newBody = createBodyFromState(bs);
            world.bodies.push(newBody);
        }
    }

    // Update the body ID counter to be higher than any ID in the snapshot
    // This ensures new bodies created after loading won't have conflicting IDs
    const currentCounter = getBody2DIdCounter();
    if (maxId >= currentCounter) {
        setBody2DIdCounter(maxId + 1);
    }

    // Sort world bodies by label for deterministic order
    world.bodies.sort((a, b) => a.label.localeCompare(b.label));
}
