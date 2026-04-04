# Modu Engine - Complete Refactor Design Spec

**Date:** 2026-04-04
**Status:** Draft
**Scope:** Full rewrite of the Moddio/Taro game engine into Modu Engine

---

## 1. Overview

### What

A clean rewrite of the existing Moddio game engine (formerly "Taro") into **Modu Engine** — a modern, TypeScript-first, modular multiplayer game engine with sandboxed JavaScript scripting, client-side prediction, and single-player development mode.

### Why

The current codebase has fundamental structural problems:

- **Split codebase**: 152 JS files (legacy) + 195 TS files in a parallel `ts/` directory that compiles into `src/`, mixing compiled output with handwritten JS
- **No module system**: 40+ globals, script-tag loading via manual config files listing 180+ files in dependency order
- **God files**: `TaroEntity.js` (5,740 lines), `ActionComponent.js` (5,221 lines), `ParameterComponent.js` (3,497 lines)
- **Dead code**: 8 physics engine variants (only Planck used), Phaser renderer (unused alongside Three.js), CocoonJS mobile wrapper (platform dead for years), orphaned files and stubs
- **No tests**: Zero test infrastructure despite the codebase having 347 source files
- **No bundler**: Raw `tsc` compilation with a custom deploy script
- **JSON scripting**: Game logic expressed as deeply nested JSON — verbose, hard to write, impossible for AI to generate reliably

### Goals

- Clean TypeScript codebase with ES modules
- Three.js only (drop Phaser)
- Rapier 2D + 3D only (drop Box2D, Planck, and all other physics variants)
- Sandboxed JavaScript scripting (replace JSON action system)
- Client-side prediction for near-zero input latency
- Single-player mode as default for development
- Interest management and delta compression for 200 CCU per game
- Security hardened: rate limiting, input validation, CPU budgets
- Test-driven: behavioral tests written against old engine, new code passes them
- One Fly Machine per game deployment

---

## 2. Naming & Identity

- **Engine name**: Modu Engine
- **Package name**: `modu-engine`
- **Global singleton**: `modu` (replaces `taro`)
- **No class prefixes**: Use module-scoped imports, not `ModuEntity` / `TaroEntity`
- **All references to "Taro" and "Moddio" are removed from the codebase**

```ts
// Import style
import { Engine, Entity, Vec2 } from 'modu-engine';
const modu = Engine.instance();
```

---

## 3. Directory Structure

```
modu-engine/
├── engine/
│   ├── core/                         # Shared isomorphic game logic
│   │   ├── ecs/                      # Entity-Component system
│   │   │   ├── Entity.ts
│   │   │   ├── Component.ts
│   │   │   └── System.ts
│   │   ├── math/                     # Vector, Matrix, Rect, Polygon
│   │   │   ├── Vec2.ts
│   │   │   ├── Vec3.ts
│   │   │   ├── Matrix2d.ts
│   │   │   ├── Rect.ts
│   │   │   └── Polygon.ts
│   │   ├── physics/                  # Rapier 2D/3D integration
│   │   │   ├── PhysicsWorld.ts
│   │   │   ├── RigidBody.ts
│   │   │   └── Collider.ts
│   │   ├── network/                  # Protocol, serialization, streaming
│   │   │   ├── Protocol.ts
│   │   │   ├── Serializer.ts
│   │   │   ├── StreamSync.ts
│   │   │   ├── InterestManagement.ts
│   │   │   ├── DeltaCompressor.ts
│   │   │   ├── InputBuffer.ts
│   │   │   └── Snapshot.ts
│   │   ├── scripting/                # Sandboxed JS scripting engine
│   │   │   ├── ScriptEngine.ts
│   │   │   ├── ScriptAPI.ts
│   │   │   ├── Sandbox.ts
│   │   │   ├── BrowserSandbox.ts
│   │   │   └── JsonCompat.ts
│   │   ├── game/                     # Game-level entities and systems
│   │   │   ├── Unit.ts
│   │   │   ├── Player.ts
│   │   │   ├── Item.ts
│   │   │   ├── Projectile.ts
│   │   │   ├── Prop.ts
│   │   │   ├── Region.ts
│   │   │   ├── Sensor.ts
│   │   │   ├── Inventory.ts
│   │   │   ├── Ability.ts
│   │   │   ├── Attribute.ts
│   │   │   └── AI.ts
│   │   ├── map/                      # Tile maps, pathfinding
│   │   │   ├── TileMap.ts
│   │   │   ├── Map2d.ts
│   │   │   └── Pathfinding.ts
│   │   ├── events/                   # Event bus
│   │   │   └── EventEmitter.ts
│   │   ├── time/                     # Game clock, timers
│   │   │   └── Clock.ts
│   │   └── Engine.ts                 # Core engine orchestrator
│   │
│   ├── client/                       # Browser-side only
│   │   ├── renderer/                 # Three.js rendering
│   │   │   ├── Renderer.ts
│   │   │   ├── Camera.ts
│   │   │   ├── Scene.ts
│   │   │   ├── Skybox.ts
│   │   │   ├── PostProcessing.ts
│   │   │   ├── SpatialIndex.ts
│   │   │   ├── RenderBatch.ts
│   │   │   ├── ObjectPool.ts
│   │   │   ├── sprites/
│   │   │   │   ├── Sprite.ts
│   │   │   │   ├── AnimatedSprite.ts
│   │   │   │   ├── InstancedSprite.ts
│   │   │   │   └── TextureSheet.ts
│   │   │   ├── entities/             # Three.js entity renderers
│   │   │   │   ├── UnitRenderer.ts
│   │   │   │   ├── ItemRenderer.ts
│   │   │   │   ├── ProjectileRenderer.ts
│   │   │   │   ├── PropRenderer.ts
│   │   │   │   └── RegionRenderer.ts
│   │   │   ├── hud/                  # Overlay UI
│   │   │   │   ├── HudElement.ts
│   │   │   │   ├── ProgressBar.ts
│   │   │   │   ├── ChatBubble.ts
│   │   │   │   ├── FloatingText.ts
│   │   │   │   └── Label.ts
│   │   │   ├── particles/
│   │   │   │   └── ParticleSystem.ts
│   │   │   └── voxels/
│   │   │       └── Voxels.ts
│   │   ├── input/                    # Keyboard, mouse, touch, gamepad
│   │   │   ├── InputManager.ts
│   │   │   └── MobileControls.ts
│   │   ├── audio/
│   │   │   └── AudioManager.ts
│   │   ├── network/                  # Client networking + prediction
│   │   │   ├── ClientSocket.ts
│   │   │   ├── ClientNetworkHandler.ts
│   │   │   ├── Predictor.ts
│   │   │   ├── Interpolator.ts
│   │   │   ├── Reconciler.ts
│   │   │   └── ClientClock.ts
│   │   ├── ui/                       # Game UI
│   │   │   ├── MenuUI.ts
│   │   │   ├── ShopUI.ts
│   │   │   ├── ScoreboardUI.ts
│   │   │   ├── TradeUI.ts
│   │   │   ├── DevConsole.ts
│   │   │   └── GameText.ts
│   │   ├── assets/
│   │   │   └── AssetManager.ts
│   │   └── Client.ts                 # Client entry/orchestrator
│   │
│   └── server/                       # Node.js server only
│       ├── network/                  # Server networking + security
│       │   ├── ServerSocket.ts
│       │   ├── ServerNetworkHandler.ts
│       │   ├── RateLimiter.ts
│       │   ├── InputValidator.ts
│       │   └── BandwidthBudget.ts
│       └── Server.ts                 # Server entry/orchestrator
│
├── editor/                           # In-game dev tools
│   ├── DevMode.ts
│   ├── EntityEditor.ts
│   ├── TileEditor.ts
│   ├── RegionEditor.ts
│   ├── VoxelEditor.ts
│   ├── EntityGizmo.ts
│   ├── TilePalette.ts
│   ├── TileMarker.ts
│   └── EditorBridge.ts              # Interface with external React editor
│
├── tests/
│   ├── unit/
│   │   ├── math/
│   │   ├── ecs/
│   │   ├── physics/
│   │   ├── scripting/
│   │   ├── game/
│   │   ├── network/
│   │   └── events/
│   ├── integration/
│   │   ├── entity-physics.test.ts
│   │   ├── player-input.test.ts
│   │   ├── network-sync.test.ts
│   │   ├── scripting-actions.test.ts
│   │   ├── inventory-items.test.ts
│   │   ├── combat.test.ts
│   │   └── interest-management.test.ts
│   ├── performance/
│   │   ├── 200ccu-simulation.bench.ts
│   │   ├── physics-stress.bench.ts
│   │   ├── serialization.bench.ts
│   │   └── spatial-query.bench.ts
│   └── e2e/
│       ├── singleplayer.test.ts
│       ├── multiplayer.test.ts
│       └── editor.test.ts
│
├── deploy/                           # Fly.io deployment
│   ├── Dockerfile
│   └── fly.toml
│
├── dist/                             # Build output (gitignored)
├── package.json
├── tsconfig.json
├── tsconfig.client.json
├── tsconfig.server.json
├── vite.config.ts
└── vitest.config.ts
```

### Key Principles

- `core/` is 100% isomorphic — works in browser and Node.js, no DOM or Node-specific APIs
- `client/` imports from `core/`, never the other way around
- `server/` imports from `core/`, never the other way around
- `editor/` imports from `core/` and `client/` (needs the renderer)
- No god files — the old 5,740-line TaroEntity splits across `ecs/Entity.ts`, `game/Unit.ts`, physics, networking, etc.

---

## 4. Module System & Build Pipeline

### Module System

ES Modules throughout. No CommonJS, no globals, no `require()`.

```ts
import { Engine } from './core/Engine';
import { Vec2 } from './core/math/Vec2';
import { PhysicsWorld } from './core/physics/PhysicsWorld';
```

The `modu` singleton is a typed export, not a window global:

```ts
export class Engine {
  private static _instance: Engine;
  static instance(): Engine { ... }

  readonly physics: PhysicsWorld;
  readonly events: EventEmitter;
  readonly clock: Clock;
}
```

For backward compatibility during migration, `window.modu` is exposed in the client entry point, but all internal code uses imports.

### Build Pipeline

| Target | Tool | Input | Output |
|--------|------|-------|--------|
| Client (browser) | Vite | `engine/client/Client.ts` | `dist/client/modu.js` |
| Server (Node.js) | tsc + tsx | `engine/server/Server.ts` | `dist/server/` (ES modules) |
| Editor (browser) | Vite | `editor/DevMode.ts` | `dist/editor/editor.js` |
| Tests | Vitest | `tests/**/*.test.ts` | (in-memory) |

### TypeScript Configuration

```
tsconfig.json            # Base config (shared compiler options)
tsconfig.client.json     # Extends base, client-specific (DOM types)
tsconfig.server.json     # Extends base, server-specific (Node types)
```

### Dev Workflow

```bash
npm run dev              # Vite dev server + tsc watch (single-player by default)
npm run build            # Builds client + server + editor
npm run build:client     # Client only
npm run build:server     # Server only
npm run test             # Vitest watch mode
npm run test:run         # Single run (CI)
npm run bench            # Performance benchmarks
```

---

## 5. Renderer

### Three.js Only

Phaser is removed entirely — all 32 TS files, the Phaser dependency (~3.6MB), rex plugins, and all 2D scene management code.

### Rendering Architecture

```
engine/client/renderer/
├── Renderer.ts           # WebGL renderer, effect composer, scene management
├── Camera.ts             # Camera control, zoom, pan, rotation
├── Scene.ts              # Three.js scene setup
├── Skybox.ts             # Environment skybox
├── PostProcessing.ts     # Bloom, outline, gamma correction
├── SpatialIndex.ts       # Grid-based spatial partitioning for frustum culling
├── RenderBatch.ts        # Draw call batching by material/texture
├── ObjectPool.ts         # Entity/particle/projectile recycling
├── sprites/              # 2D sprite rendering in 3D space
├── entities/             # Per-entity-type renderers
├── hud/                  # Overlay elements (health bars, chat, text)
├── particles/            # Particle system
└── voxels/               # Voxel rendering
```

### Performance Optimizations

- **Frustum culling** via `SpatialIndex` — only render what the camera sees
- **Instanced rendering** for same-type entities (carried forward from existing `InstancedSprite.ts`)
- **Object pooling** — avoid GC pressure from entity creation/destruction
- **LOD** — distant entities use simpler geometry
- **Texture atlasing** — fewer texture binds, better batching

---

## 6. Physics

### Rapier 2D + 3D Only

All other physics engines are removed:
- Box2D web, wasm, TS, ninja variants
- Planck
- Native wrapper
- All pre-built distribution files in `engine/components/physics/box2d/dists/`

### Physics Architecture

```
engine/core/physics/
├── PhysicsWorld.ts       # Rapier world wrapper, step, query
├── RigidBody.ts          # Dynamic/static/kinematic body wrapper
└── Collider.ts           # Shape definitions, collision filtering
```

### Key Features

- **Physics sleeping** — entities at rest skip simulation (saves CPU at scale)
- **Collision events** — integrated with the event system for script triggers
- **Deterministic stepping** — fixed timestep for consistent behavior across client/server
- **2D and 3D** — Rapier supports both; game chooses at init time

---

## 7. Networking

### Architecture

```
engine/core/network/
├── Protocol.ts             # Message type definitions + binary schema
├── Serializer.ts           # msgpack encode/decode
├── StreamSync.ts           # Delta state synchronization
├── InterestManagement.ts   # Area-of-interest filtering
├── DeltaCompressor.ts      # Property-level diffing
├── InputBuffer.ts          # Tick-stamped input history
└── Snapshot.ts             # Full/delta world state snapshots

engine/server/network/
├── ServerSocket.ts         # WebSocket server (ws)
├── ServerNetworkHandler.ts # Message routing
├── RateLimiter.ts          # Per-player per-action throttling
├── InputValidator.ts       # Schema-based message validation
└── BandwidthBudget.ts      # Per-player outbound cap

engine/client/network/
├── ClientSocket.ts         # WebSocket client
├── ClientNetworkHandler.ts # Message routing
├── Predictor.ts            # Local simulation of own player
├── Interpolator.ts         # Smooth rendering of remote entities
├── Reconciler.ts           # Replay inputs on server correction
└── ClientClock.ts          # Synchronized tick counter with server
```

### Client-Side Prediction (Near-Zero Input Latency)

```
Player presses W
  ├─> Client: Apply movement IMMEDIATELY (predicted state)
  ├─> Client: Send input + tick number to server
  ├─> Server: Simulate authoritatively, send back state + tick
  └─> Client: Compare prediction vs server
      ├─ Match → do nothing
      └─ Diverge → smoothly reconcile over 2-3 frames
```

| Entity | Strategy | Perceived Latency |
|--------|----------|-------------------|
| Own player movement | Client-side prediction | ~0ms |
| Own player actions | Optimistic prediction + rollback | ~0ms visual |
| Other players | Entity interpolation (buffered) | ~50-100ms, smooth |
| Projectiles | Client-spawned, server reconciles | ~0ms visual |
| Physics objects | Predicted locally, corrected smoothly | ~0ms |

### Interest Management (200 CCU Target)

Players only receive updates for nearby/relevant entities. This is the biggest networking win:

- **Proximity-based**: entities within player's area of interest
- **Relevance-based**: important entities (team members, quest targets) always included
- **Adaptive tick rate**: distant entities update less frequently
- **Bandwidth budgeting**: cap outbound bytes per player per tick, prioritize nearby updates

### Binary Protocol

msgpack serialization with tight schemas. No JSON over the wire.

---

## 8. Security

### Input Validation

Every client message is validated in `ServerNetworkHandler` before reaching game logic. No raw client data flows into the engine core.

```ts
// engine/server/network/InputValidator.ts
export class InputValidator {
  validate(messageType: string, payload: unknown): Result<ValidPayload, ValidationError>;
}
```

### Rate Limiting

Per-player, per-action-type rate limits:

```ts
// engine/server/network/RateLimiter.ts
export class RateLimiter {
  // e.g., "pickupItem" → max 5/sec, "chat" → max 3/sec
  check(playerId: string, action: string): boolean;
}
```

- Player spamming item pickups gets throttled on pickups without affecting movement
- Connection-level max messages per second — exceed = disconnect + cooldown
- CPU budget per player per tick for expensive operations (script execution, entity creation)

### XSS Prevention

Centralized sanitization for all string fields that touch the DOM (chat, player names, custom text).

---

## 9. Scripting System

### Overview

Replace the JSON action/condition/parameter system with **sandboxed JavaScript**. Game logic is written in plain JS with a fluent API.

### Before (JSON — current system)

```json
{
  "type": "condition",
  "operator": "AND",
  "conditions": [
    {
      "operandA": { "function": "getEntityAttribute", "entity": { "function": "thisEntity" }, "key": "health" },
      "operator": "greaterThan",
      "operandB": { "function": "number", "value": 50 }
    }
  ],
  "then": [
    {
      "type": "sendChatMessage",
      "message": { "function": "concat", "items": ["HP: ", { "function": "getEntityAttribute", "entity": { "function": "thisEntity" }, "key": "health" }] }
    }
  ]
}
```

### After (JavaScript — Modu Engine)

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

item('health_potion').when('used').do((self, player) => {
  player.health += 50;
  self.consume();
});

region('spawn_zone').when('entered').by('player').do((self, player) => {
  player.team = self.data.team;
  player.teleport(self.data.spawnPoint);
});

every(5000, () => {
  world.units.where(u => u.type === 'zombie').forEach(z => {
    z.moveTo(nearestPlayer(z));
  });
});
```

### Why JavaScript

- Every LLM is heavily trained on JS — AI generates correct scripts reliably
- Most widely known programming language
- The engine is already TS — no foreign runtime needed
- The API surface is small enough that an LLM with a system prompt would generate correct scripts most of the time

### Sandbox Architecture

```
engine/core/scripting/
├── ScriptEngine.ts       # Load scripts, manage isolate lifecycle
├── ScriptAPI.ts          # Fluent API (unit.when, on, every, world, etc.)
├── Sandbox.ts            # isolated-vm wrapper (~100 lines)
├── BrowserSandbox.ts     # Web Worker equivalent for client/single-player
└── JsonCompat.ts         # JSON -> JS transpiler for old games
```

### Server-Side Sandbox: `isolated-vm`

Each game gets a single V8 isolate via `isolated-vm` (same technology behind Cloudflare Workers):

```ts
import ivm from 'isolated-vm';

const isolate = new ivm.Isolate({ memoryLimit: 64 }); // Hard 64MB limit
const context = isolate.createContextSync();

// Inject ONLY the game API. Nothing else exists.
// No process, require, fs, fetch, setTimeout, eval, Function.
injectGameAPI(context, engine);

// Run with hard CPU timeout
await script.run(context, { timeout: 5 }); // 5ms max per tick
```

**Security guarantees from the isolate itself:**
- Separate V8 heap — no shared objects with host process
- No access to Node.js APIs — they simply don't exist in the isolate
- Hard memory limit — isolate killed if exceeded
- Hard CPU timeout — infinite loops killed after 5ms
- No prototype pollution — no shared prototypes to pollute

**Per-game isolation:** One process per game means one isolate per game. Game A's scripts cannot affect Game B.

### Client-Side Sandbox: Web Worker

In single-player / browser mode, scripts run in a Web Worker with restricted scope. Same principle — separate execution context, message-passing only.

### JSON-to-JS Transpiler

For backward compatibility with existing games:

```ts
// engine/core/scripting/JsonCompat.ts
export class JsonCompat {
  // Converts old JSON action trees to equivalent JS scripts
  transpile(jsonActions: object): string;
}
```

Existing games continue working. New games use JS directly.

---

## 10. Single-Player Mode

### Concept

In single-player mode, the engine core runs directly in the client — no server process, no network layer. The client instantiates `Engine` (from `core/`) directly.

### Architecture

```
Multiplayer:
  Client (browser) ──WebSocket──> Server (Node.js)
    └─ Predictor                    └─ Engine (core)
    └─ Interpolator                 └─ PhysicsWorld
    └─ Renderer                     └─ ScriptEngine

Single-Player:
  Client (browser)
    └─ Engine (core)     ← runs directly, no network
    └─ PhysicsWorld
    └─ ScriptEngine
    └─ Renderer
```

### Default in Development

When a game developer runs `npm run dev`, the game boots in single-player mode. No server process to manage, no network latency, instant reload. When ready for multiplayer testing, they switch to `npm run dev:multi` which spins up a local server.

```bash
npm run dev          # Single-player (default for development)
npm run dev:multi    # Local multiplayer (server + client)
```

### Why This Works

The `core/` layer is 100% isomorphic. It doesn't know or care if it's running on a server or in a browser. The `client/` layer wraps it with rendering, and the `server/` layer wraps it with networking. In single-player, the client wraps it with both rendering and direct engine access.

---

## 11. Fly.io Deployment

### One Machine Per Game

Each game instance runs on a dedicated Fly Machine:

- Player/editor starts a game -> Fly spins up a machine
- Machine runs the Modu Engine server process
- Clients connect via WebSocket
- Game idle for X minutes -> Fly stops the machine (pay for what you use)
- Fly Machines auto-start on incoming request

### Machine Sizing (per game, 100 CCU)

- `shared-cpu-2x` (2 shared vCPUs)
- 512MB - 1GB RAM
- Scales horizontally — more games = more machines

### Dockerfile

```dockerfile
FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy built engine
COPY dist/ ./dist/

# Copy game assets (mounted or baked in per game)
COPY assets/ ./assets/

EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "--experimental-strip-types", "dist/server/Server.js"]
```

### fly.toml

```toml
app = "modu-game"
primary_region = "iad"

[build]
  dockerfile = "deploy/Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "connections"
    hard_limit = 200
    soft_limit = 150

[[vm]]
  size = "shared-cpu-2x"
  memory = "1gb"

[checks]
  [checks.health]
    type = "http"
    port = 8080
    path = "/health"
    interval = "30s"
    timeout = "3s"
```

### Key Fly Features Used

- **Auto-stop/auto-start**: Machines stop when idle, start on incoming connection. Pay only for active games.
- **Connection concurrency limit**: Hard cap at 200 connections (our CCU target) per machine.
- **Health checks**: Fly restarts unhealthy machines automatically.
- **Regional deployment**: Deploy close to players for lower latency.

---

## 12. Test-Driven Migration Strategy

### Approach

Write tests against the existing engine's behavior, then build Modu Engine to pass those tests. The old code is reference only — read it to understand behavior, write fresh TS.

### Test Framework

**Vitest** — fast, native ES modules, TypeScript out of the box, compatible with Vite.

### Test Layers

| Layer | Purpose | Environment |
|-------|---------|-------------|
| Unit | Pure logic, no rendering, no network | Node.js |
| Integration | Multiple systems working together | Node.js |
| Performance | Benchmarks (not pass/fail) | Node.js |
| E2E | Full engine boot | Headless browser |

### How Existing Behavior Is Captured

**Step 1: Behavioral tests** — read old code, write tests describing its behavior:

```ts
describe('Inventory', () => {
  it('rejects pickup when full', () => {
    const inv = new Inventory({ slots: 1 });
    inv.add(createItem('sword'));
    const result = inv.add(createItem('shield'));
    expect(result.ok).toBe(false);
  });

  it('stacks same item types by quantity', () => {
    const inv = new Inventory({ slots: 5 });
    inv.add(createItem('arrow', { quantity: 10 }));
    inv.add(createItem('arrow', { quantity: 5 }));
    expect(inv.getSlot(0).quantity).toBe(15);
  });
});
```

**Step 2: Protocol compatibility tests** — capture network message format.

**Step 3: Physics behavior tests** — ensure Rapier produces equivalent results.

### Migration Phases

Each phase follows: read old code -> write tests -> write new TS -> verify.

| Phase | What | Tests | Depends On |
|-------|------|-------|------------|
| 0 | Project setup (Vite, Vitest, tsconfig, package.json) | — | — |
| 1 | Math library (Vec2, Vec3, Matrix2d, Rect, Polygon) | Unit | — |
| 2 | Event system (EventEmitter) | Unit | — |
| 3 | ECS (Entity, Component, System) | Unit | 1, 2 |
| 4 | Clock & game loop | Unit | 2, 3 |
| 5 | Physics (Rapier integration) | Unit + integration | 1, 3 |
| 6 | Map system (TileMap, Pathfinding) | Unit | 1, 5 |
| 7 | Game entities (Unit, Player, Item, Projectile, Prop, Region, Sensor) | Unit + integration | 3, 5 |
| 8 | Game systems (Inventory, Ability, Attribute, AI) | Unit + integration | 7 |
| 9 | Scripting engine (ScriptEngine, ScriptAPI, Sandbox) | Unit + integration | 7, 8 |
| 10 | Network protocol (Serializer, Delta, InputBuffer) | Unit | 3 |
| 11 | Server (Socket, Handler, RateLimiter, Validator, InterestMgmt) | Unit + integration | 7, 10 |
| 12 | Client networking (Predictor, Interpolator, Reconciler) | Unit + integration | 10 |
| 13 | Renderer (Three.js scene, camera, sprites, entities) | Integration | 3, 7 |
| 14 | HUD & UI (health bars, chat, menus, shop, scoreboard) | Integration | 13 |
| 15 | Audio | Integration | 2 |
| 16 | Input (keyboard, mouse, touch, gamepad) | Unit + integration | 2 |
| 17 | Single-player mode (core runs in client) | E2E | 5-9, 13 |
| 18 | Multiplayer mode (full client-server) | E2E | 11, 12, 17 |
| 19 | Editor tools (DevMode, tile/entity/voxel/region editors) | Integration | 13, 17 |
| 20 | Performance benchmarks & optimization | Perf | 18 |
| 21 | JSON-to-JS transpiler | Unit + integration | 9 |
| 22 | Fly deployment setup | E2E | 18 |

### What Gets Deleted

After the new engine passes all tests, the following old directories/files are removed:

- `engine/` — replaced by `engine/core/`
- `src/` — replaced by `engine/client/` + build output in `dist/`
- `server/` — replaced by `engine/server/`
- `ts/` — source is unified, no parallel directory
- `types/` — types colocated with implementations
- All Phaser files and dependencies
- All Box2D/Planck physics files and distributions
- `loader.js`, `CoreConfig.js`, `ClientConfig.js`, `ServerConfig.js`
- `TaroCocoonJsComponent.js` and all dead code identified in analysis
- Orphaned sourcemaps and stubs in `types/` root

---

## 13. Dependencies

### Kept

| Package | Purpose |
|---------|---------|
| `three` | 3D rendering |
| `@dimforge/rapier2d-compat` | 2D physics |
| `@dimforge/rapier3d-compat` | 3D physics |
| `ws` | WebSocket server |
| `msgpack-lite` | Binary serialization |
| `isolated-vm` | Script sandboxing (server) |
| `express` + `helmet` | HTTP server + security headers |
| `xss-filters` | Input sanitization |
| `nipplejs` | Mobile joystick |
| `rate-limiter-flexible` | Rate limiting |

### Removed

| Package | Reason |
|---------|--------|
| `phaser` | Replaced by Three.js only |
| `phaser3-rex-plugins` | Phaser dependency |
| `phaser3-rex-plugins-types` | Phaser dependency |
| All Box2D/Planck packages | Replaced by Rapier |
| `lodash` | Use native JS methods |
| `request` | Deprecated, use native `fetch` |
| `lz-string`, `lzutf8` | Evaluate if still needed |

### Added

| Package | Purpose |
|---------|---------|
| `vite` | Client build tool |
| `vitest` | Test framework |
| `tsx` | TypeScript execution for server dev |
| `isolated-vm` | Script sandbox |
| `@dimforge/rapier2d-compat` | Rapier 2D (replaces Planck) |
| `@dimforge/rapier3d-compat` | Rapier 3D |

---

## 14. External Editor Integration

The external editor (separate React app at github.com/moddio/editor) remains a separate repo. Communication pattern is preserved but cleaned up:

### Interface Contract

```ts
// editor/EditorBridge.ts
export interface EditorBridge {
  // Engine -> Editor (update React UI)
  updateEntity(data: EditEntityData): void;
  updateRegion(data: RegionData): void;
  editGlobalScripts(data: ScriptChangesData): void;
  saveMap(): void;
  // ... other methods

  // Editor -> Engine (via event bus)
  // Editor calls modu.events.emit('editTile', data)
  // Engine listens and applies changes
}
```

The `window.inGameEditor` bridge pattern is kept but typed properly. The external editor is fetched dynamically at runtime (no bundling).

---

## 15. Summary of Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Migration strategy | Clean rewrite with test scaffold | Old architecture too broken for incremental |
| Language | TypeScript (strict) | Type safety, modern tooling |
| Module system | ES Modules | Tree-shaking, proper isolation |
| Build tool | Vite (client) + tsc (server) | Fast dev, optimized production |
| Test framework | Vitest | Fast, native ESM, Vite-compatible |
| Renderer | Three.js only | Drop Phaser, single renderer |
| Physics | Rapier 2D + 3D only | Modern, fast, WASM-based |
| Scripting | Sandboxed JavaScript | AI-trainable, succinct, secure |
| Sandbox | isolated-vm (server), Web Worker (client) | Cloudflare-grade isolation |
| Networking | Client-side prediction + interest management | ~0ms latency, 200 CCU |
| Naming | Modu Engine, no prefixes, module-scoped | Clean identity, ES module namespacing |
| Deployment | One Fly Machine per game | Isolation, auto-scaling, pay-per-use |
| Single-player | Core engine runs in browser | Default for dev, no server needed |
| Editor | Separate repo, in-game tools in `editor/` | Different tech stack, clean boundary |
| Old game compat | JSON-to-JS transpiler | Existing games keep working |
