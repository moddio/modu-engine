/**
 * Physics World
 *
 * Manages the physics simulation including gravity, collision detection,
 * and integration of velocities and positions.
 */
import { Fixed } from '../../math/fixed';
import { Vec3 } from '../../math/vec';
import { RigidBody } from './rigid-body';
import { Contact } from './collision';
import { TriggerState } from './trigger';
export interface World {
    bodies: RigidBody[];
    gravity: Vec3;
    dt: Fixed;
    triggers: TriggerState;
    /** Step the physics simulation */
    step(): Contact[];
}
export declare function createWorld(dt?: number): World;
export declare function addBody(world: World, body: RigidBody): void;
export declare function removeBody(world: World, body: RigidBody): void;
/**
 * Check if a body is grounded (has a surface below it within threshold)
 * @param world The physics world
 * @param body The body to check
 * @param threshold Distance below to check (default 0.15)
 * @returns true if grounded
 */
export declare function isGrounded(world: World, body: RigidBody, threshold?: number): boolean;
export declare function stepWorld(world: World): Contact[];
