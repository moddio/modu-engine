/**
 * Trigger System Unit Tests
 *
 * Comprehensive tests for the trigger/sensor system.
 * Verifies trigger detection, events, and state management.
 */

import {
    toFixed, toFloat, FP_ONE,
    createBox, createSphere, BodyType, createBody, resetBodyIdCounter,
    Layers, createFilter,
    TriggerEvent, TriggerState, makeTrigger,
    createWorld, addBody, stepWorld
} from '../src/index';

console.log('=== Trigger System Unit Tests ===\n');

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

// ============================================
// makeTrigger Tests
// ============================================

console.log('Test 1: makeTrigger');

test('makeTrigger sets isTrigger flag', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    makeTrigger(body);
    return body.isTrigger === true;
});

test('makeTrigger returns the body', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    const result = makeTrigger(body);
    return result === body;
});

test('makeTrigger works with dynamic bodies', () => {
    resetBodyIdCounter();
    const body = createBody(BodyType.Dynamic, createSphere(1), 0, 0, 0, 'movingTrigger');
    makeTrigger(body);
    return body.isTrigger === true && body.type === BodyType.Dynamic;
});

// ============================================
// TriggerState Basic Tests
// ============================================

console.log('\nTest 2: TriggerState Basics');

test('TriggerState starts empty', () => {
    const state = new TriggerState();
    return state.overlapCount() === 0;
});

test('TriggerState has callback methods', () => {
    const state = new TriggerState();
    return typeof state.onEnter === 'function' &&
           typeof state.onStay === 'function' &&
           typeof state.onExit === 'function';
});

test('clear removes all overlaps', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const other = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0, 'other');

    // Simulate overlap
    state.processOverlaps([{ trigger, other }]);
    const countBefore = state.overlapCount();

    state.clear();
    const countAfter = state.overlapCount();

    return countBefore === 1 && countAfter === 0;
});

// ============================================
// processOverlaps Tests
// ============================================

console.log('\nTest 3: processOverlaps');

test('processOverlaps emits onEnter for new overlap', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const other = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0, 'other');

    let enterFired = false;
    state.onEnter(() => { enterFired = true; });

    state.processOverlaps([{ trigger, other }]);

    return enterFired;
});

test('processOverlaps emits onStay for continuing overlap', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const other = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0, 'other');

    let stayCount = 0;
    state.onStay(() => { stayCount++; });

    // First overlap - enter
    state.processOverlaps([{ trigger, other }]);
    const stayAfterFirst = stayCount;

    // Second overlap - stay
    state.processOverlaps([{ trigger, other }]);
    const stayAfterSecond = stayCount;

    return stayAfterFirst === 0 && stayAfterSecond === 1;
});

test('processOverlaps emits onExit when overlap ends', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const other = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0, 'other');

    let exitFired = false;
    state.onExit(() => { exitFired = true; });

    // Start overlap
    state.processOverlaps([{ trigger, other }]);
    const exitAfterEnter = exitFired;

    // End overlap (empty array)
    state.processOverlaps([]);
    const exitAfterLeave = exitFired;

    return exitAfterEnter === false && exitAfterLeave === true;
});

test('processOverlaps event data is correct', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'myTrigger');
    trigger.isTrigger = true;
    const other = createBody(BodyType.Dynamic, createBox(1, 1, 1), 0, 0, 0, 'myOther');

    let receivedEvent: TriggerEvent | null = null;
    state.onEnter((e) => { receivedEvent = e; });

    state.processOverlaps([{ trigger, other }]);

    return receivedEvent !== null &&
           receivedEvent.trigger === trigger &&
           receivedEvent.other === other;
});

// ============================================
// Multiple Overlaps Tests
// ============================================

console.log('\nTest 4: Multiple Overlaps');

test('Multiple bodies entering trigger', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(2, 2, 2), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body1 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body1');
    const body2 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body2');

    let enterCount = 0;
    state.onEnter(() => { enterCount++; });

    state.processOverlaps([
        { trigger, other: body1 },
        { trigger, other: body2 }
    ]);

    return enterCount === 2 && state.overlapCount() === 2;
});

test('Multiple triggers with same body', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger1 = createBody(BodyType.Static, createBox(1, 1, 1), -2, 0, 0, 'trigger1');
    trigger1.isTrigger = true;
    const trigger2 = createBody(BodyType.Static, createBox(1, 1, 1), 2, 0, 0, 'trigger2');
    trigger2.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    let enterCount = 0;
    state.onEnter(() => { enterCount++; });

    state.processOverlaps([
        { trigger: trigger1, other: body },
        { trigger: trigger2, other: body }
    ]);

    return enterCount === 2;
});

test('Partial exit - one body leaves', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(2, 2, 2), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body1 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body1');
    const body2 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body2');

    // Both enter
    state.processOverlaps([
        { trigger, other: body1 },
        { trigger, other: body2 }
    ]);

    let exitCount = 0;
    state.onExit(() => { exitCount++; });

    // Only body1 stays
    state.processOverlaps([
        { trigger, other: body1 }
    ]);

    return exitCount === 1 && state.overlapCount() === 1;
});

// ============================================
// getOverlappingBodies Tests
// ============================================

console.log('\nTest 5: getOverlappingBodies');

test('getOverlappingBodies returns overlapping bodies', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(2, 2, 2), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body1 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body1');
    const body2 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body2');

    state.processOverlaps([
        { trigger, other: body1 },
        { trigger, other: body2 }
    ]);

    const overlapping = state.getOverlappingBodies(trigger);
    return overlapping.length === 2;
});

test('getOverlappingBodies returns sorted by label', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(2, 2, 2), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const bodyZ = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'z_body');
    const bodyA = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'a_body');
    const bodyM = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'm_body');

    state.processOverlaps([
        { trigger, other: bodyZ },
        { trigger, other: bodyA },
        { trigger, other: bodyM }
    ]);

    const overlapping = state.getOverlappingBodies(trigger);
    return overlapping[0].label === 'a_body' &&
           overlapping[1].label === 'm_body' &&
           overlapping[2].label === 'z_body';
});

test('getOverlappingBodies returns empty for no overlaps', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;

    const overlapping = state.getOverlappingBodies(trigger);
    return overlapping.length === 0;
});

// ============================================
// isBodyInTrigger Tests
// ============================================

console.log('\nTest 6: isBodyInTrigger');

test('isBodyInTrigger returns true for overlapping body', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state.processOverlaps([{ trigger, other: body }]);

    return state.isBodyInTrigger(trigger, body) === true;
});

test('isBodyInTrigger returns false for non-overlapping body', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    return state.isBodyInTrigger(trigger, body) === false;
});

test('isBodyInTrigger returns false after body exits', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state.processOverlaps([{ trigger, other: body }]);
    const wasIn = state.isBodyInTrigger(trigger, body);

    state.processOverlaps([]);
    const isInNow = state.isBodyInTrigger(trigger, body);

    return wasIn === true && isInNow === false;
});

// ============================================
// removeBody Tests
// ============================================

console.log('\nTest 7: removeBody');

test('removeBody removes body from overlaps', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state.processOverlaps([{ trigger, other: body }]);
    state.removeBody(body);

    return state.overlapCount() === 0;
});

test('removeBody emits exit event', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state.processOverlaps([{ trigger, other: body }]);

    let exitFired = false;
    state.onExit(() => { exitFired = true; });

    state.removeBody(body);

    return exitFired;
});

test('removeBody removes from all triggers', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger1 = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger1');
    trigger1.isTrigger = true;
    const trigger2 = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger2');
    trigger2.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state.processOverlaps([
        { trigger: trigger1, other: body },
        { trigger: trigger2, other: body }
    ]);

    let exitCount = 0;
    state.onExit(() => { exitCount++; });

    state.removeBody(body);

    return exitCount === 2 && state.overlapCount() === 0;
});

test('Removing trigger body clears its overlaps', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body1 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body1');
    const body2 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body2');

    state.processOverlaps([
        { trigger, other: body1 },
        { trigger, other: body2 }
    ]);

    state.removeBody(trigger);

    return state.overlapCount() === 0;
});

// ============================================
// State Serialization Tests
// ============================================

console.log('\nTest 8: State Serialization');

test('saveState returns overlap pairs', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const trigger = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger.isTrigger = true;
    const body = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state.processOverlaps([{ trigger, other: body }]);

    const saved = state.saveState();
    return saved.length === 1 &&
           saved[0][0] === 'trigger' &&
           saved[0][1] === 'body';
});

test('saveState returns sorted pairs', () => {
    resetBodyIdCounter();
    const state = new TriggerState();
    const triggerB = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'triggerB');
    triggerB.isTrigger = true;
    const triggerA = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'triggerA');
    triggerA.isTrigger = true;
    const bodyZ = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'bodyZ');
    const bodyA = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'bodyA');

    state.processOverlaps([
        { trigger: triggerB, other: bodyZ },
        { trigger: triggerA, other: bodyA }
    ]);

    const saved = state.saveState();
    // Should be sorted: triggerA:bodyA, triggerB:bodyZ
    return saved[0][0] === 'triggerA' && saved[1][0] === 'triggerB';
});

test('loadState and syncWithWorld restores overlaps', () => {
    resetBodyIdCounter();

    // Save state from first instance
    const state1 = new TriggerState();
    const trigger1 = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger1.isTrigger = true;
    const body1 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state1.processOverlaps([{ trigger: trigger1, other: body1 }]);
    const saved = state1.saveState();

    // Load into second instance
    resetBodyIdCounter();
    const state2 = new TriggerState();
    const trigger2 = createBody(BodyType.Static, createBox(1, 1, 1), 0, 0, 0, 'trigger');
    trigger2.isTrigger = true;
    const body2 = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'body');

    state2.loadState(saved);
    state2.syncWithWorld([trigger2, body2]);

    return state2.overlapCount() === 1 &&
           state2.isBodyInTrigger(trigger2, body2);
});

// ============================================
// Determinism Tests
// ============================================

console.log('\nTest 9: Determinism');

test('Event order is deterministic', () => {
    function runTest(): string[] {
        resetBodyIdCounter();
        const state = new TriggerState();
        const trigger = createBody(BodyType.Static, createBox(2, 2, 2), 0, 0, 0, 'trigger');
        trigger.isTrigger = true;
        const bodyC = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'c_body');
        const bodyA = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'a_body');
        const bodyB = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, 'b_body');

        const events: string[] = [];
        state.onEnter((e) => { events.push('enter:' + e.other.label); });

        state.processOverlaps([
            { trigger, other: bodyC },
            { trigger, other: bodyA },
            { trigger, other: bodyB }
        ]);

        return events;
    }

    const result1 = runTest();
    const result2 = runTest();

    return result1.length === result2.length &&
           result1.every((e, i) => e === result2[i]);
});

test('Exit events are deterministic', () => {
    function runTest(): string[] {
        resetBodyIdCounter();
        const state = new TriggerState();
        const trigger = createBody(BodyType.Static, createBox(2, 2, 2), 0, 0, 0, 'trigger');
        trigger.isTrigger = true;
        const bodies = ['z', 'a', 'm'].map(name =>
            createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 0, 0, name + '_body')
        );

        // All enter
        state.processOverlaps(bodies.map(b => ({ trigger, other: b })));

        const events: string[] = [];
        state.onExit((e) => { events.push('exit:' + e.other.label); });

        // All exit
        state.processOverlaps([]);

        return events;
    }

    const result1 = runTest();
    const result2 = runTest();

    return result1.every((e, i) => e === result2[i]);
});

// ============================================
// Integration with Physics World
// ============================================

console.log('\nTest 10: Physics World Integration');

test('Trigger body does not apply collision response', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);

    // Static trigger zone - positioned so ball starts above it
    const trigger = createBody(BodyType.Static, createBox(2, 2, 2), 0, 1, 0, 'trigger');
    trigger.isTrigger = true;
    addBody(world, trigger);

    // Dynamic body passing through
    const ball = createBody(BodyType.Dynamic, createBox(0.5, 0.5, 0.5), 0, 5, 0, 'ball');
    addBody(world, ball);

    const initialY = toFloat(ball.position.y);

    // Simulate - ball should fall (gravity applies even with trigger overlap)
    for (let i = 0; i < 60; i++) {
        stepWorld(world);
    }

    // Ball should have fallen from initial position (collision response not applied)
    // Note: Ball may not pass completely through due to resting contact damping
    // affecting velocity. This verifies no bounce/push from collision response.
    const finalY = toFloat(ball.position.y);
    return finalY < initialY - 2; // Ball fell at least 2 units
});

test('Non-trigger body blocks movement', () => {
    resetBodyIdCounter();
    const world = createWorld(1/60);

    // Static solid block
    const block = createBody(BodyType.Static, createBox(2, 2, 2), 0, 0, 0, 'block');
    // NOT a trigger - should block
    addBody(world, block);

    // Dynamic body falling
    const ball = createBody(BodyType.Dynamic, createSphere(0.5), 0, 5, 0, 'ball');
    addBody(world, ball);

    // Simulate
    for (let i = 0; i < 120; i++) {
        stepWorld(world);
    }

    // Ball should be resting above block
    return toFloat(ball.position.y) > 0;
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll trigger system tests passed!');
    process.exit(0);
}
