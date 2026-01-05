/**
 * 2D Physics World
 *
 * Manages the 2D physics simulation including gravity, collision detection,
 * and integration of velocities and positions.
 */
import { Fixed } from '../../math/fixed';
import { Shape2DType } from './shapes';
import { RigidBody2D, BodyType2D, Vec2 } from './rigid-body';
import { Contact2D } from './collision';
import { CollisionFilter } from './layers';
export interface TriggerEvent2D {
    trigger: RigidBody2D;
    other: RigidBody2D;
}
export interface ContactListener2D {
    onContact(bodyA: RigidBody2D, bodyB: RigidBody2D): void;
}
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
export declare function createWorld2D(dt?: number): World2D;
export declare function addBody2D(world: World2D, body: RigidBody2D): void;
export declare function removeBody2D(world: World2D, body: RigidBody2D): void;
export declare function stepWorld2D(world: World2D): {
    contacts: Contact2D[];
    triggers: TriggerEvent2D[];
};
/**
 * Serialized shape data for snapshots.
 * Contains all information needed to recreate a shape.
 */
export interface ShapeState2D {
    type: Shape2DType;
    radius?: Fixed;
    halfWidth?: Fixed;
    halfHeight?: Fixed;
}
/**
 * Complete body state for snapshots.
 * Contains ALL information needed to recreate a body from scratch.
 * This is critical for late joiners who have an empty world.
 */
export interface BodyState2D {
    id: number;
    label: string;
    bodyType: BodyType2D;
    shape: ShapeState2D;
    px: Fixed;
    py: Fixed;
    angle: Fixed;
    vx: Fixed;
    vy: Fixed;
    av: Fixed;
    mass: Fixed;
    restitution: Fixed;
    friction: Fixed;
    isSleeping: boolean;
    sleepFrames: number;
    lockRotation: boolean;
    isSensor: boolean;
    isBullet: boolean;
    filter: CollisionFilter;
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
 * Save world state - use saveWorldStateWithHash2D for efficiency when you need both
 */
export declare function saveWorldState2D(world: World2D): WorldState2D;
/**
 * Save world state AND compute hash in a single pass.
 * More efficient than calling saveWorldState2D + separate hash function.
 */
export declare function saveWorldStateWithHash2D(world: World2D): WorldStateWithHash2D;
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
export declare function loadWorldState2D(world: World2D, state: WorldState2D): void;
