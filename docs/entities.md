# Entities

Entities are unique identifiers with attached components in Modu's ECS architecture.

## Defining Entity Types

Define entity types using the fluent builder API:

```javascript
game.defineEntity('player')
    .with(Transform2D)
    .with(Body2D, { radius: 20, bodyType: BODY_KINEMATIC })
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20, layer: 1 })
    .with(Player)
    .register();
```

### `.with(Component, defaults?)`

Add a component with optional default values:

```javascript
game.defineEntity('food')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 8 })
    .with(Body2D, {
        shapeType: SHAPE_CIRCLE,
        radius: 8,
        bodyType: BODY_STATIC,
        isSensor: true
    })
    .register();
```

### Prefabs

`.register()` returns a Prefab for convenient spawning:

```javascript
const FoodPrefab = game.defineEntity('food')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 8 })
    .register();

// Spawn using prefab
const food = FoodPrefab.spawn({ x: 100, y: 100 });
```

### Bandwidth Optimization with `.syncOnly()` and `.onRestore()`

For entities with many components where only a few fields are unique (like snake segments that all share the same color), you can reduce snapshot bandwidth by only syncing essential fields:

```javascript
game.defineEntity('snake-segment')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 14 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 14, bodyType: BODY_KINEMATIC })
    .with(SnakeSegment)
    .syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])  // Only sync these fields
    .onRestore((entity, game) => {
        // Reconstruct non-synced fields from the owner
        const owner = game.world.getEntityByClientId(entity.get(SnakeSegment).ownerId);
        if (owner) {
            entity.get(Sprite).color = owner.get(Sprite).color;
        }
    })
    .register();
```

**`.syncOnly(fields)`** - Specify which component fields to include in network snapshots. If not called, all fields are synced (default behavior).

**`.syncNone()`** - Exclude all fields from syncing. The entity will not be included in network snapshots at all. Useful for purely client-local entities:

```javascript
game.defineEntity('local-camera')
    .with(Camera2D)
    .syncNone()  // Never synced - each client has their own
    .register();
```

**`.onRestore(callback)`** - Called after loading a snapshot to reconstruct non-synced fields. The callback receives the entity and game instance.

**Bandwidth savings example:**
- Without `.syncOnly()`: 70 segments × 29 fields × 4 bytes = **8.1KB**
- With `.syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])`: 70 segments × 4 fields × 4 bytes = **1.1KB**
- **Savings: 87%**

**Note:** For component-level sync control (the entire component never syncs), use `defineComponent` with `{ sync: false }`. See [Components - Sync Options](./components.md#sync-options).

## Spawning Entities

### `game.spawn(type, props?)`

```javascript
const entity = game.spawn('player', {
    x: 100,
    y: 200,
    clientId: 'abc123',
    color: game.internString('color', '#ff0000')
});
```

**Common props:**

| Prop | Component | Description |
|------|-----------|-------------|
| `x`, `y` | Transform2D | Position |
| `angle` | Transform2D | Rotation |
| `clientId` | Player | Owner client ID |
| `color` | Sprite | Color (interned string ID) |
| `radius` | Sprite, Body2D | Circle size |
| `width`, `height` | Sprite, Body2D | Box size |

## Entity Properties

```javascript
entity.eid        // Unique entity ID (number)
entity.type       // Type name ('player', 'food', etc.)
entity.destroyed  // true if entity has been destroyed
entity.render     // Client-only render state
entity.input      // Current frame's input (for players)
```

## Accessing Components

### `entity.get(Component)`

Get a component accessor to read/write data:

```javascript
const transform = entity.get(Transform2D);
transform.x = 100;
transform.y = 200;

const sprite = entity.get(Sprite);
sprite.radius = 50;

const body = entity.get(Body2D);
body.vx = 10;
body.vy = 5;
```

### `entity.has(Component)`

Check if an entity has a component:

```javascript
if (entity.has(Player)) {
    const player = entity.get(Player);
    console.log('Client:', player.clientId);
}
```

### Adding/Removing Components

```javascript
// Add component at runtime
entity.addComponent(Health, { current: 100, max: 100 });

// Remove component
entity.removeComponent(Health);

// Get all components
const components = entity.getComponents();
```

## Entity Methods

### Movement Helpers

```javascript
// Move towards a point (deterministic)
entity.moveTowards({ x: 100, y: 100 }, speed);

// Move towards with automatic stop at distance
entity.moveTowardsWithStop({ x: 100, y: 100 }, speed, stopRadius);

// Set velocity directly
entity.setVelocity(vx, vy);

// Stop all movement
entity.stop();
```

### Distance Calculations

```javascript
// Get distance to a point (deterministic)
const dist = entity.distanceTo({ x: 100, y: 100 });

// Check if within a distance
if (entity.isWithin({ x: 100, y: 100 }, 50)) {
    // Within 50 units
}
```

### Destruction

```javascript
entity.destroy();

// Check before accessing
if (!entity.destroyed) {
    const pos = entity.get(Transform2D);
}
```

## Querying Entities

### By Type

```javascript
// Iterator
for (const entity of game.query('player')) {
    const pos = entity.get(Transform2D);
}

// Array
const players = game.getEntitiesByType('player');
```

### By Component

```javascript
for (const entity of game.query(Transform2D)) {
    // All entities with Transform2D
}
```

### By Client ID

```javascript
const playerEntity = game.getEntityByClientId('abc123');
```

### All Players

```javascript
for (const player of game.getPlayers()) {
    // All entities with Player component
}
```

### All Entities

```javascript
const all = game.getAllEntities();
```

## Common Patterns

### Food/Collectible

```javascript
game.defineEntity('food')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 8, layer: 0 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 8, bodyType: BODY_STATIC, isSensor: true })
    .register();

function spawnFood() {
    return game.spawn('food', {
        x: 50 + dRandom() * 700,
        y: 50 + dRandom() * 500,
        color: game.internString('color', '#44ff44')
    });
}
```

### Projectile

```javascript
game.defineEntity('bullet')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 4, layer: 2 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 4, bodyType: BODY_KINEMATIC })
    .register();

function spawnBullet(x, y, angle, ownerId) {
    const bullet = game.spawn('bullet', {
        x, y,
        color: game.internString('color', '#ffcc00')
    });

    // Set velocity from angle
    const body = bullet.get(Body2D);
    body.vx = Math.cos(angle) * 350;
    body.vy = Math.sin(angle) * 350;

    // Store owner for collision handling
    bullet.ownerId = ownerId;
    bullet.life = 60;  // 3 seconds at 20 FPS

    return bullet;
}

// System to handle bullet lifetime
game.addSystem(() => {
    for (const bullet of game.query('bullet')) {
        bullet.life--;
        if (bullet.life <= 0) bullet.destroy();
    }
}, { phase: 'update' });
```

### Wall/Barrier

```javascript
game.defineEntity('wall')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_RECT, layer: 0 })
    .with(Body2D, { shapeType: SHAPE_RECT, bodyType: BODY_STATIC })
    .register();

function spawnWall(x, y, width, height) {
    const wall = game.spawn('wall', { x, y });

    const sprite = wall.get(Sprite);
    sprite.width = width;
    sprite.height = height;
    sprite.color = game.internString('color', '#4a4a5a');

    const body = wall.get(Body2D);
    body.width = width;
    body.height = height;

    return wall;
}
```

### Player with Input

```javascript
game.defineEntity('player')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20, layer: 1 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 20, bodyType: BODY_KINEMATIC })
    .with(Player)
    .register();

function spawnPlayer(clientId) {
    const color = game.internString('color', '#' + ((dRandom() * 0xFFFFFF) | 0).toString(16).padStart(6, '0'));
    return game.spawn('player', {
        x: 100 + dRandom() * 600,
        y: 100 + dRandom() * 400,
        clientId,
        color
    });
}
```

## Render State

Entities have a `render` property for client-side interpolation:

```javascript
// Interpolated position (use for drawing)
entity.render.interpX
entity.render.interpY

// Screen position (after camera transform)
entity.render.screenX
entity.render.screenY

// Visibility
entity.render.visible = false;
```

The engine automatically handles interpolation when using `AutoRenderer`.

## Next Steps

- [Components](./components.md) - Built-in components
- [Systems](./systems.md) - Writing game logic
- [Physics](./physics-2d.md) - Collision handling
