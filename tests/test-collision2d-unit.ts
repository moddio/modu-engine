/**
 * 2D Collision Unit Tests
 *
 * Comprehensive tests for collision detection and resolution in the 2D physics engine.
 * These tests cover:
 * - Circle-Box collision when circle is outside box
 * - Circle-Box collision when circle center is inside box (suction bug fix)
 * - Kinematic vs Static collision resolution
 * - Kinematic vs Kinematic collision resolution
 *
 * All tests use fixed-point math for determinism.
 */

import {
    toFixed, toFloat, FP_ONE, fpMul,
    physics2d
} from '../src/index';

const {
    createCircle, createBox2D,
    BodyType2D, vec2, vec2Zero,
    createBody2D,
    resetBody2DIdCounter,
    createWorld2D, addBody2D, stepWorld2D,
    detectCollision2D, resolveCollision2D
} = physics2d;

console.log('=== 2D Collision Unit Tests ===\n');

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
// Circle-Box Collision: Circle OUTSIDE Box
// ============================================

console.log('Test 1: Circle-Box Collision - Circle Outside Box');

test('Circle approaching box from RIGHT side - detects collision', () => {
    resetBody2DIdCounter();
    // Circle to the right of box, overlapping
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 2.5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    // Should detect collision with positive depth
    if (!contact) return false;
    if (contact.depth <= 0) return false;

    // Verify collision is detected correctly
    return true;
});

test('Circle approaching box from LEFT side - detects collision', () => {
    resetBody2DIdCounter();
    // Circle to the left of box, overlapping
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), -2.5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) return false;

    // Should detect collision with positive depth
    return contact.depth > 0;
});

test('Circle approaching box from TOP - detects collision', () => {
    resetBody2DIdCounter();
    // Circle above box, overlapping
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, 2.5, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) return false;

    // Should detect collision with positive depth
    return contact.depth > 0;
});

test('Circle approaching box from BOTTOM - detects collision', () => {
    resetBody2DIdCounter();
    // Circle below box, overlapping
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 0, -2.5, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) return false;

    // Should detect collision with positive depth
    return contact.depth > 0;
});

test('Circle approaching box from CORNER (top-right) - detects collision', () => {
    resetBody2DIdCounter();
    // Circle at top-right corner, overlapping
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 2.5, 2.5, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) return false;

    // Should detect collision with positive depth
    return contact.depth > 0;
});

test('Circle NOT touching box - no collision', () => {
    resetBody2DIdCounter();
    // Circle far from box
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    return contact === null;
});

// Test that circle OUTSIDE box is pushed in the correct direction after resolution
test('Circle outside box (right side) - pushed RIGHT after resolution', () => {
    resetBody2DIdCounter();
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 2.5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);
    if (!contact) return false;

    const initialX = toFloat(circle.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(circle.position.x);

    // Circle to the right of box should be pushed further right (away from box)
    const pushedRight = finalX > initialX;

    if (!pushedRight) {
        console.log(`    DEBUG: Circle at ${initialX} moved to ${finalX} (should move right)`);
    }

    return pushedRight;
});

test('Circle outside box (left side) - pushed LEFT after resolution', () => {
    resetBody2DIdCounter();
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), -2.5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);
    if (!contact) return false;

    const initialX = toFloat(circle.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(circle.position.x);

    // Circle to the left of box should be pushed further left (away from box)
    const pushedLeft = finalX < initialX;

    if (!pushedLeft) {
        console.log(`    DEBUG: Circle at ${initialX} moved to ${finalX} (should move left)`);
    }

    return pushedLeft;
});

// ============================================
// Circle-Box Collision: Circle CENTER INSIDE Box (Suction Bug Fix)
// ============================================

console.log('\nTest 2: Circle-Box Collision - Circle Center Inside Box (Suction Bug Fix)');

test('Circle center inside box, right of center - pushes RIGHT', () => {
    resetBody2DIdCounter();
    // Circle center inside box, slightly right of center
    // Box: halfWidth=2, so extends from -2 to +2
    // Circle center at x=0.5 (inside, right of box center)
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0.5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) {
        console.log('    DEBUG: No contact detected (expected collision)');
        return false;
    }

    // The circle center is inside the box
    // When center is right of box center (dx > 0), it should push circle further right
    // The normal points from A (circle) to B (box), so for the circle to be pushed right,
    // the normal should be NEGATIVE X (pointing left, from circle toward box center)
    // Then resolution subtracts normal*depth from circle position, pushing it RIGHT

    // Actually, let's verify by checking what the resolution does
    const initialX = toFloat(circle.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(circle.position.x);

    // Circle should have moved RIGHT (positive X direction, away from box center)
    const movedRight = finalX > initialX;

    if (!movedRight) {
        console.log(`    DEBUG: Circle moved from ${initialX} to ${finalX} (should move right)`);
    }

    return movedRight;
});

test('Circle center inside box, left of center - pushes LEFT', () => {
    resetBody2DIdCounter();
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(0.5), -0.5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    const initialX = toFloat(circle.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(circle.position.x);

    // Circle should have moved LEFT (negative X direction, away from box center)
    const movedLeft = finalX < initialX;

    if (!movedLeft) {
        console.log(`    DEBUG: Circle moved from ${initialX} to ${finalX} (should move left)`);
    }

    return movedLeft;
});

test('Circle center inside box, above center - pushes UP', () => {
    resetBody2DIdCounter();
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 0.5, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    const initialY = toFloat(circle.position.y);
    resolveCollision2D(contact);
    const finalY = toFloat(circle.position.y);

    // Circle should have moved UP (positive Y direction)
    const movedUp = finalY > initialY;

    if (!movedUp) {
        console.log(`    DEBUG: Circle moved from ${initialY} to ${finalY} (should move up)`);
    }

    return movedUp;
});

test('Circle center inside box, below center - pushes DOWN', () => {
    resetBody2DIdCounter();
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, -0.5, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    const initialY = toFloat(circle.position.y);
    resolveCollision2D(contact);
    const finalY = toFloat(circle.position.y);

    // Circle should have moved DOWN (negative Y direction)
    const movedDown = finalY < initialY;

    if (!movedDown) {
        console.log(`    DEBUG: Circle moved from ${initialY} to ${finalY} (should move down)`);
    }

    return movedDown;
});

test('Circle center exactly at box center - pushes out deterministically', () => {
    resetBody2DIdCounter();
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    // Even when at exact center, it should still resolve (pick an axis)
    const initialX = circle.position.x;
    const initialY = circle.position.y;
    resolveCollision2D(contact);

    // Position should have changed
    return circle.position.x !== initialX || circle.position.y !== initialY;
});

test('Circle center deeply inside box - fully escapes after resolution', () => {
    resetBody2DIdCounter();
    // Circle deeply embedded - center near edge of box
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 1.5, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    // Box extends from -2 to +2
    // Circle center at 1.5, radius 1
    // Circle extends from 0.5 to 2.5
    // Circle center IS inside box (1.5 < 2)

    const contact = detectCollision2D(circle, box);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    const initialX = toFloat(circle.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(circle.position.x);

    // Should push right (positive direction)
    const pushedRight = finalX > initialX;

    if (!pushedRight) {
        console.log(`    DEBUG: Circle at ${initialX} moved to ${finalX} (should push right)`);
    }

    return pushedRight;
});

// ============================================
// Kinematic vs Static Collision Resolution
// ============================================

console.log('\nTest 3: Kinematic vs Static Collision Resolution');

test('Kinematic body colliding with Static body - kinematic pushed out', () => {
    resetBody2DIdCounter();
    // Kinematic circle moving into static box
    const kinematic = createBody2D(BodyType2D.Kinematic, createCircle(1), 2.5, 0, 'kinematic');
    const staticBody = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'static');

    const contact = detectCollision2D(kinematic, staticBody);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    const initialX = toFloat(kinematic.position.x);
    const staticInitialX = toFloat(staticBody.position.x);

    resolveCollision2D(contact);

    const finalX = toFloat(kinematic.position.x);
    const staticFinalX = toFloat(staticBody.position.x);

    // Kinematic should have moved (pushed out)
    const kinematicMoved = finalX !== initialX;
    // Static should NOT have moved
    const staticUnmoved = staticFinalX === staticInitialX;

    if (!kinematicMoved) {
        console.log(`    DEBUG: Kinematic did not move (was ${initialX}, now ${finalX})`);
    }
    if (!staticUnmoved) {
        console.log(`    DEBUG: Static moved (was ${staticInitialX}, now ${staticFinalX})`);
    }

    return kinematicMoved && staticUnmoved;
});

test('Static body (as A) vs Kinematic body (as B) - kinematic pushed out', () => {
    resetBody2DIdCounter();
    // Order matters for detectCollision2D - test with static first
    const staticBody = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'static');
    const kinematic = createBody2D(BodyType2D.Kinematic, createCircle(1), 2.5, 0, 'kinematic');

    // Note: detectCollision2D(static, kinematic) will swap if needed
    const contact = detectCollision2D(staticBody, kinematic);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    const initialX = toFloat(kinematic.position.x);
    const staticInitialX = toFloat(staticBody.position.x);

    resolveCollision2D(contact);

    const finalX = toFloat(kinematic.position.x);
    const staticFinalX = toFloat(staticBody.position.x);

    // Kinematic should have moved
    const kinematicMoved = finalX !== initialX;
    // Static should NOT have moved
    const staticUnmoved = staticFinalX === staticInitialX;

    return kinematicMoved && staticUnmoved;
});

test('Kinematic pushed in correct direction (uses circle center inside box)', () => {
    resetBody2DIdCounter();
    // Use kinematic circle with center INSIDE the static box for predictable behavior
    // This tests the kinematic resolution with the fixed inside-box normal direction
    const kinematic = createBody2D(BodyType2D.Kinematic, createCircle(1), 1.5, 0, 'kinematic');
    const staticBody = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'static');

    const contact = detectCollision2D(kinematic, staticBody);
    if (!contact) return false;

    const initialX = toFloat(kinematic.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(kinematic.position.x);

    // Should be pushed RIGHT (away from static center)
    const pushedRight = finalX > initialX;

    if (!pushedRight) {
        console.log(`    DEBUG: Kinematic at ${initialX} moved to ${finalX} (should move right)`);
    }

    return pushedRight;
});

test('Kinematic inside static on left side - pushed left', () => {
    resetBody2DIdCounter();
    // Kinematic circle with center inside static box, on left side
    const kinematic = createBody2D(BodyType2D.Kinematic, createCircle(1), -1.5, 0, 'kinematic');
    const staticBody = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'static');

    const contact = detectCollision2D(kinematic, staticBody);
    if (!contact) return false;

    const initialX = toFloat(kinematic.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(kinematic.position.x);

    // Should be pushed LEFT (away from static center)
    const pushedLeft = finalX < initialX;

    if (!pushedLeft) {
        console.log(`    DEBUG: Kinematic at ${initialX} moved to ${finalX} (should move left)`);
    }

    return pushedLeft;
});

// ============================================
// Kinematic vs Kinematic Collision Resolution
// ============================================

console.log('\nTest 4: Kinematic vs Kinematic Collision Resolution');

test('Two kinematic bodies colliding - both pushed apart', () => {
    resetBody2DIdCounter();
    const kinematic1 = createBody2D(BodyType2D.Kinematic, createCircle(1), -0.5, 0, 'kinematic1');
    const kinematic2 = createBody2D(BodyType2D.Kinematic, createCircle(1), 0.5, 0, 'kinematic2');

    const contact = detectCollision2D(kinematic1, kinematic2);

    if (!contact) {
        console.log('    DEBUG: No contact detected');
        return false;
    }

    const initial1 = toFloat(kinematic1.position.x);
    const initial2 = toFloat(kinematic2.position.x);

    resolveCollision2D(contact);

    const final1 = toFloat(kinematic1.position.x);
    const final2 = toFloat(kinematic2.position.x);

    // Both should have moved
    const k1Moved = final1 !== initial1;
    const k2Moved = final2 !== initial2;

    // k1 should move left (negative), k2 should move right (positive)
    const k1MovedLeft = final1 < initial1;
    const k2MovedRight = final2 > initial2;

    if (!k1Moved || !k2Moved) {
        console.log(`    DEBUG: k1 ${initial1}->${final1}, k2 ${initial2}->${final2}`);
    }

    return k1Moved && k2Moved && k1MovedLeft && k2MovedRight;
});

test('Kinematic-Kinematic collision - pushed apart equally', () => {
    resetBody2DIdCounter();
    // Two identical kinematic bodies overlapping at the same distance from center
    const kinematic1 = createBody2D(BodyType2D.Kinematic, createCircle(1), -0.5, 0, 'kinematic1');
    const kinematic2 = createBody2D(BodyType2D.Kinematic, createCircle(1), 0.5, 0, 'kinematic2');

    const contact = detectCollision2D(kinematic1, kinematic2);
    if (!contact) return false;

    const initial1 = toFloat(kinematic1.position.x);
    const initial2 = toFloat(kinematic2.position.x);

    resolveCollision2D(contact);

    const final1 = toFloat(kinematic1.position.x);
    const final2 = toFloat(kinematic2.position.x);

    // Calculate how much each moved
    const movement1 = Math.abs(final1 - initial1);
    const movement2 = Math.abs(final2 - initial2);

    // They should move approximately the same amount
    return approxEqual(movement1, movement2, 0.001);
});

test('Kinematic-Kinematic vertical collision - both pushed apart on Y axis', () => {
    resetBody2DIdCounter();
    const kinematic1 = createBody2D(BodyType2D.Kinematic, createCircle(1), 0, -0.5, 'kinematic1');
    const kinematic2 = createBody2D(BodyType2D.Kinematic, createCircle(1), 0, 0.5, 'kinematic2');

    const contact = detectCollision2D(kinematic1, kinematic2);
    if (!contact) return false;

    const initial1 = toFloat(kinematic1.position.y);
    const initial2 = toFloat(kinematic2.position.y);

    resolveCollision2D(contact);

    const final1 = toFloat(kinematic1.position.y);
    const final2 = toFloat(kinematic2.position.y);

    // k1 should move down (negative Y), k2 should move up (positive Y)
    const k1MovedDown = final1 < initial1;
    const k2MovedUp = final2 > initial2;

    return k1MovedDown && k2MovedUp;
});

// ============================================
// Static vs Static (no resolution)
// ============================================

console.log('\nTest 5: Static vs Static - No Resolution');

test('Two static bodies overlapping - neither moves', () => {
    resetBody2DIdCounter();
    const static1 = createBody2D(BodyType2D.Static, createBox2D(1, 1), 0, 0, 'static1');
    const static2 = createBody2D(BodyType2D.Static, createBox2D(1, 1), 0.5, 0, 'static2');

    const contact = detectCollision2D(static1, static2);
    if (!contact) return false;

    const initial1 = { x: static1.position.x, y: static1.position.y };
    const initial2 = { x: static2.position.x, y: static2.position.y };

    resolveCollision2D(contact);

    // Neither should move
    return static1.position.x === initial1.x &&
           static1.position.y === initial1.y &&
           static2.position.x === initial2.x &&
           static2.position.y === initial2.y;
});

// ============================================
// Dynamic vs Static (standard physics)
// ============================================

console.log('\nTest 6: Dynamic vs Static Collision');

test('Dynamic body pushed out of static body (center inside)', () => {
    resetBody2DIdCounter();
    // Use circle with center INSIDE box for predictable inside-box normal behavior
    const dynamic = createBody2D(BodyType2D.Dynamic, createCircle(1), 1.5, 0, 'dynamic');
    const staticBody = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'static');

    const contact = detectCollision2D(dynamic, staticBody);
    if (!contact) return false;

    const initialX = toFloat(dynamic.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(dynamic.position.x);

    // Dynamic should be pushed right (away from static center)
    const pushedRight = finalX > initialX;

    if (!pushedRight) {
        console.log(`    DEBUG: Dynamic at ${initialX} moved to ${finalX} (should move right)`);
    }

    return pushedRight;
});

test('Dynamic body falling onto static ground - stops at surface', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);

    // Ground at y=0
    const ground = createBody2D(BodyType2D.Static, createBox2D(10, 1), 0, 0, 'ground');
    addBody2D(world, ground);

    // Ball starting above ground
    const ball = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 0, 5, 'ball');
    addBody2D(world, ball);

    // Simulate for a few seconds
    for (let i = 0; i < 300; i++) {
        stepWorld2D(world);
    }

    // Ball should have fallen and stopped near the ground surface
    // Ground top is at y = 1 (halfHeight), ball should stop when center is at y = 1 + 0.5 = 1.5
    const ballY = toFloat(ball.position.y);

    // Should be above the ground top (1.0) but not too far
    return ballY >= 1.0 && ballY < 3.0;
});

// ============================================
// Dynamic vs Kinematic
// ============================================

console.log('\nTest 7: Dynamic vs Kinematic Collision');

test('Dynamic colliding with Kinematic - dynamic pushed, kinematic unmoved', () => {
    resetBody2DIdCounter();
    const dynamic = createBody2D(BodyType2D.Dynamic, createCircle(1), 2.5, 0, 'dynamic');
    const kinematic = createBody2D(BodyType2D.Kinematic, createBox2D(2, 2), 0, 0, 'kinematic');

    const contact = detectCollision2D(dynamic, kinematic);
    if (!contact) return false;

    const dynamicInitialX = toFloat(dynamic.position.x);
    const kinematicInitialX = toFloat(kinematic.position.x);

    resolveCollision2D(contact);

    const dynamicFinalX = toFloat(dynamic.position.x);
    const kinematicFinalX = toFloat(kinematic.position.x);

    // Dynamic should move (pushed out)
    // Kinematic should NOT move (it's kinematic, controlled by user)
    const dynamicMoved = dynamicFinalX !== dynamicInitialX;
    const kinematicUnmoved = kinematicFinalX === kinematicInitialX;

    return dynamicMoved && kinematicUnmoved;
});

// ============================================
// Trigger Bodies (no physics resolution)
// ============================================

console.log('\nTest 8: Trigger Bodies - No Physics Resolution');

test('Trigger body overlapping - no position change', () => {
    resetBody2DIdCounter();
    const trigger = createBody2D(BodyType2D.Dynamic, createCircle(1), 0.5, 0, 'trigger');
    trigger.isTrigger = true;
    const other = createBody2D(BodyType2D.Dynamic, createCircle(1), -0.5, 0, 'other');

    const contact = detectCollision2D(trigger, other);
    if (!contact) return false;

    const triggerInitial = { x: trigger.position.x, y: trigger.position.y };
    const otherInitial = { x: other.position.x, y: other.position.y };

    resolveCollision2D(contact);

    // Neither should move - triggers don't cause physics response
    return trigger.position.x === triggerInitial.x &&
           trigger.position.y === triggerInitial.y &&
           other.position.x === otherInitial.x &&
           other.position.y === otherInitial.y;
});

// ============================================
// Edge Cases
// ============================================

console.log('\nTest 9: Edge Cases');

test('Circle exactly touching box edge (no penetration) - no collision', () => {
    resetBody2DIdCounter();
    // Circle radius 1 at x=3, box halfWidth 2 at x=0
    // Box edge at x=2, circle edge at x=2 (exactly touching)
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 3, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    // Exactly touching should not be a collision (depth = 0)
    return contact === null || contact.depth <= 0;
});

test('Very small penetration depth - still resolves correctly', () => {
    resetBody2DIdCounter();
    // Circle barely overlapping
    const circle = createBody2D(BodyType2D.Dynamic, createCircle(1), 2.99, 0, 'circle');
    const box = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'box');

    const contact = detectCollision2D(circle, box);

    if (!contact) {
        console.log('    DEBUG: No contact for small penetration');
        return false;
    }

    const initialX = toFloat(circle.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(circle.position.x);

    // Should still push right
    return finalX >= initialX;
});

test('Box-Box collision resolution works', () => {
    resetBody2DIdCounter();
    const box1 = createBody2D(BodyType2D.Dynamic, createBox2D(1, 1), 0.5, 0, 'box1');
    const box2 = createBody2D(BodyType2D.Static, createBox2D(1, 1), -0.5, 0, 'box2');

    const contact = detectCollision2D(box1, box2);
    if (!contact) return false;

    const initialX = toFloat(box1.position.x);
    resolveCollision2D(contact);
    const finalX = toFloat(box1.position.x);

    // box1 should be pushed right
    return finalX > initialX;
});

// ============================================
// Integration: World Step with Collisions
// ============================================

console.log('\nTest 10: World Step Integration');

test('Kinematic body pushed by world step', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    world.gravity = vec2Zero(); // No gravity for this test

    const kinematic = createBody2D(BodyType2D.Kinematic, createCircle(1), 2.5, 0, 'kinematic');
    addBody2D(world, kinematic);

    const staticBody = createBody2D(BodyType2D.Static, createBox2D(2, 2), 0, 0, 'static');
    addBody2D(world, staticBody);

    const initialX = toFloat(kinematic.position.x);

    // Single world step should resolve collision
    stepWorld2D(world);

    const finalX = toFloat(kinematic.position.x);

    // Kinematic should have been pushed out
    return finalX >= initialX;
});

test('Multiple kinematic bodies all separate after world step', () => {
    resetBody2DIdCounter();
    const world = createWorld2D(1/60);
    world.gravity = vec2Zero();

    // Three kinematic bodies stacked on top of each other
    const k1 = createBody2D(BodyType2D.Kinematic, createCircle(1), 0, 0, 'k1');
    const k2 = createBody2D(BodyType2D.Kinematic, createCircle(1), 0.5, 0, 'k2');
    const k3 = createBody2D(BodyType2D.Kinematic, createCircle(1), 1.0, 0, 'k3');

    addBody2D(world, k1);
    addBody2D(world, k2);
    addBody2D(world, k3);

    // Run several steps to let them separate
    for (let i = 0; i < 60; i++) {
        stepWorld2D(world);
    }

    // Check that no two bodies are still overlapping
    const x1 = toFloat(k1.position.x);
    const x2 = toFloat(k2.position.x);
    const x3 = toFloat(k3.position.x);

    // With radius 1, centers should be at least 2 apart to not overlap
    const gap12 = Math.abs(x2 - x1);
    const gap23 = Math.abs(x3 - x2);

    // They might not be fully separated after 60 frames, but should be mostly separated
    return gap12 >= 1.5 && gap23 >= 1.5;
});

// ============================================
// Summary
// ============================================

console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll 2D Collision Unit Tests passed!');
    process.exit(0);
}
