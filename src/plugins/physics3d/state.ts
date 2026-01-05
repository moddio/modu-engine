/**
 * State Serialization
 *
 * Functions for saving and loading world state for rollback netcode.
 * Uses labels for body matching to ensure determinism across clients.
 */

import { Fixed } from '../../math/fixed';
import { World } from './world';

// ============================================
// State Interfaces
// ============================================

export interface BodyState {
    id: number;
    label: string;  // Used for matching bodies across clients with different IDs
    px: Fixed; py: Fixed; pz: Fixed;
    qx: Fixed; qy: Fixed; qz: Fixed; qw: Fixed;
    vx: Fixed; vy: Fixed; vz: Fixed;
    avx: Fixed; avy: Fixed; avz: Fixed;
    isSleeping: boolean;
    sleepFrames: number;
}

export interface WorldState {
    bodies: BodyState[];
}

// ============================================
// State Functions
// ============================================

export function saveWorldState(world: World): WorldState {
    return {
        bodies: world.bodies.map(b => ({
            id: b.id,
            label: b.label,
            px: b.position.x, py: b.position.y, pz: b.position.z,
            qx: b.rotation.x, qy: b.rotation.y, qz: b.rotation.z, qw: b.rotation.w,
            vx: b.linearVelocity.x, vy: b.linearVelocity.y, vz: b.linearVelocity.z,
            avx: b.angularVelocity.x, avy: b.angularVelocity.y, avz: b.angularVelocity.z,
            isSleeping: b.isSleeping,
            sleepFrames: b.sleepFrames,
        }))
    };
}

export function loadWorldState(world: World, state: WorldState): void {
    // Build set of labels that should exist
    const snapshotLabels = new Set(state.bodies.map(bs => bs.label));

    // Remove bodies that exist in world but not in snapshot (created after snapshot was taken)
    for (let i = world.bodies.length - 1; i >= 0; i--) {
        if (!snapshotLabels.has(world.bodies[i].label)) {
            world.bodies.splice(i, 1);
        }
    }

    // Use label for matching - body IDs may differ across clients
    const bodyMap = new Map(world.bodies.map(b => [b.label, b]));

    for (const bs of state.bodies) {
        const body = bodyMap.get(bs.label);
        if (!body) continue;

        body.position = { x: bs.px, y: bs.py, z: bs.pz };
        body.rotation = { x: bs.qx, y: bs.qy, z: bs.qz, w: bs.qw };
        body.linearVelocity = { x: bs.vx, y: bs.vy, z: bs.vz };
        body.angularVelocity = { x: bs.avx, y: bs.avy, z: bs.avz };
        body.isSleeping = bs.isSleeping;
        body.sleepFrames = bs.sleepFrames;
    }
}
