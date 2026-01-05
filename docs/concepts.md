# Concepts

How Modu Engine works in 2 minutes.

## Local-First Multiplayer

Modu is a **local-first multiplayer** engine. Your game runs locally with full simulation - no "connecting..." screens, no waiting. When you call `game.connect()`, you sync with other players seamlessly.

```
Start game → Playing immediately (local simulation)
     ↓
Connect to room → Receive snapshot → Synced with others
     ↓
Disconnect? → Keep playing locally
```

This works because:
- The **same deterministic simulation** runs on every client
- Network just syncs inputs, not game state
- Your code works identically solo or with 100 players

No separate "single-player" or "multiplayer" modes. One codebase, any number of players.

## ECS Architecture

Games are built with three things:

| Concept | What it is | Example |
|---------|-----------|---------|
| **Entity** | A game object (just an ID) | Player, bullet, wall |
| **Component** | Data attached to an entity | Position, velocity, health |
| **System** | Logic that runs each frame | Movement, collision response |

```javascript
// Define what a "player" is (entity + components)
game.defineEntity('player')
    .with(Transform2D)      // position
    .with(Body2D)           // physics
    .with(Sprite)           // visuals
    .with(Player)           // marks ownership by clientId
    .register();

// Spawn one (runs on all clients)
game.spawn('player', { x: 100, y: 100, clientId });

// Write logic - this runs every frame on every client
game.addSystem(() => {
    for (const entity of game.query('player')) {
        entity.moveTowards(target, speed);
    }
});
```

## Deterministic Simulation

All clients run the exact same simulation. Given the same inputs, every client computes the same result. This is how sync works - not by sending positions, but by ensuring everyone calculates the same thing.

**Rules:**
- Use `dRandom()` instead of `Math.random()`
- Use `dSqrt()` instead of `Math.sqrt()`
- Use `game.time` instead of `Date.now()` (returns deterministic milliseconds)
- Use `moveTowards()` instead of manual position math

Enable debug mode to catch mistakes automatically:
```javascript
Modu.enableDebugUI(game);  // Warns about non-deterministic function calls
```

See [Determinism Guide](./determinism.md) for full details.

## How Networking Works

```
Client A presses "move right"
    ↓
Input sent to server
    ↓
Server broadcasts to all clients
    ↓
All clients apply input at the same frame
    ↓
All clients compute the same result
```

The server never runs game logic. It just orders inputs so everyone processes them in the same sequence.

## Late Joiners

When a player joins mid-game:
1. They receive a snapshot of the current state
2. `onSnapshot()` fires so you can set up non-serializable state
3. They catch up by replaying missed inputs
4. They're now in sync

## Plugins

Functionality is added via plugins:

```javascript
const game = createGame();
game.addPlugin(AutoRenderer, canvas);           // Rendering
game.addPlugin(Physics2DSystem, { gravity });   // Physics
game.addPlugin(InputPlugin, canvas);            // Input
```

## That's It

1. Define entities with components
2. Write systems for logic
3. Call `game.connect()` to go online
4. Everything syncs automatically

## Next Steps

- [Getting Started](./getting-started.md) - Working example code
- [Entities](./entities.md) - Entity definition and spawning
- [Systems](./systems.md) - Writing game logic
- [Determinism](./determinism.md) - Full sync rules
