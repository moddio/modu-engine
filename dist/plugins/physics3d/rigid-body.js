/**
 * Rigid Body
 *
 * Defines rigid body types and operations for physics simulation.
 * All values use fixed-point math for determinism.
 */
import { FP_ONE, toFixed, fpMul, fpDiv } from '../../math/fixed';
import { vec3Zero, vec3FromFloats, vec3Add, vec3Scale, vec3Sub, vec3Cross } from '../../math/vec';
import { quatIdentity } from '../../math/quat';
import { ShapeType } from './shapes';
import { DEFAULT_FILTER } from './layers';
// ============================================
// Constants
// ============================================
const RESTITUTION_DEFAULT = toFixed(0.0); // No bounce for stable resting
const FRICTION_DEFAULT = toFixed(0.5); // Moderate friction
// ============================================
// Body Types
// ============================================
export var BodyType;
(function (BodyType) {
    BodyType[BodyType["Static"] = 0] = "Static";
    BodyType[BodyType["Kinematic"] = 1] = "Kinematic";
    BodyType[BodyType["Dynamic"] = 2] = "Dynamic";
})(BodyType || (BodyType = {}));
// ============================================
// Body ID Management
// ============================================
let nextBodyId = 1;
export function resetBodyIdCounter() {
    nextBodyId = 1;
}
export function getBodyIdCounter() {
    return nextBodyId;
}
export function setBodyIdCounter(value) {
    nextBodyId = value;
}
// ============================================
// Body Creation
// ============================================
export function createBody(type, shape, x, y, z, label) {
    const mass = type === BodyType.Dynamic ? toFixed(1) : 0;
    const invMass = type === BodyType.Dynamic ? FP_ONE : 0;
    // Simplified inertia calculation
    let inertia = 0;
    if (type === BodyType.Dynamic) {
        if (shape.type === ShapeType.Box) {
            // I = (1/12) * m * (h² + d²) for each axis - use average
            const h = shape.halfExtents;
            inertia = fpMul(mass, fpMul(toFixed(1 / 6), fpMul(h.x, h.x) + fpMul(h.y, h.y) + fpMul(h.z, h.z)));
        }
        else {
            // I = (2/5) * m * r² for solid sphere
            const r = shape.radius;
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
export function setBodyMass(body, mass) {
    if (body.type !== BodyType.Dynamic)
        return;
    body.mass = toFixed(mass);
    body.invMass = mass > 0 ? fpDiv(FP_ONE, body.mass) : 0;
}
export function setBodyVelocity(body, vx, vy, vz) {
    body.linearVelocity = vec3FromFloats(vx, vy, vz);
    body.isSleeping = false;
}
export function applyImpulse(body, impulse, point) {
    if (body.type !== BodyType.Dynamic || body.invMass === 0)
        return;
    body.linearVelocity = vec3Add(body.linearVelocity, vec3Scale(impulse, body.invMass));
    if (point) {
        const r = vec3Sub(point, body.position);
        const torque = vec3Cross(r, impulse);
        body.angularVelocity = vec3Add(body.angularVelocity, vec3Scale(torque, body.invInertia));
    }
    body.isSleeping = false;
}
export function applyForce(body, force, dt) {
    if (body.type !== BodyType.Dynamic || body.invMass === 0)
        return;
    const impulse = vec3Scale(force, dt);
    applyImpulse(body, impulse);
}
