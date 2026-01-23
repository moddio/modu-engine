# Engine API

Complete reference for the Modu Engine ECS API.

## Game Creation

```javascript
import { createGame } from 'modu';

const game = createGame();
```

## Plugins

Plugins extend the game with additional functionality.

### Adding Plugins

```javascript
// Physics
const physics = game.addPlugin(Physics2DSystem, {
    gravity: { x: 0, y: -100 }
});

// Rendering
const renderer = game.addPlugin(AutoRenderer, canvas, {
    scale: 1,
    smoothing: true
});

// Input
const input = game.addPlugin(InputPlugin, canvas);
```

### Built-in Plugins

| Plugin | Purpose |
|--------|---------|
| `Physics2DSystem` | 2D physics simulation and collision detection |
| `AutoRenderer` | Automatic canvas rendering based on Sprite components |
| `InputPlugin` | Declarative input handling with action bindings |

## Entity Definition

Define entity types using the fluent builder API:

```javascript
game.defineEntity('player')
    .with(Transform2D)
    .with(Body2D, { radius: 20, bodyType: BODY_KINEMATIC })
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
    .with(Player)
    .register();
```

### `.with(Component, defaults?)`

Add a component to the entity definition with optional default values.

### `.syncOnly(fields)`

Specify which component fields to include in network snapshots. If not called, all fields are synced (default).

```javascript
game.defineEntity('snake-segment')
    .with(Transform2D)
    .with(Sprite)
    .with(SnakeSegment)
    .syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])  // Only sync these 4 fields
    .register();
```

### `.syncNone()`

Exclude all fields from syncing. The entity will not be included in network snapshots at all. Use for purely client-local entities like cameras, UI, or effects.

```javascript
game.defineEntity('local-camera')
    .with(Camera2D)
    .syncNone()
    .register();
```

### `.onRestore(callback)`

Set a callback to reconstruct non-synced fields after snapshot load.

```javascript
game.defineEntity('snake-segment')
    .with(Transform2D)
    .with(Sprite)
    .with(SnakeSegment)
    .syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])
    .onRestore((entity, game) => {
        // Reconstruct color from owner
        const owner = game.world.getEntityByClientId(entity.get(SnakeSegment).ownerId);
        if (owner) entity.get(Sprite).color = owner.get(Sprite).color;
    })
    .register();
```

### `.register()`

Register the entity type. Returns a Prefab that can be used to spawn entities.

```javascript
const PlayerPrefab = game.defineEntity('player')
    .with(Transform2D)
    .with(Player)
    .register();

// Spawn using prefab
const entity = PlayerPrefab.spawn({ x: 100, y: 100 });
```

## Spawning Entities

### `game.spawn(type, props?)`

Create an entity of the specified type.

```javascript
const entity = game.spawn('player', {
    x: 100,
    y: 200,
    clientId: 'abc123',
    color: game.internString('color', '#ff0000')
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Entity type name |
| `props` | `object` | Initial property values |

**Common props:**
- `x`, `y` - Position (sets Transform2D)
- `clientId` - Player ownership (sets Player component)
- `color` - Sprite color (interned string ID)

## Querying Entities

### `game.query(type)`

Query entities by type name. Returns an iterator.

```javascript
for (const entity of game.query('player')) {
    const pos = entity.get(Transform2D);
    console.log(pos.x, pos.y);
}
```

### `game.query(Component)`

Query entities that have a specific component.

```javascript
for (const entity of game.query(Transform2D)) {
    // All entities with Transform2D
}
```

### Query Methods

Queries return an iterator with additional helper methods:

```javascript
const query = game.query('player');

// Iteration
for (const entity of query) { }

// Helper methods
query.toArray()              // Entity[] - Convert to array
query.first()                // Entity | undefined - Get first match
query.count()                // number - Count without allocating
query.find(e => e.x > 0)     // Entity | undefined - Find with predicate
```

| Method | Returns | Description |
|--------|---------|-------------|
| `toArray()` | `Entity[]` | Collects all matching entities into an array |
| `first()` | `Entity \| undefined` | Returns first entity or undefined if empty |
| `count()` | `number` | Counts entities without creating an array |
| `find(predicate)` | `Entity \| undefined` | Returns first entity matching predicate |

### `game.getEntitiesByType(type)`

Get all entities of a type as an array.

```javascript
const players = game.getEntitiesByType('player');
```

### `game.getEntityByClientId(clientId)`

Get the entity owned by a specific client. O(1) lookup.

```javascript
const playerEntity = game.getEntityByClientId('abc123');
```

### `game.getPlayers()`

Get all entities with the Player component.

```javascript
for (const player of game.getPlayers()) {
    // Process each player
}
```

### `game.getAllEntities()`

Get all active entities.

```javascript
const all = game.getAllEntities();
```

## Connection

### `game.connect(roomId, callbacks, options?)`

Connect to a multiplayer room.

```javascript
game.connect('my-room', callbacks, {
    nodeUrl: 'wss://my-server.com/ws',
    centralServiceUrl: 'https://my-server.com',
    debug: true
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `roomId` | `string` | Room identifier |
| `callbacks` | `object` | Game callbacks object |
| `options.nodeUrl` | `string` | Direct WebSocket URL |
| `options.centralServiceUrl` | `string` | Central service URL |
| `options.debug` | `boolean` | Enable debug logging |

## Game Callbacks

```javascript
const callbacks = {
    onRoomCreate() {
        // Called once when room is created (not for late joiners)
        for (let i = 0; i < 20; i++) spawnFood();
    },

    onConnect(clientId) {
        // Called when any client connects
        spawnPlayer(clientId);
    },

    onDisconnect(clientId) {
        // Called when a client disconnects
        game.getEntityByClientId(clientId)?.destroy();
    },

    onSnapshot(entities) {
        // Called after snapshot restore (late joiners only)
        for (const entity of entities) {
            // Set up non-serializable state
        }
    },

    onTick(frame) {
        // Called every simulation frame
    },

    render() {
        // Called every render frame (if not using AutoRenderer)
    }
};
```

### Callback Reference

| Callback | When Called | Late Joiner? |
|----------|-------------|--------------|
| `onRoomCreate()` | Room first created | No |
| `onConnect(clientId)` | Client connects | Yes |
| `onDisconnect(clientId)` | Client disconnects | Yes |
| `onSnapshot(entities)` | After snapshot restore | Yes (only) |
| `onTick(frame)` | Every simulation frame | Yes |
| `render()` | Every render frame | Yes |

## Systems

### `game.addSystem(fn, options?)`

Add a system that runs each frame.

```javascript
game.addSystem(() => {
    for (const entity of game.query('player')) {
        // Update logic
    }
}, { phase: 'update', order: 0 });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `phase` | `string` | `'update'` | Execution phase |
| `order` | `number` | `0` | Order within phase |
| `client` | `boolean` | `false` | Client-only system |

### System Phases

Systems run in this order each frame:

1. `'input'` - Apply network inputs
2. `'update'` - Game logic
3. `'prePhysics'` - Pre-physics setup
4. `'physics'` - Physics simulation
5. `'postPhysics'` - Post-physics cleanup
6. `'render'` - Rendering (client only)

### Removing Systems

```javascript
const unregister = game.addSystem(() => { /* ... */ });
unregister();  // Remove the system
```

## State Methods

### `game.frame`

Get the current simulation frame number.

```javascript
const frame = game.frame;
```

### `game.time`

Get deterministic time in milliseconds (frame * tick interval). Use this instead of `Date.now()` for game logic to maintain determinism.

```javascript
const RESPAWN_TIME = 3000; // 3 seconds
deadPlayers.set(clientId, game.time + RESPAWN_TIME);

// Later, check if respawn time has passed
if (game.time >= respawnTime) {
    spawnPlayer(clientId);
}
```

### `game.localClientId`

The local client's ID (string).

```javascript
if (entity.get(Player).clientId === game.localClientId) {
    // This is my entity
}
```

### `game.getClients()`

Get all connected client IDs.

```javascript
for (const clientId of game.getClients()) {
    console.log('Connected:', clientId);
}
```

### `game.getStateHash()`

Get the current state hash for sync verification.

```javascript
const hash = game.getStateHash();
```

### `game.isAuthority()`

Check if this client is the snapshot authority.

```javascript
if (game.isAuthority()) {
    console.log('This client sends snapshots');
}
```

### `game.isConnected()`

Check if connected to the network.

```javascript
if (game.isConnected()) {
    // Online
}
```

### `game.getRenderAlpha()`

Get interpolation alpha (0-1) for smooth rendering.

```javascript
const alpha = game.getRenderAlpha();
```

## String Interning

For determinism, strings are converted to integer IDs.

### `game.internString(namespace, value)`

Get or create an integer ID for a string.

```javascript
const colorId = game.internString('color', '#ff0000');
sprite.color = colorId;
```

### `game.getString(namespace, id)`

Look up a string by its ID.

```javascript
const colorStr = game.getString('color', colorId);  // '#ff0000'
```

## World Access

### `game.world`

Access the underlying ECS World for low-level operations.

```javascript
game.world.entityCount  // Total active entities
game.world.frame        // Current frame
game.world.reset()      // Clear all entities
```

### `game.world.getEntity(eid)`

Get an entity by its entity ID. Returns `null` if entity doesn't exist or is destroyed.

```javascript
const entity = game.world.getEntity(eid);
if (entity) {
    console.log(entity.type);  // Entity type name
}
```

### `game.world.getInput(clientId)`

Get the current input data for a client. Returns the input object or `undefined` if no input recorded.

```javascript
// In a system or callback
for (const player of game.query('player')) {
    const clientId = player.get(Player).clientId;
    const input = game.world.getInput(clientId);
    if (input?.target) {
        player.moveTowardsWithStop(input.target, 5, 20);
    }
}
```

## Entity Properties

Entities have several important properties:

### `entity.eid`

The entity ID (number). Unique identifier for this entity.

```javascript
const entity = game.spawn('player', { x: 100, y: 100 });
console.log(entity.eid);  // e.g., 1
```

### `entity.type`

The entity type name (string).

```javascript
console.log(entity.type);  // 'player'
```

### `entity.destroyed`

Whether the entity has been destroyed (boolean). Always check this before accessing entity data.

```javascript
if (!entity.destroyed) {
    const pos = entity.get(Transform2D);
    console.log(pos.x, pos.y);
}
```

### `entity.render`

Render-only state for interpolation and screen position. Client-only, never serialized.

```javascript
// In render callback
const render = entity.render;
console.log(render.interpX, render.interpY);  // Interpolated position
console.log(render.screenX, render.screenY);  // Screen coordinates
console.log(render.prevX, render.prevY);      // Previous tick position
console.log(render.visible);                   // Visibility flag
```

| Field | Type | Description |
|-------|------|-------------|
| `prevX`, `prevY` | number | Previous tick position |
| `interpX`, `interpY` | number | Interpolated position (computed each render) |
| `screenX`, `screenY` | number | Screen coordinates after camera transform |
| `visible` | boolean | Whether entity is visible |

## Complete Example

```javascript
import { createGame, Transform2D, Body2D, Sprite, Player,
         Physics2DSystem, AutoRenderer, InputPlugin,
         SHAPE_CIRCLE, BODY_KINEMATIC, BODY_STATIC, dRandom } from 'modu';

const canvas = document.getElementById('game');
const game = createGame();

// Plugins
game.addPlugin(AutoRenderer, canvas);
const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });
const input = game.addPlugin(InputPlugin, canvas);
input.action('target', { type: 'vector', bindings: ['mouse'] });

// Entity definitions
game.defineEntity('player')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20, layer: 1 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 20, bodyType: BODY_KINEMATIC })
    .with(Player)
    .register();

game.defineEntity('food')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 8 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 8, bodyType: BODY_STATIC })
    .register();

// Systems - run every frame on all clients
game.addSystem(() => {
    const target = input.get('target');
    for (const entity of game.query('player')) {
        const player = entity.get(Player);
        // Only control your own player
        if (player.clientId === game.localClientId && target) {
            entity.moveTowardsWithStop(target, 5, entity.get(Sprite).radius);
        }
    }
}, { phase: 'update' });

// Collision handling - runs on all clients
physics.onCollision('player', 'food', (player, food) => {
    if (food.destroyed) return;
    player.get(Sprite).radius += 2;
    player.get(Body2D).radius += 2;
    food.destroy();
});

// Callbacks - run on ALL clients (deterministic)
const callbacks = {
    onRoomCreate() {
        // Only first client runs this
        for (let i = 0; i < 20; i++) {
            game.spawn('food', {
                x: dRandom() * 800,
                y: dRandom() * 600,
                color: game.internString('color', '#44ff44')
            });
        }
    },
    onConnect(clientId) {
        // Runs on all clients when anyone connects
        game.spawn('player', {
            x: dRandom() * 800,
            y: dRandom() * 600,
            clientId,
            color: game.internString('color', '#ff0000')
        });
    },
    onDisconnect(clientId) {
        game.getEntityByClientId(clientId)?.destroy();
    }
};

game.connect('my-game', callbacks);
```

## Next Steps

- [Entities](./entities.md) - Entity system details
- [Components](./components.md) - Built-in components
- [Systems](./systems.md) - Writing systems
- [Game Lifecycle](./game-lifecycle.md) - Callback flow
