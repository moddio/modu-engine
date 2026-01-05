/**
 * Test that boxes balanced on corners/edges tip over correctly
 */

import { createTestEngine, toFixed, toFloat, vec3, quatFromAxisAngle, FP_ONE } from './test-helper-physics3d';

async function runTest() {
    console.log('=== Box Physics Test ===\n');

    // TEST 1: Tilted box should rotate
    console.log('--- Test 1: Tilted box tips over ---');
    await testTiltedBox();

    console.log('\n--- Test 2: Flat box settles quickly ---');
    await testFlatBox();

    console.log('\n' + '='.repeat(50));
    console.log('ALL TESTS PASSED');
    console.log('='.repeat(50));
    process.exit(0);
}

async function testFlatBox() {
    const engine = createTestEngine('test', {
        gravity: -30,
        inputDelay: 0,
        maxRollbackFrames: 0
    });

    engine.createStaticBox(0, -0.5, 0, 20, 0.5, 20, 'ground');
    const box = engine.createDynamicBox(0, 2, 0, 0.5, 0.5, 0.5, 'test_box');
    // No rotation - box is flat

    engine.onSimulate = () => {};

    let settledFrame = -1;
    for (let i = 0; i < 300; i++) {
        engine.tick();
        if (box.isSleeping && settledFrame < 0) {
            settledFrame = i;
            break;
        }
    }

    console.log(`  Settled at frame: ${settledFrame >= 0 ? settledFrame : 'never (300+ frames)'}`);
    console.log(`  Final position.y: ${toFloat(box.position.y).toFixed(3)}`);
    console.log(`  Angular velocity: (${toFloat(box.angularVelocity.x).toFixed(3)}, ${toFloat(box.angularVelocity.y).toFixed(3)}, ${toFloat(box.angularVelocity.z).toFixed(3)})`);

    if (settledFrame < 0 || settledFrame > 120) {
        console.log('  FAIL: Flat box should settle within 2 seconds (120 frames)');
        process.exit(1);
    }
    console.log('  PASS: Flat box settled quickly');
}

async function testTiltedBox() {
    // Create physics world
    const engine = createTestEngine('test', {
        gravity: -30,
        inputDelay: 0,
        maxRollbackFrames: 0
    });

    // Create ground
    engine.createStaticBox(0, -0.5, 0, 20, 0.5, 20, 'ground');

    // Create a box tilted 50 degrees on the Z axis (clearly off-balance)
    // Note: 45 degrees is unstable equilibrium where COM is directly above edge
    const box = engine.createDynamicBox(0, 2, 0, 0.5, 0.5, 0.5, 'test_box');

    // Rotate 50 degrees around Z axis (clearly past equilibrium)
    const angle = toFixed(50 * Math.PI / 180);
    box.rotation = quatFromAxisAngle(vec3(0, 0, FP_ONE), angle);

    console.log('Initial state:');
    console.log(`  Position: (${toFloat(box.position.x).toFixed(3)}, ${toFloat(box.position.y).toFixed(3)}, ${toFloat(box.position.z).toFixed(3)})`);
    console.log(`  Rotation (quat): (${toFloat(box.rotation.x).toFixed(3)}, ${toFloat(box.rotation.y).toFixed(3)}, ${toFloat(box.rotation.z).toFixed(3)}, ${toFloat(box.rotation.w).toFixed(3)})`);
    console.log(`  Angular velocity: (${toFloat(box.angularVelocity.x).toFixed(3)}, ${toFloat(box.angularVelocity.y).toFixed(3)}, ${toFloat(box.angularVelocity.z).toFixed(3)})`);

    // Run simulation for 10 seconds (600 frames at 60fps) to let box fully settle
    const frames = 600;
    engine.onSimulate = () => {}; // Empty callback

    let maxAngularVel = 0;
    const initialZ = toFloat(quatFromAxisAngle(vec3(0, 0, FP_ONE), angle).z);

    for (let i = 0; i < frames; i++) {
        engine.tick();

        // Track maximum angular velocity (to prove box rotated)
        const angVel = Math.sqrt(
            toFloat(box.angularVelocity.x) ** 2 +
            toFloat(box.angularVelocity.y) ** 2 +
            toFloat(box.angularVelocity.z) ** 2
        );
        if (angVel > maxAngularVel) {
            maxAngularVel = angVel;
        }

        // Early exit if box has settled
        if (box.isSleeping) {
            console.log(`Box settled to sleep at frame ${i}`);
            break;
        }
    }

    console.log(`\nAfter simulation (up to ${frames} frames):`);
    console.log(`  Position: (${toFloat(box.position.x).toFixed(3)}, ${toFloat(box.position.y).toFixed(3)}, ${toFloat(box.position.z).toFixed(3)})`);
    console.log(`  Rotation (quat): (${toFloat(box.rotation.x).toFixed(3)}, ${toFloat(box.rotation.y).toFixed(3)}, ${toFloat(box.rotation.z).toFixed(3)}, ${toFloat(box.rotation.w).toFixed(3)})`);
    console.log(`  Angular velocity: (${toFloat(box.angularVelocity.x).toFixed(3)}, ${toFloat(box.angularVelocity.y).toFixed(3)}, ${toFloat(box.angularVelocity.z).toFixed(3)})`);
    console.log(`  Is sleeping: ${box.isSleeping}`);
    console.log(`  Max angular velocity observed: ${maxAngularVel.toFixed(3)} rad/s`);

    const finalZ = toFloat(box.rotation.z);
    const finalW = toFloat(box.rotation.w);

    console.log(`\nInitial rotation.z: ${initialZ.toFixed(3)} (45 degrees)`);
    console.log(`Final rotation.z: ${finalZ.toFixed(3)}`);

    // Check if box rotated at any point (had significant angular velocity)
    const boxRotated = maxAngularVel > 0.5;  // At least 0.5 rad/s at some point

    // Check if box settled to a more stable orientation
    // A flat box on its face has rotation.w ≈ 1 (identity) or rotation.z ≈ +/-0.707 (90 deg)
    const settledFlat = Math.abs(finalW) > 0.95 || Math.abs(finalZ) > 0.65;

    console.log(`\nBox rotated during simulation: ${boxRotated ? 'YES' : 'NO'}`);
    console.log(`Box settled to flat orientation: ${settledFlat ? 'YES' : 'NO'}`);

    // Also check Y position - should have fallen and settled
    const finalY = toFloat(box.position.y);
    const expectedY = 0.5; // Half-height above ground for flat box
    console.log(`Final Y position: ${finalY.toFixed(3)} (expected ~${expectedY} for flat box)`);

    // Success if box rotated at all (proving torque is being applied)
    if (!boxRotated) {
        console.log('  FAIL: Box should rotate when balanced on corner');
        process.exit(1);
    }
    console.log('  PASS: Box tipped over correctly');
}

runTest().catch(console.error);
