/**
 * 3D Physics Unit Tests
 *
 * Comprehensive tests for the 3D physics engine.
 * Verifies shapes, bodies, collision, world simulation, and state serialization.
 */

import {
    toFixed, toFloat, FP_ONE,
    vec3FromFloats, vec3Zero,
    ShapeType, createBox, createSphere, AABB, aabbOverlap,
    BodyType, RigidBody, createBody, setBodyMass, setBodyVelocity, applyImpulse, applyForce, resetBodyIdCounter,
    CollisionFilter, Layers, DEFAULT_FILTER, createFilter, shouldCollide,
    World, createWorld, addBody, removeBody, stepWorld, isGrounded,
    saveWorldState, loadWorldState
} from '../src/index';

console.log('=== 3D Physics Unit Tests ===\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
    try {
        if (fn()) {
            console.log(`  PASS: ${name}`);
            passed++;
        } else {
            console.log(`  FAIL: ${name}`);
            failed++;
        }
    } catch (e) {
        console.log(`  FAIL: ${name} - ${e}`);
        failed++;
    }
}

function approxEqual(a: number, b: number, tolerance: number = 0.01): boolean {
    return Math.abs(a - b) < tolerance;
}

// ============================================
// Shape Tests
// ============================================

console.log('Test 1: Shapes');

test('createBox creates box shape', () => {
    const box = createBox(1, 2, 3);
    return box.type === ShapeType.Box &&
           box.halfExtents.x === toFixed(1) &&
           box.halfExtents.y === toFixed(2) &&
           box.halfExtents.z === toFixed(3);
});

test('createSphere creates sphere shape', () => {
    const sphere = createSphere(2.5);
    return sphere.type === ShapeType.Sphere &&
           sphere.radius === toFixed(2.5);
});

test('aabbOverlap detects overlapping AABBs', () => {
    const a: AABB = {
        min: vec3FromFloats(0, 0, 0),
        max: vec3FromFloats(2, 2, 2)
    };
    const b: AABB = {
        min: vec3FromFloats(1, 1, 1),
        max: vec3FromFloats(3, 3, 3)
    };
    return aabbOverlap(a, b) === true;
});

test('aabbOverlap detects non-overlapping AABBs', () => {
    const a: AABB = {
        min: vec3FromFloats(0, 0, 0),
        max: vec3FromFloats(1, 1, 1)
    };
    const b: AABB = {
        min: vec3FromFloats(2, 2, 2),
        max: vec3FromFloats(3, 3, 3)
    };
    return aabbOverlap(a, b) === false;
});

test('aabbOverlap edge case - touching AABBs', () => {
    const a: AABB = {
        min: vec3FromFloats(0, 0, 0),
        max: vec3FromFloats(1, 1, 1)
    };
    const b: AABB = {
        min: vec3FromFloats(1, 0, 0),
        max: vec3FromFloats(2, 1, 1)
    };
    return aabbOverlap(a, b) === true;
});

// ============================================
// Rigid Body Tests
// ============================================

console.log('\nTest 2: Rigid Bodies');

test('createBody creates dynamic body', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 5, 0, 'testBox');
    return body.type === BodyType.Dynamic &&
           body.label === 'testBox' &&
           body.mass > 0 &&
           body.invMass > 0;
});

test('createBody creates static body', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Static, createBox(10, 1, 10), 0, 0, 0, 'ground');
    return body.type === BodyType.Static &&
           body.mass === 0 &&
           body.invMass === 0;
});

test('createBody generates unique IDs', () => {
    resetBodyIdCounter();
    const body1 = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    const body2 = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    return body1.id !== body2.id;
});

test('createBody generates default labels', () => {
    resetBodyIdCounter();
    const body1 = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    const body2 = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    return body1.label.startsWith('body_') && body2.label.startsWith('body_');
});

test('setBodyMass updates mass properties', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    setBodyMass(body, 5);
    return body.mass === toFixed(5);
});

test('setBodyMass does not affect static bodies', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0);
    const originalMass = body.mass;
    setBodyMass(body, 100);
    return body.mass === originalMass;
});

test('setBodyVelocity sets velocity', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    setBodyVelocity(body, 1, 2, 3);
    return body.linearVelocity.x === toFixed(1) &&
           body.linearVelocity.y === toFixed(2) &&
           body.linearVelocity.z === toFixed(3);
});

test('setBodyVelocity wakes sleeping body', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    body.isSleeping = true;
    setBodyVelocity(body, 1, 0, 0);
    return body.isSleeping === false;
});

test('applyImpulse changes velocity', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    body.linearVelocity = vec3Zero();
    applyImpulse(body, vec3FromFloats(10, 0, 0));
    return body.linearVelocity.x > 0;
});

test('applyImpulse does not affect static bodies', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0);
    applyImpulse(body, vec3FromFloats(1000, 1000, 1000));
    return body.linearVelocity.x === 0 &&
           body.linearVelocity.y === 0 &&
           body.linearVelocity.z === 0;
});

test('applyForce applies scaled impulse', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0);
    body.linearVelocity = vec3Zero();
    applyForce(body, vec3FromFloats(60, 0, 0), toFixed(1/60));
    return body.linearVelocity.x > 0;
});

// ============================================
// World Tests
// ============================================

console.log('\nTest 3: Physics World');

test('createWorld initializes world', () => {
    const world = createWorld(1/60);
    return world.bodies.length === 0 && world.dt === toFixed(1/60);
});

test('addBody adds body to world', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 5, 0, 'box1');
    addBody(world, body);
    return world.bodies.length === 1 && world.bodies[0] === body;
});

test('removeBody removes body from world', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 5, 0, 'box1');
    addBody(world, body);
    removeBody(world, body);
    return world.bodies.length === 0;
});

test('stepWorld applies gravity', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 10, 0, 'falling');
    addBody(world, body);

    const initialY = body.position.y;
    for (let i = 0; i < 10; i++) {
        stepWorld(world);
    }

    return body.position.y < initialY;
});

test('stepWorld does not move static bodies', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Static, createBox(10, 1, 10), 0, 0, 0, 'ground');
    addBody(world, body);

    const initialY = body.position.y;
    for (let i = 0; i < 60; i++) {
        stepWorld(world);
    }

    return body.position.y === initialY;
});

test('stepWorld handles collision detection', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);

    // Ground
    const ground = createBody(BodyType.Static, createBox(10, 0.5, 10), 0, 0, 0, 'ground');
    addBody(world, ground);

    // Falling box
    const box = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 5, 0, 'box');
    addBody(world, box);

    // Simulate until settled
    for (let i = 0; i < 300; i++) {
        stepWorld(world);
    }

    // Box should have stopped above ground
    return toFloat(box.position.y) > 0 && toFloat(box.position.y) < 5;
});

test('isGrounded detects grounded body', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);

    // Ground
    const ground = createBody(BodyType.Static, createBox(10, 0.5, 10), 0, 0, 0, 'ground');
    addBody(world, ground);

    // Box resting on ground
    const box = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 2, 0, 'box');
    addBody(world, box);

    // Let it settle
    for (let i = 0; i < 300; i++) {
        stepWorld(world);
    }

    return isGrounded(world, box);
});

// ============================================
// State Serialization Tests
// ============================================

console.log('\nTest 4: State Serialization');

test('saveWorldState captures body positions', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 5, 10, -3, 'testBox');
    addBody(world, body);

    const state = saveWorldState(world);
    return state.bodies.length === 1 &&
           state.bodies[0].px === body.position.x &&
           state.bodies[0].py === body.position.y &&
           state.bodies[0].pz === body.position.z;
});

test('saveWorldState captures body velocities', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0, 'testBox');
    setBodyVelocity(body, 1, 2, 3);
    addBody(world, body);

    const state = saveWorldState(world);
    return state.bodies[0].vx === body.linearVelocity.x &&
           state.bodies[0].vy === body.linearVelocity.y &&
           state.bodies[0].vz === body.linearVelocity.z;
});

test('loadWorldState restores positions', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(1, 1, 1), 5, 10, 15, 'testBox');
    addBody(world, body);

    const state = saveWorldState(world);

    // Move body
    body.position = vec3FromFloats(0, 0, 0);

    // Restore
    loadWorldState(world, state);

    return body.position.x === toFixed(5) &&
           body.position.y === toFixed(10) &&
           body.position.z === toFixed(15);
});

test('State save/load cycle is deterministic', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 10, 0, 'testBox');
    addBody(world, body);

    // Simulate 50 frames
    for (let i = 0; i < 50; i++) {
        stepWorld(world);
    }
    const state = saveWorldState(world);

    // Continue 50 more frames
    for (let i = 0; i < 50; i++) {
        stepWorld(world);
    }
    const finalY1 = body.position.y;

    // Restore and continue
    loadWorldState(world, state);
    for (let i = 0; i < 50; i++) {
        stepWorld(world);
    }
    const finalY2 = body.position.y;

    return finalY1 === finalY2;
});

// ============================================
// Determinism Tests
// ============================================

console.log('\nTest 5: Determinism');

test('Same simulation produces same results', () => {
    function runSimulation(): number {
        resetBodyIdCounter();
        const world = createWorld(1/60);
        const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 10, 0, 'testBox');
        addBody(world, body);

        for (let i = 0; i < 100; i++) {
            stepWorld(world);
        }

        return body.position.y;
    }

    const result1 = runSimulation();
    const result2 = runSimulation();

    return result1 === result2;
});

test('Multiple bodies simulation is deterministic', () => {
    function runSimulation(): number[] {
        resetBodyIdCounter();
        const world = createWorld(1/60);

        // Add ground
        const ground = createBody(BodyType.Static, createBox(10, 0.5, 10), 0, 0, 0, 'ground');
        addBody(world, ground);

        // Add multiple falling boxes
        for (let i = 0; i < 5; i++) {
            const box = createBody(BodyType.Dynamic, createBox(0.4, 0.4, 0.4), i * 0.5, 5 + i, 0, `box_${i}`);
            addBody(world, box);
        }

        // Simulate
        for (let i = 0; i < 200; i++) {
            stepWorld(world);
        }

        // Return positions
        return world.bodies
            .filter(b => b.type === BodyType.Dynamic)
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(b => b.position.y);
    }

    const results1 = runSimulation();
    const results2 = runSimulation();

    return results1.length === results2.length &&
           results1.every((v, i) => v === results2[i]);
});

test('Collision response is deterministic', () => {
    function runCollision(): { x: number, y: number } {
        resetBodyIdCounter();
        const world = createWorld(1/60);

        // Two boxes colliding
        const box1 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), -2, 1, 0, 'box1');
        setBodyVelocity(box1, 5, 0, 0);
        addBody(world, box1);

        const box2 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 2, 1, 0, 'box2');
        setBodyVelocity(box2, -5, 0, 0);
        addBody(world, box2);

        // Ground
        const ground = createBody(BodyType.Static, createBox(10, 0.5, 10), 0, 0, 0, 'ground');
        addBody(world, ground);

        // Simulate collision
        for (let i = 0; i < 120; i++) {
            stepWorld(world);
        }

        return { x: box1.position.x, y: box1.position.y };
    }

    const result1 = runCollision();
    const result2 = runCollision();

    return result1.x === result2.x && result1.y === result2.y;
});

// ============================================
// Edge Cases
// ============================================

console.log('\nTest 6: Edge Cases');

test('Empty world step does not crash', () => {
    const world = createWorld(1/60);
    stepWorld(world);
    return true;
});

test('Very small body works correctly', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(0.01, 0.01, 0.01), 0, 5, 0, 'tiny');
    addBody(world, body);

    for (let i = 0; i < 60; i++) {
        stepWorld(world);
    }

    return Number.isFinite(toFloat(body.position.y));
});

test('Very large velocity handled correctly', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'fast');
    setBodyVelocity(body, 1000, 0, 0);
    addBody(world, body);

    stepWorld(world);

    return Number.isFinite(toFloat(body.position.x));
});

test('Body at origin works correctly', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'origin');
    addBody(world, body);

    stepWorld(world);

    return Number.isFinite(toFloat(body.position.y));
});

test('Sphere shape body works', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);

    const ground = createBody(BodyType.Static, createBox(10, 0.5, 10), 0, 0, 0, 'ground');
    addBody(world, ground);

    const sphere = createBody(BodyType.Dynamic, createSphere(0.5), 0, 5, 0, 'sphere');
    addBody(world, sphere);

    for (let i = 0; i < 120; i++) {
        stepWorld(world);
    }

    return toFloat(sphere.position.y) > 0;
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll 3D physics tests passed!');
    process.exit(0);
}
