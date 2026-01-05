/**
 * Engine Determinism Tests
 *
 * Verifies that physics simulations produce identical results
 * across multiple runs with the same inputs.
 */

import {
  toFixed, toFloat, fpMul, fpDiv, fpSin, fpCos, fpSqrt, FP_ONE, FP_PI,
  vec3, vec3Add, vec3FromFloats,
  createWorld, createBody, createBox, addBody, stepWorld,
  saveWorldState, loadWorldState, resetBodyIdCounter
} from '../src/index';

console.log('=== Engine Determinism Tests ===\n');

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

// Test 1: Fixed-point math is deterministic
console.log('Test 1: Fixed-Point Math');

test('toFixed/toFloat roundtrip', () => {
  const original = 3.5;
  const fixed = toFixed(original);
  const back = toFloat(fixed);
  return Math.abs(back - original) < 0.0001;
});

test('Addition is exact', () => {
  const a = toFixed(1.5);
  const b = toFixed(2.5);
  const result = a + b; // Fixed-point addition is regular addition
  return result === toFixed(4.0);
});

test('Multiplication is deterministic', () => {
  const a = toFixed(3.0);
  const b = toFixed(4.0);
  const result1 = fpMul(a, b);
  const result2 = fpMul(a, b);
  return result1 === result2 && result1 === toFixed(12.0);
});

test('Division is deterministic', () => {
  const a = toFixed(10.0);
  const b = toFixed(2.0);
  const result1 = fpDiv(a, b);
  const result2 = fpDiv(a, b);
  return result1 === result2 && result1 === toFixed(5.0);
});

test('Sin/Cos are deterministic', () => {
  const angle = Math.floor(FP_PI / 4); // 45 degrees (must be integer for fixed-point)
  const sin1 = fpSin(angle);
  const sin2 = fpSin(angle);
  const cos1 = fpCos(angle);
  const cos2 = fpCos(angle);
  return sin1 === sin2 && cos1 === cos2;
});

test('Square root is deterministic', () => {
  const value = toFixed(16.0);
  const sqrt1 = fpSqrt(value);
  const sqrt2 = fpSqrt(value);
  return sqrt1 === sqrt2 && Math.abs(toFloat(sqrt1) - 4.0) < 0.01;
});

// Test 2: Physics world is deterministic
console.log('\nTest 2: Physics World');

function runPhysicsSimulation(steps: number): number {
  resetBodyIdCounter(); // Reset for deterministic body IDs
  const world = createWorld(1/60);
  const box = createBody('dynamic', createBox(0.5, 0.5, 0.5), 0, 10, 0, 'testBox');
  addBody(world, box);

  for (let i = 0; i < steps; i++) {
    stepWorld(world);
  }

  return box.position.y;
}

test('Same inputs produce same output', () => {
  const result1 = runPhysicsSimulation(100);
  const result2 = runPhysicsSimulation(100);
  return result1 === result2;
});

test('Simulation produces valid fixed-point positions', () => {
  const result = runPhysicsSimulation(10);
  // Position should be a valid fixed-point integer
  return Number.isInteger(result) && result !== 0;
});

// Test 3: State save/load
console.log('\nTest 3: State Save/Load');

test('Can save and load world state', () => {
  resetBodyIdCounter();
  const world = createWorld(1/60);
  const box = createBody('dynamic', createBox(0.5, 0.5, 0.5), 5, 10, -3, 'testBox');
  addBody(world, box);

  // Step once
  stepWorld(world);

  // Save state
  const state = saveWorldState(world);
  const savedY = box.position.y;

  // Verify state was captured
  return state.bodies && state.bodies.length > 0 && savedY !== 0;
});

test('State restore produces deterministic continuation', () => {
  resetBodyIdCounter();
  const world = createWorld(1/60);
  const box = createBody('dynamic', createBox(0.5, 0.5, 0.5), 0, 10, 0, 'testBox');
  addBody(world, box);

  // Step to frame 50
  for (let i = 0; i < 50; i++) {
    stepWorld(world);
  }
  const state = saveWorldState(world);

  // Continue to frame 100
  for (let i = 0; i < 50; i++) {
    stepWorld(world);
  }
  const finalY1 = box.position.y;

  // Restore and continue again
  loadWorldState(world, state);
  for (let i = 0; i < 50; i++) {
    stepWorld(world);
  }
  const finalY2 = box.position.y;

  return finalY1 === finalY2;
});

// Test 4: Vector math
console.log('\nTest 4: Vector Math');

test('Vector addition is exact', () => {
  const a = vec3FromFloats(1, 2, 3);
  const b = vec3FromFloats(4, 5, 6);
  const result = vec3Add(a, b);
  return result.x === toFixed(5) && result.y === toFixed(7) && result.z === toFixed(9);
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
