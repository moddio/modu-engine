/**
 * Collision Detection and Response
 *
 * Handles narrow-phase collision detection between shapes and
 * impulse-based collision response.
 */
import { FP_ONE, FP_HALF, toFixed, fpMul, fpDiv, fpAbs, fpMin, fpSqrt, fpClamp } from '../../math/fixed';
import { vec3, vec3Sub, vec3Add, vec3Scale, vec3Neg, vec3Dot, vec3Cross, vec3LengthSq, vec3Normalize } from '../../math/vec';
import { quatRotateVec3, quatConjugate } from '../../math/quat';
import { ShapeType } from './shapes';
import { applyImpulse } from './rigid-body';
// ============================================
// Constants
// ============================================
const POSITION_CORRECTION = toFixed(0.6); // Slightly less aggressive correction
const SLOP = toFixed(0.05); // Penetration allowance to reduce jitter
const WAKE_VELOCITY_THRESHOLD = toFixed(1.5); // Threshold for waking sleeping bodies
// ============================================
// AABB Computation
// ============================================
export function computeAABB(body) {
    const pos = body.position;
    const shape = body.shape;
    if (shape.type === ShapeType.Sphere) {
        const r = shape.radius;
        return {
            min: { x: pos.x - r, y: pos.y - r, z: pos.z - r },
            max: { x: pos.x + r, y: pos.y + r, z: pos.z + r }
        };
    }
    else {
        // For rotated boxes, compute world-space AABB by projecting onto each world axis
        const h = shape.halfExtents;
        // Get the box axes in world space
        const axisX = quatRotateVec3(body.rotation, vec3(FP_ONE, 0, 0));
        const axisY = quatRotateVec3(body.rotation, vec3(0, FP_ONE, 0));
        const axisZ = quatRotateVec3(body.rotation, vec3(0, 0, FP_ONE));
        // Compute the extent along each world axis
        const extentX = fpAbs(fpMul(axisX.x, h.x)) + fpAbs(fpMul(axisY.x, h.y)) + fpAbs(fpMul(axisZ.x, h.z));
        const extentY = fpAbs(fpMul(axisX.y, h.x)) + fpAbs(fpMul(axisY.y, h.y)) + fpAbs(fpMul(axisZ.y, h.z));
        const extentZ = fpAbs(fpMul(axisX.z, h.x)) + fpAbs(fpMul(axisY.z, h.y)) + fpAbs(fpMul(axisZ.z, h.z));
        return {
            min: { x: pos.x - extentX, y: pos.y - extentY, z: pos.z - extentZ },
            max: { x: pos.x + extentX, y: pos.y + extentY, z: pos.z + extentZ }
        };
    }
}
// ============================================
// Collision Detection Functions
// ============================================
function sphereSphereCollision(a, b) {
    const shapeA = a.shape;
    const shapeB = b.shape;
    const diff = vec3Sub(a.position, b.position); // Points from B to A
    const distSq = vec3LengthSq(diff);
    const minDist = shapeA.radius + shapeB.radius;
    const minDistSq = fpMul(minDist, minDist);
    if (distSq >= minDistSq)
        return null;
    const dist = fpSqrt(distSq);
    const normal = dist > 0 ? vec3Scale(diff, fpDiv(FP_ONE, dist)) : vec3(FP_ONE, 0, 0);
    const penetration = minDist - dist;
    const point = vec3Sub(a.position, vec3Scale(normal, shapeA.radius));
    return { bodyA: a, bodyB: b, normal, points: [{ point, penetration }] };
}
function sphereBoxCollision(sphere, box) {
    const sphereShape = sphere.shape;
    const boxShape = box.shape;
    // Transform sphere center into box's local space (accounting for rotation)
    const worldDiff = vec3Sub(sphere.position, box.position);
    const invRotation = quatConjugate(box.rotation);
    const localSphere = quatRotateVec3(invRotation, worldDiff);
    const h = boxShape.halfExtents;
    // Find closest point on box to sphere center (in local space)
    const closestLocal = {
        x: fpClamp(localSphere.x, -h.x, h.x),
        y: fpClamp(localSphere.y, -h.y, h.y),
        z: fpClamp(localSphere.z, -h.z, h.z)
    };
    const diffLocal = vec3Sub(localSphere, closestLocal);
    const distSq = vec3LengthSq(diffLocal);
    const radiusSq = fpMul(sphereShape.radius, sphereShape.radius);
    if (distSq >= radiusSq)
        return null;
    const dist = fpSqrt(distSq);
    let normalLocal;
    let penetration;
    if (dist > 0) {
        normalLocal = vec3Scale(diffLocal, fpDiv(FP_ONE, dist));
        penetration = sphereShape.radius - dist;
    }
    else {
        // Sphere center inside box - find shortest axis to push out
        const dx = h.x - fpAbs(localSphere.x);
        const dy = h.y - fpAbs(localSphere.y);
        const dz = h.z - fpAbs(localSphere.z);
        if (dx <= dy && dx <= dz) {
            normalLocal = localSphere.x >= 0 ? vec3(FP_ONE, 0, 0) : vec3(-FP_ONE, 0, 0);
            penetration = dx + sphereShape.radius;
        }
        else if (dy <= dz) {
            normalLocal = localSphere.y >= 0 ? vec3(0, FP_ONE, 0) : vec3(0, -FP_ONE, 0);
            penetration = dy + sphereShape.radius;
        }
        else {
            normalLocal = localSphere.z >= 0 ? vec3(0, 0, FP_ONE) : vec3(0, 0, -FP_ONE);
            penetration = dz + sphereShape.radius;
        }
    }
    // Transform contact point and normal back to world space
    const worldClosest = vec3Add(box.position, quatRotateVec3(box.rotation, closestLocal));
    const worldNormal = quatRotateVec3(box.rotation, normalLocal);
    return { bodyA: sphere, bodyB: box, normal: worldNormal, points: [{ point: worldClosest, penetration }] };
}
function boxBoxCollision(a, b) {
    const shapeA = a.shape;
    const shapeB = b.shape;
    const hA = shapeA.halfExtents;
    const hB = shapeB.halfExtents;
    // Get rotated axes for both boxes
    const axesA = [
        quatRotateVec3(a.rotation, vec3(FP_ONE, 0, 0)),
        quatRotateVec3(a.rotation, vec3(0, FP_ONE, 0)),
        quatRotateVec3(a.rotation, vec3(0, 0, FP_ONE))
    ];
    const axesB = [
        quatRotateVec3(b.rotation, vec3(FP_ONE, 0, 0)),
        quatRotateVec3(b.rotation, vec3(0, FP_ONE, 0)),
        quatRotateVec3(b.rotation, vec3(0, 0, FP_ONE))
    ];
    const extentsA = [hA.x, hA.y, hA.z];
    const extentsB = [hB.x, hB.y, hB.z];
    const d = vec3Sub(b.position, a.position);
    let minPen = 0x7FFFFFFF;
    let bestNormal = vec3(0, FP_ONE, 0);
    // Project extent onto axis
    function project(axes, extents, axis) {
        return fpAbs(fpMul(vec3Dot(axes[0], axis), extents[0])) +
            fpAbs(fpMul(vec3Dot(axes[1], axis), extents[1])) +
            fpAbs(fpMul(vec3Dot(axes[2], axis), extents[2]));
    }
    // Test separation on axis, returns false if separated
    function testAxis(axis) {
        const lenSq = vec3LengthSq(axis);
        if (lenSq < toFixed(0.0001))
            return true; // Skip degenerate
        const len = fpSqrt(lenSq);
        const n = vec3Scale(axis, fpDiv(FP_ONE, len));
        const pA = project(axesA, extentsA, n);
        const pB = project(axesB, extentsB, n);
        const dist = fpAbs(vec3Dot(d, n));
        const pen = (pA + pB) - dist;
        if (pen <= 0)
            return false;
        if (pen < minPen) {
            minPen = pen;
            bestNormal = vec3Dot(d, n) < 0 ? n : vec3Neg(n);
        }
        return true;
    }
    // Test 15 SAT axes
    for (let i = 0; i < 3; i++) {
        if (!testAxis(axesA[i]))
            return null;
        if (!testAxis(axesB[i]))
            return null;
    }
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (!testAxis(vec3Cross(axesA[i], axesB[j])))
                return null;
        }
    }
    // Generate proper contact manifold based on the type of contact
    const contactPoints = [];
    // Determine which body's face is the reference (the one whose normal we're using)
    const volumeA = fpMul(fpMul(hA.x, hA.y), hA.z);
    const volumeB = fpMul(fpMul(hB.x, hB.y), hB.z);
    // Find all vertices of the incident body (smaller one) that are below the reference face
    const incidentBody = volumeB <= volumeA ? b : a;
    const incidentHalf = volumeB <= volumeA ? hB : hA;
    const referenceBody = volumeB <= volumeA ? a : b;
    // For each vertex of the incident body, project onto reference face and check penetration
    const signs = [
        [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
        [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]
    ];
    // Calculate reference face plane normal
    const refFaceNormal = volumeB <= volumeA ? bestNormal : vec3Neg(bestNormal);
    const vertexContacts = [];
    const refAxes = volumeB <= volumeA ? axesA : axesB;
    const refHalf = volumeB <= volumeA ? hA : hB;
    for (const [sx, sy, sz] of signs) {
        const localV = vec3(fpMul(incidentHalf.x, toFixed(sx)), fpMul(incidentHalf.y, toFixed(sy)), fpMul(incidentHalf.z, toFixed(sz)));
        const worldV = vec3Add(incidentBody.position, quatRotateVec3(incidentBody.rotation, localV));
        // Calculate how deep this vertex is along the collision normal direction
        const toVertex = vec3Sub(worldV, referenceBody.position);
        const normalDist = vec3Dot(toVertex, refFaceNormal);
        // Get the reference body's extent along the normal
        const refExtent = fpMul(fpAbs(vec3Dot(refAxes[0], refFaceNormal)), refHalf.x) +
            fpMul(fpAbs(vec3Dot(refAxes[1], refFaceNormal)), refHalf.y) +
            fpMul(fpAbs(vec3Dot(refAxes[2], refFaceNormal)), refHalf.z);
        const depth = normalDist + refExtent;
        if (depth > 0) {
            vertexContacts.push({ point: worldV, depth });
        }
    }
    // Sort by depth and take the deepest vertices (up to 4 for face contact)
    // Use position as tiebreaker for deterministic stable sort
    vertexContacts.sort((a, b) => {
        const depthDiff = b.depth - a.depth;
        if (depthDiff !== 0)
            return depthDiff;
        // Tiebreaker using point position for determinism
        return (a.point.x - b.point.x) || (a.point.y - b.point.y) || (a.point.z - b.point.z);
    });
    // Use vertices with similar depth (within threshold of deepest)
    const DEPTH_THRESHOLD = toFixed(0.05);
    const maxDepth = vertexContacts.length > 0 ? vertexContacts[0].depth : 0;
    for (const vc of vertexContacts) {
        if (vc.depth > maxDepth - DEPTH_THRESHOLD) {
            contactPoints.push({ point: vc.point, penetration: vc.depth });
        }
        if (contactPoints.length >= 4)
            break; // Max 4 contact points
    }
    // Fallback: use the SAT penetration point
    if (contactPoints.length === 0) {
        const midPoint = vec3Scale(vec3Add(a.position, b.position), FP_HALF);
        contactPoints.push({ point: midPoint, penetration: minPen });
    }
    return { bodyA: a, bodyB: b, normal: bestNormal, points: contactPoints };
}
export function detectCollision(a, b) {
    const typeA = a.shape.type;
    const typeB = b.shape.type;
    if (typeA === ShapeType.Sphere && typeB === ShapeType.Sphere) {
        return sphereSphereCollision(a, b);
    }
    else if (typeA === ShapeType.Sphere && typeB === ShapeType.Box) {
        return sphereBoxCollision(a, b);
    }
    else if (typeA === ShapeType.Box && typeB === ShapeType.Sphere) {
        const contact = sphereBoxCollision(b, a);
        if (contact) {
            // Swap bodies and flip normal
            return {
                bodyA: a,
                bodyB: b,
                normal: vec3Neg(contact.normal),
                points: contact.points
            };
        }
        return null;
    }
    else {
        return boxBoxCollision(a, b);
    }
}
// ============================================
// Collision Response
// ============================================
export function resolveCollision(contact) {
    const { bodyA, bodyB, normal, points } = contact;
    // Skip if both are static/kinematic or no contact points
    if (bodyA.invMass === 0 && bodyB.invMass === 0)
        return;
    if (points.length === 0)
        return;
    // Calculate relative velocity along collision normal to determine wake conditions
    const relVelForWake = vec3Sub(bodyA.linearVelocity, bodyB.linearVelocity);
    const impactVelocity = fpAbs(vec3Dot(relVelForWake, normal));
    // Check if this is a resting contact (bodies gently settling, not impacting)
    const isRestingContact = impactVelocity < WAKE_VELOCITY_THRESHOLD;
    // If one body is sleeping and this is a resting contact, keep it sleeping
    // Apply position correction only without waking
    if (isRestingContact && (bodyA.isSleeping || bodyB.isSleeping)) {
        for (const cp of points) {
            const penetration = cp.penetration;
            if (penetration > SLOP) {
                const pureInvMassSum = bodyA.invMass + bodyB.invMass;
                if (pureInvMassSum > 0) {
                    const correction = fpMul(fpDiv(penetration - SLOP, pureInvMassSum), POSITION_CORRECTION);
                    const correctionVec = vec3Scale(normal, correction);
                    // Only move non-sleeping bodies
                    if (bodyA.invMass > 0 && !bodyA.isSleeping) {
                        bodyA.position = vec3Add(bodyA.position, vec3Scale(correctionVec, bodyA.invMass));
                    }
                    if (bodyB.invMass > 0 && !bodyB.isSleeping) {
                        bodyB.position = vec3Sub(bodyB.position, vec3Scale(correctionVec, bodyB.invMass));
                    }
                }
            }
        }
        return;
    }
    const numContacts = points.length;
    const invNumContacts = fpDiv(FP_ONE, toFixed(numContacts));
    // Restitution (use minimum)
    const e = fpMin(bodyA.restitution, bodyB.restitution);
    const frictionCoeff = fpDiv(bodyA.friction + bodyB.friction, toFixed(2));
    // Process each contact point
    for (const cp of points) {
        const point = cp.point;
        const penetration = cp.penetration;
        // Calculate radius vectors from center of mass to contact point
        const rA = vec3Sub(point, bodyA.position);
        const rB = vec3Sub(point, bodyB.position);
        // Calculate velocity at contact point (including rotation)
        const velA = vec3Add(bodyA.linearVelocity, vec3Cross(bodyA.angularVelocity, rA));
        const velB = vec3Add(bodyB.linearVelocity, vec3Cross(bodyB.angularVelocity, rB));
        const relVel = vec3Sub(velA, velB);
        const velAlongNormal = vec3Dot(relVel, normal);
        // Only resolve if approaching
        if (velAlongNormal < 0) {
            // Calculate impulse magnitude
            const rACrossN = vec3Cross(rA, normal);
            const rBCrossN = vec3Cross(rB, normal);
            const angularInertiaA = (bodyA.lockRotationX && bodyA.lockRotationY && bodyA.lockRotationZ)
                ? 0 : fpMul(vec3Dot(rACrossN, rACrossN), bodyA.invInertia);
            const angularInertiaB = (bodyB.lockRotationX && bodyB.lockRotationY && bodyB.lockRotationZ)
                ? 0 : fpMul(vec3Dot(rBCrossN, rBCrossN), bodyB.invInertia);
            const invMassSum = bodyA.invMass + bodyB.invMass + angularInertiaA + angularInertiaB;
            let j = fpMul(-(FP_ONE + e), velAlongNormal);
            j = fpDiv(j, invMassSum);
            j = fpMul(j, invNumContacts); // Distribute across contacts
            const impulse = vec3Scale(normal, j);
            if (bodyA.invMass > 0) {
                applyImpulse(bodyA, impulse, point);
            }
            if (bodyB.invMass > 0) {
                applyImpulse(bodyB, vec3Neg(impulse), point);
            }
            // Friction
            const tangent = vec3Sub(relVel, vec3Scale(normal, velAlongNormal));
            const tangentLenSq = vec3LengthSq(tangent);
            if (tangentLenSq > toFixed(0.0001)) {
                const tangentNorm = vec3Normalize(tangent);
                const rACrossT = vec3Cross(rA, tangentNorm);
                const rBCrossT = vec3Cross(rB, tangentNorm);
                const angularInertiaTA = (bodyA.lockRotationX && bodyA.lockRotationY && bodyA.lockRotationZ)
                    ? 0 : fpMul(vec3Dot(rACrossT, rACrossT), bodyA.invInertia);
                const angularInertiaTB = (bodyB.lockRotationX && bodyB.lockRotationY && bodyB.lockRotationZ)
                    ? 0 : fpMul(vec3Dot(rBCrossT, rBCrossT), bodyB.invInertia);
                const invMassSumT = bodyA.invMass + bodyB.invMass + angularInertiaTA + angularInertiaTB;
                const tangentSpeed = fpSqrt(tangentLenSq);
                let jt = fpDiv(tangentSpeed, invMassSumT);
                jt = fpMul(jt, invNumContacts); // Distribute
                const maxFriction = fpMul(fpAbs(j), frictionCoeff);
                if (jt > maxFriction)
                    jt = maxFriction;
                const frictionImpulse = vec3Scale(tangentNorm, -jt);
                if (bodyA.invMass > 0) {
                    applyImpulse(bodyA, frictionImpulse, point);
                }
                if (bodyB.invMass > 0) {
                    applyImpulse(bodyB, vec3Neg(frictionImpulse), point);
                }
            }
        }
        // Position correction for this contact
        if (penetration > SLOP) {
            const pureInvMassSum = bodyA.invMass + bodyB.invMass;
            const correction = fpMul(fpDiv(penetration - SLOP, pureInvMassSum), POSITION_CORRECTION);
            const scaledCorrection = fpMul(correction, invNumContacts); // Distribute
            const correctionVec = vec3Scale(normal, scaledCorrection);
            if (bodyA.invMass > 0) {
                bodyA.position = vec3Add(bodyA.position, vec3Scale(correctionVec, bodyA.invMass));
            }
            if (bodyB.invMass > 0) {
                bodyB.position = vec3Sub(bodyB.position, vec3Scale(correctionVec, bodyB.invMass));
            }
        }
    }
}
