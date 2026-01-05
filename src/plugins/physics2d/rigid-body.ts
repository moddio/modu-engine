/**
 * 2D Rigid Body
 *
 * Defines 2D rigid body with position, rotation (angle), velocity.
 * Uses fixed-point math for determinism.
 */

import { Fixed, FP_ONE, FP_HALF, toFixed, fpMul, fpDiv, fpSin, fpCos } from '../../math/fixed';
import { Shape2D, Shape2DType, CircleShape } from './shapes';
import { CollisionFilter, DEFAULT_FILTER } from './layers';

// ============================================
// Constants
// ============================================

const RESTITUTION_DEFAULT = toFixed(0.0);
const FRICTION_DEFAULT = toFixed(0.5);

// Pre-computed fixed-point constants for deterministic inertia calculations
const FP_ONE_TWELFTH = 5461 as Fixed;  // 65536 / 12 = 5461.33... -> 5461

// ============================================
// Types
// ============================================

export enum BodyType2D {
    Static = 0,     // Never moves
    Kinematic = 1,  // Moved by user, no physics response
    Dynamic = 2,    // Full physics simulation
}

/**
 * 2D Vector using fixed-point math.
 */
export interface Vec2 {
    x: Fixed;
    y: Fixed;
}

export function vec2Zero(): Vec2 {
    return { x: 0, y: 0 };
}

export function vec2(x: number, y: number): Vec2 {
    return { x: toFixed(x), y: toFixed(y) };
}

export function vec2Clone(v: Vec2): Vec2 {
    return { x: v.x, y: v.y };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
    return { x: (a.x + b.x) as Fixed, y: (a.y + b.y) as Fixed };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
    return { x: (a.x - b.x) as Fixed, y: (a.y - b.y) as Fixed };
}

export function vec2Scale(v: Vec2, s: Fixed): Vec2 {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s) };
}

export function vec2Dot(a: Vec2, b: Vec2): Fixed {
    return (fpMul(a.x, b.x) + fpMul(a.y, b.y)) as Fixed;
}

export function vec2LengthSq(v: Vec2): Fixed {
    return (fpMul(v.x, v.x) + fpMul(v.y, v.y)) as Fixed;
}

export function vec2Cross(a: Vec2, b: Vec2): Fixed {
    // 2D cross product returns scalar (z component of 3D cross)
    return (fpMul(a.x, b.y) - fpMul(a.y, b.x)) as Fixed;
}

// ============================================
// Rigid Body Interface
// ============================================

export interface RigidBody2D {
    id: number;
    type: BodyType2D;
    shape: Shape2D;
    label: string;

    // Transform
    position: Vec2;
    angle: Fixed;  // Rotation in radians (not quaternion like 3D)

    // Velocity
    linearVelocity: Vec2;
    angularVelocity: Fixed;  // Radians per second

    // Mass properties
    mass: Fixed;
    invMass: Fixed;
    inertia: Fixed;
    invInertia: Fixed;

    // Material
    restitution: Fixed;
    friction: Fixed;

    // State
    isSleeping: boolean;
    sleepFrames: number;

    // Flags
    lockRotation: boolean;
    isSensor: boolean;
    isBullet: boolean;  // Enable CCD (continuous collision detection) for fast-moving objects

    // Collision filtering
    filter: CollisionFilter;

    // User data
    userData: any;
}

// ============================================
// Body ID Management
// ============================================

let nextBodyId2D = 1;

export function resetBody2DIdCounter(): void {
    nextBodyId2D = 1;
}

export function getBody2DIdCounter(): number {
    return nextBodyId2D;
}

export function setBody2DIdCounter(value: number): void {
    nextBodyId2D = value;
}

// ============================================
// Body Creation
// ============================================

export function createBody2D(
    type: BodyType2D,
    shape: Shape2D,
    x: number,
    y: number,
    label?: string
): RigidBody2D {
    const mass = type === BodyType2D.Dynamic ? toFixed(1) : 0;
    const invMass = type === BodyType2D.Dynamic ? FP_ONE : 0;

    // Calculate moment of inertia using pre-computed constants
    let inertia = 0;
    if (type === BodyType2D.Dynamic) {
        if (shape.type === Shape2DType.Circle) {
            // I = (1/2) * m * r²
            const r = (shape as CircleShape).radius;
            inertia = fpMul(fpMul(mass, FP_HALF), fpMul(r, r));
        } else {
            // I = (1/12) * m * (w² + h²)
            // Use bit shift for *2 instead of fpMul with toFixed(2)
            const w = (shape.halfWidth << 1) as Fixed;
            const h = (shape.halfHeight << 1) as Fixed;
            inertia = fpMul(fpMul(mass, FP_ONE_TWELFTH), (fpMul(w, w) + fpMul(h, h)) as Fixed);
        }
    }

    // Always increment counter for new bodies (ID will be overwritten for snapshot restoration)
    const bodyId = nextBodyId2D++;
    const bodyLabel = label || 'body2d_' + bodyId;

    return {
        id: bodyId,
        type,
        shape,
        label: bodyLabel,
        position: vec2(x, y),
        angle: 0,
        linearVelocity: vec2Zero(),
        angularVelocity: 0,
        mass,
        invMass,
        inertia: inertia || FP_ONE,
        invInertia: inertia ? fpDiv(FP_ONE, inertia) : 0,
        restitution: RESTITUTION_DEFAULT,
        friction: FRICTION_DEFAULT,
        isSleeping: false,
        sleepFrames: 0,
        lockRotation: false,
        isSensor: false,
        isBullet: false,
        filter: { ...DEFAULT_FILTER },
        userData: null,
    };
}

// ============================================
// Body Operations
// ============================================

export function setBody2DMass(body: RigidBody2D, mass: number): void {
    if (body.type !== BodyType2D.Dynamic) return;
    body.mass = toFixed(mass);
    body.invMass = mass > 0 ? fpDiv(FP_ONE, body.mass) : 0;
}

export function setBody2DVelocity(body: RigidBody2D, vx: number, vy: number): void {
    body.linearVelocity = vec2(vx, vy);
    body.isSleeping = false;
}

export function applyImpulse2D(body: RigidBody2D, impulse: Vec2, point?: Vec2): void {
    if (body.type !== BodyType2D.Dynamic || body.invMass === 0) return;

    body.linearVelocity = vec2Add(body.linearVelocity, vec2Scale(impulse, body.invMass));

    if (point && !body.lockRotation) {
        const r = vec2Sub(point, body.position);
        const torque = vec2Cross(r, impulse);
        body.angularVelocity = (body.angularVelocity + fpMul(torque, body.invInertia)) as Fixed;
    }

    body.isSleeping = false;
}

export function applyForce2D(body: RigidBody2D, force: Vec2, dt: Fixed): void {
    if (body.type !== BodyType2D.Dynamic || body.invMass === 0) return;
    const impulse = vec2Scale(force, dt);
    applyImpulse2D(body, impulse);
}
