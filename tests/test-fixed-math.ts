/**
 * Fixed-Point Math Unit Tests
 *
 * Comprehensive tests for the fixed-point math library.
 * Verifies correctness, determinism, and edge cases.
 */

import {
    FP_SHIFT, FP_ONE, FP_HALF, FP_PI, FP_2PI, FP_HALF_PI,
    toFixed, toFloat, fpMul, fpDiv, fpAbs, fpSign, fpMin, fpMax, fpClamp, fpFloor, fpCeil,
    fpSqrt, fpSin, fpCos, fpAtan2,
    Vec3, vec3, vec3Zero, vec3FromFloats, vec3ToFloats, vec3Clone, vec3Add, vec3Sub,
    vec3Scale, vec3Neg, vec3Dot, vec3Cross, vec3LengthSq, vec3Length, vec3Normalize, vec3Lerp,
    vec3Distance, vec3DistanceSq,
    Quat, quatIdentity, quatFromAxisAngle, quatFromEulerY, quatMul, quatRotateVec3, quatNormalize, quatConjugate, quatClone
} from '../src/index';

console.log('=== Fixed-Point Math Unit Tests ===\n');

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
// Basic Conversion Tests
// ============================================

console.log('Test 1: Basic Conversions');

test('FP_ONE equals 65536', () => {
    return FP_ONE === 65536;
});

test('FP_HALF equals 32768', () => {
    return FP_HALF === 32768;
});

test('toFixed(1) equals FP_ONE', () => {
    return toFixed(1) === FP_ONE;
});

test('toFixed(0.5) equals FP_HALF', () => {
    return toFixed(0.5) === FP_HALF;
});

test('toFloat(FP_ONE) equals 1', () => {
    return toFloat(FP_ONE) === 1;
});

test('toFixed/toFloat roundtrip for positive float', () => {
    const original = 3.5;
    const back = toFloat(toFixed(original));
    return approxEqual(back, original);
});

test('toFixed/toFloat roundtrip for negative float', () => {
    const original = -7.25;
    const back = toFloat(toFixed(original));
    return approxEqual(back, original);
});

test('toFixed/toFloat roundtrip for zero', () => {
    return toFixed(0) === 0 && toFloat(0) === 0;
});

test('toFixed produces integer results', () => {
    return Number.isInteger(toFixed(3.14159));
});

// ============================================
// Basic Arithmetic Tests
// ============================================

console.log('\nTest 2: Basic Arithmetic');

test('Addition is exact', () => {
    const a = toFixed(1.5);
    const b = toFixed(2.5);
    return (a + b) === toFixed(4.0);
});

test('Subtraction is exact', () => {
    const a = toFixed(10);
    const b = toFixed(3);
    return (a - b) === toFixed(7);
});

test('fpMul basic multiplication', () => {
    const a = toFixed(3);
    const b = toFixed(4);
    return fpMul(a, b) === toFixed(12);
});

test('fpMul with fractions', () => {
    const a = toFixed(2.5);
    const b = toFixed(4);
    return fpMul(a, b) === toFixed(10);
});

test('fpMul with small fractions', () => {
    const a = toFixed(0.5);
    const b = toFixed(0.5);
    return fpMul(a, b) === toFixed(0.25);
});

test('fpMul with negative numbers', () => {
    const a = toFixed(-3);
    const b = toFixed(4);
    return fpMul(a, b) === toFixed(-12);
});

test('fpDiv basic division', () => {
    const a = toFixed(12);
    const b = toFixed(3);
    return fpDiv(a, b) === toFixed(4);
});

test('fpDiv with fractions', () => {
    const a = toFixed(5);
    const b = toFixed(2);
    return fpDiv(a, b) === toFixed(2.5);
});

test('fpDiv with negative numbers', () => {
    const a = toFixed(-10);
    const b = toFixed(2);
    return fpDiv(a, b) === toFixed(-5);
});

test('fpDiv by zero returns max value', () => {
    const a = toFixed(10);
    const result = fpDiv(a, 0);
    return result === 0x7FFFFFFF;
});

test('fpDiv negative by zero returns min value', () => {
    const a = toFixed(-10);
    const result = fpDiv(a, 0);
    return result === -0x7FFFFFFF;
});

// ============================================
// Utility Function Tests
// ============================================

console.log('\nTest 3: Utility Functions');

test('fpAbs of positive', () => {
    return fpAbs(toFixed(5)) === toFixed(5);
});

test('fpAbs of negative', () => {
    return fpAbs(toFixed(-5)) === toFixed(5);
});

test('fpAbs of zero', () => {
    return fpAbs(0) === 0;
});

test('fpSign of positive', () => {
    return fpSign(toFixed(10)) === FP_ONE;
});

test('fpSign of negative', () => {
    return fpSign(toFixed(-10)) === -FP_ONE;
});

test('fpSign of zero', () => {
    return fpSign(0) === 0;
});

test('fpMin returns smaller', () => {
    return fpMin(toFixed(3), toFixed(7)) === toFixed(3);
});

test('fpMax returns larger', () => {
    return fpMax(toFixed(3), toFixed(7)) === toFixed(7);
});

test('fpClamp within range', () => {
    return fpClamp(toFixed(5), toFixed(0), toFixed(10)) === toFixed(5);
});

test('fpClamp below min', () => {
    return fpClamp(toFixed(-5), toFixed(0), toFixed(10)) === toFixed(0);
});

test('fpClamp above max', () => {
    return fpClamp(toFixed(15), toFixed(0), toFixed(10)) === toFixed(10);
});

test('fpFloor rounds down', () => {
    const val = toFixed(3.7);
    const floored = fpFloor(val);
    return toFloat(floored) === 3;
});

test('fpFloor of negative rounds toward negative infinity', () => {
    const val = toFixed(-3.7);
    const floored = fpFloor(val);
    return toFloat(floored) === -4;
});

test('fpCeil rounds up', () => {
    const val = toFixed(3.2);
    const ceiled = fpCeil(val);
    return toFloat(ceiled) === 4;
});

// ============================================
// Square Root Tests
// ============================================

console.log('\nTest 4: Square Root');

test('fpSqrt of 4', () => {
    const result = fpSqrt(toFixed(4));
    return approxEqual(toFloat(result), 2, 0.01);
});

test('fpSqrt of 9', () => {
    const result = fpSqrt(toFixed(9));
    return approxEqual(toFloat(result), 3, 0.01);
});

test('fpSqrt of 16', () => {
    const result = fpSqrt(toFixed(16));
    return approxEqual(toFloat(result), 4, 0.01);
});

test('fpSqrt of 2', () => {
    const result = fpSqrt(toFixed(2));
    return approxEqual(toFloat(result), Math.sqrt(2), 0.01);
});

test('fpSqrt of 0', () => {
    return fpSqrt(0) === 0;
});

test('fpSqrt of negative returns 0', () => {
    return fpSqrt(toFixed(-1)) === 0;
});

test('fpSqrt is deterministic', () => {
    const val = toFixed(17);
    return fpSqrt(val) === fpSqrt(val);
});

// ============================================
// Trigonometry Tests
// ============================================

console.log('\nTest 5: Trigonometry');

test('fpSin of 0 is 0', () => {
    return fpSin(0) === 0;
});

test('fpCos of 0 is 1', () => {
    // Use approximate comparison due to lookup table precision
    return approxEqual(toFloat(fpCos(0)), 1, 0.001);
});

test('fpSin of PI/2 is 1', () => {
    const result = fpSin(FP_HALF_PI);
    return approxEqual(toFloat(result), 1, 0.01);
});

test('fpCos of PI/2 is 0', () => {
    const result = fpCos(FP_HALF_PI);
    return approxEqual(toFloat(result), 0, 0.01);
});

test('fpSin of PI is 0', () => {
    const result = fpSin(FP_PI);
    return approxEqual(toFloat(result), 0, 0.01);
});

test('fpCos of PI is -1', () => {
    const result = fpCos(FP_PI);
    return approxEqual(toFloat(result), -1, 0.01);
});

test('sin^2 + cos^2 = 1 identity', () => {
    const angle = toFixed(0.7);
    const s = fpSin(angle);
    const c = fpCos(angle);
    const sumSq = fpMul(s, s) + fpMul(c, c);
    return approxEqual(toFloat(sumSq), 1, 0.02);
});

test('fpSin is deterministic', () => {
    const angle = toFixed(1.234);
    return fpSin(angle) === fpSin(angle);
});

test('fpCos is deterministic', () => {
    const angle = toFixed(2.345);
    return fpCos(angle) === fpCos(angle);
});

test('fpSin handles negative angles', () => {
    const result = fpSin(toFixed(-Math.PI / 2));
    return approxEqual(toFloat(result), -1, 0.02);
});

test('fpSin handles large angles (wrap around)', () => {
    const angle = toFixed(2 * Math.PI + Math.PI / 2);
    const result = fpSin(angle);
    return approxEqual(toFloat(result), 1, 0.02);
});

test('fpAtan2 basic quadrant 1', () => {
    const result = fpAtan2(FP_ONE, FP_ONE);
    return approxEqual(toFloat(result), Math.PI / 4, 0.1);
});

test('fpAtan2 zero inputs', () => {
    return fpAtan2(0, 0) === 0;
});

// ============================================
// Vector3 Tests
// ============================================

console.log('\nTest 6: Vector3 Operations');

test('vec3Zero creates zero vector', () => {
    const v = vec3Zero();
    return v.x === 0 && v.y === 0 && v.z === 0;
});

test('vec3 creates vector with fixed values', () => {
    const v = vec3(FP_ONE, FP_ONE * 2, FP_ONE * 3);
    return v.x === FP_ONE && v.y === FP_ONE * 2 && v.z === FP_ONE * 3;
});

test('vec3FromFloats converts correctly', () => {
    const v = vec3FromFloats(1, 2, 3);
    return v.x === toFixed(1) && v.y === toFixed(2) && v.z === toFixed(3);
});

test('vec3ToFloats converts back', () => {
    const v = vec3FromFloats(1.5, 2.5, 3.5);
    const f = vec3ToFloats(v);
    return approxEqual(f.x, 1.5) && approxEqual(f.y, 2.5) && approxEqual(f.z, 3.5);
});

test('vec3Clone creates independent copy', () => {
    const v = vec3FromFloats(1, 2, 3);
    const clone = vec3Clone(v);
    clone.x = 0;
    return v.x === toFixed(1);
});

test('vec3Add adds vectors', () => {
    const a = vec3FromFloats(1, 2, 3);
    const b = vec3FromFloats(4, 5, 6);
    const result = vec3Add(a, b);
    return result.x === toFixed(5) && result.y === toFixed(7) && result.z === toFixed(9);
});

test('vec3Sub subtracts vectors', () => {
    const a = vec3FromFloats(5, 7, 9);
    const b = vec3FromFloats(1, 2, 3);
    const result = vec3Sub(a, b);
    return result.x === toFixed(4) && result.y === toFixed(5) && result.z === toFixed(6);
});

test('vec3Scale scales vector', () => {
    const v = vec3FromFloats(1, 2, 3);
    const result = vec3Scale(v, toFixed(2));
    return result.x === toFixed(2) && result.y === toFixed(4) && result.z === toFixed(6);
});

test('vec3Neg negates vector', () => {
    const v = vec3FromFloats(1, -2, 3);
    const result = vec3Neg(v);
    return result.x === toFixed(-1) && result.y === toFixed(2) && result.z === toFixed(-3);
});

test('vec3Dot computes dot product', () => {
    const a = vec3FromFloats(1, 2, 3);
    const b = vec3FromFloats(4, 5, 6);
    const result = vec3Dot(a, b);
    // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    return result === toFixed(32);
});

test('vec3Cross computes cross product', () => {
    const a = vec3FromFloats(1, 0, 0);
    const b = vec3FromFloats(0, 1, 0);
    const result = vec3Cross(a, b);
    // i x j = k
    return result.x === 0 && result.y === 0 && result.z === toFixed(1);
});

test('vec3LengthSq computes squared length', () => {
    const v = vec3FromFloats(3, 4, 0);
    const result = vec3LengthSq(v);
    return result === toFixed(25);
});

test('vec3Length computes length', () => {
    const v = vec3FromFloats(3, 4, 0);
    const result = vec3Length(v);
    return approxEqual(toFloat(result), 5, 0.01);
});

test('vec3Normalize normalizes vector', () => {
    const v = vec3FromFloats(3, 0, 0);
    const result = vec3Normalize(v);
    return approxEqual(toFloat(result.x), 1, 0.01) && result.y === 0 && result.z === 0;
});

test('vec3Normalize of zero vector returns zero', () => {
    const v = vec3Zero();
    const result = vec3Normalize(v);
    return result.x === 0 && result.y === 0 && result.z === 0;
});

test('vec3Lerp interpolates', () => {
    const a = vec3FromFloats(0, 0, 0);
    const b = vec3FromFloats(10, 20, 30);
    const result = vec3Lerp(a, b, FP_HALF);
    return approxEqual(toFloat(result.x), 5, 0.01) &&
           approxEqual(toFloat(result.y), 10, 0.01) &&
           approxEqual(toFloat(result.z), 15, 0.01);
});

test('vec3Distance computes distance', () => {
    const a = vec3FromFloats(0, 0, 0);
    const b = vec3FromFloats(3, 4, 0);
    const result = vec3Distance(a, b);
    return approxEqual(toFloat(result), 5, 0.01);
});

test('vec3DistanceSq computes squared distance', () => {
    const a = vec3FromFloats(0, 0, 0);
    const b = vec3FromFloats(3, 4, 0);
    const result = vec3DistanceSq(a, b);
    return result === toFixed(25);
});

// ============================================
// Quaternion Tests
// ============================================

console.log('\nTest 7: Quaternion Operations');

test('quatIdentity creates identity quaternion', () => {
    const q = quatIdentity();
    return q.x === 0 && q.y === 0 && q.z === 0 && q.w === FP_ONE;
});

test('quatClone creates independent copy', () => {
    const q = quatIdentity();
    const clone = quatClone(q);
    clone.w = 0;
    return q.w === FP_ONE;
});

test('quatConjugate negates xyz', () => {
    const q = { x: toFixed(1), y: toFixed(2), z: toFixed(3), w: toFixed(4) };
    const conj = quatConjugate(q);
    return conj.x === toFixed(-1) && conj.y === toFixed(-2) && conj.z === toFixed(-3) && conj.w === toFixed(4);
});

test('quatFromAxisAngle creates rotation', () => {
    const axis = vec3FromFloats(0, 1, 0);
    const angle = FP_PI;
    const q = quatFromAxisAngle(axis, angle);
    // Should be close to (0, 1, 0, 0) for 180 degree rotation around Y
    return approxEqual(toFloat(q.y), 1, 0.1) && approxEqual(toFloat(q.w), 0, 0.1);
});

test('quatFromEulerY creates Y rotation', () => {
    const q = quatFromEulerY(FP_PI);
    // 180 degree rotation around Y
    return approxEqual(toFloat(q.y), 1, 0.1) && approxEqual(toFloat(q.w), 0, 0.1);
});

test('quatMul identity preserves quaternion', () => {
    const q = quatFromEulerY(FP_HALF_PI);
    const id = quatIdentity();
    const result = quatMul(q, id);
    return result.x === q.x && result.y === q.y && result.z === q.z && result.w === q.w;
});

test('quatNormalize normalizes quaternion', () => {
    const q = { x: FP_ONE, y: FP_ONE, z: FP_ONE, w: FP_ONE };
    const norm = quatNormalize(q);
    const lenSq = fpMul(norm.x, norm.x) + fpMul(norm.y, norm.y) +
                  fpMul(norm.z, norm.z) + fpMul(norm.w, norm.w);
    return approxEqual(toFloat(lenSq), 1, 0.02);
});

test('quatRotateVec3 rotates vector', () => {
    const q = quatFromEulerY(FP_HALF_PI); // 90 degrees around Y
    const v = vec3FromFloats(1, 0, 0);
    const result = quatRotateVec3(q, v);
    // X axis rotated 90 degrees around Y should give -Z
    return approxEqual(toFloat(result.x), 0, 0.1) &&
           approxEqual(toFloat(result.y), 0, 0.1) &&
           approxEqual(toFloat(result.z), -1, 0.2);
});

// ============================================
// Determinism Tests
// ============================================

console.log('\nTest 8: Determinism Verification');

test('Same multiplication inputs always produce same output', () => {
    const a = toFixed(3.14159);
    const b = toFixed(2.71828);
    const results = new Set<number>();
    for (let i = 0; i < 1000; i++) {
        results.add(fpMul(a, b));
    }
    return results.size === 1;
});

test('Same division inputs always produce same output', () => {
    const a = toFixed(10.5);
    const b = toFixed(3.7);
    const results = new Set<number>();
    for (let i = 0; i < 1000; i++) {
        results.add(fpDiv(a, b));
    }
    return results.size === 1;
});

test('Same sqrt inputs always produce same output', () => {
    const v = toFixed(7.5);
    const results = new Set<number>();
    for (let i = 0; i < 1000; i++) {
        results.add(fpSqrt(v));
    }
    return results.size === 1;
});

test('Same trig inputs always produce same output', () => {
    const angle = toFixed(1.234);
    const sinResults = new Set<number>();
    const cosResults = new Set<number>();
    for (let i = 0; i < 1000; i++) {
        sinResults.add(fpSin(angle));
        cosResults.add(fpCos(angle));
    }
    return sinResults.size === 1 && cosResults.size === 1;
});

test('Complex calculation is deterministic', () => {
    function complexCalc() {
        let result = toFixed(1);
        for (let i = 0; i < 100; i++) {
            const angle = fpMul(result, toFixed(0.1));
            const s = fpSin(angle);
            const c = fpCos(angle);
            result = fpMul(s, c) + fpDiv(result, toFixed(2));
        }
        return result;
    }
    const r1 = complexCalc();
    const r2 = complexCalc();
    return r1 === r2;
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll fixed-math tests passed!');
    process.exit(0);
}
