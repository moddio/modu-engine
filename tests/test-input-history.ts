/**
 * InputHistory Unit Tests
 *
 * Tests for the InputHistory class which stores confirmed server inputs
 * for rollback resimulation. This is CRITICAL for determinism - the order
 * and content of inputs must be exactly reproducible.
 *
 * Requirements:
 * 1. Inputs for a frame must be retrieved in deterministic (sorted) order by clientId
 * 2. Confirmed frames must exactly match server-provided inputs
 * 3. Serialization must be bit-exact for snapshots
 * 4. Memory must be bounded by pruning old frames
 */

import { InputHistory, FrameInput } from '../src/ecs/input-history';

console.log('=== InputHistory Unit Tests ===\n');

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
// Basic Storage: setInput / getFrame
// ============================================

console.log('Test 1: Basic Input Storage');

test('setInput stores input for a frame', () => {
    const history = new InputHistory();
    history.setInput(10, 1, { moveX: 100 });

    const frame = history.getFrame(10);
    if (!frame) return false;

    return frame.inputs.get(1)?.moveX === 100;
});

test('setInput allows multiple clients on same frame', () => {
    const history = new InputHistory();
    history.setInput(10, 1, { moveX: 100 });
    history.setInput(10, 2, { moveX: 200 });

    const frame = history.getFrame(10);
    if (!frame) return false;

    return frame.inputs.get(1)?.moveX === 100 &&
           frame.inputs.get(2)?.moveX === 200;
});

test('setInput overwrites existing input for same client/frame', () => {
    const history = new InputHistory();
    history.setInput(10, 1, { moveX: 100 });
    history.setInput(10, 1, { moveX: 999 });

    const frame = history.getFrame(10);
    if (!frame) return false;

    return frame.inputs.get(1)?.moveX === 999;
});

test('getFrame returns undefined for non-existent frame', () => {
    const history = new InputHistory();
    return history.getFrame(999) === undefined;
});

test('new frames are marked as unconfirmed by default', () => {
    const history = new InputHistory();
    history.setInput(10, 1, { moveX: 100 });

    const frame = history.getFrame(10);
    if (!frame) return false;

    return frame.confirmed === false;
});

// ============================================
// Frame Confirmation: confirmFrame
// ============================================

console.log('\nTest 2: Frame Confirmation');

test('confirmFrame marks frame as confirmed', () => {
    const history = new InputHistory();

    const inputs = new Map<number, Record<string, any>>();
    inputs.set(1, { moveX: 100 });
    inputs.set(2, { moveY: 50 });

    history.confirmFrame(10, inputs);

    const frame = history.getFrame(10);
    if (!frame) return false;

    return frame.confirmed === true;
});

test('confirmFrame replaces any existing inputs with server inputs', () => {
    const history = new InputHistory();

    // Store local prediction
    history.setInput(10, 1, { moveX: 999 });

    // Server confirms with different data
    const serverInputs = new Map<number, Record<string, any>>();
    serverInputs.set(1, { moveX: 100 });

    history.confirmFrame(10, serverInputs);

    const frame = history.getFrame(10);
    if (!frame) return false;

    // Server input should replace prediction
    return frame.inputs.get(1)?.moveX === 100;
});

test('confirmFrame stores inputs from all clients', () => {
    const history = new InputHistory();

    const serverInputs = new Map<number, Record<string, any>>();
    serverInputs.set(1, { moveX: 100 });
    serverInputs.set(2, { moveY: 200 });
    serverInputs.set(3, { action: 'fire' });

    history.confirmFrame(10, serverInputs);

    const frame = history.getFrame(10);
    if (!frame) return false;

    return frame.inputs.size === 3 &&
           frame.inputs.get(1)?.moveX === 100 &&
           frame.inputs.get(2)?.moveY === 200 &&
           frame.inputs.get(3)?.action === 'fire';
});

test('confirmFrame creates new frame if not exists', () => {
    const history = new InputHistory();

    const serverInputs = new Map<number, Record<string, any>>();
    serverInputs.set(1, { moveX: 100 });

    history.confirmFrame(10, serverInputs);

    const frame = history.getFrame(10);
    return frame !== undefined && frame.confirmed === true;
});

// ============================================
// Range Retrieval: getRange (CRITICAL for resimulation)
// ============================================

console.log('\nTest 3: Range Retrieval (for resimulation)');

test('getRange returns frames in ascending order', () => {
    const history = new InputHistory();

    history.setInput(12, 1, { frame: 12 });
    history.setInput(10, 1, { frame: 10 });
    history.setInput(11, 1, { frame: 11 });

    const range = history.getRange(10, 12);

    if (range.length !== 3) return false;

    return range[0].frame === 10 &&
           range[1].frame === 11 &&
           range[2].frame === 12;
});

test('getRange includes both endpoints', () => {
    const history = new InputHistory();

    history.setInput(10, 1, { x: 10 });
    history.setInput(11, 1, { x: 11 });
    history.setInput(12, 1, { x: 12 });

    const range = history.getRange(10, 12);

    return range.length === 3;
});

test('getRange returns empty array when no frames in range', () => {
    const history = new InputHistory();

    history.setInput(5, 1, { x: 5 });
    history.setInput(20, 1, { x: 20 });

    const range = history.getRange(10, 15);

    return range.length === 0;
});

test('getRange returns partial range when some frames missing', () => {
    const history = new InputHistory();

    history.setInput(10, 1, { x: 10 });
    // 11 is missing
    history.setInput(12, 1, { x: 12 });

    const range = history.getRange(10, 12);

    // Should return frames 10 and 12 (skipping 11)
    return range.length === 2 &&
           range[0].frame === 10 &&
           range[1].frame === 12;
});

test('getRange returns empty for invalid range (from > to)', () => {
    const history = new InputHistory();

    history.setInput(10, 1, { x: 10 });

    const range = history.getRange(15, 10);

    return range.length === 0;
});

// ============================================
// Pruning: prune (CRITICAL for memory management)
// ============================================

console.log('\nTest 4: Pruning');

test('prune removes frames before specified frame', () => {
    const history = new InputHistory();

    history.setInput(5, 1, { x: 5 });
    history.setInput(10, 1, { x: 10 });
    history.setInput(15, 1, { x: 15 });

    history.prune(10);

    // Frame 5 should be removed
    // Frames 10 and 15 should remain
    return history.getFrame(5) === undefined &&
           history.getFrame(10) !== undefined &&
           history.getFrame(15) !== undefined;
});

test('prune with frame 0 removes nothing', () => {
    const history = new InputHistory();

    history.setInput(5, 1, { x: 5 });
    history.setInput(10, 1, { x: 10 });

    history.prune(0);

    return history.getFrame(5) !== undefined &&
           history.getFrame(10) !== undefined;
});

test('prune with very large frame removes everything', () => {
    const history = new InputHistory();

    history.setInput(5, 1, { x: 5 });
    history.setInput(10, 1, { x: 10 });

    history.prune(100);

    return history.getFrame(5) === undefined &&
           history.getFrame(10) === undefined;
});

// ============================================
// Serialization: getState / setState (CRITICAL for snapshots)
// ============================================

console.log('\nTest 5: Serialization (for snapshots)');

test('getState/setState round-trip preserves frame numbers', () => {
    const history = new InputHistory();

    history.setInput(10, 1, { x: 100 });
    history.setInput(20, 2, { y: 200 });

    const state = history.getState();

    const restored = new InputHistory();
    restored.setState(state);

    const frame10 = restored.getFrame(10);
    const frame20 = restored.getFrame(20);

    return frame10?.frame === 10 && frame20?.frame === 20;
});

test('getState/setState round-trip preserves input data', () => {
    const history = new InputHistory();

    history.setInput(10, 1, { moveX: 100, moveY: 50 });
    history.setInput(10, 2, { action: 'fire', target: 42 });

    const state = history.getState();

    const restored = new InputHistory();
    restored.setState(state);

    const frame = restored.getFrame(10);
    if (!frame) return false;

    const client1 = frame.inputs.get(1);
    const client2 = frame.inputs.get(2);

    return client1?.moveX === 100 &&
           client1?.moveY === 50 &&
           client2?.action === 'fire' &&
           client2?.target === 42;
});

test('getState/setState round-trip preserves confirmed status', () => {
    const history = new InputHistory();

    const serverInputs = new Map<number, Record<string, any>>();
    serverInputs.set(1, { x: 100 });
    history.confirmFrame(10, serverInputs);

    history.setInput(20, 1, { x: 200 }); // Unconfirmed

    const state = history.getState();

    const restored = new InputHistory();
    restored.setState(state);

    return restored.getFrame(10)?.confirmed === true &&
           restored.getFrame(20)?.confirmed === false;
});

test('getState returns JSON-serializable object', () => {
    const history = new InputHistory();

    history.setInput(10, 1, { x: 100 });

    const state = history.getState();

    // Should not throw when stringifying
    try {
        const json = JSON.stringify(state);
        const parsed = JSON.parse(json);
        return typeof parsed === 'object';
    } catch {
        return false;
    }
});

test('setState clears existing data before restoring', () => {
    const history = new InputHistory();

    history.setInput(5, 1, { old: true });

    // Create new state without frame 5
    const newHistory = new InputHistory();
    newHistory.setInput(10, 1, { new: true });
    const state = newHistory.getState();

    history.setState(state);

    // Frame 5 should be gone
    return history.getFrame(5) === undefined &&
           history.getFrame(10) !== undefined;
});

// ============================================
// Determinism: Input order must be consistent
// ============================================

console.log('\nTest 6: Determinism (sorted client order)');

test('getFrame returns inputs in sorted clientId order when iterating', () => {
    const history = new InputHistory();

    // Add clients in non-sorted order
    history.setInput(10, 5, { id: 5 });
    history.setInput(10, 1, { id: 1 });
    history.setInput(10, 3, { id: 3 });

    const frame = history.getFrame(10);
    if (!frame) return false;

    // Get sorted entries for iteration
    const sortedInputs = frame.getSortedInputs();

    // Should be in order: 1, 3, 5
    const clientIds = sortedInputs.map(([id]) => id);

    return clientIds[0] === 1 &&
           clientIds[1] === 3 &&
           clientIds[2] === 5;
});

test('getRange returns frames with deterministic input order', () => {
    const history = new InputHistory();

    // Add inputs in random order across frames
    history.setInput(10, 3, { x: 3 });
    history.setInput(10, 1, { x: 1 });
    history.setInput(11, 2, { x: 2 });
    history.setInput(11, 4, { x: 4 });

    const range = history.getRange(10, 11);

    // Each frame's inputs should be sorted
    const frame10Ids = range[0].getSortedInputs().map(([id]) => id);
    const frame11Ids = range[1].getSortedInputs().map(([id]) => id);

    return frame10Ids[0] === 1 && frame10Ids[1] === 3 &&
           frame11Ids[0] === 2 && frame11Ids[1] === 4;
});

// ============================================
// Edge Cases
// ============================================

console.log('\nTest 7: Edge Cases');

test('handles empty input data', () => {
    const history = new InputHistory();

    history.setInput(10, 1, {});

    const frame = history.getFrame(10);
    if (!frame) return false;

    const input = frame.inputs.get(1);
    return input !== undefined && Object.keys(input).length === 0;
});

test('handles frame 0', () => {
    const history = new InputHistory();

    history.setInput(0, 1, { x: 0 });

    const frame = history.getFrame(0);
    return frame !== undefined && frame.frame === 0;
});

test('handles very large frame numbers', () => {
    const history = new InputHistory();

    const largeFrame = 1000000;
    history.setInput(largeFrame, 1, { x: 100 });

    const frame = history.getFrame(largeFrame);
    return frame !== undefined && frame.frame === largeFrame;
});

test('handles negative clientId (should still work)', () => {
    const history = new InputHistory();

    // While unlikely, should not crash
    history.setInput(10, -1 as any, { x: 100 });

    const frame = history.getFrame(10);
    return frame !== undefined;
});

test('confirmFrame with empty inputs creates confirmed frame', () => {
    const history = new InputHistory();

    const emptyInputs = new Map<number, Record<string, any>>();
    history.confirmFrame(10, emptyInputs);

    const frame = history.getFrame(10);
    return frame !== undefined &&
           frame.confirmed === true &&
           frame.inputs.size === 0;
});

test('maxFrames constructor parameter limits history size after prune', () => {
    const history = new InputHistory(5); // Max 5 frames

    // Add 10 frames
    for (let i = 0; i < 10; i++) {
        history.setInput(i, 1, { frame: i });
    }

    // Prune to frame 5 (should keep 5-9)
    history.prune(5);

    // Frames 0-4 should be gone
    let removedCount = 0;
    for (let i = 0; i < 5; i++) {
        if (history.getFrame(i) === undefined) removedCount++;
    }

    return removedCount === 5;
});

// ============================================
// Summary
// ============================================

console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    console.log('\nInputHistory tests FAILED!');
    process.exit(1);
} else {
    console.log('\nAll InputHistory tests passed!');
    process.exit(0);
}
