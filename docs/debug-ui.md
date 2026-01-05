# Debug UI

Modu Engine includes a built-in debug overlay for development.

## Enabling Debug UI

```javascript
import { createGame, enableDebugUI } from 'modu';

const game = createGame();
// ... setup plugins, entities, systems

enableDebugUI(game);
```

Enabling debug UI also activates the **determinism guard** which warns about non-deterministic function calls during simulation.

## Determinism Guard

When debug UI is enabled, the engine intercepts dangerous functions and warns you:

```
⚠️ Math.sqrt() is non-deterministic!
   Use dSqrt() instead for deterministic square root.
   Example: const dist = dSqrt(dx * dx + dy * dy);

⚠️ Math.random() is non-deterministic!
   Use dRandom() instead for deterministic random numbers.
   Example: const r = dRandom();

⚠️ Date.now() is non-deterministic!
   Use game.time instead for deterministic timing.
   Example: const respawnAt = game.time + 3000;
```

This catches common mistakes before they cause desync issues.

## What It Shows

The debug UI displays connection status, frame info, and sync verification:

```
ROOM
  ID: my-game-room
  Players: 3
  Frame: 1234
  URL: ws://localhost:8001/ws

ME
  Authority: Yes
  Client: abc123def

ENGINE
  FPS: 60 render, 20 tick
  Net: 1.2 up, 3.5 down kB/s

SNAPSHOT
  Current: a1b2c3d4
  Received: a1b2c3d4 (5 ago)
  Last Sync: 100% (250/250 fields)
```

### Section Reference

| Section | Field | Description |
|---------|-------|-------------|
| **ROOM** | ID | Current room ID |
| | Players | Number of connected clients |
| | Frame | Current simulation frame number |
| | URL | Connected WebSocket node URL |
| **ME** | Authority | Whether this client sends snapshots |
| | Client | Your client ID |
| **ENGINE** | FPS | Render FPS and tick rate |
| | Net | Upload/download bandwidth in kB/s |
| **SNAPSHOT** | Current | Current local state hash |
| | Received | Last received snapshot hash and frames ago |
| | Last Sync | Determinism % (matching/total fields) |

## Understanding Sync Status

The **SNAPSHOT** section is your primary tool for detecting desync:

```
SNAPSHOT
  Current: a1b2c3d4          ← Your local state hash
  Received: a1b2c3d4 (5 ago) ← Authority's hash (should match!)
  Last Sync: 100% (250/250)  ← Field-by-field match percentage
```

### When Everything is Working

- **Current** and **Received** hashes match
- **Last Sync** shows 100%
- All clients show the same hash at the same frame

### When Desync Occurs

- Hashes differ between clients
- **Last Sync** drops below 100%
- The debug UI highlights drifting fields in red

## Debugging Desync

When you see mismatched hashes, follow this workflow:

### Step 1: Check Last Sync Percentage

```
Last Sync: 98% (245/250 fields)
```

This tells you 5 fields are diverging. The lower the percentage, the more widespread the desync.

### Step 2: Identify Drifting Fields

Use `getDriftStats()` to see exactly which fields are drifting:

```javascript
const stats = game.getDriftStats();
console.log('Drifting fields:', stats.lastDriftedFields);
// ['player.Transform2D.x', 'player.Transform2D.y', 'bullet.Body2D.vx']
```

The field names tell you:
- **Entity type** (player, bullet, etc.)
- **Component** (Transform2D, Body2D, etc.)
- **Field** (x, y, vx, etc.)

### Step 3: Find the Root Cause

Common patterns and their causes:

| Drifting Fields | Likely Cause |
|----------------|--------------|
| `*.Transform2D.x/y` | `Math.sqrt()` or manual position math |
| `*.Body2D.vx/vy` | `Math.random()` for velocity |
| Random entities missing | `Math.random()` in spawn logic |
| Everything drifting | `Date.now()` or async operation in system |

### Step 4: Fix and Verify

After fixing, watch the debug UI:
- **Last Sync** should return to 100%
- Hashes should match across all clients

## Example: Debugging a Position Desync

```javascript
// You see this in getDriftStats():
// lastDriftedFields: ['player.Transform2D.x', 'player.Transform2D.y']

// BAD - This was causing desync
game.addSystem(() => {
    const dx = target.x - player.get(Transform2D).x;
    const dy = target.y - player.get(Transform2D).y;
    const dist = Math.sqrt(dx * dx + dy * dy);  // Non-deterministic!
    player.get(Transform2D).x += (dx / dist) * speed;
});

// GOOD - Use deterministic helpers
game.addSystem(() => {
    player.moveTowards(target, speed);  // Best: uses fixed-point internally
});

// ALSO GOOD - If you need the distance value
game.addSystem(() => {
    const dist = player.distanceTo(target);  // Deterministic
    // or: const dist = dSqrt(dx * dx + dy * dy);
});
```

## Programmatic Access

### `game.getStateHash()`

Get the current state hash:

```javascript
const hash = game.getStateHash();
console.log('State hash:', hash);
```

### `game.isAuthority()`

Check if this client is the snapshot authority:

```javascript
if (game.isAuthority()) {
    console.log('This client sends snapshots to others');
}
```

### `game.getDriftStats()`

Get detailed drift statistics:

```javascript
const stats = game.getDriftStats();
console.log(stats);
// {
//   totalChecks: 50,
//   matchingFieldCount: 245,
//   totalFieldCount: 250,
//   determinismPercent: 98,
//   lastCheckFrame: 1000,
//   lastDriftedFields: ['player.x', 'player.y']
// }
```

## Styling

The debug UI uses inline styles. To customize:

```javascript
const debugDiv = document.getElementById('modu-debug');
if (debugDiv) {
    debugDiv.style.fontSize = '14px';
    debugDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
}
```

## Disabling

To remove the debug UI:

```javascript
const debugDiv = document.getElementById('modu-debug');
if (debugDiv) {
    debugDiv.remove();
}
```

## Conditional Enabling

Enable only in development:

```javascript
if (process.env.NODE_ENV === 'development') {
    enableDebugUI(game);
}
```

Or with a URL parameter:

```javascript
if (new URLSearchParams(location.search).has('debug')) {
    enableDebugUI(game);
}
```

## Console Debugging

For more detailed debugging, check console logs:

```javascript
// Enable debug mode in connect options
game.connect('my-room', callbacks, { debug: true });
```

Key log messages:
- `[modu] Connecting to room...` - Connection attempt
- `[modu] Connected as X, frame Y` - Successful connection
- `[modu] Catchup: snapshotFrame=X, serverFrame=Y` - Late joiner sync
- `[modu] Network error:` - Connection problems

## Next Steps

- [Determinism Guide](./determinism.md) - Avoiding desync
- [Systems](./systems.md) - Writing game logic
- [Canvas Renderer](./canvas-renderer.md) - Rendering
