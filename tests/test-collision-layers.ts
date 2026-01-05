/**
 * Collision Layers Unit Tests
 *
 * Comprehensive tests for the collision filtering system.
 * Verifies layer bitmasks and collision checks.
 */

import {
    CollisionFilter, Layers, DEFAULT_FILTER,
    createFilter, shouldCollide, filterCollidingWith, filterExcluding
} from '../src/index';

console.log('=== Collision Layers Unit Tests ===\n');

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
// Layer Constants Tests
// ============================================

console.log('Test 1: Layer Constants');

test('Layers.NONE is 0', () => {
    return Layers.NONE === 0;
});

test('Layers.DEFAULT is bit 0', () => {
    return Layers.DEFAULT === 1;
});

test('Layers.PLAYER is bit 1', () => {
    return Layers.PLAYER === 2;
});

test('Layers.ENEMY is bit 2', () => {
    return Layers.ENEMY === 4;
});

test('Layers.PROJECTILE is bit 3', () => {
    return Layers.PROJECTILE === 8;
});

test('Layers.ITEM is bit 4', () => {
    return Layers.ITEM === 16;
});

test('Layers.TRIGGER is bit 5', () => {
    return Layers.TRIGGER === 32;
});

test('Layers.WORLD is bit 6', () => {
    return Layers.WORLD === 64;
});

test('Layers.PROP is bit 7', () => {
    return Layers.PROP === 128;
});

test('Layers.ALL is 0xFFFF', () => {
    return Layers.ALL === 0xFFFF;
});

test('All standard layers are unique', () => {
    const layers = [
        Layers.DEFAULT, Layers.PLAYER, Layers.ENEMY, Layers.PROJECTILE,
        Layers.ITEM, Layers.TRIGGER, Layers.WORLD, Layers.PROP
    ];
    const set = new Set(layers);
    return set.size === layers.length;
});

test('Custom layers are defined', () => {
    return Layers.CUSTOM_1 === 256 &&
           Layers.CUSTOM_2 === 512 &&
           Layers.CUSTOM_8 === 32768;
});

// ============================================
// DEFAULT_FILTER Tests
// ============================================

console.log('\nTest 2: DEFAULT_FILTER');

test('DEFAULT_FILTER has DEFAULT layer', () => {
    return DEFAULT_FILTER.layer === Layers.DEFAULT;
});

test('DEFAULT_FILTER has ALL mask', () => {
    return DEFAULT_FILTER.mask === Layers.ALL;
});

// ============================================
// createFilter Tests
// ============================================

console.log('\nTest 3: createFilter');

test('createFilter creates filter with layer', () => {
    const filter = createFilter(Layers.PLAYER);
    return filter.layer === Layers.PLAYER;
});

test('createFilter defaults to ALL mask', () => {
    const filter = createFilter(Layers.PLAYER);
    return filter.mask === Layers.ALL;
});

test('createFilter accepts custom mask', () => {
    const filter = createFilter(Layers.PLAYER, Layers.ENEMY | Layers.PROJECTILE);
    return filter.mask === (Layers.ENEMY | Layers.PROJECTILE);
});

test('createFilter accepts NONE mask', () => {
    const filter = createFilter(Layers.PLAYER, Layers.NONE);
    return filter.mask === Layers.NONE;
});

// ============================================
// shouldCollide Tests
// ============================================

console.log('\nTest 4: shouldCollide');

test('Same layer collides with ALL mask', () => {
    const a = createFilter(Layers.PLAYER, Layers.ALL);
    const b = createFilter(Layers.PLAYER, Layers.ALL);
    return shouldCollide(a, b) === true;
});

test('Different layers collide with ALL mask', () => {
    const a = createFilter(Layers.PLAYER, Layers.ALL);
    const b = createFilter(Layers.ENEMY, Layers.ALL);
    return shouldCollide(a, b) === true;
});

test('No collision with NONE mask', () => {
    const a = createFilter(Layers.PLAYER, Layers.NONE);
    const b = createFilter(Layers.ENEMY, Layers.ALL);
    return shouldCollide(a, b) === false;
});

test('Collision requires both masks to include other layer', () => {
    // A can collide with ENEMY, but B cannot collide with PLAYER
    const a = createFilter(Layers.PLAYER, Layers.ENEMY);
    const b = createFilter(Layers.ENEMY, Layers.PROJECTILE);
    return shouldCollide(a, b) === false;
});

test('Symmetric collision - both masks include other', () => {
    const a = createFilter(Layers.PLAYER, Layers.ENEMY);
    const b = createFilter(Layers.ENEMY, Layers.PLAYER);
    return shouldCollide(a, b) === true;
});

test('DEFAULT_FILTER collides with everything', () => {
    const enemy = createFilter(Layers.ENEMY, Layers.ALL);
    const player = createFilter(Layers.PLAYER, Layers.ALL);
    const item = createFilter(Layers.ITEM, Layers.ALL);
    return shouldCollide(DEFAULT_FILTER, enemy) &&
           shouldCollide(DEFAULT_FILTER, player) &&
           shouldCollide(DEFAULT_FILTER, item);
});

// ============================================
// filterCollidingWith Tests
// ============================================

console.log('\nTest 5: filterCollidingWith');

test('filterCollidingWith creates filter with specific mask', () => {
    const filter = filterCollidingWith(Layers.PLAYER, Layers.ENEMY);
    return filter.layer === Layers.PLAYER &&
           filter.mask === Layers.ENEMY;
});

test('filterCollidingWith with multiple layers', () => {
    const filter = filterCollidingWith(Layers.PLAYER, Layers.ENEMY, Layers.PROJECTILE, Layers.WORLD);
    return filter.mask === (Layers.ENEMY | Layers.PROJECTILE | Layers.WORLD);
});

test('filterCollidingWith with no layers is NONE mask', () => {
    const filter = filterCollidingWith(Layers.PLAYER);
    return filter.mask === Layers.NONE;
});

test('filterCollidingWith player collides with enemy', () => {
    const player = filterCollidingWith(Layers.PLAYER, Layers.ENEMY, Layers.WORLD);
    const enemy = filterCollidingWith(Layers.ENEMY, Layers.PLAYER, Layers.PROJECTILE);
    return shouldCollide(player, enemy) === true;
});

test('filterCollidingWith player does not collide with item', () => {
    const player = filterCollidingWith(Layers.PLAYER, Layers.ENEMY, Layers.WORLD);
    const item = filterCollidingWith(Layers.ITEM, Layers.PLAYER, Layers.WORLD);
    // Player mask doesn't include ITEM
    return shouldCollide(player, item) === false;
});

// ============================================
// filterExcluding Tests
// ============================================

console.log('\nTest 6: filterExcluding');

test('filterExcluding creates filter excluding layer', () => {
    const filter = filterExcluding(Layers.PLAYER, Layers.TRIGGER);
    // Should have all bits set except TRIGGER
    return (filter.mask & Layers.TRIGGER) === 0;
});

test('filterExcluding keeps other layers', () => {
    const filter = filterExcluding(Layers.PLAYER, Layers.TRIGGER);
    return (filter.mask & Layers.ENEMY) === Layers.ENEMY &&
           (filter.mask & Layers.WORLD) === Layers.WORLD;
});

test('filterExcluding multiple layers', () => {
    const filter = filterExcluding(Layers.PLAYER, Layers.TRIGGER, Layers.ITEM);
    return (filter.mask & Layers.TRIGGER) === 0 &&
           (filter.mask & Layers.ITEM) === 0 &&
           (filter.mask & Layers.ENEMY) === Layers.ENEMY;
});

test('filterExcluding with no exclusions is ALL', () => {
    const filter = filterExcluding(Layers.PLAYER);
    return filter.mask === Layers.ALL;
});

test('filterExcluding player avoids triggers', () => {
    const player = filterExcluding(Layers.PLAYER, Layers.TRIGGER);
    const trigger = createFilter(Layers.TRIGGER, Layers.ALL);
    return shouldCollide(player, trigger) === false;
});

// ============================================
// Complex Scenarios Tests
// ============================================

console.log('\nTest 7: Complex Scenarios');

test('Player-Enemy collision setup', () => {
    // Player collides with enemies and world
    const player = filterCollidingWith(Layers.PLAYER, Layers.ENEMY, Layers.WORLD);
    // Enemy collides with player, projectiles, and world
    const enemy = filterCollidingWith(Layers.ENEMY, Layers.PLAYER, Layers.PROJECTILE, Layers.WORLD);
    // Ground collides with everything
    const world = createFilter(Layers.WORLD, Layers.ALL);

    return shouldCollide(player, enemy) === true &&
           shouldCollide(player, world) === true &&
           shouldCollide(enemy, world) === true;
});

test('Projectile piercing setup', () => {
    // Projectile only hits enemies, not player
    const projectile = filterCollidingWith(Layers.PROJECTILE, Layers.ENEMY);
    const player = filterCollidingWith(Layers.PLAYER, Layers.ENEMY, Layers.WORLD);
    const enemy = filterCollidingWith(Layers.ENEMY, Layers.PLAYER, Layers.PROJECTILE);

    return shouldCollide(projectile, enemy) === true &&
           shouldCollide(projectile, player) === false;
});

test('Item pickup setup', () => {
    // Items only collide with players
    const item = filterCollidingWith(Layers.ITEM, Layers.PLAYER);
    // Player can collect items
    const player = filterCollidingWith(Layers.PLAYER, Layers.ENEMY, Layers.WORLD, Layers.ITEM);
    // Enemies ignore items
    const enemy = filterCollidingWith(Layers.ENEMY, Layers.PLAYER, Layers.WORLD);

    return shouldCollide(item, player) === true &&
           shouldCollide(item, enemy) === false;
});

test('Trigger zone setup', () => {
    // Trigger detects player and enemy
    const trigger = filterCollidingWith(Layers.TRIGGER, Layers.PLAYER, Layers.ENEMY);
    const player = filterCollidingWith(Layers.PLAYER, Layers.TRIGGER, Layers.WORLD);
    const enemy = filterCollidingWith(Layers.ENEMY, Layers.TRIGGER, Layers.WORLD);
    const projectile = filterCollidingWith(Layers.PROJECTILE, Layers.ENEMY);

    return shouldCollide(trigger, player) === true &&
           shouldCollide(trigger, enemy) === true &&
           shouldCollide(trigger, projectile) === false;
});

test('One-way collision (A hits B but B ignores A)', () => {
    // This shouldn't allow collision due to symmetric requirement
    const attacker = filterCollidingWith(Layers.CUSTOM_1, Layers.CUSTOM_2);
    const target = filterCollidingWith(Layers.CUSTOM_2); // mask = NONE

    return shouldCollide(attacker, target) === false;
});

// ============================================
// Bitwise Operation Tests
// ============================================

console.log('\nTest 8: Bitwise Operations');

test('Combining layers with OR', () => {
    const combined = Layers.PLAYER | Layers.ENEMY | Layers.PROJECTILE;
    return (combined & Layers.PLAYER) !== 0 &&
           (combined & Layers.ENEMY) !== 0 &&
           (combined & Layers.PROJECTILE) !== 0 &&
           (combined & Layers.WORLD) === 0;
});

test('Removing layer with AND NOT', () => {
    const all = Layers.ALL;
    const noPlayer = all & ~Layers.PLAYER;
    return (noPlayer & Layers.PLAYER) === 0 &&
           (noPlayer & Layers.ENEMY) !== 0;
});

test('Checking layer membership', () => {
    const mask = Layers.PLAYER | Layers.ENEMY;
    return (mask & Layers.PLAYER) === Layers.PLAYER &&
           (mask & Layers.ENEMY) === Layers.ENEMY &&
           (mask & Layers.WORLD) === 0;
});

// ============================================
// Determinism Tests
// ============================================

console.log('\nTest 9: Determinism');

test('shouldCollide is deterministic', () => {
    const a = createFilter(Layers.PLAYER, Layers.ENEMY | Layers.WORLD);
    const b = createFilter(Layers.ENEMY, Layers.PLAYER | Layers.PROJECTILE);

    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
        results.push(shouldCollide(a, b));
    }

    return results.every(r => r === results[0]);
});

test('Filter creation is deterministic', () => {
    const filters: CollisionFilter[] = [];
    for (let i = 0; i < 10; i++) {
        filters.push(filterCollidingWith(Layers.PLAYER, Layers.ENEMY, Layers.WORLD));
    }

    return filters.every(f =>
        f.layer === filters[0].layer &&
        f.mask === filters[0].mask
    );
});

// ============================================
// Edge Cases Tests
// ============================================

console.log('\nTest 10: Edge Cases');

test('NONE layer never collides', () => {
    const none = createFilter(Layers.NONE, Layers.ALL);
    const all = createFilter(Layers.ALL, Layers.ALL);
    return shouldCollide(none, all) === false;
});

test('Two NONE layers do not collide', () => {
    const a = createFilter(Layers.NONE, Layers.ALL);
    const b = createFilter(Layers.NONE, Layers.ALL);
    return shouldCollide(a, b) === false;
});

test('Same filter collides with itself', () => {
    const filter = createFilter(Layers.PLAYER, Layers.PLAYER);
    return shouldCollide(filter, filter) === true;
});

test('ALL layer collides with ALL', () => {
    const a = createFilter(Layers.ALL, Layers.ALL);
    const b = createFilter(Layers.ALL, Layers.ALL);
    return shouldCollide(a, b) === true;
});

test('Filter with own layer excluded does not self-collide', () => {
    const filter = filterExcluding(Layers.PLAYER, Layers.PLAYER);
    return shouldCollide(filter, filter) === false;
});

test('Multiple custom layers work', () => {
    const a = filterCollidingWith(Layers.CUSTOM_1, Layers.CUSTOM_2, Layers.CUSTOM_3);
    const b = filterCollidingWith(Layers.CUSTOM_2, Layers.CUSTOM_1);
    const c = filterCollidingWith(Layers.CUSTOM_3, Layers.CUSTOM_1);

    return shouldCollide(a, b) === true &&
           shouldCollide(a, c) === true &&
           shouldCollide(b, c) === false;
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll collision layer tests passed!');
    process.exit(0);
}
