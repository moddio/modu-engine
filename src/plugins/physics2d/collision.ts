/**
 * 2D Collision Detection and Response
 *
 * Uses Box2D-style collision detection:
 * - SAT (Separating Axis Theorem) for box-box
 * - Closest point on box for circle-box
 * - Direct distance for circle-circle
 */

import { Fixed, FP_ONE, FP_HALF, toFixed, toFloat, fpMul, fpDiv, fpAbs, fpSqrt, fpMin, fpMax, fpSin, fpCos } from '../../math/fixed';
import { Shape2DType, Shape2D, CircleShape, BoxShape2D, AABB2D } from './shapes';
import { RigidBody2D, Vec2, vec2, vec2Zero, vec2Sub, vec2Add, vec2Scale, vec2Dot, vec2LengthSq, vec2Cross, BodyType2D } from './rigid-body';

// ============================================
// Contact
// ============================================

export interface Contact2D {
    bodyA: RigidBody2D;
    bodyB: RigidBody2D;
    point: Vec2;
    normal: Vec2;  // Points from A to B
    depth: Fixed;
}

/**
 * Contact manifold - multiple contact points sharing the same normal.
 * Box-box collisions can have up to 2 contact points (edge-edge contact).
 * This improves stacking stability by balancing torques.
 */
export interface ContactManifold2D {
    bodyA: RigidBody2D;
    bodyB: RigidBody2D;
    normal: Vec2;  // Shared normal, points from A to B
    points: { point: Vec2; depth: Fixed }[];  // Up to 2 contact points
}

// ============================================
// Contact Constraint (Rapier-style solver)
// ============================================

/**
 * Contact constraint for iterative impulse solver.
 * Stores precomputed values and cached impulses for warmstarting.
 */
export interface ContactConstraint {
    bodyA: RigidBody2D;
    bodyB: RigidBody2D;
    normal: Vec2;
    tangent: Vec2;
    point: Vec2;
    depth: Fixed;

    // Lever arms from body centers to contact point (for angular impulse)
    rA: Vec2;
    rB: Vec2;

    // Effective masses (precomputed, includes angular terms)
    normalMass: Fixed;
    tangentMass: Fixed;

    // Cached impulses for warmstarting (accumulated)
    normalImpulse: Fixed;
    tangentImpulse: Fixed;

    // Position correction bias
    bias: Fixed;

    // Unique key for contact caching (deterministic)
    key: string;
}

// ============================================
// Solver Parameters
// ============================================

export interface SolverParams {
    velocityIterations: number;     // Default: 8
    positionIterations: number;     // Default: 3
    allowedPenetration: Fixed;      // Slop - ignore penetration below this
    baumgarte: Fixed;               // Position correction factor (0.1-0.3)
    maxLinearCorrection: Fixed;     // Max position correction per iteration
    warmstartFactor: Fixed;         // How much of cached impulse to apply (0.0-1.0)
}

const DEFAULT_SOLVER_PARAMS: SolverParams = {
    velocityIterations: 12,                // Increased for better convergence with multiple manifolds
    positionIterations: 8,                 // More iterations
    allowedPenetration: toFixed(0.5),      // 0.5 units slop
    baumgarte: toFixed(0.2),               // 20% bias
    maxLinearCorrection: toFixed(20.0),    // Much larger correction per iteration
    warmstartFactor: toFixed(0.8),         // 80% warmstart
};

let solverParams: SolverParams = { ...DEFAULT_SOLVER_PARAMS };

export function setSolverParams(params: Partial<SolverParams>): void {
    solverParams = { ...solverParams, ...params };
}

export function getSolverParams(): SolverParams {
    return solverParams;
}

// ============================================
// Contact Cache (for warmstarting)
// ============================================

// Map of contact key -> cached impulses from last frame
// Key format: "minEid:maxEid" for deterministic ordering
const contactCache = new Map<string, { normalImpulse: Fixed; tangentImpulse: Fixed }>();

/**
 * Generate deterministic contact key from two bodies.
 * Always uses smaller eid first for consistency.
 */
function getContactKey(bodyA: RigidBody2D, bodyB: RigidBody2D): string {
    const eidA = parseInt(bodyA.label, 10) || 0;
    const eidB = parseInt(bodyB.label, 10) || 0;
    return eidA < eidB ? `${eidA}:${eidB}` : `${eidB}:${eidA}`;
}

/**
 * Clear contact cache (call when world is reset)
 */
export function clearContactCache(): void {
    contactCache.clear();
}

// ============================================
// AABB Computation
// ============================================

export function computeAABB2D(body: RigidBody2D): AABB2D {
    const { position, shape, angle } = body;

    if (shape.type === Shape2DType.Circle) {
        const radius = (shape as CircleShape).radius;
        return {
            minX: (position.x - radius) as Fixed,
            minY: (position.y - radius) as Fixed,
            maxX: (position.x + radius) as Fixed,
            maxY: (position.y + radius) as Fixed,
        };
    } else {
        const box = shape as BoxShape2D;
        const halfWidth = box.halfWidth;
        const halfHeight = box.halfHeight;

        if (angle === 0) {
            return {
                minX: (position.x - halfWidth) as Fixed,
                minY: (position.y - halfHeight) as Fixed,
                maxX: (position.x + halfWidth) as Fixed,
                maxY: (position.y + halfHeight) as Fixed,
            };
        }

        // Rotated box - compute bounding box
        const cosAngle = fpCos(angle);
        const sinAngle = fpSin(angle);
        const absCos = fpAbs(cosAngle);
        const absSin = fpAbs(sinAngle);

        const extentX = (fpMul(halfWidth, absCos) + fpMul(halfHeight, absSin)) as Fixed;
        const extentY = (fpMul(halfWidth, absSin) + fpMul(halfHeight, absCos)) as Fixed;

        return {
            minX: (position.x - extentX) as Fixed,
            minY: (position.y - extentY) as Fixed,
            maxX: (position.x + extentX) as Fixed,
            maxY: (position.y + extentY) as Fixed,
        };
    }
}

// ============================================
// Collision Detection
// ============================================

/**
 * Detect collision between two bodies.
 * Returns an array of Contact2D objects (0 for no collision, 1-2 for box-box).
 * Box-box collisions return up to 2 contact points for balanced torques.
 */
export function detectCollision2D(bodyA: RigidBody2D, bodyB: RigidBody2D): Contact2D[] {
    const shapeA = bodyA.shape;
    const shapeB = bodyB.shape;

    // Circle-Circle (single contact point)
    if (shapeA.type === Shape2DType.Circle && shapeB.type === Shape2DType.Circle) {
        const contact = detectCircleCircle(bodyA, bodyB);
        return contact ? [contact] : [];
    }

    // Box-Box (up to 2 contact points from manifold)
    if (shapeA.type === Shape2DType.Box && shapeB.type === Shape2DType.Box) {
        const manifold = detectBoxBox(bodyA, bodyB);
        if (!manifold) return [];
        // Convert manifold to Contact2D array
        return manifold.points.map(p => ({
            bodyA: manifold.bodyA,
            bodyB: manifold.bodyB,
            point: p.point,
            normal: manifold.normal,
            depth: p.depth
        }));
    }

    // Circle-Box (single contact point, ensure circle is always first for consistent normal direction)
    if (shapeA.type === Shape2DType.Circle && shapeB.type === Shape2DType.Box) {
        const contact = detectCircleBox(bodyA, bodyB);
        return contact ? [contact] : [];
    }
    if (shapeA.type === Shape2DType.Box && shapeB.type === Shape2DType.Circle) {
        const contact = detectCircleBox(bodyB, bodyA);
        if (contact) {
            // Swap bodies and flip normal to maintain A->B convention
            return [{
                bodyA: bodyA,
                bodyB: bodyB,
                point: contact.point,
                normal: { x: (-contact.normal.x) as Fixed, y: (-contact.normal.y) as Fixed },
                depth: contact.depth
            }];
        }
        return [];
    }

    return [];
}

/**
 * Circle vs Circle collision detection
 */
function detectCircleCircle(circleA: RigidBody2D, circleB: RigidBody2D): Contact2D | null {
    const radiusA = (circleA.shape as CircleShape).radius;
    const radiusB = (circleB.shape as CircleShape).radius;
    const sumRadius = (radiusA + radiusB) as Fixed;

    // Vector from A to B
    const deltaX = (circleB.position.x - circleA.position.x) as Fixed;
    const deltaY = (circleB.position.y - circleA.position.y) as Fixed;
    const distanceSq = (fpMul(deltaX, deltaX) + fpMul(deltaY, deltaY)) as Fixed;
    const minDistSq = fpMul(sumRadius, sumRadius);

    if (distanceSq >= minDistSq) return null;

    const distance = fpSqrt(distanceSq);
    const penetration = (sumRadius - distance) as Fixed;

    // Normal points from A to B
    let normalX: Fixed, normalY: Fixed;
    if (distance > 0) {
        const invDist = fpDiv(FP_ONE, distance);
        normalX = fpMul(deltaX, invDist);
        normalY = fpMul(deltaY, invDist);
    } else {
        // Circles at same position - arbitrary normal
        normalX = FP_ONE;
        normalY = 0 as Fixed;
    }

    // Contact point on surface of A
    const contactX = (circleA.position.x + fpMul(normalX, radiusA)) as Fixed;
    const contactY = (circleA.position.y + fpMul(normalY, radiusA)) as Fixed;

    return {
        bodyA: circleA,
        bodyB: circleB,
        point: { x: contactX, y: contactY },
        normal: { x: normalX, y: normalY },
        depth: penetration
    };
}

/**
 * Box vs Box collision detection
 * Uses OBB (Oriented Bounding Box) with SAT when either box is rotated,
 * falls back to fast AABB when both boxes have zero rotation.
 * Returns a contact manifold with up to 2 contact points.
 */
function detectBoxBox(boxA: RigidBody2D, boxB: RigidBody2D): ContactManifold2D | null {
    // Fast path: if neither box is rotated, use AABB
    if (boxA.angle === 0 && boxB.angle === 0) {
        return detectBoxBoxAABB(boxA, boxB);
    }
    // Slow path: use OBB with SAT
    return detectBoxBoxOBB(boxA, boxB);
}

/**
 * AABB Box vs Box collision (fast path for non-rotated boxes)
 * Returns a contact manifold with up to 2 contact points for edge-edge collision.
 * Two contact points balance torques and improve stacking stability.
 */
function detectBoxBoxAABB(boxA: RigidBody2D, boxB: RigidBody2D): ContactManifold2D | null {
    const shapeA = boxA.shape as BoxShape2D;
    const shapeB = boxB.shape as BoxShape2D;

    // Vector from A to B
    const deltaX = (boxB.position.x - boxA.position.x) as Fixed;
    const deltaY = (boxB.position.y - boxA.position.y) as Fixed;

    // Overlap on each axis
    const overlapX = ((shapeA.halfWidth + shapeB.halfWidth) - fpAbs(deltaX)) as Fixed;
    const overlapY = ((shapeA.halfHeight + shapeB.halfHeight) - fpAbs(deltaY)) as Fixed;

    if (overlapX <= 0 || overlapY <= 0) return null;

    // Use axis with minimum overlap (SAT)
    let normalX: Fixed, normalY: Fixed;
    let penetration: Fixed;
    const points: { point: Vec2; depth: Fixed }[] = [];

    if (overlapX < overlapY) {
        // Collision on X axis (left/right faces) - edge is vertical
        penetration = overlapX;
        normalX = deltaX > 0 ? FP_ONE : (-FP_ONE) as Fixed;
        normalY = 0 as Fixed;

        // Contact X: midpoint between the two colliding edges
        let contactX: Fixed;
        if (deltaX > 0) {
            const edgeA = (boxA.position.x + shapeA.halfWidth) as Fixed;
            const edgeB = (boxB.position.x - shapeB.halfWidth) as Fixed;
            contactX = ((edgeA + edgeB) >> 1) as Fixed;
        } else {
            const edgeA = (boxA.position.x - shapeA.halfWidth) as Fixed;
            const edgeB = (boxB.position.x + shapeB.halfWidth) as Fixed;
            contactX = ((edgeA + edgeB) >> 1) as Fixed;
        }

        // Find vertical overlap region - this is where the two edges touch
        const minYA = (boxA.position.y - shapeA.halfHeight) as Fixed;
        const maxYA = (boxA.position.y + shapeA.halfHeight) as Fixed;
        const minYB = (boxB.position.y - shapeB.halfHeight) as Fixed;
        const maxYB = (boxB.position.y + shapeB.halfHeight) as Fixed;
        const overlapMinY = fpMax(minYA, minYB);
        const overlapMaxY = fpMin(maxYA, maxYB);

        // Two contact points at the top and bottom of the overlap region
        // This balances torques for stable stacking
        points.push({
            point: { x: contactX, y: overlapMinY },
            depth: penetration
        });
        points.push({
            point: { x: contactX, y: overlapMaxY },
            depth: penetration
        });
    } else {
        // Collision on Y axis (top/bottom faces) - edge is horizontal
        penetration = overlapY;
        normalX = 0 as Fixed;
        normalY = deltaY > 0 ? FP_ONE : (-FP_ONE) as Fixed;

        // Contact Y: midpoint between the two colliding edges
        let contactY: Fixed;
        if (deltaY > 0) {
            const edgeA = (boxA.position.y + shapeA.halfHeight) as Fixed;
            const edgeB = (boxB.position.y - shapeB.halfHeight) as Fixed;
            contactY = ((edgeA + edgeB) >> 1) as Fixed;
        } else {
            const edgeA = (boxA.position.y - shapeA.halfHeight) as Fixed;
            const edgeB = (boxB.position.y + shapeB.halfHeight) as Fixed;
            contactY = ((edgeA + edgeB) >> 1) as Fixed;
        }

        // Find horizontal overlap region
        const minXA = (boxA.position.x - shapeA.halfWidth) as Fixed;
        const maxXA = (boxA.position.x + shapeA.halfWidth) as Fixed;
        const minXB = (boxB.position.x - shapeB.halfWidth) as Fixed;
        const maxXB = (boxB.position.x + shapeB.halfWidth) as Fixed;
        const overlapMinX = fpMax(minXA, minXB);
        const overlapMaxX = fpMin(maxXA, maxXB);

        // Two contact points at the left and right of the overlap region
        points.push({
            point: { x: overlapMinX, y: contactY },
            depth: penetration
        });
        points.push({
            point: { x: overlapMaxX, y: contactY },
            depth: penetration
        });
    }

    return {
        bodyA: boxA,
        bodyB: boxB,
        normal: { x: normalX, y: normalY },
        points
    };
}

/**
 * OBB vs OBB collision detection using SAT (Separating Axis Theorem)
 * Tests 4 axes: 2 from each box's rotated edges
 * Returns a contact manifold with up to 2 contact points.
 */
function detectBoxBoxOBB(boxA: RigidBody2D, boxB: RigidBody2D): ContactManifold2D | null {
    const shapeA = boxA.shape as BoxShape2D;
    const shapeB = boxB.shape as BoxShape2D;

    // Get rotation matrices for each box
    const cosA = fpCos(boxA.angle);
    const sinA = fpSin(boxA.angle);
    const cosB = fpCos(boxB.angle);
    const sinB = fpSin(boxB.angle);

    // Box A's local axes in world space
    const axisAX: Vec2 = { x: cosA, y: sinA };
    const axisAY: Vec2 = { x: (-sinA) as Fixed, y: cosA };

    // Box B's local axes in world space
    const axisBX: Vec2 = { x: cosB, y: sinB };
    const axisBY: Vec2 = { x: (-sinB) as Fixed, y: cosB };

    // Vector from A center to B center
    const d: Vec2 = {
        x: (boxB.position.x - boxA.position.x) as Fixed,
        y: (boxB.position.y - boxA.position.y) as Fixed
    };

    // Test all 4 separating axes and find minimum overlap
    let minOverlap = toFixed(999999);
    let minAxis: Vec2 = { x: FP_ONE, y: 0 as Fixed };
    let minAxisFlip = false;
    let minAxisFromA = true; // Track which box owns the separating axis

    // Helper: project box onto axis and get half-extent
    const projectBox = (halfW: Fixed, halfH: Fixed, localAxisX: Vec2, localAxisY: Vec2, axis: Vec2): Fixed => {
        const projX = fpAbs((fpMul(localAxisX.x, axis.x) + fpMul(localAxisX.y, axis.y)) as Fixed);
        const projY = fpAbs((fpMul(localAxisY.x, axis.x) + fpMul(localAxisY.y, axis.y)) as Fixed);
        return (fpMul(halfW, projX) + fpMul(halfH, projY)) as Fixed;
    };

    // Test axis and track which box it belongs to
    const testAxis = (axis: Vec2, fromA: boolean): boolean => {
        const dist = fpAbs((fpMul(d.x, axis.x) + fpMul(d.y, axis.y)) as Fixed);
        const projA = projectBox(shapeA.halfWidth, shapeA.halfHeight, axisAX, axisAY, axis);
        const projB = projectBox(shapeB.halfWidth, shapeB.halfHeight, axisBX, axisBY, axis);
        const overlap = ((projA + projB) - dist) as Fixed;

        if (overlap <= 0) return false;

        if (overlap < minOverlap) {
            minOverlap = overlap;
            minAxis = axis;
            minAxisFromA = fromA;
            const dProj = (fpMul(d.x, axis.x) + fpMul(d.y, axis.y)) as Fixed;
            minAxisFlip = dProj < 0;
        }
        return true;
    };

    // Test all 4 axes
    if (!testAxis(axisAX, true)) return null;
    if (!testAxis(axisAY, true)) return null;
    if (!testAxis(axisBX, false)) return null;
    if (!testAxis(axisBY, false)) return null;

    // Normal points from A to B
    let normalX = minAxis.x;
    let normalY = minAxis.y;
    if (minAxisFlip) {
        normalX = (-normalX) as Fixed;
        normalY = (-normalY) as Fixed;
    }

    // Find the reference and incident edges for clipping
    // Reference edge is on the box that owns the separating axis
    // Incident edge is on the other box, most anti-parallel to the normal

    // Get corners of both boxes in world space
    const getCornersWorld = (body: RigidBody2D, shape: BoxShape2D, cos: Fixed, sin: Fixed): Vec2[] => {
        const hw = shape.halfWidth;
        const hh = shape.halfHeight;
        // Local corners: (-hw,-hh), (hw,-hh), (hw,hh), (-hw,hh)
        const corners: Vec2[] = [];
        const localCorners = [
            { x: (-hw) as Fixed, y: (-hh) as Fixed },
            { x: hw, y: (-hh) as Fixed },
            { x: hw, y: hh },
            { x: (-hw) as Fixed, y: hh }
        ];
        for (const lc of localCorners) {
            corners.push({
                x: (body.position.x + fpMul(lc.x, cos) - fpMul(lc.y, sin)) as Fixed,
                y: (body.position.y + fpMul(lc.x, sin) + fpMul(lc.y, cos)) as Fixed
            });
        }
        return corners;
    };

    const cornersA = getCornersWorld(boxA, shapeA, cosA, sinA);
    const cornersB = getCornersWorld(boxB, shapeB, cosB, sinB);

    // Find the incident edge on the non-reference box
    // The incident edge is the one most anti-parallel to the collision normal
    const findIncidentEdge = (corners: Vec2[], normal: Vec2): { v1: Vec2; v2: Vec2 } => {
        let minDot = toFixed(999999);
        let incidentIdx = 0;

        for (let i = 0; i < 4; i++) {
            const next = (i + 1) % 4;
            // Edge normal (perpendicular to edge, pointing outward)
            const edgeX = (corners[next].x - corners[i].x) as Fixed;
            const edgeY = (corners[next].y - corners[i].y) as Fixed;
            // Outward normal for CCW winding: (edgeY, -edgeX) normalized (90° CW rotation)
            const len = fpSqrt((fpMul(edgeX, edgeX) + fpMul(edgeY, edgeY)) as Fixed);
            if (len === 0) continue;
            const invLen = fpDiv(FP_ONE, len);
            const enX = fpMul(edgeY, invLen);
            const enY = fpMul((-edgeX) as Fixed, invLen);

            const dot = (fpMul(enX, normal.x) + fpMul(enY, normal.y)) as Fixed;
            if (dot < minDot) {
                minDot = dot;
                incidentIdx = i;
            }
        }

        return {
            v1: corners[incidentIdx],
            v2: corners[(incidentIdx + 1) % 4]
        };
    };

    // Get the reference face info (for clipping)
    const refCorners = minAxisFromA ? cornersA : cornersB;
    const incCorners = minAxisFromA ? cornersB : cornersA;
    const refBody = minAxisFromA ? boxA : boxB;

    // Find which edge of reference box is the reference edge
    // It's the one whose normal is most parallel to the collision normal
    let refEdgeIdx = 0;
    let maxDot = toFixed(-999999);
    for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        const edgeX = (refCorners[next].x - refCorners[i].x) as Fixed;
        const edgeY = (refCorners[next].y - refCorners[i].y) as Fixed;
        const len = fpSqrt((fpMul(edgeX, edgeX) + fpMul(edgeY, edgeY)) as Fixed);
        if (len === 0) continue;
        const invLen = fpDiv(FP_ONE, len);
        const enX = fpMul(edgeY, invLen);
        const enY = fpMul((-edgeX) as Fixed, invLen);

        // For A as reference, normal points from A to B, so reference edge normal should align
        // For B as reference, we need to flip
        const testNormal = minAxisFromA ? { x: normalX, y: normalY } : { x: (-normalX) as Fixed, y: (-normalY) as Fixed };
        const dot = (fpMul(enX, testNormal.x) + fpMul(enY, testNormal.y)) as Fixed;
        if (dot > maxDot) {
            maxDot = dot;
            refEdgeIdx = i;
        }
    }

    const refV1 = refCorners[refEdgeIdx];
    const refV2 = refCorners[(refEdgeIdx + 1) % 4];

    // Get incident edge
    const incidentNormal = minAxisFromA ? { x: normalX, y: normalY } : { x: (-normalX) as Fixed, y: (-normalY) as Fixed };
    const incEdge = findIncidentEdge(incCorners, incidentNormal);

    // Clip incident edge against reference edge side planes
    // Reference edge tangent
    const refEdgeX = (refV2.x - refV1.x) as Fixed;
    const refEdgeY = (refV2.y - refV1.y) as Fixed;
    const refLen = fpSqrt((fpMul(refEdgeX, refEdgeX) + fpMul(refEdgeY, refEdgeY)) as Fixed);
    if (refLen === 0) {
        // Degenerate edge, fall back to single contact point at midpoint
        const midX = ((boxA.position.x + boxB.position.x) >> 1) as Fixed;
        const midY = ((boxA.position.y + boxB.position.y) >> 1) as Fixed;
        return {
            bodyA: boxA,
            bodyB: boxB,
            normal: { x: normalX, y: normalY },
            points: [{ point: { x: midX, y: midY }, depth: minOverlap }]
        };
    }

    const invRefLen = fpDiv(FP_ONE, refLen);
    const refTangentX = fpMul(refEdgeX, invRefLen);
    const refTangentY = fpMul(refEdgeY, invRefLen);

    // Clip against side plane at refV1 (tangent points toward refV2)
    const clip1 = (fpMul(refV1.x, refTangentX) + fpMul(refV1.y, refTangentY)) as Fixed;
    // Clip against side plane at refV2
    const clip2 = (fpMul(refV2.x, refTangentX) + fpMul(refV2.y, refTangentY)) as Fixed;

    // Clip incident edge against these planes
    let clippedPoints: Vec2[] = [incEdge.v1, incEdge.v2];

    // Clip against plane at refV1 (keep points where dot >= clip1)
    const clipAgainstPlane = (points: Vec2[], planeD: Fixed, keepGreater: boolean): Vec2[] => {
        const result: Vec2[] = [];
        for (let i = 0; i < points.length; i++) {
            const curr = points[i];
            const next = points[(i + 1) % points.length];
            const currD = (fpMul(curr.x, refTangentX) + fpMul(curr.y, refTangentY)) as Fixed;
            const nextD = (fpMul(next.x, refTangentX) + fpMul(next.y, refTangentY)) as Fixed;

            const currInside = keepGreater ? currD >= planeD : currD <= planeD;
            const nextInside = keepGreater ? nextD >= planeD : nextD <= planeD;

            if (currInside) {
                result.push(curr);
            }

            if (currInside !== nextInside) {
                // Edge crosses plane, compute intersection
                const t = fpDiv((planeD - currD) as Fixed, (nextD - currD) as Fixed);
                if (t > 0 && t < FP_ONE) {
                    result.push({
                        x: (curr.x + fpMul(t, (next.x - curr.x) as Fixed)) as Fixed,
                        y: (curr.y + fpMul(t, (next.y - curr.y) as Fixed)) as Fixed
                    });
                }
            }
        }
        return result;
    };

    clippedPoints = clipAgainstPlane(clippedPoints, clip1, true);
    clippedPoints = clipAgainstPlane(clippedPoints, clip2, false);

    // Now filter points that are behind the reference face
    // Reference face normal: 90° CW rotation of tangent = outward from reference body
    const refNormalX = refTangentY;
    const refNormalY = (-refTangentX) as Fixed;

    const refFaceD = (fpMul(refV1.x, refNormalX) + fpMul(refV1.y, refNormalY)) as Fixed;

    const contactPoints: { point: Vec2; depth: Fixed }[] = [];
    for (const p of clippedPoints) {
        const sep = ((fpMul(p.x, refNormalX) + fpMul(p.y, refNormalY)) - refFaceD) as Fixed;
        if (sep <= 0) {
            // Point is behind or on the reference face - it's a contact
            const depth = (-sep) as Fixed;
            contactPoints.push({ point: p, depth: fpMax(depth, minOverlap) });
        }
    }

    if (contactPoints.length === 0) {
        // Fallback: use midpoint
        const midX = ((boxA.position.x + boxB.position.x) >> 1) as Fixed;
        const midY = ((boxA.position.y + boxB.position.y) >> 1) as Fixed;
        contactPoints.push({ point: { x: midX, y: midY }, depth: minOverlap });
    }

    // Limit to 2 contact points (keep the deepest ones)
    if (contactPoints.length > 2) {
        contactPoints.sort((a, b) => toFloat(b.depth) - toFloat(a.depth));
        contactPoints.length = 2;
    }

    return {
        bodyA: boxA,
        bodyB: boxB,
        normal: { x: normalX, y: normalY },
        points: contactPoints
    };
}

/**
 * Circle vs Box collision detection
 * Box2D-style: find closest point on box, check distance to circle center
 */
function detectCircleBox(circle: RigidBody2D, box: RigidBody2D): Contact2D | null {
    const radius = (circle.shape as CircleShape).radius;
    const boxShape = box.shape as BoxShape2D;

    // Circle center in box's local space (box at origin)
    const localX = (circle.position.x - box.position.x) as Fixed;
    const localY = (circle.position.y - box.position.y) as Fixed;

    // Clamp to box bounds to find closest point
    const clampedX = fpMax((-boxShape.halfWidth) as Fixed, fpMin(boxShape.halfWidth, localX));
    const clampedY = fpMax((-boxShape.halfHeight) as Fixed, fpMin(boxShape.halfHeight, localY));

    // Check if circle center is inside box
    const centerInside = fpAbs(localX) < boxShape.halfWidth && fpAbs(localY) < boxShape.halfHeight;

    let normalX: Fixed, normalY: Fixed;
    let penetration: Fixed;

    if (centerInside) {
        // Circle center is inside box - find closest face
        const distToRight = (boxShape.halfWidth - localX) as Fixed;
        const distToLeft = (boxShape.halfWidth + localX) as Fixed;
        const distToTop = (boxShape.halfHeight - localY) as Fixed;
        const distToBottom = (boxShape.halfHeight + localY) as Fixed;

        // Find minimum distance to any face
        let minDist = distToRight;
        normalX = FP_ONE;
        normalY = 0 as Fixed;

        if (distToLeft < minDist) {
            minDist = distToLeft;
            normalX = (-FP_ONE) as Fixed;
            normalY = 0 as Fixed;
        }
        if (distToTop < minDist) {
            minDist = distToTop;
            normalX = 0 as Fixed;
            normalY = FP_ONE;
        }
        if (distToBottom < minDist) {
            minDist = distToBottom;
            normalX = 0 as Fixed;
            normalY = (-FP_ONE) as Fixed;
        }

        // Penetration is distance to face plus radius
        penetration = (minDist + radius) as Fixed;
    } else {
        // Circle center is outside box - normal case
        const diffX = (localX - clampedX) as Fixed;
        const diffY = (localY - clampedY) as Fixed;
        const distanceSq = (fpMul(diffX, diffX) + fpMul(diffY, diffY)) as Fixed;

        // No collision if distance > radius
        if (distanceSq >= fpMul(radius, radius)) return null;

        const distance = fpSqrt(distanceSq);
        penetration = (radius - distance) as Fixed;

        if (distance > 0) {
            const invDist = fpDiv(FP_ONE, distance);
            // Normal points from circle toward box (from A to B)
            // diffX/diffY points from box surface toward circle, so negate
            normalX = fpMul((-diffX) as Fixed, invDist);
            normalY = fpMul((-diffY) as Fixed, invDist);
        } else {
            // Edge case: circle exactly on box corner
            normalX = FP_ONE;
            normalY = 0 as Fixed;
        }
    }

    // Contact point on circle surface (toward box)
    const contactX = (circle.position.x + fpMul(normalX, radius)) as Fixed;
    const contactY = (circle.position.y + fpMul(normalY, radius)) as Fixed;

    return {
        bodyA: circle,
        bodyB: box,
        point: { x: contactX, y: contactY },
        normal: { x: normalX, y: normalY },
        depth: penetration
    };
}

// ============================================
// Rapier-Style Iterative Solver
// ============================================

/**
 * Create contact constraints from detected contacts.
 * Precomputes effective masses (including angular terms) and applies warmstarting.
 */
export function createContactConstraints(contacts: Contact2D[], dt: Fixed): ContactConstraint[] {
    const constraints: ContactConstraint[] = [];

    for (const contact of contacts) {
        const { bodyA, bodyB, normal, point, depth } = contact;

        // Skip sensors
        if (bodyA.isSensor || bodyB.isSensor) continue;

        // Skip static-static
        if (bodyA.type === BodyType2D.Static && bodyB.type === BodyType2D.Static) continue;

        // Get effective inverse masses (linear)
        const invMassA = bodyA.type === BodyType2D.Dynamic ? bodyA.invMass : 0 as Fixed;
        const invMassB = bodyB.type === BodyType2D.Dynamic ? bodyB.invMass : 0 as Fixed;

        // Get effective inverse inertias (angular)
        // Static/kinematic bodies have 0 inverse inertia for collision response
        // Also respect lockRotation flag
        const invInertiaA = (bodyA.type === BodyType2D.Dynamic && !bodyA.lockRotation) ? bodyA.invInertia : 0 as Fixed;
        const invInertiaB = (bodyB.type === BodyType2D.Dynamic && !bodyB.lockRotation) ? bodyB.invInertia : 0 as Fixed;

        // Compute lever arms from body centers to contact point
        const rA: Vec2 = vec2Sub(point, bodyA.position);
        const rB: Vec2 = vec2Sub(point, bodyB.position);

        // Compute tangent (perpendicular to normal)
        const tangent: Vec2 = { x: (-normal.y) as Fixed, y: normal.x };

        // Compute cross products: rA × n and rB × n (scalar in 2D)
        const rAxN = vec2Cross(rA, normal);
        const rBxN = vec2Cross(rB, normal);

        // Compute cross products for tangent: rA × t and rB × t
        const rAxT = vec2Cross(rA, tangent);
        const rBxT = vec2Cross(rB, tangent);

        // Effective mass along normal including angular terms:
        // kn = invMassA + invMassB + (rA × n)² * invInertiaA + (rB × n)² * invInertiaB
        const knLinear = (invMassA + invMassB) as Fixed;
        const knAngularA = fpMul(fpMul(rAxN, rAxN), invInertiaA);
        const knAngularB = fpMul(fpMul(rBxN, rBxN), invInertiaB);
        const kn = (knLinear + knAngularA + knAngularB) as Fixed;
        const normalMass = kn > 0 ? fpDiv(FP_ONE, kn) : 0 as Fixed;

        // Effective mass along tangent including angular terms:
        const ktLinear = (invMassA + invMassB) as Fixed;
        const ktAngularA = fpMul(fpMul(rAxT, rAxT), invInertiaA);
        const ktAngularB = fpMul(fpMul(rBxT, rBxT), invInertiaB);
        const kt = (ktLinear + ktAngularA + ktAngularB) as Fixed;
        const tangentMass = kt > 0 ? fpDiv(FP_ONE, kt) : 0 as Fixed;

        // If both bodies are completely immovable (no linear or angular response), skip
        if (kn === 0) continue;

        // Compute bias for position correction (Baumgarte stabilization)
        const { allowedPenetration, baumgarte } = solverParams;
        const penetration = fpMax(0 as Fixed, (depth - allowedPenetration) as Fixed);
        const bias = fpMul(baumgarte, penetration);

        // Generate contact key and get cached impulses
        const key = getContactKey(bodyA, bodyB);
        const cached = contactCache.get(key);

        // Initialize impulses (warmstart from cache or zero)
        let normalImpulse = 0 as Fixed;
        let tangentImpulse = 0 as Fixed;

        if (cached) {
            normalImpulse = fpMul(cached.normalImpulse, solverParams.warmstartFactor);
            tangentImpulse = fpMul(cached.tangentImpulse, solverParams.warmstartFactor);
        }

        constraints.push({
            bodyA,
            bodyB,
            normal,
            tangent,
            point,
            depth,
            rA,
            rB,
            normalMass,
            tangentMass,
            normalImpulse,
            tangentImpulse,
            bias,
            key
        });
    }

    return constraints;
}

/**
 * Apply warmstart impulses to bodies (both linear and angular).
 * Uses cached impulses from the previous frame for faster convergence.
 */
export function warmstartConstraints(constraints: ContactConstraint[]): void {
    for (const c of constraints) {
        const { bodyA, bodyB, normal, tangent, rA, rB, normalImpulse, tangentImpulse } = c;

        if (normalImpulse === 0 && tangentImpulse === 0) continue;

        // Compute total impulse vector
        const impulseX = (fpMul(normal.x, normalImpulse) + fpMul(tangent.x, tangentImpulse)) as Fixed;
        const impulseY = (fpMul(normal.y, normalImpulse) + fpMul(tangent.y, tangentImpulse)) as Fixed;
        const impulse: Vec2 = { x: impulseX, y: impulseY };

        // Apply to body A (subtract impulse)
        if (bodyA.type === BodyType2D.Dynamic) {
            const invMassA = bodyA.invMass;
            bodyA.linearVelocity.x = (bodyA.linearVelocity.x - fpMul(impulseX, invMassA)) as Fixed;
            bodyA.linearVelocity.y = (bodyA.linearVelocity.y - fpMul(impulseY, invMassA)) as Fixed;

            // Angular impulse: ωA -= (rA × impulse) * invInertiaA
            if (!bodyA.lockRotation && bodyA.invInertia > 0) {
                const torqueA = vec2Cross(rA, impulse);
                bodyA.angularVelocity = (bodyA.angularVelocity - fpMul(torqueA, bodyA.invInertia)) as Fixed;
            }
        }

        // Apply to body B (add impulse)
        if (bodyB.type === BodyType2D.Dynamic) {
            const invMassB = bodyB.invMass;
            bodyB.linearVelocity.x = (bodyB.linearVelocity.x + fpMul(impulseX, invMassB)) as Fixed;
            bodyB.linearVelocity.y = (bodyB.linearVelocity.y + fpMul(impulseY, invMassB)) as Fixed;

            // Angular impulse: ωB += (rB × impulse) * invInertiaB
            if (!bodyB.lockRotation && bodyB.invInertia > 0) {
                const torqueB = vec2Cross(rB, impulse);
                bodyB.angularVelocity = (bodyB.angularVelocity + fpMul(torqueB, bodyB.invInertia)) as Fixed;
            }
        }
    }
}

/**
 * Contact manifold for block solving - groups constraints by body pair.
 */
interface ContactManifoldConstraint {
    bodyA: RigidBody2D;
    bodyB: RigidBody2D;
    constraints: ContactConstraint[];
}

/**
 * Group constraints by body pair for block solving.
 */
function groupConstraintsByManifold(constraints: ContactConstraint[]): ContactManifoldConstraint[] {
    const manifoldMap = new Map<string, ContactManifoldConstraint>();

    for (const c of constraints) {
        const key = `${c.bodyA.id}:${c.bodyB.id}`;
        let manifold = manifoldMap.get(key);
        if (!manifold) {
            manifold = { bodyA: c.bodyA, bodyB: c.bodyB, constraints: [] };
            manifoldMap.set(key, manifold);
        }
        manifold.constraints.push(c);
    }

    return Array.from(manifoldMap.values());
}

/**
 * Compute relative velocity at contact point.
 */
function computeRelativeVelocity(
    bodyA: RigidBody2D,
    bodyB: RigidBody2D,
    rA: Vec2,
    rB: Vec2,
    wA: Fixed,
    wB: Fixed
): Vec2 {
    // vRel = (vB + ωB × rB) - (vA + ωA × rA)
    // In 2D: ω × r = (-ω * r.y, ω * r.x)
    const relVelX = (
        (bodyB.linearVelocity.x + fpMul((-wB) as Fixed, rB.y)) -
        (bodyA.linearVelocity.x + fpMul((-wA) as Fixed, rA.y))
    ) as Fixed;
    const relVelY = (
        (bodyB.linearVelocity.y + fpMul(wB, rB.x)) -
        (bodyA.linearVelocity.y + fpMul(wA, rA.x))
    ) as Fixed;
    return { x: relVelX, y: relVelY };
}

/**
 * Apply impulse to bodies (both linear and angular).
 */
function applyImpulse(
    bodyA: RigidBody2D,
    bodyB: RigidBody2D,
    impulse: Vec2,
    rA: Vec2,
    rB: Vec2,
    invMassA: Fixed,
    invMassB: Fixed,
    invInertiaA: Fixed,
    invInertiaB: Fixed
): void {
    if (bodyA.type === BodyType2D.Dynamic) {
        bodyA.linearVelocity.x = (bodyA.linearVelocity.x - fpMul(impulse.x, invMassA)) as Fixed;
        bodyA.linearVelocity.y = (bodyA.linearVelocity.y - fpMul(impulse.y, invMassA)) as Fixed;
        if (invInertiaA > 0) {
            const torqueA = (fpMul(rA.x, impulse.y) - fpMul(rA.y, impulse.x)) as Fixed;
            bodyA.angularVelocity = (bodyA.angularVelocity - fpMul(torqueA, invInertiaA)) as Fixed;
        }
    }
    if (bodyB.type === BodyType2D.Dynamic) {
        bodyB.linearVelocity.x = (bodyB.linearVelocity.x + fpMul(impulse.x, invMassB)) as Fixed;
        bodyB.linearVelocity.y = (bodyB.linearVelocity.y + fpMul(impulse.y, invMassB)) as Fixed;
        if (invInertiaB > 0) {
            const torqueB = (fpMul(rB.x, impulse.y) - fpMul(rB.y, impulse.x)) as Fixed;
            bodyB.angularVelocity = (bodyB.angularVelocity + fpMul(torqueB, invInertiaB)) as Fixed;
        }
    }
}

/**
 * Block solver for 2-point contact manifolds.
 * Solves both contact points simultaneously using 2x2 LCP.
 * This prevents unwanted rotation that occurs when solving sequentially.
 */
function solveManifoldBlock(
    manifold: ContactManifoldConstraint,
    invMassA: Fixed,
    invMassB: Fixed,
    invInertiaA: Fixed,
    invInertiaB: Fixed
): void {
    const { bodyA, bodyB, constraints } = manifold;
    if (constraints.length !== 2) return;

    const c1 = constraints[0];
    const c2 = constraints[1];
    const normal = c1.normal; // Both share the same normal

    // Get angular velocities
    const wA = bodyA.type === BodyType2D.Dynamic ? bodyA.angularVelocity : 0 as Fixed;
    const wB = bodyB.type === BodyType2D.Dynamic ? bodyB.angularVelocity : 0 as Fixed;

    // Compute relative velocities at both contact points
    const relVel1 = computeRelativeVelocity(bodyA, bodyB, c1.rA, c1.rB, wA, wB);
    const relVel2 = computeRelativeVelocity(bodyA, bodyB, c2.rA, c2.rB, wA, wB);

    // Normal velocities at both points
    const vn1 = (fpMul(relVel1.x, normal.x) + fpMul(relVel1.y, normal.y)) as Fixed;
    const vn2 = (fpMul(relVel2.x, normal.x) + fpMul(relVel2.y, normal.y)) as Fixed;

    // Build the 2x2 effective mass matrix K
    // K[i][j] = how impulse at point j affects velocity at point i
    // Diagonal: K[0][0] = 1/normalMass1, K[1][1] = 1/normalMass2
    // Off-diagonal: cross-coupling through shared body

    // rA × n for both points
    const rA1xN = vec2Cross(c1.rA, normal);
    const rA2xN = vec2Cross(c2.rA, normal);
    const rB1xN = vec2Cross(c1.rB, normal);
    const rB2xN = vec2Cross(c2.rB, normal);

    // Diagonal elements (same as normalMass computation)
    const k11 = (invMassA + invMassB +
        fpMul(fpMul(rA1xN, rA1xN), invInertiaA) +
        fpMul(fpMul(rB1xN, rB1xN), invInertiaB)) as Fixed;

    const k22 = (invMassA + invMassB +
        fpMul(fpMul(rA2xN, rA2xN), invInertiaA) +
        fpMul(fpMul(rB2xN, rB2xN), invInertiaB)) as Fixed;

    // Off-diagonal elements (cross-coupling)
    // k12 = invMassA + invMassB + (rA1 × n)(rA2 × n) * invInertiaA + (rB1 × n)(rB2 × n) * invInertiaB
    const k12 = (invMassA + invMassB +
        fpMul(fpMul(rA1xN, rA2xN), invInertiaA) +
        fpMul(fpMul(rB1xN, rB2xN), invInertiaB)) as Fixed;

    // Target velocities (want vn = 0 for non-penetration)
    // b = -vn (we want to eliminate normal velocity)
    const b1 = (-vn1) as Fixed;
    const b2 = (-vn2) as Fixed;

    // Current accumulated impulses
    const a1 = c1.normalImpulse;
    const a2 = c2.normalImpulse;

    // Solve 2x2 LCP using total enumeration (Box2D method)
    // We test 4 cases and pick the first valid one

    // Invert 2x2 matrix K to get effective mass matrix
    const det = (fpMul(k11, k22) - fpMul(k12, k12)) as Fixed;
    if (det === 0) {
        // Degenerate case - fall back to sequential
        return;
    }
    const invDet = fpDiv(FP_ONE, det);

    // Case 1: Both contacts active (x1 > 0, x2 > 0)
    // Solve K * x = b directly
    // x = K^-1 * b
    // K^-1 = (1/det) * [[k22, -k12], [-k12, k11]]
    {
        const x1 = fpMul(invDet, (fpMul(k22, b1) - fpMul(k12, b2)) as Fixed);
        const x2 = fpMul(invDet, (fpMul(k11, b2) - fpMul(k12, b1)) as Fixed);

        // New accumulated impulse
        const newA1 = (a1 + x1) as Fixed;
        const newA2 = (a2 + x2) as Fixed;

        if (newA1 >= 0 && newA2 >= 0) {
            // Valid solution - apply delta impulses
            const d1 = (newA1 - a1) as Fixed;
            const d2 = (newA2 - a2) as Fixed;

            c1.normalImpulse = newA1;
            c2.normalImpulse = newA2;

            // Apply impulses
            const impulse1: Vec2 = { x: fpMul(normal.x, d1), y: fpMul(normal.y, d1) };
            const impulse2: Vec2 = { x: fpMul(normal.x, d2), y: fpMul(normal.y, d2) };

            applyImpulse(bodyA, bodyB, impulse1, c1.rA, c1.rB, invMassA, invMassB, invInertiaA, invInertiaB);
            applyImpulse(bodyA, bodyB, impulse2, c2.rA, c2.rB, invMassA, invMassB, invInertiaA, invInertiaB);
            return;
        }
    }

    // Case 2: Only contact 1 active (x1 > 0, x2 = 0)
    {
        const x1 = fpDiv(b1, k11);
        const newA1 = (a1 + x1) as Fixed;

        if (newA1 >= 0) {
            // Check if vn2 >= 0 (contact 2 separating)
            const vn2_new = (vn2 + fpMul(k12, x1)) as Fixed;
            if (vn2_new >= 0) {
                const d1 = (newA1 - a1) as Fixed;
                c1.normalImpulse = newA1;
                c2.normalImpulse = 0 as Fixed;

                const impulse1: Vec2 = { x: fpMul(normal.x, d1), y: fpMul(normal.y, d1) };
                applyImpulse(bodyA, bodyB, impulse1, c1.rA, c1.rB, invMassA, invMassB, invInertiaA, invInertiaB);

                // Apply negative of accumulated c2 impulse (release it)
                if (a2 !== 0) {
                    const impulse2: Vec2 = { x: fpMul(normal.x, (-a2) as Fixed), y: fpMul(normal.y, (-a2) as Fixed) };
                    applyImpulse(bodyA, bodyB, impulse2, c2.rA, c2.rB, invMassA, invMassB, invInertiaA, invInertiaB);
                }
                return;
            }
        }
    }

    // Case 3: Only contact 2 active (x1 = 0, x2 > 0)
    {
        const x2 = fpDiv(b2, k22);
        const newA2 = (a2 + x2) as Fixed;

        if (newA2 >= 0) {
            // Check if vn1 >= 0 (contact 1 separating)
            const vn1_new = (vn1 + fpMul(k12, x2)) as Fixed;
            if (vn1_new >= 0) {
                const d2 = (newA2 - a2) as Fixed;
                c1.normalImpulse = 0 as Fixed;
                c2.normalImpulse = newA2;

                // Apply negative of accumulated c1 impulse (release it)
                if (a1 !== 0) {
                    const impulse1: Vec2 = { x: fpMul(normal.x, (-a1) as Fixed), y: fpMul(normal.y, (-a1) as Fixed) };
                    applyImpulse(bodyA, bodyB, impulse1, c1.rA, c1.rB, invMassA, invMassB, invInertiaA, invInertiaB);
                }

                const impulse2: Vec2 = { x: fpMul(normal.x, d2), y: fpMul(normal.y, d2) };
                applyImpulse(bodyA, bodyB, impulse2, c2.rA, c2.rB, invMassA, invMassB, invInertiaA, invInertiaB);
                return;
            }
        }
    }

    // Case 4: Neither contact active (x1 = 0, x2 = 0)
    // Just release both impulses
    {
        c1.normalImpulse = 0 as Fixed;
        c2.normalImpulse = 0 as Fixed;

        if (a1 !== 0) {
            const impulse1: Vec2 = { x: fpMul(normal.x, (-a1) as Fixed), y: fpMul(normal.y, (-a1) as Fixed) };
            applyImpulse(bodyA, bodyB, impulse1, c1.rA, c1.rB, invMassA, invMassB, invInertiaA, invInertiaB);
        }
        if (a2 !== 0) {
            const impulse2: Vec2 = { x: fpMul(normal.x, (-a2) as Fixed), y: fpMul(normal.y, (-a2) as Fixed) };
            applyImpulse(bodyA, bodyB, impulse2, c2.rA, c2.rB, invMassA, invMassB, invInertiaA, invInertiaB);
        }
    }
}

/**
 * Solve velocity constraints iteratively.
 * Uses block solver for 2-point manifolds to prevent unwanted rotation.
 * This prevents bodies from interpenetrating by adjusting velocities.
 * Includes angular velocity contribution to relative velocity and applies angular impulses.
 */
export function solveVelocityConstraints(constraints: ContactConstraint[]): void {
    const iterations = solverParams.velocityIterations;

    // Group constraints by body pair for block solving
    const manifolds = groupConstraintsByManifold(constraints);

    for (let iter = 0; iter < iterations; iter++) {
        for (const manifold of manifolds) {
            const { bodyA, bodyB, constraints: mConstraints } = manifold;

            // Get effective inverse masses
            const invMassA = bodyA.type === BodyType2D.Dynamic ? bodyA.invMass : 0 as Fixed;
            const invMassB = bodyB.type === BodyType2D.Dynamic ? bodyB.invMass : 0 as Fixed;

            // Get effective inverse inertias
            const invInertiaA = (bodyA.type === BodyType2D.Dynamic && !bodyA.lockRotation) ? bodyA.invInertia : 0 as Fixed;
            const invInertiaB = (bodyB.type === BodyType2D.Dynamic && !bodyB.lockRotation) ? bodyB.invInertia : 0 as Fixed;

            // Solve friction for each contact point individually (friction doesn't need block solving)
            for (const c of mConstraints) {
                const { normal, tangent, rA, rB, tangentMass } = c;

                // Get angular velocities
                const wA = bodyA.type === BodyType2D.Dynamic ? bodyA.angularVelocity : 0 as Fixed;
                const wB = bodyB.type === BodyType2D.Dynamic ? bodyB.angularVelocity : 0 as Fixed;

                // Relative velocity at contact point
                const relVel = computeRelativeVelocity(bodyA, bodyB, rA, rB, wA, wB);

                // Velocity along tangent
                const vt = (fpMul(relVel.x, tangent.x) + fpMul(relVel.y, tangent.y)) as Fixed;

                // Compute friction impulse
                let lambda = fpMul(-vt, tangentMass);

                // Clamp to friction cone
                const friction = fpMul(bodyA.friction, bodyB.friction);
                const maxFriction = fpMul(friction, fpAbs(c.normalImpulse));

                const oldTangentImpulse = c.tangentImpulse;
                c.tangentImpulse = fpMax((-maxFriction) as Fixed, fpMin(maxFriction, (c.tangentImpulse + lambda) as Fixed));
                lambda = (c.tangentImpulse - oldTangentImpulse) as Fixed;

                // Apply tangent impulse
                const impulse: Vec2 = { x: fpMul(tangent.x, lambda), y: fpMul(tangent.y, lambda) };
                applyImpulse(bodyA, bodyB, impulse, rA, rB, invMassA, invMassB, invInertiaA, invInertiaB);
            }

            // Solve normal constraints
            if (mConstraints.length === 2) {
                // Use block solver for 2-point manifolds
                solveManifoldBlock(manifold, invMassA, invMassB, invInertiaA, invInertiaB);
            } else {
                // Single contact - solve normally
                for (const c of mConstraints) {
                    const { normal, rA, rB, normalMass } = c;

                    // Get angular velocities
                    const wA = bodyA.type === BodyType2D.Dynamic ? bodyA.angularVelocity : 0 as Fixed;
                    const wB = bodyB.type === BodyType2D.Dynamic ? bodyB.angularVelocity : 0 as Fixed;

                    // Relative velocity at contact point
                    const relVel = computeRelativeVelocity(bodyA, bodyB, rA, rB, wA, wB);

                    // Velocity along normal
                    const vn = (fpMul(relVel.x, normal.x) + fpMul(relVel.y, normal.y)) as Fixed;

                    // Compute restitution
                    const VELOCITY_THRESHOLD = toFixed(1.0);
                    let restitution = fpMin(bodyA.restitution, bodyB.restitution);
                    if (fpAbs(vn) < VELOCITY_THRESHOLD) {
                        restitution = 0 as Fixed;
                    }

                    // Compute impulse
                    let lambda = fpMul(-normalMass, fpMul(vn, (FP_ONE + restitution) as Fixed));

                    // Clamp accumulated impulse
                    const oldNormalImpulse = c.normalImpulse;
                    c.normalImpulse = fpMax(0 as Fixed, (c.normalImpulse + lambda) as Fixed);
                    lambda = (c.normalImpulse - oldNormalImpulse) as Fixed;

                    // Apply normal impulse
                    const impulse: Vec2 = { x: fpMul(normal.x, lambda), y: fpMul(normal.y, lambda) };
                    applyImpulse(bodyA, bodyB, impulse, rA, rB, invMassA, invMassB, invInertiaA, invInertiaB);
                }
            }
        }
    }
}

/**
 * Solve position constraints iteratively.
 * Directly adjusts positions to resolve remaining penetration.
 *
 * IMPORTANT: Kinematic bodies ARE position-corrected when colliding with static geometry.
 * This prevents kinematic bodies from pushing through walls/other kinematics.
 * Priority: Static > Kinematic > Dynamic
 */
export function solvePositionConstraints(constraints: ContactConstraint[]): boolean {
    const iterations = solverParams.positionIterations;
    const { allowedPenetration, maxLinearCorrection } = solverParams;

    let positionSolved = true;

    for (let iter = 0; iter < iterations; iter++) {
        let maxPenetration = 0 as Fixed;

        for (const c of constraints) {
            const { bodyA, bodyB, normal } = c;

            // Recompute penetration depth (positions may have changed)
            const depth = c.depth;

            // Skip if penetration is within tolerance
            const penetration = (depth - allowedPenetration) as Fixed;
            if (penetration <= 0) continue;

            if (penetration > maxPenetration) {
                maxPenetration = penetration;
            }

            // Determine which bodies can be moved for position correction
            // Priority: Static (never moves) > Kinematic (moves only vs static/kinematic) > Dynamic (always moves)
            const typeA = bodyA.type;
            const typeB = bodyB.type;

            // Skip if both are static
            if (typeA === BodyType2D.Static && typeB === BodyType2D.Static) continue;

            // Calculate effective masses for position correction
            // Dynamic bodies use their invMass
            // Kinematic bodies: use a small invMass when colliding with static, 0 otherwise
            // This makes kinematic get pushed out of static geometry
            let invMassA: Fixed;
            let invMassB: Fixed;

            if (typeA === BodyType2D.Dynamic) {
                invMassA = bodyA.invMass;
            } else if (typeA === BodyType2D.Kinematic) {
                // Kinematic position correction priority:
                // vs Static: full correction (invMass=1.0) - kinematic gets pushed out of walls
                // vs Kinematic: equal correction (invMass=1.0) - both kinematic move equally
                // vs Dynamic: small correction (invMass=0.2) - kinematic gets pushed back slightly
                //             This prevents kinematic from infinitely pushing blocked dynamic bodies
                if (typeB === BodyType2D.Static) {
                    invMassA = toFixed(1.0);
                } else if (typeB === BodyType2D.Kinematic) {
                    invMassA = toFixed(1.0);
                } else {
                    invMassA = toFixed(0.2); // Small but non-zero vs dynamic
                }
            } else {
                invMassA = 0 as Fixed; // Static never moves
            }

            if (typeB === BodyType2D.Dynamic) {
                invMassB = bodyB.invMass;
            } else if (typeB === BodyType2D.Kinematic) {
                // Same logic as above
                if (typeA === BodyType2D.Static) {
                    invMassB = toFixed(1.0);
                } else if (typeA === BodyType2D.Kinematic) {
                    invMassB = toFixed(1.0);
                } else {
                    invMassB = toFixed(0.2); // Small but non-zero vs dynamic
                }
            } else {
                invMassB = 0 as Fixed; // Static never moves
            }

            const totalInvMass = (invMassA + invMassB) as Fixed;
            if (totalInvMass === 0) continue;

            // Compute position correction
            const correction = fpMin(maxLinearCorrection, fpMul(fpDiv(FP_ONE, totalInvMass), penetration));

            // Distribute correction based on inverse mass ratio
            if (invMassA > 0) {
                const corrA = fpMul(correction, fpDiv(invMassA, totalInvMass));
                bodyA.position.x = (bodyA.position.x - fpMul(normal.x, corrA)) as Fixed;
                bodyA.position.y = (bodyA.position.y - fpMul(normal.y, corrA)) as Fixed;
            }
            if (invMassB > 0) {
                const corrB = fpMul(correction, fpDiv(invMassB, totalInvMass));
                bodyB.position.x = (bodyB.position.x + fpMul(normal.x, corrB)) as Fixed;
                bodyB.position.y = (bodyB.position.y + fpMul(normal.y, corrB)) as Fixed;
            }

            // Update stored depth for next iteration
            c.depth = (c.depth - correction) as Fixed;
        }

        // Check if all penetrations are resolved
        if (maxPenetration <= allowedPenetration) {
            positionSolved = true;
            break;
        } else {
            positionSolved = false;
        }
    }

    return positionSolved;
}

/**
 * Store impulses in cache for next frame warmstarting.
 */
export function storeContactImpulses(constraints: ContactConstraint[]): void {
    // Clear old cache entries that are no longer active
    const activeKeys = new Set(constraints.map(c => c.key));

    // Remove stale entries (contacts that no longer exist)
    for (const key of contactCache.keys()) {
        if (!activeKeys.has(key)) {
            contactCache.delete(key);
        }
    }

    // Store current impulses
    for (const c of constraints) {
        contactCache.set(c.key, {
            normalImpulse: c.normalImpulse,
            tangentImpulse: c.tangentImpulse
        });
    }
}

/**
 * Check if a body at a given position would collide with any STATIC body.
 * Uses AABB overlap for fast broad phase, then narrow phase for precision.
 */
function wouldCollideWithStatic(
    body: RigidBody2D,
    newX: Fixed,
    newY: Fixed,
    staticBodies: RigidBody2D[]
): boolean {
    // Save original position
    const origX = body.position.x;
    const origY = body.position.y;

    // Temporarily move body to check collision
    body.position.x = newX;
    body.position.y = newY;

    // Compute AABB at new position
    const aabb = computeAABB2D(body);

    // Check against static bodies only
    let collides = false;
    for (const staticBody of staticBodies) {
        const staticAABB = computeAABB2D(staticBody);

        // AABB overlap test
        if (aabb.maxX > staticAABB.minX &&
            aabb.minX < staticAABB.maxX &&
            aabb.maxY > staticAABB.minY &&
            aabb.minY < staticAABB.maxY) {

            // Narrow phase: precise collision check
            const contacts = detectCollision2D(body, staticBody);
            if (contacts.length > 0 && contacts.some(c => c.depth > 0)) {
                collides = true;
                break;
            }
        }
    }

    // Restore original position
    body.position.x = origX;
    body.position.y = origY;

    return collides;
}

/**
 * Integrate positions for a list of bodies.
 * PRE-MOVEMENT COLLISION CHECK: Prevents bodies from moving into STATIC geometry.
 * Dynamic-dynamic collisions are handled by the velocity/position solver.
 */
export function integratePositions(bodies: RigidBody2D[], dt: Fixed): void {
    // Collect static bodies for collision checking
    const staticBodies = bodies.filter(b => b.type === BodyType2D.Static);

    for (const body of bodies) {
        // Skip static bodies - they never move
        if (body.type === BodyType2D.Static) continue;
        if (body.isSleeping) continue;

        // Calculate tentative new position
        const newX = (body.position.x + fpMul(body.linearVelocity.x, dt)) as Fixed;
        const newY = (body.position.y + fpMul(body.linearVelocity.y, dt)) as Fixed;

        // PRE-MOVEMENT COLLISION CHECK against STATIC geometry only
        // This prevents penetration into walls
        // Dynamic-dynamic penetration is handled by velocity/position solver

        // Try full movement first
        if (!wouldCollideWithStatic(body, newX, newY, staticBodies)) {
            // Safe to move fully
            body.position.x = newX;
            body.position.y = newY;
        } else {
            // Full movement blocked - try axis-by-axis (allows sliding along walls)

            // Try X-only movement
            const canMoveX = !wouldCollideWithStatic(body, newX, body.position.y, staticBodies);

            // Try Y-only movement
            const canMoveY = !wouldCollideWithStatic(body, body.position.x, newY, staticBodies);

            if (canMoveX) {
                body.position.x = newX;
            } else {
                body.linearVelocity.x = 0 as Fixed;
            }

            if (canMoveY) {
                body.position.y = newY;
            } else {
                body.linearVelocity.y = 0 as Fixed;
            }
        }

        // Update angle (only for dynamic, kinematic rotation is game-controlled)
        if (body.type === BodyType2D.Dynamic && !body.lockRotation && body.angularVelocity !== 0) {
            body.angle = (body.angle + fpMul(body.angularVelocity, dt)) as Fixed;
        }
    }
}

/**
 * Main solver entry point - runs the complete Rapier-style solver pipeline.
 * Call this instead of resolveCollision2D for the new solver.
 *
 * IMPORTANT: Pass bodies array to enable correct step order:
 * 1. Velocity solver (prevent approaching)
 * 2. Position integration (update positions from velocities)
 * 3. Position solver (fix remaining penetration)
 */
export function solveConstraints(contacts: Contact2D[], dt: Fixed, bodies?: RigidBody2D[]): void {
    // Always integrate positions even if no contacts
    if (bodies) {
        if (contacts.length === 0) {
            // No contacts - just integrate positions
            integratePositions(bodies, dt);
            return;
        }
    } else if (contacts.length === 0) {
        return;
    }

    // 1. Create contact constraints with precomputed values
    const constraints = createContactConstraints(contacts, dt);

    if (constraints.length === 0) return;

    // 2. Warmstart - apply cached impulses from last frame
    warmstartConstraints(constraints);

    // 3. Velocity solver - iteratively solve velocity constraints
    solveVelocityConstraints(constraints);

    // 4. Position integration (if bodies provided)
    // This MUST happen between velocity and position solving!
    if (bodies) {
        integratePositions(bodies, dt);
    }

    // 5. Re-detect penetration depths after position integration
    // Update constraint depths, normals, and lever arms based on new positions
    // Group constraints by body pair to avoid redundant re-detection
    const pairToContacts = new Map<string, Contact2D[]>();

    for (const c of constraints) {
        const key = `${c.bodyA.id}:${c.bodyB.id}`;
        if (!pairToContacts.has(key)) {
            // Re-detect collision for this body pair
            const newContacts = detectCollision2D(c.bodyA, c.bodyB);
            pairToContacts.set(key, newContacts);
        }
    }

    // Track constraint index per body pair to match with contact points
    const pairConstraintIndex = new Map<string, number>();

    for (const c of constraints) {
        const key = `${c.bodyA.id}:${c.bodyB.id}`;
        const newContacts = pairToContacts.get(key) || [];
        const idx = pairConstraintIndex.get(key) || 0;
        pairConstraintIndex.set(key, idx + 1);

        if (newContacts.length > 0) {
            // Use corresponding contact point if available, otherwise first one
            const newContact = newContacts[Math.min(idx, newContacts.length - 1)];
            c.depth = newContact.depth;
            c.normal = newContact.normal;
            c.point = newContact.point;
            // Update tangent
            c.tangent = { x: (-c.normal.y) as Fixed, y: c.normal.x };
            // Update lever arms for position solver
            c.rA = vec2Sub(c.point, c.bodyA.position);
            c.rB = vec2Sub(c.point, c.bodyB.position);
        } else {
            // No longer colliding
            c.depth = 0 as Fixed;
        }
    }

    // 6. Position solver - fix remaining penetration
    solvePositionConstraints(constraints);

    // 7. Store impulses for next frame
    storeContactImpulses(constraints);

    // Debug logging
    if (collisionDebugEnabled) {
        for (const c of constraints) {
            if (c.normalImpulse !== 0 || c.depth > solverParams.allowedPenetration) {
                const typeA = c.bodyA.type;
                const typeB = c.bodyB.type;
                // Log angular info for dynamic bodies
                const avA = typeA === BodyType2D.Dynamic ? toFloat(c.bodyA.angularVelocity).toFixed(3) : '-';
                const avB = typeB === BodyType2D.Dynamic ? toFloat(c.bodyB.angularVelocity).toFixed(3) : '-';
                const rAx = toFloat(c.rA.x).toFixed(1);
                const rAy = toFloat(c.rA.y).toFixed(1);
                const rBx = toFloat(c.rB.x).toFixed(1);
                const rBy = toFloat(c.rB.y).toFixed(1);
                // Get shape dimensions
                const shapeA = c.bodyA.shape;
                const shapeB = c.bodyB.shape;
                const sizeA = shapeA.type === Shape2DType.Circle
                    ? `r=${toFloat((shapeA as CircleShape).radius).toFixed(1)}`
                    : `${toFloat((shapeA as BoxShape2D).halfWidth * 2).toFixed(0)}x${toFloat((shapeA as BoxShape2D).halfHeight * 2).toFixed(0)}`;
                const sizeB = shapeB.type === Shape2DType.Circle
                    ? `r=${toFloat((shapeB as CircleShape).radius).toFixed(1)}`
                    : `${toFloat((shapeB as BoxShape2D).halfWidth * 2).toFixed(0)}x${toFloat((shapeB as BoxShape2D).halfHeight * 2).toFixed(0)}`;
                // Get angles
                const angA = toFloat(c.bodyA.angle).toFixed(2);
                const angB = toFloat(c.bodyB.angle).toFixed(2);
                // Normal direction
                const nx = toFloat(c.normal.x).toFixed(2);
                const ny = toFloat(c.normal.y).toFixed(2);
                console.log(
                    `[Physics2D] ${c.bodyA.label}(${typeA === BodyType2D.Dynamic ? 'D' : 'S'},${sizeA},ang=${angA}) <-> ${c.bodyB.label}(${typeB === BodyType2D.Dynamic ? 'D' : 'S'},${sizeB},ang=${angB}) | n=(${nx},${ny}) imp=${toFloat(c.normalImpulse).toFixed(1)} depth=${toFloat(c.depth).toFixed(2)} | rA=(${rAx},${rAy}) rB=(${rBx},${rBy}) | avA=${avA} avB=${avB}`
                );
            }
        }
    }
}

// ============================================
// Legacy Collision Response (kept for reference)
// ============================================

/**
 * @deprecated Use solveConstraints() instead for Rapier-style solving.
 * Resolve collision by applying position correction and velocity impulses.
 *
 * For kinematic bodies: position correction only (no velocity response)
 * For dynamic bodies: both position and velocity correction
 */
export function resolveCollision2D(contact: Contact2D): void {
    const { bodyA, bodyB, normal, depth } = contact;

    // Skip triggers
    if (bodyA.isSensor || bodyB.isSensor) return;

    const typeA = bodyA.type;
    const typeB = bodyB.type;

    // Static-Static: nothing to do
    if (typeA === BodyType2D.Static && typeB === BodyType2D.Static) return;

    // Apply position correction based on body types
    applyPositionCorrection(bodyA, bodyB, normal, depth);

    // Apply velocity impulses only for dynamic bodies
    if (typeA === BodyType2D.Dynamic || typeB === BodyType2D.Dynamic) {
        applyVelocityImpulse(bodyA, bodyB, normal);
    }
}

// Debug logging for collision position correction
// Set to true to log when bodies are moved by collision resolution
let collisionDebugEnabled = false;

export function enableCollisionDebug(enabled: boolean): void {
    collisionDebugEnabled = enabled;
}

/**
 * Apply position correction to separate overlapping bodies.
 * Called once per contact, not iterated.
 */
function applyPositionCorrection(
    bodyA: RigidBody2D,
    bodyB: RigidBody2D,
    normal: Vec2,
    depth: Fixed
): void {
    const typeA = bodyA.type;
    const typeB = bodyB.type;

    // Determine how to distribute the correction
    const aMovable = typeA !== BodyType2D.Static;
    const bMovable = typeB !== BodyType2D.Static;

    if (!aMovable && !bMovable) return;

    // Tiny slop to prevent jitter (0.01 units)
    const slop = toFixed(0.01);
    const correctionDepth = fpMax(0 as Fixed, (depth - slop) as Fixed);

    if (correctionDepth <= 0) return;

    // Log only when position correction actually happens (non-spammy)
    if (collisionDebugEnabled) {
        const depthFloat = toFloat(depth);
        const correctionFloat = toFloat(correctionDepth);
        const normalX = toFloat(normal.x);
        const normalY = toFloat(normal.y);
        console.log(
            `[Physics2D] Position correction: ${bodyA.label}(${typeA === BodyType2D.Dynamic ? 'D' : typeA === BodyType2D.Kinematic ? 'K' : 'S'}) <-> ${bodyB.label}(${typeB === BodyType2D.Dynamic ? 'D' : typeB === BodyType2D.Kinematic ? 'K' : 'S'}) | depth=${depthFloat.toFixed(3)} correction=${correctionFloat.toFixed(3)} normal=(${normalX.toFixed(2)},${normalY.toFixed(2)})`
        );
    }

    if (aMovable && bMovable) {
        // Both movable: split correction equally
        const halfCorrection = (correctionDepth >> 1) as Fixed;
        bodyA.position.x = (bodyA.position.x - fpMul(normal.x, halfCorrection)) as Fixed;
        bodyA.position.y = (bodyA.position.y - fpMul(normal.y, halfCorrection)) as Fixed;
        bodyB.position.x = (bodyB.position.x + fpMul(normal.x, halfCorrection)) as Fixed;
        bodyB.position.y = (bodyB.position.y + fpMul(normal.y, halfCorrection)) as Fixed;
    } else if (aMovable) {
        // Only A moves
        bodyA.position.x = (bodyA.position.x - fpMul(normal.x, correctionDepth)) as Fixed;
        bodyA.position.y = (bodyA.position.y - fpMul(normal.y, correctionDepth)) as Fixed;
    } else {
        // Only B moves
        bodyB.position.x = (bodyB.position.x + fpMul(normal.x, correctionDepth)) as Fixed;
        bodyB.position.y = (bodyB.position.y + fpMul(normal.y, correctionDepth)) as Fixed;
    }
}

/**
 * Apply velocity impulse for dynamic body collisions.
 */
function applyVelocityImpulse(
    bodyA: RigidBody2D,
    bodyB: RigidBody2D,
    normal: Vec2
): void {
    // Get effective inverse masses (0 for non-dynamic)
    const invMassA = bodyA.type === BodyType2D.Dynamic ? bodyA.invMass : 0 as Fixed;
    const invMassB = bodyB.type === BodyType2D.Dynamic ? bodyB.invMass : 0 as Fixed;
    const totalInvMass = (invMassA + invMassB) as Fixed;

    if (totalInvMass === 0) return;

    // Relative velocity (B relative to A)
    const relVelX = (bodyB.linearVelocity.x - bodyA.linearVelocity.x) as Fixed;
    const relVelY = (bodyB.linearVelocity.y - bodyA.linearVelocity.y) as Fixed;

    // Velocity along collision normal
    const velAlongNormal = (fpMul(relVelX, normal.x) + fpMul(relVelY, normal.y)) as Fixed;

    // Don't resolve if separating
    if (velAlongNormal > 0) return;

    // Coefficient of restitution (bounciness)
    const restitution = fpMin(bodyA.restitution, bodyB.restitution);

    // Impulse magnitude
    const impulseMag = fpDiv(
        fpMul((-(FP_ONE + restitution)) as Fixed, velAlongNormal),
        totalInvMass
    );

    // Apply impulse
    const impulseX = fpMul(normal.x, impulseMag);
    const impulseY = fpMul(normal.y, impulseMag);

    if (bodyA.type === BodyType2D.Dynamic) {
        bodyA.linearVelocity.x = (bodyA.linearVelocity.x - fpMul(impulseX, invMassA)) as Fixed;
        bodyA.linearVelocity.y = (bodyA.linearVelocity.y - fpMul(impulseY, invMassA)) as Fixed;
    }
    if (bodyB.type === BodyType2D.Dynamic) {
        bodyB.linearVelocity.x = (bodyB.linearVelocity.x + fpMul(impulseX, invMassB)) as Fixed;
        bodyB.linearVelocity.y = (bodyB.linearVelocity.y + fpMul(impulseY, invMassB)) as Fixed;
    }

    // Friction impulse
    applyFrictionImpulse(bodyA, bodyB, normal, impulseMag, invMassA, invMassB, totalInvMass);
}

/**
 * Apply friction impulse tangent to collision normal.
 */
function applyFrictionImpulse(
    bodyA: RigidBody2D,
    bodyB: RigidBody2D,
    normal: Vec2,
    normalImpulse: Fixed,
    invMassA: Fixed,
    invMassB: Fixed,
    totalInvMass: Fixed
): void {
    // Recalculate relative velocity after normal impulse
    const relVelX = (bodyB.linearVelocity.x - bodyA.linearVelocity.x) as Fixed;
    const relVelY = (bodyB.linearVelocity.y - bodyA.linearVelocity.y) as Fixed;

    const velAlongNormal = (fpMul(relVelX, normal.x) + fpMul(relVelY, normal.y)) as Fixed;

    // Tangent velocity
    const tangentX = (relVelX - fpMul(normal.x, velAlongNormal)) as Fixed;
    const tangentY = (relVelY - fpMul(normal.y, velAlongNormal)) as Fixed;
    const tangentLenSq = (fpMul(tangentX, tangentX) + fpMul(tangentY, tangentY)) as Fixed;

    if (tangentLenSq === 0) return;

    const tangentLen = fpSqrt(tangentLenSq);
    const invTangentLen = fpDiv(FP_ONE, tangentLen);
    const tangentNormX = fpMul(tangentX, invTangentLen);
    const tangentNormY = fpMul(tangentY, invTangentLen);

    // Friction coefficient
    const friction = fpMul(bodyA.friction, bodyB.friction);

    // Friction impulse magnitude
    const tangentVel = (fpMul(relVelX, tangentNormX) + fpMul(relVelY, tangentNormY)) as Fixed;
    let frictionMag = fpDiv(-tangentVel, totalInvMass);

    // Coulomb friction: clamp to mu * normal force
    const maxFriction = fpMul(friction, fpAbs(normalImpulse));
    if (fpAbs(frictionMag) > maxFriction) {
        frictionMag = frictionMag > 0 ? maxFriction : (-maxFriction) as Fixed;
    }

    // Apply friction
    const frictionX = fpMul(tangentNormX, frictionMag);
    const frictionY = fpMul(tangentNormY, frictionMag);

    if (bodyA.type === BodyType2D.Dynamic) {
        bodyA.linearVelocity.x = (bodyA.linearVelocity.x - fpMul(frictionX, invMassA)) as Fixed;
        bodyA.linearVelocity.y = (bodyA.linearVelocity.y - fpMul(frictionY, invMassA)) as Fixed;
    }
    if (bodyB.type === BodyType2D.Dynamic) {
        bodyB.linearVelocity.x = (bodyB.linearVelocity.x + fpMul(frictionX, invMassB)) as Fixed;
        bodyB.linearVelocity.y = (bodyB.linearVelocity.y + fpMul(frictionY, invMassB)) as Fixed;
    }
}
