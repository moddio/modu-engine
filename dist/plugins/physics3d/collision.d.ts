/**
 * Collision Detection and Response
 *
 * Handles narrow-phase collision detection between shapes and
 * impulse-based collision response.
 */
import { Fixed } from '../../math/fixed';
import { Vec3 } from '../../math/vec';
import { AABB } from './shapes';
import { RigidBody } from './rigid-body';
export declare function computeAABB(body: RigidBody): AABB;
export interface ContactPoint {
    point: Vec3;
    penetration: Fixed;
}
export interface Contact {
    bodyA: RigidBody;
    bodyB: RigidBody;
    normal: Vec3;
    points: ContactPoint[];
}
export declare function detectCollision(a: RigidBody, b: RigidBody): Contact | null;
export declare function resolveCollision(contact: Contact): void;
