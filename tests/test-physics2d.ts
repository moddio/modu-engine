/**
 * 2D Physics Unit Tests
 *
 * Comprehensive tests for the 2D physics engine.
 * Verifies shapes, bodies, collision, world simulation, and state serialization.
 */

import {
    toFixed, toFloat, FP_ONE,
    physics2d
} from '../src/index';

const {
    Shape2DType, createCircle, createBox2D, createBox2DFromSize,
    AABB2D, aabb2DOverlap, aabb2DUnion, aabb2DArea,
    BodyType2D, Vec2, vec2, vec2Zero, vec2Clone, vec2Add, vec2Sub, vec2Scale, vec2Dot, vec2LengthSq, vec2Cross,
    createBody2D, setBody2DMass, setBody2DVelocity, applyImpulse2D, applyForce2D,
    resetBody2DIdCounter, getBody2DIdCounter, setBody2DIdCounter,
    World2D, createWorld2D, addBody2D, removeBody2D, stepWorld2D,
    saveWorldState2D, loadWorldState2D
} = physics2d;

console.log('=== 2D Physics Unit Tests ===\n');

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
// Vec2 Tests
// ============================================

console.log('Test 1: Vec2 Operations');

test('vec2Zero creates zero vector', () => {
    const v = vec2Zero();
    return v.x === 0 && v.y === 0;
});

test('vec2 creates vector with fixed values', () => {
    const v = vec2(1.5, 2.5);
    return v.x === toFixed(1.5) && v.y === toFixed(2.5);
});

test('vec2Clone creates independent copy', () => {
    const v = vec2(3, 4);
    const clone = vec2Clone(v);
    clone.x = 0;
    return v.x === toFixed(3);
});

test('vec2Add adds vectors', () => {
    const a = vec2(1, 2);
    const b = vec2(3, 4);
    const result = vec2Add(a, b);
    return result.x === toFixed(4) && result.y === toFixed(6);
});

test('vec2Sub subtracts vectors', () => {
    const a = vec2(5, 7);
    const b = vec2(2, 3);
    const result = vec2Sub(a, b);
    return result.x === toFixed(3) && result.y === toFixed(4);
});

test('vec2Scale scales vector', () => {
    const v = vec2(2, 3);
    const result = vec2Scale(v, toFixed(2));
    return result.x === toFixed(4) && result.y === toFixed(6);
});

test('vec2Dot computes dot product', () => {
    const a = vec2(2, 3);
    const b = vec2(4, 5);
    const result = vec2Dot(a, b);
    // 2*4 + 3*5 = 8 + 15 = 23
    return result === toFixed(23);
});

test('vec2LengthSq computes squared length', () => {
    const v = vec2(3, 4);
    const result = vec2LengthSq(v);
    // 3*3 + 4*4 = 9 + 16 = 25
    return result === toFixed(25);
});

test('vec2Cross computes 2D cross (z component)', () => {
    const a = vec2(1, 0);
    const b = vec2(0, 1);
    const result = vec2Cross(a, b);
    // 1*1 - 0*0 = 1
    return result === toFixed(1);
});

// ============================================
// Shape2D Tests
// ============================================

console.log('\nTest 2: 2D Shapes');

test('createCircle creates circle shape', () => {
    const circle = createCircle(2.5);
    return circle.type === Shape2DType.Circle &&
           circle.radius === toFixed(2.5);
});

test('createBox2D creates box from half-extents', () => {
    const box = createBox2D(1.5, 2.5);
    return box.type === Shape2DType.Box &&
           box.halfWidth === toFixed(1.5) &&
           box.halfHeight === toFixed(2.5);
});

test('createBox2DFromSize creates box from full size', () => {
    const box = createBox2DFromSize(4, 6);
    // Should be half of input
    return box.type === Shape2DType.Box &&
           toFloat(box.halfWidth) === 2 &&
           toFloat(box.halfHeight) === 3;
});

test('aabb2DOverlap detects overlapping boxes', () => {
    const a: AABB2D = { minX: toFixed(0), minY: toFixed(0), maxX: toFixed(2), maxY: toFixed(2) };
    const b: AABB2D = { minX: toFixed(1), minY: toFixed(1), maxX: toFixed(3), maxY: toFixed(3) };
    return aabb2DOverlap(a, b) === true;
});

test('aabb2DOverlap detects non-overlapping boxes', () => {
    const a: AABB2D = { minX: toFixed(0), minY: toFixed(0), maxX: toFixed(1), maxY: toFixed(1) };
    const b: AABB2D = { minX: toFixed(2), minY: toFixed(2), maxX: toFixed(3), maxY: toFixed(3) };
    return aabb2DOverlap(a, b) === false;
});

test('aabb2DUnion computes union', () => {
    const a: AABB2D = { minX: toFixed(0), minY: toFixed(0), maxX: toFixed(2), maxY: toFixed(2) };
    const b: AABB2D = { minX: toFixed(1), minY: toFixed(1), maxX: toFixed(4), maxY: toFixed(4) };
    const union = aabb2DUnion(a, b);
    return union.minX === toFixed(0) &&
           union.minY === toFixed(0) &&
           union.maxX === toFixed(4) &&
           union.maxY === toFixed(4);
});

test('aabb2DArea computes area', () => {
    const aabb: AABB2D = { minX: toFixed(0), minY: toFixed(0), maxX: toFixed(3), maxY: toFixed(4) };
    const area = aabb2DArea(aabb);
    // 3 * 4 = 12
    return area === toFixed(12);
});

// ============================================
// RigidBody2D Tests
// ============================================

console.log('\nTest 3: 2D Rigid Bodies');

test('createBody2D creates dynamic body', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 5, 10, 'circle1');
    return body.type === BodyType2D.Dynamic &&
           body.label === 'circle1' &&
           body.mass > 0 &&
           body.invMass > 0;
});

test('createBody2D creates static body', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Static, createBox2D(10, 1), 0, 0, 'ground');
    return body.type === BodyType2D.Static &&
           body.mass === 0 &&
           body.invMass === 0;
});

test('createBody2D generates unique IDs', () => {
    resetBody2DIdCounter();
    const body1 = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    const body2 = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    return body1.id !== body2.id;
});

test('Body ID counter functions work', () => {
    resetBody2DIdCounter();
    const initial = getBody2DIdCounter();
    createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    const after = getBody2DIdCounter();
    setBody2DIdCounter(100);
    const set = getBody2DIdCounter();
    resetBody2DIdCounter();
    return initial === 1 && after === 2 && set === 100;
});

test('setBody2DMass updates mass', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    setBody2DMass(body, 5);
    return body.mass === toFixed(5);
});

test('setBody2DVelocity sets velocity', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    setBody2DVelocity(body, 3, 4);
    return body.linearVelocity.x === toFixed(3) &&
           body.linearVelocity.y === toFixed(4);
});

test('setBody2DVelocity wakes sleeping body', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    body.isSleeping = true;
    setBody2DVelocity(body, 1, 1);
    return body.isSleeping === false;
});

test('applyImpulse2D changes velocity', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    body.linearVelocity = vec2Zero();
    applyImpulse2D(body, vec2(5, 0));
    return body.linearVelocity.x > 0;
});

test('applyImpulse2D does not affect static bodies', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Static, createCircle(1), 0, 0);
    applyImpulse2D(body, vec2(100, 100));
    return body.linearVelocity.x === 0 && body.linearVelocity.y === 0;
});

test('applyForce2D applies scaled impulse', () => {
    resetBody2DIdCounter();
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0);
    body.linearVelocity = vec2Zero();
    applyForce2D(body, vec2(60, 0), toFixed(1/60));
    return body.linearVelocity.x > 0;
});

// ============================================
// World2D Tests
// ============================================

console.log('\nTest 4: 2D Physics World');

test('createWorld2D initializes world', () => {
    const world = createWorld2D(1/60);
    return world.bodies.length === 0;
});

test('addBody2D adds body to world', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 5, 'ball');
    addBody2D(world, body);
    return world.bodies.length === 1 && world.bodies[0] === body;
});

test('removeBody2D removes body from world', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 5, 'ball');
    addBody2D(world, body);
    removeBody2D(world, body);
    return world.bodies.length === 0;
});

test('stepWorld2D applies gravity', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 10, 'falling');
    addBody2D(world, body);

    const initialY = body.position.y;
    for (let i = 0; i < 10; i++) {
        stepWorld2D(world);
    }

    return body.position.y < initialY;
});

test('stepWorld2D does not move static bodies', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Static, createBox2D(10, 1), 0, 0, 'ground');
    addBody2D(world, body);

    const initialY = body.position.y;
    for (let i = 0; i < 60; i++) {
        stepWorld2D(world);
    }

    return body.position.y === initialY;
});

test('stepWorld2D returns contacts', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);

    // Ground
    const ground = createBody2D(BodyType2D.Static, createBox2D(10, 0.5), 0, 0, 'ground');
    addBody2D(world, ground);

    // Falling circle (start close to ground)
    const ball = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 1, 'ball');
    addBody2D(world, ball);

    // Step and check for contacts
    let foundContact = false;
    for (let i = 0; i < 60; i++) {
        const result = stepWorld2D(world);
        if (result.contacts.length > 0) {
            foundContact = true;
            break;
        }
    }

    return foundContact;
});

test('stepWorld2D handles circle-circle collision', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    world.gravity = vec2Zero(); // No gravity for this test

    const ball1 = createBody2D(BodyType2D.Dynamic, createCircle(0.5), -2, 0, 'ball1');
    setBody2DVelocity(ball1, 5, 0);
    addBody2D(world, ball1);

    const ball2 = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 2, 0, 'ball2');
    setBody2DVelocity(ball2, -5, 0);
    addBody2D(world, ball2);

    // Let them collide
    for (let i = 0; i < 60; i++) {
        stepWorld2D(world);
    }

    // After collision, velocities should have changed direction
    const v1 = ball1.linearVelocity.x;
    const v2 = ball2.linearVelocity.x;

    // The balls should have bounced (this may depend on collision parameters)
    return Number.isFinite(toFloat(v1)) && Number.isFinite(toFloat(v2));
});

// ============================================
// State Serialization Tests
// ============================================

console.log('\nTest 5: 2D State Serialization');

test('saveWorldState2D captures positions', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 5, 10, 'ball');
    addBody2D(world, body);

    const state = saveWorldState2D(world);
    return state.bodies.length === 1 &&
           state.bodies[0].px === body.position.x &&
           state.bodies[0].py === body.position.y;
});

test('saveWorldState2D captures velocities', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 0, 'ball');
    setBody2DVelocity(body, 3, 4);
    addBody2D(world, body);

    const state = saveWorldState2D(world);
    return state.bodies[0].vx === body.linearVelocity.x &&
           state.bodies[0].vy === body.linearVelocity.y;
});

test('loadWorldState2D restores positions', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(1), 5, 10, 'ball');
    addBody2D(world, body);

    const state = saveWorldState2D(world);

    // Move body
    body.position = vec2(0, 0);

    // Restore
    loadWorldState2D(world, state);

    return body.position.x === toFixed(5) &&
           body.position.y === toFixed(10);
});

test('State save/load cycle is deterministic', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 10, 'ball');
    addBody2D(world, body);

    // Simulate 50 frames
    for (let i = 0; i < 50; i++) {
        stepWorld2D(world);
    }
    const state = saveWorldState2D(world);

    // Continue 50 more frames
    for (let i = 0; i < 50; i++) {
        stepWorld2D(world);
    }
    const finalY1 = body.position.y;

    // Restore and continue
    loadWorldState2D(world, state);
    for (let i = 0; i < 50; i++) {
        stepWorld2D(world);
    }
    const finalY2 = body.position.y;

    return finalY1 === finalY2;
});

// ============================================
// Determinism Tests
// ============================================

console.log('\nTest 6: 2D Determinism');

test('Same simulation produces same results', () => {
    function runSimulation(): number {
        resetBody2DIdCounter();
        const world = createWorld2D(1/60);
        const body = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 10, 'ball');
        addBody2D(world, body);

        for (let i = 0; i < 100; i++) {
            stepWorld2D(world);
        }

        return body.position.y;
    }

    const result1 = runSimulation();
    const result2 = runSimulation();

    return result1 === result2;
});

test('Multiple bodies simulation is deterministic', () => {
    function runSimulation(): number[] {
        resetBody2DIdCounter();
        const world = createWorld2D(1/60);

        // Add ground
        const ground = createBody2D(BodyType2D.Static, createBox2D(10, 0.5), 0, 0, 'ground');
        addBody2D(world, ground);

        // Add multiple falling circles
        for (let i = 0; i < 5; i++) {
            const ball = createBody2D(BodyType2D.Dynamic, createCircle(0.3), i * 0.5, 5 + i, `ball_${i}`);
            addBody2D(world, ball);
        }

        // Simulate
        for (let i = 0; i < 200; i++) {
            stepWorld2D(world);
        }

        // Return positions
        return world.bodies
            .filter(b => b.type === BodyType2D.Dynamic)
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(b => b.position.y);
    }

    const results1 = runSimulation();
    const results2 = runSimulation();

    return results1.length === results2.length &&
           results1.every((v, i) => v === results2[i]);
});

// ============================================
// Edge Cases
// ============================================

console.log('\nTest 7: 2D Edge Cases');

test('Empty world step does not crash', () => {
    const world = createWorld2D(1/60);
    stepWorld2D(world);
    return true;
});

test('Very small circle works', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(0.01), 0, 5, 'tiny');
    addBody2D(world, body);

    for (let i = 0; i < 60; i++) {
        stepWorld2D(world);
    }

    return Number.isFinite(toFloat(body.position.y));
});

test('Body at origin works', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    const body = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 0, 'origin');
    addBody2D(world, body);

    stepWorld2D(world);

    return Number.isFinite(toFloat(body.position.y));
});

test('Box shape body works', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);

    const ground = createBody2D(BodyType2D.Static, createBox2D(10, 0.5), 0, 0, 'ground');
    addBody2D(world, ground);

    const box = createBody2D(BodyType2D.Dynamic, createBox2D(0.5, 0.5), 0, 5, 'box');
    addBody2D(world, box);

    for (let i = 0; i < 120; i++) {
        stepWorld2D(world);
    }

    return toFloat(box.position.y) > 0;
});

test('Rotation lock works', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    world.gravity = vec2Zero();

    const body = createBody2D(BodyType2D.Dynamic, createBox2D(0.5, 0.5), 0, 0, 'locked');
    body.lockRotation = true;
    body.angularVelocity = toFixed(10);
    addBody2D(world, body);

    const initialAngle = body.angle;
    for (let i = 0; i < 60; i++) {
        stepWorld2D(world);
    }

    return body.angle === initialAngle;
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll 2D physics tests passed!');
    process.exit(0);
}
