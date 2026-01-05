/**
 * Rigid Body
 *
 * Defines rigid body types and operations for physics simulation.
 * All values use fixed-point math for determinism.
 */

import { Fixed, FP_ONE, toFixed, fpMul, fpDiv } from '../../math/fixed';
import { Vec3, vec3Zero, vec3FromFloats, vec3Add, vec3Scale, vec3Sub, vec3Cross } from '../../math/vec';
import { Quat, quatIdentity } from '../../math/quat';
import { Shape, ShapeType, SphereShape } from './shapes';
import { CollisionFilter, DEFAULT_FILTER } from './layers';

// ============================================
// Constants
// ============================================

const RESTITUTION_DEFAULT = toFixed(0.0);  // No bounce for stable resting
const FRICTION_DEFAULT = toFixed(0.5);      // Moderate friction

// ============================================
// Body Types
// ============================================

export enum BodyType {
    Static = 0,     // Never moves
    Kinematic = 1,  // Moved by user, no physics response
    Dynamic = 2,    // Full physics simulation
}

// ============================================
// Rigid Body Interface
// ============================================

export interface RigidBody {
    id: number;
    type: BodyType;
    shape: Shape;

    // Label for deterministic ordering - MUST be unique and consistent across all clients
    // Examples: "ground", "box_0", "box_1", "player_abc123"
    label: string;

    // Transform
    position: Vec3;
    rotation: Quat;

    // Velocity
    linearVelocity: Vec3;
    angularVelocity: Vec3;

    // Mass properties
    mass: Fixed;           // 0 for static/kinematic
    invMass: Fixed;        // 1/mass, 0 for static/kinematic
    inertia: Fixed;        // Moment of inertia (simplified scalar)
    invInertia: Fixed;     // 1/inertia

    // Material
    restitution: Fixed;
    friction: Fixed;

    // State
    isSleeping: boolean;
    sleepFrames: number;

    // Flags
    lockRotationX: boolean;
    lockRotationY: boolean;
    lockRotationZ: boolean;
    isTrigger: boolean;  // If true, detects overlap but doesn't apply physics response

    // Collision filtering
    filter: CollisionFilter;

    // User data
    userData: any;
}

// ============================================
// Body ID Management
// ============================================

let nextBodyId = 1;

export function resetBodyIdCounter(): void {
    nextBodyId = 1;
}

export function getBodyIdCounter(): number {
    return nextBodyId;
}

export function setBodyIdCounter(value: number): void {
    nextBodyId = value;
}

// ============================================
// Body Creation
// ============================================

export function createBody(type: BodyType, shape: Shape, x: number, y: number, z: number, label?: string): RigidBody {
    const mass = type === BodyType.Dynamic ? toFixed(1) : 0;
    const invMass = type === BodyType.Dynamic ? FP_ONE : 0;

    // Simplified inertia calculation
    let inertia = 0;
    if (type === BodyType.Dynamic) {
        if (shape.type === ShapeType.Box) {
            // I = (1/12) * m * (h² + d²) for each axis - use average
            const h = shape.halfExtents;
            inertia = fpMul(mass, fpMul(toFixed(1 / 6),
                fpMul(h.x, h.x) + fpMul(h.y, h.y) + fpMul(h.z, h.z)));
        } else {
            // I = (2/5) * m * r² for solid sphere
            const r = (shape as SphereShape).radius;
            inertia = fpMul(mass, fpMul(toFixed(0.4), fpMul(r, r)));
        }
    }

    const bodyLabel = label || 'body_' + nextBodyId;
    const bodyId = nextBodyId++;

    return {
        id: bodyId,
        label: bodyLabel,
        type,
        shape,
        position: vec3FromFloats(x, y, z),
        rotation: quatIdentity(),
        linearVelocity: vec3Zero(),
        angularVelocity: vec3Zero(),
        mass,
        invMass,
        inertia: inertia || FP_ONE,
        invInertia: inertia ? fpDiv(FP_ONE, inertia) : 0,
        restitution: RESTITUTION_DEFAULT,
        friction: FRICTION_DEFAULT,
        isSleeping: false,
        sleepFrames: 0,
        lockRotationX: false,
        lockRotationY: false,
        lockRotationZ: false,
        isTrigger: false,
        filter: { ...DEFAULT_FILTER },
        userData: null,
    };
}

// ============================================
// Body Operations
// ============================================

export function setBodyMass(body: RigidBody, mass: number): void {
    if (body.type !== BodyType.Dynamic) return;
    body.mass = toFixed(mass);
    body.invMass = mass > 0 ? fpDiv(FP_ONE, body.mass) : 0;
}

export function setBodyVelocity(body: RigidBody, vx: number, vy: number, vz: number): void {
    body.linearVelocity = vec3FromFloats(vx, vy, vz);
    body.isSleeping = false;
}

export function applyImpulse(body: RigidBody, impulse: Vec3, point?: Vec3): void {
    if (body.type !== BodyType.Dynamic || body.invMass === 0) return;

    body.linearVelocity = vec3Add(body.linearVelocity, vec3Scale(impulse, body.invMass));

    if (point) {
        const r = vec3Sub(point, body.position);
        const torque = vec3Cross(r, impulse);
        body.angularVelocity = vec3Add(body.angularVelocity, vec3Scale(torque, body.invInertia));
    }

    body.isSleeping = false;
}

export function applyForce(body: RigidBody, force: Vec3, dt: Fixed): void {
    if (body.type !== BodyType.Dynamic || body.invMass === 0) return;
    const impulse = vec3Scale(force, dt);
    applyImpulse(body, impulse);
}
