/**
 * 2D Rigid Body
 *
 * Defines 2D rigid body with position, rotation (angle), velocity.
 * Uses fixed-point math for determinism.
 */
import { Fixed } from '../../math/fixed';
import { Shape2D } from './shapes';
import { CollisionFilter } from './layers';
export declare enum BodyType2D {
    Static = 0,// Never moves
    Kinematic = 1,// Moved by user, no physics response
    Dynamic = 2
}
/**
 * 2D Vector using fixed-point math.
 */
export interface Vec2 {
    x: Fixed;
    y: Fixed;
}
export declare function vec2Zero(): Vec2;
export declare function vec2(x: number, y: number): Vec2;
export declare function vec2Clone(v: Vec2): Vec2;
export declare function vec2Add(a: Vec2, b: Vec2): Vec2;
export declare function vec2Sub(a: Vec2, b: Vec2): Vec2;
export declare function vec2Scale(v: Vec2, s: Fixed): Vec2;
export declare function vec2Dot(a: Vec2, b: Vec2): Fixed;
export declare function vec2LengthSq(v: Vec2): Fixed;
export declare function vec2Cross(a: Vec2, b: Vec2): Fixed;
export interface RigidBody2D {
    id: number;
    type: BodyType2D;
    shape: Shape2D;
    label: string;
    position: Vec2;
    angle: Fixed;
    linearVelocity: Vec2;
    angularVelocity: Fixed;
    mass: Fixed;
    invMass: Fixed;
    inertia: Fixed;
    invInertia: Fixed;
    restitution: Fixed;
    friction: Fixed;
    isSleeping: boolean;
    sleepFrames: number;
    lockRotation: boolean;
    isSensor: boolean;
    isBullet: boolean;
    filter: CollisionFilter;
    userData: any;
}
export declare function resetBody2DIdCounter(): void;
export declare function getBody2DIdCounter(): number;
export declare function setBody2DIdCounter(value: number): void;
export declare function createBody2D(type: BodyType2D, shape: Shape2D, x: number, y: number, label?: string): RigidBody2D;
export declare function setBody2DMass(body: RigidBody2D, mass: number): void;
export declare function setBody2DVelocity(body: RigidBody2D, vx: number, vy: number): void;
export declare function applyImpulse2D(body: RigidBody2D, impulse: Vec2, point?: Vec2): void;
export declare function applyForce2D(body: RigidBody2D, force: Vec2, dt: Fixed): void;
