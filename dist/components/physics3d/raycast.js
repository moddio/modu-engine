/**
 * Raycasting
 *
 * Ray-body intersection tests for visibility checks,
 * hit detection, and other line-of-sight queries.
 */
import { FP_ONE, toFixed, fpMul, fpDiv, fpSqrt } from '../../math/fixed';
import { vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Normalize } from '../../math/vec';
import { ShapeType } from './shapes';
// ============================================
// Raycast Functions
// ============================================
export function raycast(world, origin, direction, maxDistance) {
    const dir = vec3Normalize(direction);
    let closestHit = null;
    let closestDist = maxDistance;
    for (const body of world.bodies) {
        const hit = raycastBody(body, origin, dir, closestDist);
        if (hit && hit.distance < closestDist) {
            closestDist = hit.distance;
            closestHit = hit;
        }
    }
    return closestHit;
}
function raycastBody(body, origin, dir, maxDist) {
    if (body.shape.type === ShapeType.Sphere) {
        return raycastSphere(body, origin, dir, maxDist);
    }
    else {
        return raycastBox(body, origin, dir, maxDist);
    }
}
function raycastSphere(body, origin, dir, maxDist) {
    const shape = body.shape;
    const oc = vec3Sub(origin, body.position);
    const a = vec3Dot(dir, dir);
    const b = fpMul(toFixed(2), vec3Dot(oc, dir));
    const c = vec3Dot(oc, oc) - fpMul(shape.radius, shape.radius);
    const discriminant = fpMul(b, b) - fpMul(fpMul(toFixed(4), a), c);
    if (discriminant < 0)
        return null;
    const sqrtD = fpSqrt(discriminant);
    let t = fpDiv(-b - sqrtD, fpMul(toFixed(2), a));
    if (t < 0) {
        t = fpDiv(-b + sqrtD, fpMul(toFixed(2), a));
        if (t < 0)
            return null;
    }
    if (t > maxDist)
        return null;
    const point = vec3Add(origin, vec3Scale(dir, t));
    const normal = vec3Normalize(vec3Sub(point, body.position));
    return { body, point, normal, distance: t };
}
function raycastBox(body, origin, dir, maxDist) {
    const shape = body.shape;
    const h = shape.halfExtents;
    const pos = body.position;
    // AABB ray intersection
    let tMin = -0x7FFFFFFF;
    let tMax = 0x7FFFFFFF;
    let normalAxis = 0;
    let normalSign = 1;
    // X axis
    {
        const invD = dir.x !== 0 ? fpDiv(FP_ONE, dir.x) : 0x7FFFFFFF;
        let t0 = fpMul((pos.x - h.x) - origin.x, invD);
        let t1 = fpMul((pos.x + h.x) - origin.x, invD);
        if (invD < 0)
            [t0, t1] = [t1, t0];
        if (t0 > tMin) {
            tMin = t0;
            normalAxis = 0;
            normalSign = invD < 0 ? 1 : -1;
        }
        if (t1 < tMax)
            tMax = t1;
        if (tMax < tMin)
            return null;
    }
    // Y axis
    {
        const invD = dir.y !== 0 ? fpDiv(FP_ONE, dir.y) : 0x7FFFFFFF;
        let t0 = fpMul((pos.y - h.y) - origin.y, invD);
        let t1 = fpMul((pos.y + h.y) - origin.y, invD);
        if (invD < 0)
            [t0, t1] = [t1, t0];
        if (t0 > tMin) {
            tMin = t0;
            normalAxis = 1;
            normalSign = invD < 0 ? 1 : -1;
        }
        if (t1 < tMax)
            tMax = t1;
        if (tMax < tMin)
            return null;
    }
    // Z axis
    {
        const invD = dir.z !== 0 ? fpDiv(FP_ONE, dir.z) : 0x7FFFFFFF;
        let t0 = fpMul((pos.z - h.z) - origin.z, invD);
        let t1 = fpMul((pos.z + h.z) - origin.z, invD);
        if (invD < 0)
            [t0, t1] = [t1, t0];
        if (t0 > tMin) {
            tMin = t0;
            normalAxis = 2;
            normalSign = invD < 0 ? 1 : -1;
        }
        if (t1 < tMax)
            tMax = t1;
        if (tMax < tMin)
            return null;
    }
    if (tMin < 0 || tMin > maxDist)
        return null;
    const point = vec3Add(origin, vec3Scale(dir, tMin));
    const normal = vec3(normalAxis === 0 ? toFixed(normalSign) : 0, normalAxis === 1 ? toFixed(normalSign) : 0, normalAxis === 2 ? toFixed(normalSign) : 0);
    return { body, point, normal, distance: tMin };
}
