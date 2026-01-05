/**
 * 2D Collision Detection and Response
 *
 * Uses Box2D-style collision detection:
 * - SAT (Separating Axis Theorem) for box-box
 * - Closest point on box for circle-box
 * - Direct distance for circle-circle
 */

import { Fixed, FP_ONE, FP_HALF, toFixed, fpMul, fpDiv, fpAbs, fpSqrt, fpMin, fpMax, fpSin, fpCos } from '../../math/fixed';
import { Shape2DType, Shape2D, CircleShape, BoxShape2D, AABB2D } from './shapes';
import { RigidBody2D, Vec2, vec2, vec2Zero, vec2Sub, vec2Add, vec2Scale, vec2Dot, vec2LengthSq, BodyType2D } from './rigid-body';

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

export function detectCollision2D(bodyA: RigidBody2D, bodyB: RigidBody2D): Contact2D | null {
    const shapeA = bodyA.shape;
    const shapeB = bodyB.shape;

    // Circle-Circle
    if (shapeA.type === Shape2DType.Circle && shapeB.type === Shape2DType.Circle) {
        return detectCircleCircle(bodyA, bodyB);
    }

    // Box-Box
    if (shapeA.type === Shape2DType.Box && shapeB.type === Shape2DType.Box) {
        return detectBoxBox(bodyA, bodyB);
    }

    // Circle-Box (ensure circle is always first for consistent normal direction)
    if (shapeA.type === Shape2DType.Circle && shapeB.type === Shape2DType.Box) {
        return detectCircleBox(bodyA, bodyB);
    }
    if (shapeA.type === Shape2DType.Box && shapeB.type === Shape2DType.Circle) {
        const contact = detectCircleBox(bodyB, bodyA);
        if (contact) {
            // Swap bodies and flip normal to maintain A->B convention
            return {
                bodyA: bodyA,
                bodyB: bodyB,
                point: contact.point,
                normal: { x: (-contact.normal.x) as Fixed, y: (-contact.normal.y) as Fixed },
                depth: contact.depth
            };
        }
        return null;
    }

    return null;
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
 * Box vs Box collision detection (AABB - assumes no rotation)
 */
function detectBoxBox(boxA: RigidBody2D, boxB: RigidBody2D): Contact2D | null {
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

    if (overlapX < overlapY) {
        penetration = overlapX;
        normalX = deltaX > 0 ? FP_ONE : (-FP_ONE) as Fixed;
        normalY = 0 as Fixed;
    } else {
        penetration = overlapY;
        normalX = 0 as Fixed;
        normalY = deltaY > 0 ? FP_ONE : (-FP_ONE) as Fixed;
    }

    // Contact point at midpoint
    const contactX = ((boxA.position.x + boxB.position.x) >> 1) as Fixed;
    const contactY = ((boxA.position.y + boxB.position.y) >> 1) as Fixed;

    return {
        bodyA: boxA,
        bodyB: boxB,
        point: { x: contactX, y: contactY },
        normal: { x: normalX, y: normalY },
        depth: penetration
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
// Collision Response
// ============================================

/**
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
