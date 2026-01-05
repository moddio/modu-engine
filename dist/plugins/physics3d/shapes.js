/**
 * Collision Shapes
 *
 * Defines shape types for rigid body collision detection.
 * All values use fixed-point math for determinism.
 */
import { toFixed } from '../../math/fixed';
import { vec3FromFloats } from '../../math/vec';
// ============================================
// Shape Types
// ============================================
export var ShapeType;
(function (ShapeType) {
    ShapeType[ShapeType["Box"] = 0] = "Box";
    ShapeType[ShapeType["Sphere"] = 1] = "Sphere";
})(ShapeType || (ShapeType = {}));
export function createBox(hx, hy, hz) {
    return { type: ShapeType.Box, halfExtents: vec3FromFloats(hx, hy, hz) };
}
export function createSphere(radius) {
    return { type: ShapeType.Sphere, radius: toFixed(radius) };
}
export function aabbOverlap(a, b) {
    return a.max.x >= b.min.x && a.min.x <= b.max.x &&
        a.max.y >= b.min.y && a.min.y <= b.max.y &&
        a.max.z >= b.min.z && a.min.z <= b.max.z;
}
