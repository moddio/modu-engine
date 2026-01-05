/**
 * 2D Physics Shapes
 *
 * Defines 2D collision shapes: Circle and Box (AABB).
 * Uses fixed-point math for determinism.
 */

import { Fixed, FP_ONE, toFixed, fpMul, fpDiv, fpMin, fpMax } from '../../math/fixed';

// ============================================
// Types
// ============================================

export enum Shape2DType {
    Circle = 0,
    Box = 1,
}

export interface CircleShape {
    type: Shape2DType.Circle;
    radius: Fixed;
}

export interface BoxShape2D {
    type: Shape2DType.Box;
    halfWidth: Fixed;   // Half extent on X axis
    halfHeight: Fixed;  // Half extent on Y axis
}

export type Shape2D = CircleShape | BoxShape2D;

// ============================================
// AABB (Axis-Aligned Bounding Box)
// ============================================

export interface AABB2D {
    minX: Fixed;
    minY: Fixed;
    maxX: Fixed;
    maxY: Fixed;
}

/**
 * Check if two AABBs overlap.
 */
export function aabb2DOverlap(a: AABB2D, b: AABB2D): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Compute the union of two AABBs.
 */
export function aabb2DUnion(a: AABB2D, b: AABB2D): AABB2D {
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
export function aabb2DArea(aabb: AABB2D): Fixed {
    const width = aabb.maxX - aabb.minX;
    const height = aabb.maxY - aabb.minY;
    return fpMul(width as Fixed, height as Fixed);
}

// ============================================
// Shape Factories
// ============================================

/**
 * Create a circle shape.
 */
export function createCircle(radius: number): CircleShape {
    return {
        type: Shape2DType.Circle,
        radius: toFixed(radius),
    };
}

/**
 * Create a box shape from half-extents.
 */
export function createBox2D(halfWidth: number, halfHeight: number): BoxShape2D {
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
export function createBox2DFromSize(width: number, height: number): BoxShape2D {
    // Use bit shift instead of floating-point division for determinism
    const halfWidth = (toFixed(width) >> 1) as Fixed;
    const halfHeight = (toFixed(height) >> 1) as Fixed;
    return {
        type: Shape2DType.Box,
        halfWidth,
        halfHeight,
    };
}
