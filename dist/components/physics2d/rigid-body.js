/**
 * 2D Rigid Body
 *
 * Defines 2D rigid body with position, rotation (angle), velocity.
 * Uses fixed-point math for determinism.
 */
import { FP_ONE, FP_HALF, toFixed, fpMul, fpDiv } from '../../math/fixed';
import { Shape2DType } from './shapes';
import { DEFAULT_FILTER } from './layers';
// ============================================
// Constants
// ============================================
const RESTITUTION_DEFAULT = toFixed(0.0);
const FRICTION_DEFAULT = toFixed(0.5);
// Pre-computed fixed-point constants for deterministic inertia calculations
const FP_ONE_TWELFTH = 5461; // 65536 / 12 = 5461.33... -> 5461
// ============================================
// Types
// ============================================
export var BodyType2D;
(function (BodyType2D) {
    BodyType2D[BodyType2D["Static"] = 0] = "Static";
    BodyType2D[BodyType2D["Kinematic"] = 1] = "Kinematic";
    BodyType2D[BodyType2D["Dynamic"] = 2] = "Dynamic";
})(BodyType2D || (BodyType2D = {}));
export function vec2Zero() {
    return { x: 0, y: 0 };
}
export function vec2(x, y) {
    return { x: toFixed(x), y: toFixed(y) };
}
export function vec2Clone(v) {
    return { x: v.x, y: v.y };
}
export function vec2Add(a, b) {
    return { x: (a.x + b.x), y: (a.y + b.y) };
}
export function vec2Sub(a, b) {
    return { x: (a.x - b.x), y: (a.y - b.y) };
}
export function vec2Scale(v, s) {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s) };
}
export function vec2Dot(a, b) {
    return (fpMul(a.x, b.x) + fpMul(a.y, b.y));
}
export function vec2LengthSq(v) {
    return (fpMul(v.x, v.x) + fpMul(v.y, v.y));
}
export function vec2Cross(a, b) {
    // 2D cross product returns scalar (z component of 3D cross)
    return (fpMul(a.x, b.y) - fpMul(a.y, b.x));
}
// ============================================
// Body ID Management
// ============================================
let nextBodyId2D = 1;
export function resetBody2DIdCounter() {
    nextBodyId2D = 1;
}
export function getBody2DIdCounter() {
    return nextBodyId2D;
}
export function setBody2DIdCounter(value) {
    nextBodyId2D = value;
}
// ============================================
// Body Creation
// ============================================
export function createBody2D(type, shape, x, y, label) {
    const mass = type === BodyType2D.Dynamic ? toFixed(1) : 0;
    const invMass = type === BodyType2D.Dynamic ? FP_ONE : 0;
    // Calculate moment of inertia using pre-computed constants
    let inertia = 0;
    if (type === BodyType2D.Dynamic) {
        if (shape.type === Shape2DType.Circle) {
            // I = (1/2) * m * r²
            const r = shape.radius;
            inertia = fpMul(fpMul(mass, FP_HALF), fpMul(r, r));
        }
        else {
            // I = (1/12) * m * (w² + h²)
            // Use bit shift for *2 instead of fpMul with toFixed(2)
            const w = (shape.halfWidth << 1);
            const h = (shape.halfHeight << 1);
            inertia = fpMul(fpMul(mass, FP_ONE_TWELFTH), (fpMul(w, w) + fpMul(h, h)));
        }
    }
    // Only increment counter if no label provided (new body, not restored from snapshot)
    const bodyLabel = label || 'body2d_' + nextBodyId2D;
    const bodyId = label ? 0 : nextBodyId2D++;
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
export function setBody2DMass(body, mass) {
    if (body.type !== BodyType2D.Dynamic)
        return;
    body.mass = toFixed(mass);
    body.invMass = mass > 0 ? fpDiv(FP_ONE, body.mass) : 0;
}
export function setBody2DVelocity(body, vx, vy) {
    body.linearVelocity = vec2(vx, vy);
    body.isSleeping = false;
}
export function applyImpulse2D(body, impulse, point) {
    if (body.type !== BodyType2D.Dynamic || body.invMass === 0)
        return;
    body.linearVelocity = vec2Add(body.linearVelocity, vec2Scale(impulse, body.invMass));
    if (point && !body.lockRotation) {
        const r = vec2Sub(point, body.position);
        const torque = vec2Cross(r, impulse);
        body.angularVelocity = (body.angularVelocity + fpMul(torque, body.invInertia));
    }
    body.isSleeping = false;
}
export function applyForce2D(body, force, dt) {
    if (body.type !== BodyType2D.Dynamic || body.invMass === 0)
        return;
    const impulse = vec2Scale(force, dt);
    applyImpulse2D(body, impulse);
}
