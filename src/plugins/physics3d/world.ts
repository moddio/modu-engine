/**
 * Physics World
 *
 * Manages the physics simulation including gravity, collision detection,
 * and integration of velocities and positions.
 */

import { Fixed, FP_ONE, FP_HALF, toFixed, fpMul, fpDiv, fpAbs, fpSqrt } from '../../math/fixed';
import { Vec3, vec3, vec3Zero, vec3Clone, vec3Add, vec3Scale, vec3LengthSq } from '../../math/vec';
import { quatFromAxisAngle, quatMul, quatNormalize } from '../../math/quat';
import { aabbOverlap } from './shapes';
import { RigidBody, BodyType } from './rigid-body';
import { Contact, computeAABB, detectCollision, resolveCollision } from './collision';
import { shouldCollide } from './layers';
import { TriggerState, TriggerEvent } from './trigger';

// ============================================
// Constants
// ============================================

const GRAVITY: Vec3 = { x: 0, y: toFixed(-30), z: 0 };  // -30 units/s²
const LINEAR_DAMPING = toFixed(0.1);      // 10% velocity loss per frame
const ANGULAR_DAMPING = toFixed(0.1);     // 10% angular velocity loss per frame
const SLEEP_THRESHOLD = toFixed(0.12);    // Sleep when nearly stopped
const SLEEP_FRAMES_REQUIRED = 20;         // ~0.33 seconds at 60fps before sleeping
const CONTACT_SLEEP_BONUS = 10;           // Extra sleep frames when in stable contact
const COLLISION_ITERATIONS = 8;           // Multiple iterations for stability

// ============================================
// World Interface
// ============================================

export interface World {
    bodies: RigidBody[];
    gravity: Vec3;
    dt: Fixed;  // Fixed timestep
    triggers: TriggerState;  // Trigger/sensor event tracking
    /** Step the physics simulation */
    step(): Contact[];
}

export function createWorld(dt: number = 1 / 60): World {
    const world: World = {
        bodies: [],
        gravity: vec3Clone(GRAVITY),
        dt: toFixed(dt),
        triggers: new TriggerState(),
        step() {
            return stepWorld(world);
        }
    };
    return world;
}

export function addBody(world: World, body: RigidBody): void {
    world.bodies.push(body);
}

export function removeBody(world: World, body: RigidBody): void {
    const index = world.bodies.indexOf(body);
    if (index >= 0) {
        world.bodies.splice(index, 1);
        // Clean up trigger overlaps involving this body
        world.triggers.removeBody(body);
    }
}

// ============================================
// Ground Check
// ============================================

/**
 * Check if a body is grounded (has a surface below it within threshold)
 * @param world The physics world
 * @param body The body to check
 * @param threshold Distance below to check (default 0.15)
 * @returns true if grounded
 */
export function isGrounded(world: World, body: RigidBody, threshold: number = 0.15): boolean {
    const thresholdFP = toFixed(threshold);

    for (const other of world.bodies) {
        if (other === body) continue;

        // Check if there's collision contact with normal pointing up
        const contact = detectCollision(body, other);
        if (contact && contact.normal.y > FP_HALF) {
            // Normal pointing up means surface is below
            return true;
        }

        // Also check slightly below current position
        const savedY = body.position.y;
        body.position.y = body.position.y - thresholdFP;
        const contactBelow = detectCollision(body, other);
        body.position.y = savedY;

        if (contactBelow && contactBelow.normal.y > FP_HALF) {
            return true;
        }
    }

    return false;
}

// ============================================
// World Step
// ============================================

export function stepWorld(world: World): Contact[] {
    const { gravity, dt, triggers } = world;
    const contacts: Contact[] = [];
    const triggerOverlaps: TriggerEvent[] = [];

    // CRITICAL: Sort bodies by label for deterministic collision processing order
    const bodies = [...world.bodies].sort((a, b) => a.label.localeCompare(b.label));

    // Track which bodies are in stable resting contact (for island sleeping)
    const restingContactBodies = new Set<RigidBody>();
    const sleepingContactBodies = new Set<RigidBody>();

    // First pass: identify resting contacts and sleeping contact pairs
    for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i];
            const b = bodies[j];

            if (a.invMass === 0 && b.invMass === 0) continue;
            if (!shouldCollide(a.filter, b.filter)) continue;

            const aabbA = computeAABB(a);
            const aabbB = computeAABB(b);
            if (!aabbOverlap(aabbA, aabbB)) continue;

            const contact = detectCollision(a, b);
            if (contact) {
                if (fpAbs(contact.normal.y) > FP_HALF) {
                    restingContactBodies.add(a);
                    restingContactBodies.add(b);

                    if (a.isSleeping && b.type === BodyType.Dynamic) {
                        const bSpeedSq = vec3LengthSq(b.linearVelocity) + vec3LengthSq(b.angularVelocity);
                        if (bSpeedSq < fpMul(SLEEP_THRESHOLD, SLEEP_THRESHOLD)) {
                            sleepingContactBodies.add(b);
                        }
                    }
                    if (b.isSleeping && a.type === BodyType.Dynamic) {
                        const aSpeedSq = vec3LengthSq(a.linearVelocity) + vec3LengthSq(a.angularVelocity);
                        if (aSpeedSq < fpMul(SLEEP_THRESHOLD, SLEEP_THRESHOLD)) {
                            sleepingContactBodies.add(a);
                        }
                    }
                }
            }
        }
    }

    // Integrate velocities (apply gravity)
    for (const body of bodies) {
        if (body.type !== BodyType.Dynamic) continue;
        if (body.isSleeping) continue;

        body.linearVelocity = vec3Add(body.linearVelocity, vec3Scale(gravity, dt));

        let linearDamp = FP_ONE - LINEAR_DAMPING;
        let angularDamp = FP_ONE - ANGULAR_DAMPING;

        if (restingContactBodies.has(body)) {
            linearDamp = fpMul(linearDamp, toFixed(0.95));
            angularDamp = fpMul(angularDamp, toFixed(0.9));
        }

        body.linearVelocity = vec3Scale(body.linearVelocity, linearDamp);
        body.angularVelocity = vec3Scale(body.angularVelocity, angularDamp);
    }

    // Multiple collision iterations for stability
    for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                const a = bodies[i];
                const b = bodies[j];

                if (a.invMass === 0 && b.invMass === 0) continue;
                if (!shouldCollide(a.filter, b.filter)) continue;

                const aabbA = computeAABB(a);
                const aabbB = computeAABB(b);
                if (!aabbOverlap(aabbA, aabbB)) continue;

                const contact = detectCollision(a, b);
                if (contact) {
                    // Check if either body is a trigger
                    const isTriggerCollision = a.isTrigger || b.isTrigger;

                    if (isTriggerCollision) {
                        // Record trigger overlap (only on first iteration)
                        if (iter === 0) {
                            // Determine which is the trigger
                            if (a.isTrigger) {
                                triggerOverlaps.push({ trigger: a, other: b });
                            }
                            if (b.isTrigger) {
                                triggerOverlaps.push({ trigger: b, other: a });
                            }
                        }
                        // Skip physics response for triggers
                    } else {
                        // Normal collision - apply physics response
                        if (iter === 0) contacts.push(contact);
                        resolveCollision(contact);
                    }
                }
            }
        }
    }

    // Process trigger events after collision detection
    triggers.processOverlaps(triggerOverlaps);

    // Integrate positions
    for (const body of bodies) {
        if (body.type === BodyType.Static) continue;
        if (body.isSleeping) continue;

        // Clamp tiny linear velocities to zero
        const linearClampThreshold = toFixed(0.05);
        if (fpAbs(body.linearVelocity.x) < linearClampThreshold) body.linearVelocity.x = 0;
        if (fpAbs(body.linearVelocity.y) < linearClampThreshold) body.linearVelocity.y = 0;
        if (fpAbs(body.linearVelocity.z) < linearClampThreshold) body.linearVelocity.z = 0;

        body.position = vec3Add(body.position, vec3Scale(body.linearVelocity, dt));

        // Skip rotation integration if all rotations are locked
        if (body.lockRotationX && body.lockRotationY && body.lockRotationZ) {
            continue;
        }

        // Apply rotation locks
        let angVelX = body.lockRotationX ? 0 : body.angularVelocity.x;
        let angVelY = body.lockRotationY ? 0 : body.angularVelocity.y;
        let angVelZ = body.lockRotationZ ? 0 : body.angularVelocity.z;

        // Clamp tiny angular velocities to zero
        const angularClampThreshold = toFixed(0.01);
        if (fpAbs(angVelX) < angularClampThreshold) angVelX = 0;
        if (fpAbs(angVelY) < angularClampThreshold) angVelY = 0;
        if (fpAbs(angVelZ) < angularClampThreshold) angVelZ = 0;

        body.angularVelocity.x = angVelX;
        body.angularVelocity.y = angVelY;
        body.angularVelocity.z = angVelZ;

        const angVelLengthSq = fpMul(angVelX, angVelX) + fpMul(angVelY, angVelY) + fpMul(angVelZ, angVelZ);

        if (angVelLengthSq > 0) {
            const angSpeed = fpSqrt(angVelLengthSq);
            const angle = fpMul(angSpeed, dt);
            const invSpeed = fpDiv(FP_ONE, angSpeed);
            const axis = {
                x: fpMul(angVelX, invSpeed),
                y: fpMul(angVelY, invSpeed),
                z: fpMul(angVelZ, invSpeed)
            };
            const rotDelta = quatFromAxisAngle(axis, angle);
            body.rotation = quatNormalize(quatMul(rotDelta, body.rotation));
        }

        // Sleep detection
        const speedSq = vec3LengthSq(body.linearVelocity);
        const angSpeedSq = vec3LengthSq(body.angularVelocity);
        const sleepThreshSq = fpMul(SLEEP_THRESHOLD, SLEEP_THRESHOLD);

        if (speedSq < sleepThreshSq && angSpeedSq < sleepThreshSq) {
            const sleepIncrement = sleepingContactBodies.has(body) ? (1 + CONTACT_SLEEP_BONUS) : 1;
            body.sleepFrames += sleepIncrement;

            if (body.sleepFrames >= SLEEP_FRAMES_REQUIRED) {
                body.isSleeping = true;
                body.linearVelocity = vec3Zero();
                body.angularVelocity = vec3Zero();
            }
        } else {
            body.sleepFrames = 0;
            body.isSleeping = false;
        }
    }

    return contacts;
}
