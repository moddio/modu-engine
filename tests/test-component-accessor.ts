/**
 * Component Accessor Unit Tests
 *
 * Verifies that component fields handle float/fixed-point conversion correctly.
 * This is critical because:
 * - All number fields are stored as i32 (Int32Array) for determinism
 * - The accessor auto-converts: setter calls toFixed(), getter calls toFloat()
 * - Game code should use plain floats - conversion is transparent
 */

import { defineComponent } from '../src/core';
import { toFixed, toFloat } from '../src/math';

console.log('=== Component Accessor Unit Tests ===\n');

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

function approxEqual(a: number, b: number, tolerance: number = 0.001): boolean {
    return Math.abs(a - b) < tolerance;
}

// ============================================
// Test Setup - Direct accessor testing
// ============================================

// Define a test component
const TestComponent = defineComponent('TestAccessor', {
    intField: 100,
    floatField: 0.5,
    negativeField: -10,
    zeroField: 0,
});

// Get the accessor class and storage directly
const storage = (TestComponent as any).storage;
const AccessorClass = (TestComponent as any).AccessorClass;

// Create an accessor for entity index 0
const accessor = new AccessorClass(0);

// Initialize with defaults
storage.fields.intField[0] = toFixed(100);
storage.fields.floatField[0] = toFixed(0.5);
storage.fields.negativeField[0] = toFixed(-10);
storage.fields.zeroField[0] = toFixed(0);

// ============================================
// Basic Float Storage Tests
// ============================================

console.log('Test 1: Float Value Storage');

test('Integer default is preserved', () => {
    return accessor.intField === 100;
});

test('Float default is preserved', () => {
    return approxEqual(accessor.floatField, 0.5);
});

test('Negative default is preserved', () => {
    return accessor.negativeField === -10;
});

test('Zero default is preserved', () => {
    return accessor.zeroField === 0;
});

// ============================================
// Float Assignment Tests
// ============================================

console.log('\nTest 2: Float Assignment');

test('Can assign float and read it back', () => {
    accessor.floatField = 0.707;
    return approxEqual(accessor.floatField, 0.707);
});

test('Can assign negative float', () => {
    accessor.floatField = -0.333;
    return approxEqual(accessor.floatField, -0.333);
});

test('Can assign small float', () => {
    accessor.floatField = 0.001;
    return approxEqual(accessor.floatField, 0.001, 0.0001);
});

test('Can assign float close to 1', () => {
    accessor.floatField = 0.999;
    return approxEqual(accessor.floatField, 0.999);
});

test('Can assign integer as float', () => {
    accessor.floatField = 5;
    return accessor.floatField === 5;
});

// ============================================
// Direction Vector Tests (the actual use case)
// ============================================

console.log('\nTest 3: Direction Vector Storage (Snake Use Case)');

const DirectionComponent = defineComponent('DirectionTest', {
    dirX: 1,
    dirY: 0,
});

const dirStorage = (DirectionComponent as any).storage;
const DirAccessor = (DirectionComponent as any).AccessorClass;
const dir = new DirAccessor(0);

// Initialize
dirStorage.fields.dirX[0] = toFixed(1);
dirStorage.fields.dirY[0] = toFixed(0);

test('Default direction (1, 0) is preserved', () => {
    return dir.dirX === 1 && dir.dirY === 0;
});

test('Normalized direction vector can be stored', () => {
    // Simulate: direction toward (1, 1) normalized
    const len = Math.sqrt(2);
    dir.dirX = 1 / len;  // ~0.707
    dir.dirY = 1 / len;  // ~0.707
    return approxEqual(dir.dirX, 0.707, 0.01) && approxEqual(dir.dirY, 0.707, 0.01);
});

test('Direction magnitude is preserved after storage', () => {
    const len = Math.sqrt(2);
    dir.dirX = 1 / len;
    dir.dirY = 1 / len;
    const storedLen = Math.sqrt(dir.dirX * dir.dirX + dir.dirY * dir.dirY);
    return approxEqual(storedLen, 1.0, 0.01);
});

test('Negative direction components work', () => {
    dir.dirX = -0.6;
    dir.dirY = -0.8;
    return approxEqual(dir.dirX, -0.6, 0.01) && approxEqual(dir.dirY, -0.8, 0.01);
});

// ============================================
// NO Manual Fixed-Point Conversion Needed
// ============================================

console.log('\nTest 4: Manual FP Conversion is WRONG');

test('Double conversion causes wrong values (overflow)', () => {
    // This is what was being done WRONG:
    // sh.dirX = (dirX * 65536) | 0;  // Manual FP conversion
    // Then accessor does toFixed() again = 65536 * 65536 = overflow!

    const FP = 65536;
    const floatVal = 0.5;

    // Simulate double conversion (WRONG)
    const manualFP = (floatVal * FP) | 0;  // 32768
    dir.dirX = manualFP;  // Accessor does toFixed(32768) = 32768 * 65536 = 2147483648 → overflow!

    // The read value will be VERY wrong due to Int32 overflow
    // 2147483648 overflows to -2147483648 in Int32Array
    // Then toFloat(-2147483648) = -32768
    const readBack = dir.dirX;
    console.log(`    Double conversion: input=0.5, manual FP=${manualFP}, readBack=${readBack}`);

    // readBack should be -32768 (overflow result), NOT 0.5
    return readBack === -32768;
});

test('Direct float assignment works correctly', () => {
    // This is CORRECT - just use floats directly
    dir.dirX = 0.5;
    return approxEqual(dir.dirX, 0.5);
});

// ============================================
// Internal Storage Verification
// ============================================

console.log('\nTest 5: Internal Storage is Fixed-Point');

test('Stored value is actually fixed-point internally', () => {
    // Set a known float
    dir.dirX = 0.5;

    // The internal Int32Array should have toFixed(0.5) = 32768
    const rawValue = dirStorage.fields.dirX[0];

    console.log(`    Set dir.dirX = 0.5, raw storage = ${rawValue}, expected = ${toFixed(0.5)}`);
    return rawValue === toFixed(0.5);  // Should be 32768
});

test('Getter converts fixed-point back to float', () => {
    dir.dirX = 0.75;
    const rawValue = dirStorage.fields.dirX[0];

    // Raw should be fixed-point
    const expectedRaw = toFixed(0.75);  // 49152

    // Read value should be float
    const readValue = dir.dirX;

    console.log(`    Set 0.75, raw=${rawValue}, expected raw=${expectedRaw}, read=${readValue}`);
    return rawValue === expectedRaw && approxEqual(readValue, 0.75);
});

// ============================================
// Determinism Tests
// ============================================

console.log('\nTest 6: Determinism');

test('Same float stored multiple times gives same result', () => {
    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
        dir.dirX = 0.123456789;
        results.push(dir.dirX);
    }
    return results.every(v => v === results[0]);
});

test('Float precision is limited but consistent', () => {
    dir.dirX = 0.123456789;
    const stored1 = dir.dirX;

    dir.dirX = 0.123456789;
    const stored2 = dir.dirX;

    return stored1 === stored2;
});

// ============================================
// Edge Cases
// ============================================

console.log('\nTest 7: Edge Cases');

test('Very small values survive round-trip', () => {
    dir.dirX = 0.0001;
    return approxEqual(dir.dirX, 0.0001, 0.00001);
});

test('Values near max i32 range work', () => {
    dir.dirX = 30000;  // Large but within range
    return dir.dirX === 30000;
});

test('Negative values work correctly', () => {
    dir.dirX = -1;
    dir.dirY = -0.5;
    return dir.dirX === -1 && approxEqual(dir.dirY, -0.5);
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    console.log('\n!!! SOME TESTS FAILED !!!');
    console.log('The component accessor may not be working as expected.');
    process.exit(1);
} else {
    console.log('\nAll component accessor tests passed!');
    console.log('\nKEY TAKEAWAY: Game code should use plain floats with components.');
    console.log('The accessor automatically handles fixed-point conversion internally.');
    console.log('NEVER manually multiply/divide by 65536 - it causes double conversion!');
    process.exit(0);
}
