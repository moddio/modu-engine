/**
 * Late Joiner Snapshot Test
 *
 * Verifies that loadWorldState2D can CREATE bodies from scratch
 * (not just update existing ones). This is critical for late joiners
 * who have an empty world.
 */

import { physics2d } from '../src/index';

const {
  createWorld2D, saveWorldState2D, loadWorldState2D, addBody2D,
  createCircle, createBody2D, resetBody2DIdCounter, BodyType2D
} = physics2d;

console.log('=== Late Joiner Snapshot Test ===');
console.log('Testing: Create bodies from scratch using snapshot\n');

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
  } catch (e: any) {
    console.log(`  FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

// Create source world with multiple body types
resetBody2DIdCounter();
const sourceWorld = createWorld2D(1/20);

const player1 = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 100, 200, 'player_A');
player1.userData = { health: 80, name: 'Alice' };
addBody2D(sourceWorld, player1);

const player2 = createBody2D(BodyType2D.Dynamic, createCircle(0.5), 300, 400, 'player_B');
player2.userData = { health: 100, name: 'Bob' };
addBody2D(sourceWorld, player2);

const food1 = createBody2D(BodyType2D.Static, createCircle(0.15), 50, 50, 'food_1');
food1.userData = { color: '#ff0000' };
addBody2D(sourceWorld, food1);

const food2 = createBody2D(BodyType2D.Static, createCircle(0.15), 150, 75, 'food_2');
food2.userData = { color: '#00ff00' };
addBody2D(sourceWorld, food2);

console.log('Phase 1: Create source world');
test('Source world has 4 bodies', () => sourceWorld.bodies.length === 4);

// Save snapshot
const snapshot = saveWorldState2D(sourceWorld);

console.log('\nPhase 2: Verify snapshot contents');
test('Snapshot has 4 bodies', () => snapshot.bodies.length === 4);
test('Snapshot includes player_A', () => snapshot.bodies.some(b => b.label === 'player_A'));
test('Snapshot includes player_B', () => snapshot.bodies.some(b => b.label === 'player_B'));
test('Snapshot includes food_1', () => snapshot.bodies.some(b => b.label === 'food_1'));
test('Snapshot includes food_2', () => snapshot.bodies.some(b => b.label === 'food_2'));
test('Snapshot preserves userData', () => {
  const p1 = snapshot.bodies.find(b => b.label === 'player_A');
  return p1 && p1.userData && p1.userData.health === 80;
});
test('Snapshot preserves shape', () => {
  const p1 = snapshot.bodies.find(b => b.label === 'player_A');
  return p1 && p1.shape && p1.shape.radius !== undefined;
});

// Create EMPTY world (like a late joiner)
console.log('\nPhase 3: Load snapshot into EMPTY world (late joiner scenario)');
const targetWorld = createWorld2D(1/20);
test('Target world starts empty', () => targetWorld.bodies.length === 0);

// Load snapshot into empty world
loadWorldState2D(targetWorld, snapshot);

test('Target world now has 4 bodies', () => targetWorld.bodies.length === 4);

// Verify all bodies were created correctly
console.log('\nPhase 4: Verify body reconstruction');
for (const srcBody of sourceWorld.bodies) {
  const tgtBody = targetWorld.bodies.find(b => b.label === srcBody.label);

  test(`Body ${srcBody.label} exists in target`, () => !!tgtBody);

  if (tgtBody) {
    test(`${srcBody.label} position matches`, () =>
      tgtBody.position.x === srcBody.position.x &&
      tgtBody.position.y === srcBody.position.y
    );

    test(`${srcBody.label} type matches`, () => tgtBody.type === srcBody.type);

    test(`${srcBody.label} userData matches`, () =>
      JSON.stringify(tgtBody.userData) === JSON.stringify(srcBody.userData)
    );

    test(`${srcBody.label} has valid shape`, () =>
      tgtBody.shape && tgtBody.shape.type !== undefined
    );
  }
}

// Test that we can simulate after loading
console.log('\nPhase 5: Verify simulation works after load');
test('Can step target world after load', () => {
  for (let i = 0; i < 10; i++) {
    physics2d.stepWorld2D(targetWorld);
  }
  return true;
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\nLate joiner snapshot restoration BROKEN!');
  process.exit(1);
} else {
  console.log('\nLate joiner snapshot restoration works correctly!');
  process.exit(0);
}
