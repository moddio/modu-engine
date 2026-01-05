# Engine Architecture

Technical overview of the Modu Engine internals.

## Core Concepts

### Local-First Multiplayer

The engine runs a full deterministic simulation locally. Multiplayer is achieved by syncing inputs, not state:

```
Client A: [Local Simulation] ──input──> Server ──broadcast──> All Clients
Client B: [Local Simulation] <──────────────────────────────────────────
Client C: [Local Simulation] <──────────────────────────────────────────
```

All clients run identical simulations. Given the same inputs in the same order, they compute identical results.

### Determinism Requirements

- **Fixed-point math**: All physics uses 16.16 fixed-point integers (no floats)
- **Sorted iteration**: Queries return entities in deterministic order
- **Seeded random**: `dRandom()` produces identical sequences across clients
- **Frame-based timing**: Use `game.frame`, never `Date.now()`

## Directory Structure

```
src/
├── ecs/                 # Entity Component System
│   ├── game.ts          # High-level Game API
│   ├── world.ts         # Entity management, queries
│   ├── entity.ts        # Entity wrapper
│   ├── component.ts     # Component storage (SoA)
│   ├── components.ts    # Built-in components
│   ├── query.ts         # Query engine
│   ├── system.ts        # System scheduler
│   ├── snapshot.ts      # State snapshots
│   ├── physics2d-system.ts  # Physics plugin
│   ├── auto-renderer.ts     # Rendering plugin
│   └── input-plugin.ts      # Input plugin
│
├── components/          # Physics implementations
│   ├── physics2d/       # 2D physics engine
│   └── physics3d/       # 3D physics engine
│
├── math/                # Deterministic math
│   ├── fixed.ts         # 16.16 fixed-point
│   ├── vec.ts           # Vector operations
│   └── random.ts        # Seeded PRNG
│
├── sync/                # Rollback netcode
│   └── rollback.ts      # GGPO-style rollback
│
└── codec/               # Binary encoding
    └── binary.ts        # Snapshot serialization
```

## ECS Architecture

### Components

Structure of Arrays (SoA) storage for cache efficiency:

```typescript
// Each component field stored as typed array
Transform2D:
  x: Int32Array[MAX_ENTITIES]      // Fixed-point
  y: Int32Array[MAX_ENTITIES]      // Fixed-point
  angle: Int32Array[MAX_ENTITIES]  // Fixed-point
```

Components are defined with `defineComponent()`:

```typescript
const Health = defineComponent('Health', {
    current: 100,
    max: 100
});
```

### Entities

Entities are just IDs (32-bit: 20-bit index + 12-bit generation). The `Entity` class is a wrapper providing component access:

```typescript
entity.get(Transform2D).x = 100;
entity.has(Health);
entity.destroy();
```

### Systems

Functions that run each frame in defined phases:

```
Frame execution order:
1. input       - Apply network inputs to InputState
2. update      - Game logic
3. prePhysics  - Pre-physics preparation
4. physics     - Physics simulation
5. postPhysics - React to physics results
6. render      - Drawing (client only)
```

### Queries

O(1) entity lookup by type or component:

```typescript
game.query('player')        // By type name
game.query(Transform2D)     // By component
game.getEntityByClientId()  // O(1) player lookup
```

## Networking

### Input Flow

```
1. Player input captured locally
2. Applied immediately (prediction)
3. Sent to server
4. Server assigns sequence number, broadcasts
5. All clients apply at same frame
6. If misprediction: rollback + resimulate
```

### Snapshots

Used for late joiners only (not for sync correction):

```typescript
// Sparse snapshot format
{
    frame: number,
    entityMask: Uint8Array,      // Which entities exist
    componentData: ArrayBuffer,   // Packed component values
    strings: Map<string, Map<string, number>>  // Interned strings
}
```

### Rollback

GGPO-style predict-verify-rollback:

1. **Predict**: Apply local input immediately
2. **Verify**: Compare hash when server confirms
3. **Rollback**: If wrong, restore snapshot + resimulate

## Plugins

Plugins extend Game via `game.addPlugin()`:

### Physics2DSystem

- Deterministic 2D physics with fixed-point math
- Collision detection (circle-circle, rect-rect, circle-rect)
- Body types: DYNAMIC, STATIC, KINEMATIC
- Sensor/trigger support

### AutoRenderer

- Automatic canvas rendering from Sprite components
- Interpolation between simulation frames
- Layer-based z-ordering

### InputPlugin

- Declarative input binding (`action('move', { bindings: ['keys:wasd'] })`)
- Vector and button action types
- Automatic network sync

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State storage | Components only | No external bags, everything typed and serializable |
| Entity destruction | Immediate | Destroyed entities removed from indices same frame |
| Render state | Separate `entity.render` | Client-only, never serialized |
| Snapshot usage | Late joiners only | Trust determinism, don't correct drift |
| Physics | Fixed-point | Cross-platform bit-exact determinism |

## Performance Considerations

- **SoA storage**: Cache-friendly iteration
- **Sparse snapshots**: Only serialize non-default values
- **Query caching**: Incremental index updates
- **Entity pooling**: Reuse entity objects
- **Fixed-point**: Integer math faster than float on some platforms
