# Engine Refactor Plan

Restructure `engine/src` for clarity and maintainability.

> **Note**: `ARCHITECTURE.md` now exists at engine root with current architecture docs.
> Old planning docs removed from `docs/` folder.

## Current Problems

1. **`components/` is misleading** - Contains physics engine implementations, not ECS components
2. **`ecs/` is a dumping ground** - Core ECS, plugins, and built-in components all mixed together
3. **Plugins scattered** - AutoRenderer, InputPlugin, Physics2DSystem buried in `ecs/`
4. **Physics split across folders**:
   - `components/physics2d/` - Physics engine implementation (world, collision, shapes)
   - `ecs/physics2d-system.ts` - ECS plugin that uses the engine
   - These should be together in one place
5. **Duplicate input code** - `input/` folder vs `ecs/input-plugin.ts`
6. **Loose files** - `debug-ui.ts` floating at root

### Current Physics Structure (confusing)

```
src/
├── components/
│   └── physics2d/           # Physics ENGINE (world, collision, shapes)
│       ├── world.ts
│       ├── collision.ts
│       └── ...
└── ecs/
    └── physics2d-system.ts  # Physics PLUGIN (ECS integration)
```

Both should be together since the plugin depends on the engine.

## Target Structure

```
src/
├── core/                       # Core ECS (internal primitives)
│   ├── index.ts
│   ├── component.ts            # Component definition & storage
│   ├── entity.ts               # Entity class & pool
│   ├── entity-id.ts            # ID allocation
│   ├── world.ts                # World & EntityBuilder
│   ├── query.ts                # Query engine
│   ├── system.ts               # System scheduler
│   ├── snapshot.ts             # Snapshot & rollback buffer
│   ├── string-registry.ts      # String interning
│   ├── input-history.ts        # Input history for rollback
│   └── constants.ts            # MAX_ENTITIES, SYSTEM_PHASES, etc.
│
├── components/                 # Built-in ECS components
│   ├── index.ts
│   ├── transform2d.ts          # Transform2D
│   ├── body2d.ts               # Body2D + constants (BODY_DYNAMIC, etc.)
│   ├── sprite.ts               # Sprite + constants (SHAPE_CIRCLE, etc.)
│   ├── player.ts               # Player
│   ├── health.ts               # Health
│   └── input-state.ts          # InputState
│
├── plugins/                    # Optional plugins (add via game.addPlugin)
│   ├── index.ts
│   ├── auto-renderer.ts        # AutoRenderer
│   ├── input-plugin.ts         # InputPlugin
│   ├── debug-ui.ts             # enableDebugUI
│   ├── physics2d/              # Physics2DSystem + implementation
│   │   ├── index.ts
│   │   ├── system.ts           # Physics2DSystem plugin
│   │   ├── world.ts            # Physics world simulation
│   │   ├── collision.ts        # Collision detection
│   │   ├── shapes.ts           # Shape primitives
│   │   ├── rigid-body.ts       # Rigid body physics
│   │   ├── layers.ts           # Collision layers
│   │   └── trigger.ts          # Trigger/sensor handling
│   └── physics3d/              # Physics3DSystem + implementation (same structure)
│       ├── index.ts
│       ├── system.ts           # Physics3DSystem plugin (to be created)
│       ├── world.ts            # 3D physics world
│       ├── collision.ts        # 3D collision detection
│       ├── shapes.ts           # 3D shape primitives
│       ├── rigid-body.ts       # 3D rigid body physics
│       ├── layers.ts           # Collision layers
│       ├── raycast.ts          # 3D raycasting
│       ├── state.ts            # Physics state
│       └── trigger.ts          # Trigger/sensor handling
│
├── math/                       # Fixed-point math (unchanged)
│   ├── index.ts
│   ├── fixed.ts
│   ├── vec.ts
│   ├── quat.ts
│   └── random.ts
│
├── sync/                       # Rollback networking (unchanged)
│   ├── index.ts
│   └── rollback.ts
│
├── codec/                      # Binary encoding (unchanged)
│   ├── index.ts
│   └── binary.ts
│
├── input/                      # Low-level input capture (used by input-plugin)
│   ├── index.ts
│   ├── input-capture.ts
│   ├── command-processor.ts
│   ├── prediction-buffer.ts
│   └── keys.ts
│
├── game.ts                     # Game class (high-level API)
└── index.ts                    # Public exports
```

## Migration Steps

### Phase 1: Create new folder structure (no breaking changes)

```bash
# Create new folders
mkdir -p src/core
mkdir -p src/plugins/physics2d
```

### Phase 2: Move core ECS files

| From | To |
|------|-----|
| `ecs/component.ts` | `core/component.ts` |
| `ecs/entity.ts` | `core/entity.ts` |
| `ecs/entity-id.ts` | `core/entity-id.ts` |
| `ecs/world.ts` | `core/world.ts` |
| `ecs/query.ts` | `core/query.ts` |
| `ecs/system.ts` | `core/system.ts` |
| `ecs/snapshot.ts` | `core/snapshot.ts` |
| `ecs/string-registry.ts` | `core/string-registry.ts` |
| `ecs/input-history.ts` | `core/input-history.ts` |
| `ecs/constants.ts` | `core/constants.ts` |

### Phase 3: Split and move components

| From | To |
|------|-----|
| `ecs/components.ts` | Split into individual files in `components/` |

Create:
- `components/transform2d.ts`
- `components/body2d.ts`
- `components/sprite.ts`
- `components/player.ts`
- `components/health.ts`
- `components/input-state.ts`
- `components/index.ts`

### Phase 4: Move plugins

| From | To |
|------|-----|
| `ecs/auto-renderer.ts` | `plugins/auto-renderer.ts` |
| `ecs/input-plugin.ts` | `plugins/input-plugin.ts` |
| `debug-ui.ts` | `plugins/debug-ui.ts` |

**Physics2D** - Merge plugin + engine into one folder:

| From | To |
|------|-----|
| `ecs/physics2d-system.ts` | `plugins/physics2d/system.ts` (the plugin) |
| `components/physics2d/world.ts` | `plugins/physics2d/world.ts` (engine) |
| `components/physics2d/collision.ts` | `plugins/physics2d/collision.ts` (engine) |
| `components/physics2d/shapes.ts` | `plugins/physics2d/shapes.ts` (engine) |
| `components/physics2d/rigid-body.ts` | `plugins/physics2d/rigid-body.ts` (engine) |
| `components/physics2d/layers.ts` | `plugins/physics2d/layers.ts` (engine) |
| `components/physics2d/trigger.ts` | `plugins/physics2d/trigger.ts` (engine) |

**Physics3D** - Move engine, create plugin:

| From | To |
|------|-----|
| `components/physics3d/*` | `plugins/physics3d/*` (engine files) |
| (new file) | `plugins/physics3d/system.ts` (plugin to be created) |

**Note:** Physics3DSystem plugin (`plugins/physics3d/system.ts`) needs to be created to match Physics2DSystem pattern:

```typescript
// plugins/physics3d/system.ts (to be created)
export interface Physics3DSystemConfig {
    gravity?: { x: number; y: number; z: number };
}

export class Physics3DSystem {
    // Same pattern as Physics2DSystem
    // Allows: game.addPlugin(Physics3DSystem, { gravity: { x: 0, y: -9.8, z: 0 } })
}
```

### Phase 5: Move game.ts

| From | To |
|------|-----|
| `ecs/game.ts` | `game.ts` (root of src/) |

### Phase 6: Update imports

Update all internal imports to use new paths.

### Phase 7: Update index.ts exports

```typescript
// src/index.ts

// Core (internal, but exported for advanced use)
export * from './core';

// Components
export * from './components';

// Plugins
export { AutoRenderer } from './plugins/auto-renderer';
export { InputPlugin } from './plugins/input-plugin';
export { Physics2DSystem } from './plugins/physics2d';
export { enableDebugUI } from './plugins/debug-ui';

// Game (main entry point)
export { Game, createGame, Prefab } from './game';

// Math
export * from './math';

// Sync
export * from './sync';

// Codec
export * as codec from './codec';
```

### Phase 8: Delete old structure

```bash
rm -rf src/ecs
rm -rf src/components/physics2d  # Now in plugins/physics2d
rm -rf src/components/physics3d  # If not used, delete; otherwise move to plugins/
```

### Phase 9: Update documentation

Update any docs referencing old file paths.

## Files to Delete

### After migration (old structure)

These become empty/obsolete after moving files:

| Delete | Reason |
|--------|--------|
| `src/ecs/` (entire folder) | All files moved to `core/`, `components/`, `plugins/`, or `game.ts` |
| `src/components/` (entire folder) | `physics2d/` and `physics3d/` moved to `plugins/` |
| `src/debug-ui.ts` | Moved to `plugins/debug-ui.ts` |
| `src/input/` | **DEAD CODE** - not imported anywhere outside itself |

## Breaking Changes

**None for public API** - All exports remain the same, just internal reorganization.

Internal imports will change, but that's contained within the engine package.

## Verification

After refactor:

1. `npm run build` passes
2. `npm test` passes
3. All examples still work
4. Documentation code samples still valid

## Estimated Effort

| Phase | Files | Effort |
|-------|-------|--------|
| 1-2 | 10 files | Small |
| 3 | 1 file → 7 files | Medium |
| 4 | 5 files + 7 files | Medium |
| 5-6 | All files | Medium (import updates) |
| 7-9 | 3 files | Small |

**Total: ~2-3 hours of focused work**

## Decision Needed

1. **Keep physics3d?** - Currently in `components/physics3d/`. Keep, move to plugins, or delete?
2. **Keep input/ folder?** - Is it used separately from InputPlugin, or should it merge into plugins/input-plugin/?
