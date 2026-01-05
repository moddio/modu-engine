/**
 * State Serialization
 *
 * Functions for saving and loading world state for rollback netcode.
 * Uses labels for body matching to ensure determinism across clients.
 */
// ============================================
// State Functions
// ============================================
export function saveWorldState(world) {
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
export function loadWorldState(world, state) {
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
        if (!body)
            continue;
        body.position = { x: bs.px, y: bs.py, z: bs.pz };
        body.rotation = { x: bs.qx, y: bs.qy, z: bs.qz, w: bs.qw };
        body.linearVelocity = { x: bs.vx, y: bs.vy, z: bs.vz };
        body.angularVelocity = { x: bs.avx, y: bs.avy, z: bs.avz };
        body.isSleeping = bs.isSleeping;
        body.sleepFrames = bs.sleepFrames;
    }
}
