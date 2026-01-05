/**
 * Fixed-Point Vector Types
 *
 * 2D and 3D vectors using fixed-point arithmetic for deterministic physics.
 */

import { Fixed, FP_ONE, toFixed, toFloat, fpMul, fpDiv, fpSqrt } from './fixed';

// ============================================
// 2D Vector (Fixed-Point)
// ============================================

export interface Vec2 {
    x: Fixed;
    y: Fixed;
}

export function vec2(x: number, y: number): Vec2 {
    return { x: toFixed(x), y: toFixed(y) };
}

export function vec2Zero(): Vec2 {
    return { x: 0, y: 0 };
}

export function vec2FromFixed(x: Fixed, y: Fixed): Vec2 {
    return { x, y };
}

export function vec2Clone(v: Vec2): Vec2 {
    return { x: v.x, y: v.y };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Scale(v: Vec2, s: Fixed): Vec2 {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s) };
}

export function vec2Neg(v: Vec2): Vec2 {
    return { x: -v.x, y: -v.y };
}

export function vec2Dot(a: Vec2, b: Vec2): Fixed {
    return fpMul(a.x, b.x) + fpMul(a.y, b.y);
}

/** 2D cross product (returns z component of 3D cross) */
export function vec2Cross(a: Vec2, b: Vec2): Fixed {
    return fpMul(a.x, b.y) - fpMul(a.y, b.x);
}

export function vec2LengthSq(v: Vec2): Fixed {
    return fpMul(v.x, v.x) + fpMul(v.y, v.y);
}

export function vec2Length(v: Vec2): Fixed {
    return fpSqrt(vec2LengthSq(v));
}

export function vec2Normalize(v: Vec2): Vec2 {
    const len = vec2Length(v);
    if (len === 0) return vec2Zero();
    return { x: fpDiv(v.x, len), y: fpDiv(v.y, len) };
}

export function vec2Lerp(a: Vec2, b: Vec2, t: Fixed): Vec2 {
    const oneMinusT = FP_ONE - t;
    return {
        x: fpMul(a.x, oneMinusT) + fpMul(b.x, t),
        y: fpMul(a.y, oneMinusT) + fpMul(b.y, t)
    };
}

export function vec2Distance(a: Vec2, b: Vec2): Fixed {
    return vec2Length(vec2Sub(b, a));
}

export function vec2DistanceSq(a: Vec2, b: Vec2): Fixed {
    return vec2LengthSq(vec2Sub(b, a));
}

// ============================================
// 3D Vector (Fixed-Point)
// ============================================

export interface Vec3 {
    x: Fixed;
    y: Fixed;
    z: Fixed;
}

export function vec3(x: Fixed, y: Fixed, z: Fixed): Vec3 {
    return { x, y, z };
}

export function vec3Zero(): Vec3 {
    return { x: 0, y: 0, z: 0 };
}

export function vec3FromFloats(x: number, y: number, z: number): Vec3 {
    return { x: toFixed(x), y: toFixed(y), z: toFixed(z) };
}

export function vec3ToFloats(v: Vec3): { x: number; y: number; z: number } {
    return { x: toFloat(v.x), y: toFloat(v.y), z: toFloat(v.z) };
}

export function vec3Clone(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vec3, s: Fixed): Vec3 {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s), z: fpMul(v.z, s) };
}

export function vec3Neg(v: Vec3): Vec3 {
    return { x: -v.x, y: -v.y, z: -v.z };
}

export function vec3Dot(a: Vec3, b: Vec3): Fixed {
    return fpMul(a.x, b.x) + fpMul(a.y, b.y) + fpMul(a.z, b.z);
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
    return {
        x: fpMul(a.y, b.z) - fpMul(a.z, b.y),
        y: fpMul(a.z, b.x) - fpMul(a.x, b.z),
        z: fpMul(a.x, b.y) - fpMul(a.y, b.x)
    };
}

export function vec3LengthSq(v: Vec3): Fixed {
    return fpMul(v.x, v.x) + fpMul(v.y, v.y) + fpMul(v.z, v.z);
}

export function vec3Length(v: Vec3): Fixed {
    return fpSqrt(vec3LengthSq(v));
}

export function vec3Normalize(v: Vec3): Vec3 {
    const len = vec3Length(v);
    if (len === 0) return vec3Zero();
    return { x: fpDiv(v.x, len), y: fpDiv(v.y, len), z: fpDiv(v.z, len) };
}

export function vec3Lerp(a: Vec3, b: Vec3, t: Fixed): Vec3 {
    const oneMinusT = FP_ONE - t;
    return {
        x: fpMul(a.x, oneMinusT) + fpMul(b.x, t),
        y: fpMul(a.y, oneMinusT) + fpMul(b.y, t),
        z: fpMul(a.z, oneMinusT) + fpMul(b.z, t)
    };
}

export function vec3Distance(a: Vec3, b: Vec3): Fixed {
    return vec3Length(vec3Sub(b, a));
}

export function vec3DistanceSq(a: Vec3, b: Vec3): Fixed {
    return vec3LengthSq(vec3Sub(b, a));
}
