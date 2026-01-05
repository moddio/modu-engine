/**
 * Collision Shapes
 *
 * Defines shape types for rigid body collision detection.
 * All values use fixed-point math for determinism.
 */
import { Fixed } from '../../math/fixed';
import { Vec3 } from '../../math/vec';
export declare enum ShapeType {
    Box = 0,
    Sphere = 1
}
export interface BoxShape {
    type: ShapeType.Box;
    halfExtents: Vec3;
}
export interface SphereShape {
    type: ShapeType.Sphere;
    radius: Fixed;
}
export type Shape = BoxShape | SphereShape;
export declare function createBox(hx: number, hy: number, hz: number): BoxShape;
export declare function createSphere(radius: number): SphereShape;
export interface AABB {
    min: Vec3;
    max: Vec3;
}
export declare function aabbOverlap(a: AABB, b: AABB): boolean;
