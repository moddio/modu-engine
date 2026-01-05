/**
 * 2D Physics Shapes
 *
 * Defines 2D collision shapes: Circle and Box (AABB).
 * Uses fixed-point math for determinism.
 */
import { Fixed } from '../../math/fixed';
export declare enum Shape2DType {
    Circle = 0,
    Box = 1
}
export interface CircleShape {
    type: Shape2DType.Circle;
    radius: Fixed;
}
export interface BoxShape2D {
    type: Shape2DType.Box;
    halfWidth: Fixed;
    halfHeight: Fixed;
}
export type Shape2D = CircleShape | BoxShape2D;
export interface AABB2D {
    minX: Fixed;
    minY: Fixed;
    maxX: Fixed;
    maxY: Fixed;
}
/**
 * Check if two AABBs overlap.
 */
export declare function aabb2DOverlap(a: AABB2D, b: AABB2D): boolean;
/**
 * Compute the union of two AABBs.
 */
export declare function aabb2DUnion(a: AABB2D, b: AABB2D): AABB2D;
/**
 * Compute the area of an AABB.
 */
export declare function aabb2DArea(aabb: AABB2D): Fixed;
/**
 * Create a circle shape.
 */
export declare function createCircle(radius: number): CircleShape;
/**
 * Create a box shape from half-extents.
 */
export declare function createBox2D(halfWidth: number, halfHeight: number): BoxShape2D;
/**
 * Create a box shape from full dimensions.
 * Uses bit shift for deterministic halving.
 */
export declare function createBox2DFromSize(width: number, height: number): BoxShape2D;
