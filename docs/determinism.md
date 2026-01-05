# Determinism Guide

Modu Engine uses deterministic lockstep networking. This means **all clients must compute exactly the same state** given the same inputs. Any deviation causes desync - players see different game states.

## The Golden Rule

> Same inputs + same code = same state

If this rule is violated, players will desync. The engine cannot correct for non-deterministic simulation.

## Determinism Guard

Enable the debug UI to automatically catch common mistakes:

```javascript
Modu.enableDebugUI(game);
```

The guard warns you when dangerous functions are called during simulation:

```
⚠️ Math.sqrt() is non-deterministic!
   Use dSqrt() instead for deterministic square root.
   Example: const dist = dSqrt(dx * dx + dy * dy);
```

## Quick Reference

| Non-Deterministic | Deterministic Alternative |
|-------------------|---------------------------|
| `Math.random()` | `dRandom()` |
| `Math.sqrt(x)` | `dSqrt(x)` |
| `Date.now()` | `game.time` |
| `game.frame` | `game.time` (more intuitive) |
| `performance.now()` | `game.time` |

## Common Pitfalls

### 1. Using `Math.random()`

**BAD:**
```javascript
game.addSystem(() => {
    if (Math.random() < 0.1) {
        spawnEnemy();  // Different on each client!
    }
});
```

**GOOD:**
```javascript
game.addSystem(() => {
    if (dRandom() < 0.1) {
        spawnEnemy();  // Same on all clients
    }
});
```

`dRandom()` is seeded and produces the same sequence on all clients.

### 2. Using `Math.sqrt()`

**BAD:**
```javascript
game.addSystem(() => {
    const dx = target.x - entity.get(Transform2D).x;
    const dy = target.y - entity.get(Transform2D).y;
    const dist = Math.sqrt(dx * dx + dy * dy);  // Non-deterministic!
});
```

**GOOD:**
```javascript
game.addSystem(() => {
    const dx = target.x - entity.get(Transform2D).x;
    const dy = target.y - entity.get(Transform2D).y;
    const dist = dSqrt(dx * dx + dy * dy);  // Deterministic!
});
```

`dSqrt()` uses fixed-point math internally for cross-platform determinism.

**Even Better** - use entity helpers:
```javascript
const dist = entity.distanceTo(target);  // Deterministic distance
entity.moveTowards(target, speed);        // Deterministic movement
```

### 3. Using Wall-Clock Time

**BAD:**
```javascript
let lastSpawn = Date.now();

game.addSystem(() => {
    if (Date.now() - lastSpawn > 5000) {
        spawnItem();  // Timing differs per client!
        lastSpawn = Date.now();
    }
});
```

**GOOD:**
```javascript
const SPAWN_INTERVAL = 5000;  // 5 seconds in milliseconds
let lastSpawnTime = 0;

game.addSystem(() => {
    if (game.time - lastSpawnTime >= SPAWN_INTERVAL) {
        spawnItem();
        lastSpawnTime = game.time;
    }
});
```

`game.time` returns deterministic time in milliseconds. Much more intuitive than counting frames!

### 4. Division with Floats

Division itself is fine, but **the result must not be used for position/physics calculations**:

**BAD:**
```javascript
// Float division result used for movement - non-deterministic!
const dx = target.x - pos.x;
const dy = target.y - pos.y;
const dist = dSqrt(dx * dx + dy * dy);
const vx = (dx / dist) * speed;  // Float division
const vy = (dy / dist) * speed;
entity.get(Transform2D).x += vx;  // Desync!
```

**GOOD:**
```javascript
// Use entity helpers - they handle the math deterministically
entity.moveTowards(target, speed);
```

**Also GOOD:**
```javascript
// For bullets/projectiles, use moveTowards after spawning
const bullet = game.spawn('bullet', { x, y });
bullet.moveTowards(target, BULLET_SPEED);
```

**Safe divisions:**
```javascript
// Constants computed at load time are fine
const SEGMENT_FRAMES = SEGMENT_SPACING / SNAKE_SPEED;  // Computed once

// Integer-like divisions are fine
const halfWidth = WIDTH / 2;  // Simple constant division

// Ratios for scaling are fine if not used for physics
const healthPercent = health.current / health.max;
```

### 5. Manual Position Math

**BAD:**
```javascript
// Manual math causes desync - float results vary across platforms
const dx = target.x - entity.get(Transform2D).x;
const dy = target.y - entity.get(Transform2D).y;
const dist = dSqrt(dx * dx + dy * dy);
entity.get(Transform2D).x += (dx / dist) * speed;
entity.get(Transform2D).y += (dy / dist) * speed;
```

**GOOD:**
```javascript
// Use built-in helpers - they use fixed-point math internally
entity.moveTowards(target, speed);
entity.moveTowardsWithStop(target, speed, stopRadius);
entity.setVelocity(vx, vy);
entity.stop();
```

**Also GOOD:**
```javascript
// Set velocity on Body2D - physics system handles movement
const body = entity.get(Body2D);
body.vx = speed;
body.vy = 0;
```

The engine's movement helpers and physics use 16.16 fixed-point math, ensuring identical results on all platforms.

### 6. Iterating Maps/Sets Without Sorting

**BAD:**
```javascript
game.addSystem(() => {
    for (const [id, data] of customMap) {
        processEntity(id, data);  // Iteration order undefined!
    }
});
```

**GOOD:**
```javascript
game.addSystem(() => {
    const sortedIds = [...customMap.keys()].sort();
    for (const id of sortedIds) {
        processEntity(id, customMap.get(id));
    }
});
```

**Even better** - use the engine's query methods which return sorted entities:
```javascript
game.addSystem(() => {
    for (const entity of game.query('enemy')) {
        // Already sorted by entity ID
    }
});
```

### 7. Non-Deterministic External State

**BAD:**
```javascript
game.addSystem(() => {
    const ping = measurePing();
    player.get(Body2D).vx = 100 / ping;  // Latency affects game!
});
```

**GOOD:**
```javascript
game.addSystem(() => {
    player.get(Body2D).vx = 100;  // Constant, no external dependencies
});
```

### 8. Async Operations in Systems

**BAD:**
```javascript
game.addSystem(async () => {
    const data = await fetchSomething();  // Timing non-deterministic!
    applyData(data);
});
```

**GOOD:**
```javascript
game.addSystem(() => {
    // Systems must be synchronous
    // All state comes from components and synced inputs
});
```

### 9. Using Client-Specific Data

**BAD:**
```javascript
game.addSystem(() => {
    const width = canvas.width;  // Canvas size might differ!
    entity.get(Transform2D).x = width / 2;
});
```

**GOOD:**
```javascript
const WORLD_WIDTH = 800;  // Constant

game.addSystem(() => {
    entity.get(Transform2D).x = WORLD_WIDTH / 2;
});
```

## What's Safe

### Safe Operations

- `dRandom()` for randomness
- `dSqrt()` for square root
- `game.time` for timing (milliseconds)
- Component data via `entity.get(Component)`
- `game.query()` (returns sorted entities)
- **Entity movement helpers**: `moveTowards()`, `moveTowardsWithStop()`, `setVelocity()`, `stop()`
- **Entity distance helpers**: `distanceTo()`, `isWithin()`
- Setting `Body2D.vx` / `Body2D.vy` (physics handles movement)
- Integer math (addition, subtraction, multiplication)
- Constant divisions computed at load time
- String operations
- Array operations with explicit sorting

### Unsafe Operations

- `Math.random()` → use `dRandom()`
- `Math.sqrt()` → use `dSqrt()` or `entity.distanceTo()`
- `Date.now()`, `performance.now()` → use `game.time`
- `new Date()`
- Iterating unsorted Map/Set
- Float division for physics/position calculations
- Network calls in systems
- localStorage/sessionStorage in simulation
- DOM operations in systems
- `setTimeout`/`setInterval` timing

## Debugging Desync

### Enable Debug UI

```javascript
Modu.enableDebugUI(game);
```

The debug overlay shows:
- **Current hash** vs **Received hash** - should match across clients
- **Last Sync %** - shows how many fields match (100% = no desync)
- **Drifting fields** - highlights exactly which fields are diverging

It also enables the determinism guard which warns about dangerous function calls.

### Identify Drifting Fields

```javascript
const stats = game.getDriftStats();
console.log('Drifting:', stats.lastDriftedFields);
// ['player.Transform2D.x', 'player.Transform2D.y']
```

Common patterns:

| Drifting Fields | Likely Cause |
|----------------|--------------|
| `*.Transform2D.x/y` | Manual position math or `Math.sqrt()` |
| `*.Body2D.vx/vy` | `Math.random()` for velocity |
| Random entities | `Math.random()` in spawn logic |
| Everything | `Date.now()` or async in system |

See [Debug UI](./debug-ui.md) for a complete debugging workflow.

### Bisect the Problem

If desync occurs, narrow down when:

```javascript
game.addSystem(() => {
    console.log('before movement:', game.getStateHash());

    for (const player of game.query('player')) {
        // ... movement logic
    }
    console.log('after movement:', game.getStateHash());

    for (const bullet of game.query('bullet')) {
        // ... bullet logic
    }
    console.log('after bullets:', game.getStateHash());
}, { phase: 'update' });
```

Find where hashes diverge between clients.

## Fixed-Point Math (Advanced)

For custom physics or precise calculations, use fixed-point math directly:

```javascript
import { toFixed, toFloat, fpMul, fpDiv, fpSin, fpCos, fpSqrt } from 'modu';

// Convert float to fixed-point
const speed = toFixed(5.5);

// Fixed-point operations
const distance = fpMul(speed, time);
const angle = fpDiv(toFixed(Math.PI), toFixed(2));

// Trig (uses lookup tables for determinism)
const vx = fpMul(speed, fpCos(angle));
const vy = fpMul(speed, fpSin(angle));

// Square root
const dist = fpSqrt(fpMul(dx, dx) + fpMul(dy, dy));

// Convert back to float for display
console.log('Speed:', toFloat(speed));
```

Most developers won't need this - the entity helpers (`moveTowards`, `distanceTo`) handle it automatically.

## Checklist

Before shipping, verify:

- [ ] No `Math.random()` - use `dRandom()`
- [ ] No `Math.sqrt()` - use `dSqrt()` or `entity.distanceTo()`
- [ ] No `Date.now()` - use `game.time`
- [ ] All Map/Set iterations are sorted
- [ ] Using `moveTowards()` / `setVelocity()` instead of manual position math
- [ ] No float division for physics calculations
- [ ] No async operations in systems
- [ ] All game state in components
- [ ] Strings interned for comparison
- [ ] Using `game.query()` for entity iteration
- [ ] Debug UI enabled during development

## Next Steps

- [Debug UI](./debug-ui.md) - Verifying sync
- [Engine API](./engine-api.md) - Full API reference
