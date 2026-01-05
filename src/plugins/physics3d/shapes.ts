/**
 * Collision Shapes
 *
 * Defines shape types for rigid body collision detection.
 * All values use fixed-point math for determinism.
 */

import { Fixed, toFixed } from '../../math/fixed';
import { Vec3, vec3FromFloats } from '../../math/vec';

// ============================================
// Shape Types
// ============================================

export enum ShapeType {
    Box = 0,
    Sphere = 1,
}

export interface BoxShape {
    type: ShapeType.Box;
    halfExtents: Vec3;  // Half-size in each dimension
}

export interface SphereShape {
    type: ShapeType.Sphere;
    radius: Fixed;
}

export type Shape = BoxShape | SphereShape;

export function createBox(hx: number, hy: number, hz: number): BoxShape {
    return { type: ShapeType.Box, halfExtents: vec3FromFloats(hx, hy, hz) };
}

export function createSphere(radius: number): SphereShape {
    return { type: ShapeType.Sphere, radius: toFixed(radius) };
}

// ============================================
// AABB (Axis-Aligned Bounding Box)
// ============================================

export interface AABB {
    min: Vec3;
    max: Vec3;
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
    return a.max.x >= b.min.x && a.min.x <= b.max.x &&
        a.max.y >= b.min.y && a.min.y <= b.max.y &&
        a.max.z >= b.min.z && a.min.z <= b.max.z;
}
