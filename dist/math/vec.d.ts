/**
 * Fixed-Point Vector Types
 *
 * 2D and 3D vectors using fixed-point arithmetic for deterministic physics.
 */
import { Fixed } from './fixed';
export interface Vec2 {
    x: Fixed;
    y: Fixed;
}
export declare function vec2(x: number, y: number): Vec2;
export declare function vec2Zero(): Vec2;
export declare function vec2FromFixed(x: Fixed, y: Fixed): Vec2;
export declare function vec2Clone(v: Vec2): Vec2;
export declare function vec2Add(a: Vec2, b: Vec2): Vec2;
export declare function vec2Sub(a: Vec2, b: Vec2): Vec2;
export declare function vec2Scale(v: Vec2, s: Fixed): Vec2;
export declare function vec2Neg(v: Vec2): Vec2;
export declare function vec2Dot(a: Vec2, b: Vec2): Fixed;
/** 2D cross product (returns z component of 3D cross) */
export declare function vec2Cross(a: Vec2, b: Vec2): Fixed;
export declare function vec2LengthSq(v: Vec2): Fixed;
export declare function vec2Length(v: Vec2): Fixed;
export declare function vec2Normalize(v: Vec2): Vec2;
export declare function vec2Lerp(a: Vec2, b: Vec2, t: Fixed): Vec2;
export declare function vec2Distance(a: Vec2, b: Vec2): Fixed;
export declare function vec2DistanceSq(a: Vec2, b: Vec2): Fixed;
export interface Vec3 {
    x: Fixed;
    y: Fixed;
    z: Fixed;
}
export declare function vec3(x: Fixed, y: Fixed, z: Fixed): Vec3;
export declare function vec3Zero(): Vec3;
export declare function vec3FromFloats(x: number, y: number, z: number): Vec3;
export declare function vec3ToFloats(v: Vec3): {
    x: number;
    y: number;
    z: number;
};
export declare function vec3Clone(v: Vec3): Vec3;
export declare function vec3Add(a: Vec3, b: Vec3): Vec3;
export declare function vec3Sub(a: Vec3, b: Vec3): Vec3;
export declare function vec3Scale(v: Vec3, s: Fixed): Vec3;
export declare function vec3Neg(v: Vec3): Vec3;
export declare function vec3Dot(a: Vec3, b: Vec3): Fixed;
export declare function vec3Cross(a: Vec3, b: Vec3): Vec3;
export declare function vec3LengthSq(v: Vec3): Fixed;
export declare function vec3Length(v: Vec3): Fixed;
export declare function vec3Normalize(v: Vec3): Vec3;
export declare function vec3Lerp(a: Vec3, b: Vec3, t: Fixed): Vec3;
export declare function vec3Distance(a: Vec3, b: Vec3): Fixed;
export declare function vec3DistanceSq(a: Vec3, b: Vec3): Fixed;
