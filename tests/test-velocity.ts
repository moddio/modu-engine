/**
 * Test: Physics2D velocity integration
 * Verifies that bodies with velocity actually move
 */

import { createWorld2D, addBody2D, stepWorld2D } from '../src/components/physics2d/world';
import { createBody2D, BodyType2D } from '../src/components/physics2d/rigid-body';
import { createCircle } from '../src/components/physics2d/shapes';
import { toFixed, toFloat } from '../src/math/fixed';

console.log('=== Test: Physics2D Velocity ===\n');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, details?: string) {
    if (condition) {
        console.log(`  PASS: ${name}`);
        passed++;
    } else {
        console.log(`  FAIL: ${name}${details ? ' - ' + details : ''}`);
        failed++;
    }
}

// Test 1: Dynamic body with velocity should move
console.log('\n--- Test 1: Dynamic body velocity ---');
{
    const world = createWorld2D(1/20); // 20fps like game
    world.gravity = { x: 0, y: 0 }; // No gravity

    const shape = createCircle(4);
    const body = createBody2D(BodyType2D.Dynamic, shape, 100, 100);
    addBody2D(world, body);

    // Set velocity: 12 units per second
    body.linearVelocity = { x: toFixed(12), y: toFixed(0) };
    body.isSleeping = false;

    const startX = toFloat(body.position.x);
    console.log(`  Start position: ${startX}`);
    console.log(`  Velocity: ${toFloat(body.linearVelocity.x)}`);

    // Step physics
    stepWorld2D(world);

    const endX = toFloat(body.position.x);
    console.log(`  End position: ${endX}`);
    console.log(`  Movement: ${endX - startX}`);

    check('Dynamic body moved', endX > startX, `start=${startX}, end=${endX}`);
}

// Test 2: Kinematic body with velocity should move
console.log('\n--- Test 2: Kinematic body velocity ---');
{
    const world = createWorld2D(1/20);
    world.gravity = { x: 0, y: 0 };

    const shape = createCircle(4);
    const body = createBody2D(BodyType2D.Kinematic, shape, 100, 100);
    addBody2D(world, body);

    body.linearVelocity = { x: toFixed(12), y: toFixed(0) };
    body.isSleeping = false;

    const startX = toFloat(body.position.x);
    console.log(`  Start position: ${startX}`);
    console.log(`  Velocity: ${toFloat(body.linearVelocity.x)}`);
    console.log(`  isSleeping: ${body.isSleeping}`);
    console.log(`  Body type: ${body.type} (Kinematic=${BodyType2D.Kinematic})`);

    stepWorld2D(world);

    const endX = toFloat(body.position.x);
    console.log(`  End position: ${endX}`);
    console.log(`  Movement: ${endX - startX}`);

    check('Kinematic body moved', endX > startX, `start=${startX}, end=${endX}`);
}

// Test 3: Static body should NOT move
console.log('\n--- Test 3: Static body should not move ---');
{
    const world = createWorld2D(1/20);

    const shape = createCircle(4);
    const body = createBody2D(BodyType2D.Static, shape, 100, 100);
    addBody2D(world, body);

    body.linearVelocity = { x: toFixed(12), y: toFixed(0) };

    const startX = toFloat(body.position.x);
    stepWorld2D(world);
    const endX = toFloat(body.position.x);

    check('Static body did not move', endX === startX);
}

// Test 4: Multiple steps accumulate movement
console.log('\n--- Test 4: Multiple steps ---');
{
    const world = createWorld2D(1/20);
    world.gravity = { x: 0, y: 0 };

    const shape = createCircle(4);
    const body = createBody2D(BodyType2D.Kinematic, shape, 0, 0);
    addBody2D(world, body);

    body.linearVelocity = { x: toFixed(100), y: toFixed(0) }; // 100 units/sec

    // 20 steps = 1 second at 20fps
    for (let i = 0; i < 20; i++) {
        stepWorld2D(world);
    }

    const endX = toFloat(body.position.x);
    console.log(`  After 20 steps (1 sec): x = ${endX}`);

    // Should have moved ~100 units (100 units/sec * 1 sec)
    check('Moved approximately 100 units', endX > 90 && endX < 110, `actual=${endX}`);
}

// Results
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
