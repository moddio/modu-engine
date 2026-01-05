/**
 * 2D Physics Shapes
 *
 * Defines 2D collision shapes: Circle and Box (AABB).
 * Uses fixed-point math for determinism.
 */
import { toFixed, fpMul, fpMin, fpMax } from '../../math/fixed';
// ============================================
// Types
// ============================================
export var Shape2DType;
(function (Shape2DType) {
    Shape2DType[Shape2DType["Circle"] = 0] = "Circle";
    Shape2DType[Shape2DType["Box"] = 1] = "Box";
})(Shape2DType || (Shape2DType = {}));
/**
 * Check if two AABBs overlap.
 */
export function aabb2DOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
        a.minY <= b.maxY && a.maxY >= b.minY;
}
/**
 * Compute the union of two AABBs.
 */
export function aabb2DUnion(a, b) {
    return {
        minX: fpMin(a.minX, b.minX),
        minY: fpMin(a.minY, b.minY),
        maxX: fpMax(a.maxX, b.maxX),
        maxY: fpMax(a.maxY, b.maxY),
    };
}
/**
 * Compute the area of an AABB.
 */
export function aabb2DArea(aabb) {
    const width = aabb.maxX - aabb.minX;
    const height = aabb.maxY - aabb.minY;
    return fpMul(width, height);
}
// ============================================
// Shape Factories
// ============================================
/**
 * Create a circle shape.
 */
export function createCircle(radius) {
    return {
        type: Shape2DType.Circle,
        radius: toFixed(radius),
    };
}
/**
 * Create a box shape from half-extents.
 */
export function createBox2D(halfWidth, halfHeight) {
    return {
        type: Shape2DType.Box,
        halfWidth: toFixed(halfWidth),
        halfHeight: toFixed(halfHeight),
    };
}
/**
 * Create a box shape from full dimensions.
 * Uses bit shift for deterministic halving.
 */
export function createBox2DFromSize(width, height) {
    // Use bit shift instead of floating-point division for determinism
    const halfWidth = (toFixed(width) >> 1);
    const halfHeight = (toFixed(height) >> 1);
    return {
        type: Shape2DType.Box,
        halfWidth,
        halfHeight,
    };
}
