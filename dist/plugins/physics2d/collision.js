/**
 * 2D Collision Detection and Response
 *
 * Uses Box2D-style collision detection:
 * - SAT (Separating Axis Theorem) for box-box
 * - Closest point on box for circle-box
 * - Direct distance for circle-circle
 */
import { FP_ONE, toFixed, fpMul, fpDiv, fpAbs, fpSqrt, fpMin, fpMax, fpSin, fpCos } from '../../math/fixed';
import { Shape2DType } from './shapes';
import { BodyType2D } from './rigid-body';
// ============================================
// AABB Computation
// ============================================
export function computeAABB2D(body) {
    const { position, shape, angle } = body;
    if (shape.type === Shape2DType.Circle) {
        const radius = shape.radius;
        return {
            minX: (position.x - radius),
            minY: (position.y - radius),
            maxX: (position.x + radius),
            maxY: (position.y + radius),
        };
    }
    else {
        const box = shape;
        const halfWidth = box.halfWidth;
        const halfHeight = box.halfHeight;
        if (angle === 0) {
            return {
                minX: (position.x - halfWidth),
                minY: (position.y - halfHeight),
                maxX: (position.x + halfWidth),
                maxY: (position.y + halfHeight),
            };
        }
        // Rotated box - compute bounding box
        const cosAngle = fpCos(angle);
        const sinAngle = fpSin(angle);
        const absCos = fpAbs(cosAngle);
        const absSin = fpAbs(sinAngle);
        const extentX = (fpMul(halfWidth, absCos) + fpMul(halfHeight, absSin));
        const extentY = (fpMul(halfWidth, absSin) + fpMul(halfHeight, absCos));
        return {
            minX: (position.x - extentX),
            minY: (position.y - extentY),
            maxX: (position.x + extentX),
            maxY: (position.y + extentY),
        };
    }
}
// ============================================
// Collision Detection
// ============================================
export function detectCollision2D(bodyA, bodyB) {
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
                normal: { x: (-contact.normal.x), y: (-contact.normal.y) },
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
function detectCircleCircle(circleA, circleB) {
    const radiusA = circleA.shape.radius;
    const radiusB = circleB.shape.radius;
    const sumRadius = (radiusA + radiusB);
    // Vector from A to B
    const deltaX = (circleB.position.x - circleA.position.x);
    const deltaY = (circleB.position.y - circleA.position.y);
    const distanceSq = (fpMul(deltaX, deltaX) + fpMul(deltaY, deltaY));
    const minDistSq = fpMul(sumRadius, sumRadius);
    if (distanceSq >= minDistSq)
        return null;
    const distance = fpSqrt(distanceSq);
    const penetration = (sumRadius - distance);
    // Normal points from A to B
    let normalX, normalY;
    if (distance > 0) {
        const invDist = fpDiv(FP_ONE, distance);
        normalX = fpMul(deltaX, invDist);
        normalY = fpMul(deltaY, invDist);
    }
    else {
        // Circles at same position - arbitrary normal
        normalX = FP_ONE;
        normalY = 0;
    }
    // Contact point on surface of A
    const contactX = (circleA.position.x + fpMul(normalX, radiusA));
    const contactY = (circleA.position.y + fpMul(normalY, radiusA));
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
function detectBoxBox(boxA, boxB) {
    const shapeA = boxA.shape;
    const shapeB = boxB.shape;
    // Vector from A to B
    const deltaX = (boxB.position.x - boxA.position.x);
    const deltaY = (boxB.position.y - boxA.position.y);
    // Overlap on each axis
    const overlapX = ((shapeA.halfWidth + shapeB.halfWidth) - fpAbs(deltaX));
    const overlapY = ((shapeA.halfHeight + shapeB.halfHeight) - fpAbs(deltaY));
    if (overlapX <= 0 || overlapY <= 0)
        return null;
    // Use axis with minimum overlap (SAT)
    let normalX, normalY;
    let penetration;
    if (overlapX < overlapY) {
        penetration = overlapX;
        normalX = deltaX > 0 ? FP_ONE : (-FP_ONE);
        normalY = 0;
    }
    else {
        penetration = overlapY;
        normalX = 0;
        normalY = deltaY > 0 ? FP_ONE : (-FP_ONE);
    }
    // Contact point at midpoint
    const contactX = ((boxA.position.x + boxB.position.x) >> 1);
    const contactY = ((boxA.position.y + boxB.position.y) >> 1);
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
function detectCircleBox(circle, box) {
    const radius = circle.shape.radius;
    const boxShape = box.shape;
    // Circle center in box's local space (box at origin)
    const localX = (circle.position.x - box.position.x);
    const localY = (circle.position.y - box.position.y);
    // Clamp to box bounds to find closest point
    const clampedX = fpMax((-boxShape.halfWidth), fpMin(boxShape.halfWidth, localX));
    const clampedY = fpMax((-boxShape.halfHeight), fpMin(boxShape.halfHeight, localY));
    // Check if circle center is inside box
    const centerInside = fpAbs(localX) < boxShape.halfWidth && fpAbs(localY) < boxShape.halfHeight;
    let normalX, normalY;
    let penetration;
    if (centerInside) {
        // Circle center is inside box - find closest face
        const distToRight = (boxShape.halfWidth - localX);
        const distToLeft = (boxShape.halfWidth + localX);
        const distToTop = (boxShape.halfHeight - localY);
        const distToBottom = (boxShape.halfHeight + localY);
        // Find minimum distance to any face
        let minDist = distToRight;
        normalX = FP_ONE;
        normalY = 0;
        if (distToLeft < minDist) {
            minDist = distToLeft;
            normalX = (-FP_ONE);
            normalY = 0;
        }
        if (distToTop < minDist) {
            minDist = distToTop;
            normalX = 0;
            normalY = FP_ONE;
        }
        if (distToBottom < minDist) {
            minDist = distToBottom;
            normalX = 0;
            normalY = (-FP_ONE);
        }
        // Penetration is distance to face plus radius
        penetration = (minDist + radius);
    }
    else {
        // Circle center is outside box - normal case
        const diffX = (localX - clampedX);
        const diffY = (localY - clampedY);
        const distanceSq = (fpMul(diffX, diffX) + fpMul(diffY, diffY));
        // No collision if distance > radius
        if (distanceSq >= fpMul(radius, radius))
            return null;
        const distance = fpSqrt(distanceSq);
        penetration = (radius - distance);
        if (distance > 0) {
            const invDist = fpDiv(FP_ONE, distance);
            // Normal points from circle toward box (from A to B)
            // diffX/diffY points from box surface toward circle, so negate
            normalX = fpMul((-diffX), invDist);
            normalY = fpMul((-diffY), invDist);
        }
        else {
            // Edge case: circle exactly on box corner
            normalX = FP_ONE;
            normalY = 0;
        }
    }
    // Contact point on circle surface (toward box)
    const contactX = (circle.position.x + fpMul(normalX, radius));
    const contactY = (circle.position.y + fpMul(normalY, radius));
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
export function resolveCollision2D(contact) {
    const { bodyA, bodyB, normal, depth } = contact;
    // Skip triggers
    if (bodyA.isSensor || bodyB.isSensor)
        return;
    const typeA = bodyA.type;
    const typeB = bodyB.type;
    // Static-Static: nothing to do
    if (typeA === BodyType2D.Static && typeB === BodyType2D.Static)
        return;
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
function applyPositionCorrection(bodyA, bodyB, normal, depth) {
    const typeA = bodyA.type;
    const typeB = bodyB.type;
    // Determine how to distribute the correction
    const aMovable = typeA !== BodyType2D.Static;
    const bMovable = typeB !== BodyType2D.Static;
    if (!aMovable && !bMovable)
        return;
    // Tiny slop to prevent jitter (0.01 units)
    const slop = toFixed(0.01);
    const correctionDepth = fpMax(0, (depth - slop));
    if (correctionDepth <= 0)
        return;
    if (aMovable && bMovable) {
        // Both movable: split correction equally
        const halfCorrection = (correctionDepth >> 1);
        bodyA.position.x = (bodyA.position.x - fpMul(normal.x, halfCorrection));
        bodyA.position.y = (bodyA.position.y - fpMul(normal.y, halfCorrection));
        bodyB.position.x = (bodyB.position.x + fpMul(normal.x, halfCorrection));
        bodyB.position.y = (bodyB.position.y + fpMul(normal.y, halfCorrection));
    }
    else if (aMovable) {
        // Only A moves
        bodyA.position.x = (bodyA.position.x - fpMul(normal.x, correctionDepth));
        bodyA.position.y = (bodyA.position.y - fpMul(normal.y, correctionDepth));
    }
    else {
        // Only B moves
        bodyB.position.x = (bodyB.position.x + fpMul(normal.x, correctionDepth));
        bodyB.position.y = (bodyB.position.y + fpMul(normal.y, correctionDepth));
    }
}
/**
 * Apply velocity impulse for dynamic body collisions.
 */
function applyVelocityImpulse(bodyA, bodyB, normal) {
    // Get effective inverse masses (0 for non-dynamic)
    const invMassA = bodyA.type === BodyType2D.Dynamic ? bodyA.invMass : 0;
    const invMassB = bodyB.type === BodyType2D.Dynamic ? bodyB.invMass : 0;
    const totalInvMass = (invMassA + invMassB);
    if (totalInvMass === 0)
        return;
    // Relative velocity (B relative to A)
    const relVelX = (bodyB.linearVelocity.x - bodyA.linearVelocity.x);
    const relVelY = (bodyB.linearVelocity.y - bodyA.linearVelocity.y);
    // Velocity along collision normal
    const velAlongNormal = (fpMul(relVelX, normal.x) + fpMul(relVelY, normal.y));
    // Don't resolve if separating
    if (velAlongNormal > 0)
        return;
    // Coefficient of restitution (bounciness)
    const restitution = fpMin(bodyA.restitution, bodyB.restitution);
    // Impulse magnitude
    const impulseMag = fpDiv(fpMul((-(FP_ONE + restitution)), velAlongNormal), totalInvMass);
    // Apply impulse
    const impulseX = fpMul(normal.x, impulseMag);
    const impulseY = fpMul(normal.y, impulseMag);
    if (bodyA.type === BodyType2D.Dynamic) {
        bodyA.linearVelocity.x = (bodyA.linearVelocity.x - fpMul(impulseX, invMassA));
        bodyA.linearVelocity.y = (bodyA.linearVelocity.y - fpMul(impulseY, invMassA));
    }
    if (bodyB.type === BodyType2D.Dynamic) {
        bodyB.linearVelocity.x = (bodyB.linearVelocity.x + fpMul(impulseX, invMassB));
        bodyB.linearVelocity.y = (bodyB.linearVelocity.y + fpMul(impulseY, invMassB));
    }
    // Friction impulse
    applyFrictionImpulse(bodyA, bodyB, normal, impulseMag, invMassA, invMassB, totalInvMass);
}
/**
 * Apply friction impulse tangent to collision normal.
 */
function applyFrictionImpulse(bodyA, bodyB, normal, normalImpulse, invMassA, invMassB, totalInvMass) {
    // Recalculate relative velocity after normal impulse
    const relVelX = (bodyB.linearVelocity.x - bodyA.linearVelocity.x);
    const relVelY = (bodyB.linearVelocity.y - bodyA.linearVelocity.y);
    const velAlongNormal = (fpMul(relVelX, normal.x) + fpMul(relVelY, normal.y));
    // Tangent velocity
    const tangentX = (relVelX - fpMul(normal.x, velAlongNormal));
    const tangentY = (relVelY - fpMul(normal.y, velAlongNormal));
    const tangentLenSq = (fpMul(tangentX, tangentX) + fpMul(tangentY, tangentY));
    if (tangentLenSq === 0)
        return;
    const tangentLen = fpSqrt(tangentLenSq);
    const invTangentLen = fpDiv(FP_ONE, tangentLen);
    const tangentNormX = fpMul(tangentX, invTangentLen);
    const tangentNormY = fpMul(tangentY, invTangentLen);
    // Friction coefficient
    const friction = fpMul(bodyA.friction, bodyB.friction);
    // Friction impulse magnitude
    const tangentVel = (fpMul(relVelX, tangentNormX) + fpMul(relVelY, tangentNormY));
    let frictionMag = fpDiv(-tangentVel, totalInvMass);
    // Coulomb friction: clamp to mu * normal force
    const maxFriction = fpMul(friction, fpAbs(normalImpulse));
    if (fpAbs(frictionMag) > maxFriction) {
        frictionMag = frictionMag > 0 ? maxFriction : (-maxFriction);
    }
    // Apply friction
    const frictionX = fpMul(tangentNormX, frictionMag);
    const frictionY = fpMul(tangentNormY, frictionMag);
    if (bodyA.type === BodyType2D.Dynamic) {
        bodyA.linearVelocity.x = (bodyA.linearVelocity.x - fpMul(frictionX, invMassA));
        bodyA.linearVelocity.y = (bodyA.linearVelocity.y - fpMul(frictionY, invMassA));
    }
    if (bodyB.type === BodyType2D.Dynamic) {
        bodyB.linearVelocity.x = (bodyB.linearVelocity.x + fpMul(frictionX, invMassB));
        bodyB.linearVelocity.y = (bodyB.linearVelocity.y + fpMul(frictionY, invMassB));
    }
}
