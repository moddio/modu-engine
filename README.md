# Modu Engine

A modern, TypeScript-first multiplayer game engine with sandboxed JavaScript scripting, client-side prediction, and single-player development mode.

## Features

- **TypeScript throughout** — strict mode, ES modules, full type safety
- **Three.js rendering** — sprites, animated sprites, entity renderers, HUD, post-processing
- **Rapier 2D + 3D physics** — WASM-based, fast, with collision events and sensor support
- **Sandboxed JS scripting** — game logic written in plain JavaScript with a fluent API, executed in an isolated environment
- **Client-side prediction** — near-zero input latency with server reconciliation
- **Interest management** — area-of-interest filtering for 200 CCU per game
- **Delta compression** — binary protocol (msgpack) with property-level diffing
- **Single-player mode** — default for development, engine core runs directly in browser
- **Security hardened** — per-player per-action rate limiting, input validation, bandwidth budgets, XSS prevention
- **A\* pathfinding** — 8-directional with diagonal corner-cutting prevention
- **In-game editor** — dev mode tools with external editor bridge
- **Fly.io deployment** — one machine per game, auto-stop/auto-start

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm run test

# Run in development (single-player mode)
npm run dev

# Run in multiplayer mode (server + client)
npm run dev:multi

# Build for production
npm run build

# Run benchmarks
npm run bench
```

## Architecture

```
engine/
  core/           # Shared isomorphic game logic (runs everywhere)
    ecs/          # Entity-Component-System (Entity, Component, System)
    math/         # Vec2, Vec3, Matrix2d, Rect, Polygon
    physics/      # Rapier 2D + 3D physics (PhysicsWorld, RigidBody, Collider, PhysicsWorld3d, RigidBody3d)
    network/      # Protocol, Serializer, DeltaCompressor, InputBuffer, InterestManagement
    scripting/    # ScriptEngine, ScriptAPI, Sandbox, JSON-to-JS transpiler
    game/         # Game entities (Unit, Player, Item, Projectile, Prop, Region, Sensor)
                  # Game systems (Inventory, Ability, Attribute, AI)
    map/          # TileMap, Map2d, A* Pathfinding
    events/       # EventEmitter
    time/         # Clock with timers and intervals
    Engine.ts     # Core engine singleton

  client/         # Browser-side only
    renderer/     # Three.js (Renderer, Camera, Sprites, Entity Renderers, HUD, PostProcessing)
    network/      # Predictor, Interpolator, Reconciler, ClientClock
    input/        # InputManager, MobileControls
    audio/        # AudioManager
    ui/           # UIManager, Shop, Scoreboard, DevConsole, GameText
    Client.ts     # Client entry point
    SinglePlayer.ts

  server/         # Node.js server only
    network/      # ServerSocket, RateLimiter, InputValidator, BandwidthBudget
    Server.ts     # Server entry point

editor/           # In-game dev tools
  DevMode.ts      # Developer mode coordinator
  EditorBridge.ts # Interface with external React editor

deploy/           # Fly.io deployment
  Dockerfile
  fly.toml

tests/
  unit/           # 376 unit tests
  performance/    # Benchmarks (physics, serialization, spatial, ECS)
```

## Scripting

Game logic is written in plain JavaScript with a fluent API:

```js
on('unitAttacked', (attacker, target) => {
  const damage = attacker.attr('attack') - target.attr('defense');
  if (damage > 0) {
    target.attr('health', hp => hp - damage);
    target.floatingText(`-${damage}`, 'red');
    if (target.attr('health') <= 0) {
      target.die();
      attacker.attr('xp', xp => xp + target.attr('xpReward'));
    }
  }
});

every(5000, () => {
  world.units.where(u => u.type === 'zombie').forEach(z => {
    z.moveTo(nearestPlayer(z));
  });
});
```

Scripts run in an isolated sandbox (Function-based for development, `isolated-vm` for production) with:
- No access to Node.js APIs (process, fs, require)
- Hard memory limits
- CPU timeout per tick
- Per-game isolation

## Networking

```
Player presses W
  |-> Client: Apply movement IMMEDIATELY (predicted state)
  |-> Client: Send input + tick number to server
  |-> Server: Simulate authoritatively, send back state + tick
  '-> Client: Compare prediction vs server
      |- Match -> do nothing
      '- Diverge -> smoothly reconcile over 2-3 frames
```

| Entity | Strategy | Perceived Latency |
|--------|----------|-------------------|
| Own player | Client-side prediction | ~0ms |
| Own actions | Optimistic + rollback | ~0ms visual |
| Other players | Entity interpolation | ~50-100ms, smooth |
| Projectiles | Client-spawned, server reconciles | ~0ms visual |

## Security

- **Input validation** — every client message validated before reaching game logic
- **Rate limiting** — per-player, per-action-type (e.g., pickupItem: 5/sec, chat: 3/sec)
- **Bandwidth budgets** — per-player outbound byte cap per tick
- **XSS prevention** — centralized string sanitization
- **Script sandbox** — isolated execution, no shared references with host

## License

See [LICENSE](LICENSE) for details.
