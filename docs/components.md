# Components

Components are pure data containers attached to entities in Modu's ECS architecture.

## Built-in Components

### Transform2D

Position and rotation in 2D space.

```javascript
import { Transform2D } from 'modu';

const transform = entity.get(Transform2D);
transform.x = 100;
transform.y = 200;
transform.angle = Math.PI / 4;  // 45 degrees
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `x` | number | 0 | X position |
| `y` | number | 0 | Y position |
| `angle` | number | 0 | Rotation in radians |

### Body2D

Physics properties for collision and movement.

```javascript
import { Body2D, BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC,
         SHAPE_CIRCLE, SHAPE_RECT } from 'modu';

const body = entity.get(Body2D);
body.vx = 10;          // Velocity X
body.vy = 5;           // Velocity Y
body.radius = 20;      // For circles
body.bodyType = BODY_KINEMATIC;
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `vx` | number | 0 | Velocity X |
| `vy` | number | 0 | Velocity Y |
| `angularVelocity` | number | 0 | Rotational velocity |
| `width` | number | 0 | Box width |
| `height` | number | 0 | Box height |
| `radius` | number | 10 | Circle radius |
| `mass` | number | 1 | Mass for physics |
| `restitution` | number | 0 | Bounciness (0-1) |
| `friction` | number | 0 | Surface friction |
| `bodyType` | number | 0 | BODY_DYNAMIC, BODY_STATIC, or BODY_KINEMATIC |
| `shapeType` | number | 0 | SHAPE_RECT or SHAPE_CIRCLE |
| `isSensor` | boolean | false | Detect overlaps without collision response |

**Body Types:**

| Constant | Value | Behavior |
|----------|-------|----------|
| `BODY_DYNAMIC` | 0 | Full physics simulation |
| `BODY_STATIC` | 1 | Never moves (walls, obstacles) |
| `BODY_KINEMATIC` | 2 | User-controlled, no physics response |

### Sprite

Visual rendering properties.

```javascript
import { Sprite, SHAPE_CIRCLE, SHAPE_RECT } from 'modu';

const sprite = entity.get(Sprite);
sprite.shape = SHAPE_CIRCLE;
sprite.radius = 20;
sprite.color = game.internString('color', '#ff0000');
sprite.layer = 1;
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shape` | number | 0 | SHAPE_RECT, SHAPE_CIRCLE, or SPRITE_IMAGE |
| `width` | number | 0 | Width for rectangles |
| `height` | number | 0 | Height for rectangles |
| `radius` | number | 0 | Radius for circles |
| `color` | number | 0 | Interned color string ID |
| `spriteId` | number | 0 | Interned image ID |
| `offsetX` | number | 0 | Render offset X |
| `offsetY` | number | 0 | Render offset Y |
| `scaleX` | number | 1 | Horizontal scale |
| `scaleY` | number | 1 | Vertical scale |
| `layer` | number | 0 | Z-order (higher = in front) |
| `visible` | boolean | true | Whether to render |

### Player

Marks an entity as player-owned.

```javascript
import { Player } from 'modu';

const player = entity.get(Player);
console.log(player.clientId);  // Owner's client ID
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `clientId` | number | 0 | Interned client ID |

**Note:** `clientId` is automatically interned when spawning with a string:

```javascript
game.spawn('player', { clientId: 'abc123' });  // String auto-interned
```

### Camera2D

2D camera for viewport control. This is a **client-only component** (`sync: false`) - each client manages their own camera independently.

```javascript
import { Camera2D, CameraSystem } from 'modu';

// Add camera system plugin
const cameraSystem = game.addPlugin(CameraSystem);

// Define camera entity
game.defineEntity('camera')
    .with(Camera2D)
    .register();

// Create and use camera
const cameraEntity = game.spawn('camera');
const cam = cameraEntity.get(Camera2D);
cam.x = 100;
cam.y = 200;
cam.zoom = 1.5;

// Set camera on renderer
renderer.camera = cameraEntity;

// Follow an entity
cameraSystem.follow(cameraEntity, playerEntity);
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `x` | number | 0 | Camera center X position |
| `y` | number | 0 | Camera center Y position |
| `zoom` | number | 1 | Current zoom level |
| `targetZoom` | number | 1 | Target zoom for smooth transitions |
| `smoothing` | number | 0.1 | Position/zoom interpolation factor |
| `followEntity` | number | 0 | Entity ID to follow (0 = none) |
| `viewportWidth` | number | 0 | Viewport width (set by renderer) |
| `viewportHeight` | number | 0 | Viewport height (set by renderer) |

**Note:** Camera2D has `sync: false` built-in, meaning:
- Not included in network snapshots
- Not included in state hash computation
- Not included in rollback state

This is correct behavior since each client has their own camera view.

### Health

Basic health component.

```javascript
import { Health } from 'modu';

const health = entity.get(Health);
health.current = 80;
health.max = 100;
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `current` | number | 100 | Current health |
| `max` | number | 100 | Maximum health |

### InputState

Input state for player-controlled entities.

```javascript
import { InputState } from 'modu';

const input = entity.get(InputState);
console.log(input.targetX, input.targetY);  // Target position
console.log(input.moveX, input.moveY);      // Movement direction
console.log(input.buttons);                 // Button bit flags
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targetX` | number | 0 | Target X (mouse, AI target) |
| `targetY` | number | 0 | Target Y |
| `moveX` | number | 0 | Movement direction X (-1 to 1) |
| `moveY` | number | 0 | Movement direction Y (-1 to 1) |
| `buttons` | number | 0 | Button bit flags |

## Defining Custom Components

Use `defineComponent()` to create custom components:

```javascript
import { defineComponent } from 'modu';

const Inventory = defineComponent('Inventory', {
    slots: 0,      // Number fields default to i32
    gold: 0,
    weight: 0
});

// Use in entity definition
game.defineEntity('player')
    .with(Transform2D)
    .with(Inventory, { slots: 10, gold: 100 })
    .register();

// Access in systems
const inv = entity.get(Inventory);
inv.gold += 50;
```

### Field Types

All numeric fields use fixed-point integers (i32) by default for determinism:

```javascript
const Stats = defineComponent('Stats', {
    health: 100,      // i32 (default)
    speed: 5,         // i32
    isAlive: true     // boolean (stored as 0/1)
});
```

**Important:** Avoid floats in components for game state. Use fixed-point math for determinism.

### Sync Options

Components can be excluded from network synchronization using the `sync` option:

```javascript
// Client-only component (not synced)
const LocalEffects = defineComponent('LocalEffects', {
    particleCount: 0,
    screenShake: 0
}, { sync: false });
```

When `sync: false`:
- Component is **not included in network snapshots**
- Component is **not included in state hash computation**
- Component is **not saved/restored during rollback**

This is useful for:
- Camera state (each client has their own view)
- Local visual effects (particles, screen shake)
- UI state
- Debug/development data

**Note:** The built-in `Camera2D` component already has `sync: false` by default.

## String Interning

Strings must be interned to integer IDs for determinism:

```javascript
// Intern a string
const colorId = game.internString('color', '#ff0000');
sprite.color = colorId;

// Look up later
const colorStr = game.getString('color', colorId);  // '#ff0000'
```

Common namespaces:
- `'color'` - Color strings
- `'sprite'` - Sprite/image names
- `'clientId'` - Client identifiers

## Component Data Storage

Components use Structure of Arrays (SoA) for cache efficiency:

```javascript
// Internally, Transform2D stores:
// x: Int32Array[MAX_ENTITIES]
// y: Int32Array[MAX_ENTITIES]
// angle: Int32Array[MAX_ENTITIES]

// Each entity's index maps to these arrays
// entity.get(Transform2D) returns an accessor that reads/writes by index
```

This enables:
- O(1) component access
- Cache-friendly iteration
- Efficient serialization for snapshots

## Using Components in Entity Definitions

```javascript
game.defineEntity('enemy')
    .with(Transform2D)
    .with(Body2D, {
        shapeType: SHAPE_CIRCLE,
        radius: 15,
        bodyType: BODY_DYNAMIC
    })
    .with(Sprite, {
        shape: SHAPE_CIRCLE,
        radius: 15,
        layer: 1
    })
    .with(Health, { current: 50, max: 50 })
    .register();
```

## Checking Component Existence

```javascript
if (entity.has(Health)) {
    const health = entity.get(Health);
    if (health.current <= 0) {
        entity.destroy();
    }
}
```

## Adding/Removing Components at Runtime

```javascript
// Add a component
entity.addComponent(Health, { current: 100, max: 100 });

// Remove a component
entity.removeComponent(Health);

// Get all components on entity
const components = entity.getComponents();  // ComponentType[]
```

## Next Steps

- [Entities](./entities.md) - Entity system
- [Systems](./systems.md) - Writing game logic
- [Physics](./physics-2d.md) - Physics system
