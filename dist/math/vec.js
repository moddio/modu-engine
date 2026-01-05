/**
 * Fixed-Point Vector Types
 *
 * 2D and 3D vectors using fixed-point arithmetic for deterministic physics.
 */
import { FP_ONE, toFixed, toFloat, fpMul, fpDiv, fpSqrt } from './fixed';
export function vec2(x, y) {
    return { x: toFixed(x), y: toFixed(y) };
}
export function vec2Zero() {
    return { x: 0, y: 0 };
}
export function vec2FromFixed(x, y) {
    return { x, y };
}
export function vec2Clone(v) {
    return { x: v.x, y: v.y };
}
export function vec2Add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}
export function vec2Sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}
export function vec2Scale(v, s) {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s) };
}
export function vec2Neg(v) {
    return { x: -v.x, y: -v.y };
}
export function vec2Dot(a, b) {
    return fpMul(a.x, b.x) + fpMul(a.y, b.y);
}
/** 2D cross product (returns z component of 3D cross) */
export function vec2Cross(a, b) {
    return fpMul(a.x, b.y) - fpMul(a.y, b.x);
}
export function vec2LengthSq(v) {
    return fpMul(v.x, v.x) + fpMul(v.y, v.y);
}
export function vec2Length(v) {
    return fpSqrt(vec2LengthSq(v));
}
export function vec2Normalize(v) {
    const len = vec2Length(v);
    if (len === 0)
        return vec2Zero();
    return { x: fpDiv(v.x, len), y: fpDiv(v.y, len) };
}
export function vec2Lerp(a, b, t) {
    const oneMinusT = FP_ONE - t;
    return {
        x: fpMul(a.x, oneMinusT) + fpMul(b.x, t),
        y: fpMul(a.y, oneMinusT) + fpMul(b.y, t)
    };
}
export function vec2Distance(a, b) {
    return vec2Length(vec2Sub(b, a));
}
export function vec2DistanceSq(a, b) {
    return vec2LengthSq(vec2Sub(b, a));
}
export function vec3(x, y, z) {
    return { x, y, z };
}
export function vec3Zero() {
    return { x: 0, y: 0, z: 0 };
}
export function vec3FromFloats(x, y, z) {
    return { x: toFixed(x), y: toFixed(y), z: toFixed(z) };
}
export function vec3ToFloats(v) {
    return { x: toFloat(v.x), y: toFloat(v.y), z: toFloat(v.z) };
}
export function vec3Clone(v) {
    return { x: v.x, y: v.y, z: v.z };
}
export function vec3Add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function vec3Sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function vec3Scale(v, s) {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s), z: fpMul(v.z, s) };
}
export function vec3Neg(v) {
    return { x: -v.x, y: -v.y, z: -v.z };
}
export function vec3Dot(a, b) {
    return fpMul(a.x, b.x) + fpMul(a.y, b.y) + fpMul(a.z, b.z);
}
export function vec3Cross(a, b) {
    return {
        x: fpMul(a.y, b.z) - fpMul(a.z, b.y),
        y: fpMul(a.z, b.x) - fpMul(a.x, b.z),
        z: fpMul(a.x, b.y) - fpMul(a.y, b.x)
    };
}
export function vec3LengthSq(v) {
    return fpMul(v.x, v.x) + fpMul(v.y, v.y) + fpMul(v.z, v.z);
}
export function vec3Length(v) {
    return fpSqrt(vec3LengthSq(v));
}
export function vec3Normalize(v) {
    const len = vec3Length(v);
    if (len === 0)
        return vec3Zero();
    return { x: fpDiv(v.x, len), y: fpDiv(v.y, len), z: fpDiv(v.z, len) };
}
export function vec3Lerp(a, b, t) {
    const oneMinusT = FP_ONE - t;
    return {
        x: fpMul(a.x, oneMinusT) + fpMul(b.x, t),
        y: fpMul(a.y, oneMinusT) + fpMul(b.y, t),
        z: fpMul(a.z, oneMinusT) + fpMul(b.z, t)
    };
}
export function vec3Distance(a, b) {
    return vec3Length(vec3Sub(b, a));
}
export function vec3DistanceSq(a, b) {
    return vec3LengthSq(vec3Sub(b, a));
}
