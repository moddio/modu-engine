/**
 * Fixed-Point Quaternion Operations
 *
 * Quaternion math for 3D rotations using fixed-point arithmetic.
 */
import { FP_ONE, fpMul, fpDiv, fpSqrt, fpSin, fpCos } from './fixed';
import { vec3, vec3Normalize, vec3Cross, vec3Add, vec3Scale } from './vec';
export function quatIdentity() {
    return { x: 0, y: 0, z: 0, w: FP_ONE };
}
export function quatFromAxisAngle(axis, angle) {
    const halfAngle = angle >> 1;
    const s = fpSin(halfAngle);
    const c = fpCos(halfAngle);
    const normAxis = vec3Normalize(axis);
    return {
        x: fpMul(normAxis.x, s),
        y: fpMul(normAxis.y, s),
        z: fpMul(normAxis.z, s),
        w: c
    };
}
export function quatFromEulerY(yaw) {
    const halfAngle = yaw >> 1;
    return {
        x: 0,
        y: fpSin(halfAngle),
        z: 0,
        w: fpCos(halfAngle)
    };
}
export function quatMul(a, b) {
    return {
        x: fpMul(a.w, b.x) + fpMul(a.x, b.w) + fpMul(a.y, b.z) - fpMul(a.z, b.y),
        y: fpMul(a.w, b.y) - fpMul(a.x, b.z) + fpMul(a.y, b.w) + fpMul(a.z, b.x),
        z: fpMul(a.w, b.z) + fpMul(a.x, b.y) - fpMul(a.y, b.x) + fpMul(a.z, b.w),
        w: fpMul(a.w, b.w) - fpMul(a.x, b.x) - fpMul(a.y, b.y) - fpMul(a.z, b.z)
    };
}
export function quatRotateVec3(q, v) {
    // q * v * q^-1 (optimized)
    const qv = vec3(q.x, q.y, q.z);
    const uv = vec3Cross(qv, v);
    const uuv = vec3Cross(qv, uv);
    return vec3Add(v, vec3Add(vec3Scale(uv, q.w << 1), vec3Scale(uuv, FP_ONE << 1)));
}
export function quatNormalize(q) {
    const lenSq = fpMul(q.x, q.x) + fpMul(q.y, q.y) + fpMul(q.z, q.z) + fpMul(q.w, q.w);
    const len = fpSqrt(lenSq);
    if (len === 0)
        return quatIdentity();
    return {
        x: fpDiv(q.x, len),
        y: fpDiv(q.y, len),
        z: fpDiv(q.z, len),
        w: fpDiv(q.w, len)
    };
}
/** Quaternion conjugate (inverse for unit quaternions) */
export function quatConjugate(q) {
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}
/** Clone a quaternion */
export function quatClone(q) {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}
