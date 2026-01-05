/**
 * 2D Collision Detection and Response
 *
 * Uses Box2D-style collision detection:
 * - SAT (Separating Axis Theorem) for box-box
 * - Closest point on box for circle-box
 * - Direct distance for circle-circle
 */
import { Fixed } from '../../math/fixed';
import { AABB2D } from './shapes';
import { RigidBody2D, Vec2 } from './rigid-body';
export interface Contact2D {
    bodyA: RigidBody2D;
    bodyB: RigidBody2D;
    point: Vec2;
    normal: Vec2;
    depth: Fixed;
}
export declare function computeAABB2D(body: RigidBody2D): AABB2D;
export declare function detectCollision2D(bodyA: RigidBody2D, bodyB: RigidBody2D): Contact2D | null;
/**
 * Resolve collision by applying position correction and velocity impulses.
 *
 * For kinematic bodies: position correction only (no velocity response)
 * For dynamic bodies: both position and velocity correction
 */
export declare function resolveCollision2D(contact: Contact2D): void;
