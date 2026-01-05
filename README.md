# Modu Engine

Deterministic multiplayer game engine with rollback networking and fixed-point physics.

## Features

- **Rollback Netcode**: GGPO-style client-side prediction with automatic state sync
- **Fixed-Point Math**: 16.16 format integers for 100% cross-platform determinism
- **2D & 3D Physics**: Rigid body simulation with circles, boxes, spheres, and collision detection
- **OOP Entity System**: Class-based entities with `tick()` and `draw()` lifecycle methods
- **Declarative Input**: `InputComponent` with `setCommands()` for automatic input handling
- **Built-in Player Class**: Extends `Entity2D` with input handling out of the box
- **Deterministic RNG**: Seeded `dRandom()` for reproducible randomness
- **Late Joiner Sync**: Automatic snapshot-based synchronization for players joining mid-game
- **Zero External Dependencies**: Pure TypeScript, no runtime dependencies

## Installation

```bash
npm install modu-engine
```

## Quick Start

```html
<canvas id="game" width="800" height="600"></canvas>
<script src="modu.iife.js"></script>
<script>
const game = Modu.init({ physics: '2d', gravity: { x: 0, y: 0 } });
const renderer = new CanvasRenderer('#game');
const WIDTH = renderer.width, HEIGHT = renderer.height;

function createPlayer(clientId) {
    const player = new Player();
    player.setBody({
        type: 'kinematic', shape: 'circle', radius: 20,
        x: 100 + (dRandom() * (WIDTH - 200)) | 0,
        y: 100 + (dRandom() * (HEIGHT - 200)) | 0
    });
    player.input.setCommands({ target: { mouse: ['position'] } });
    player.sync.clientId = clientId;
    player.sync.color = '#' + ((dRandom() * 0xFFFFFF) | 0).toString(16).padStart(6, '0');
    player.sync.radius = 20;
    return player;
}

function createFood() {
    const food = new Entity2D('food');
    food.setBody({
        type: 'static', shape: 'circle', radius: 8,
        x: 50 + (dRandom() * (WIDTH - 100)) | 0,
        y: 50 + (dRandom() * (HEIGHT - 100)) | 0
    });
    food.sync.color = '#44ff44';
    food.sync.radius = 8;
    return food;
}

const callbacks = {
    onRoomCreate() {
        game.reset();
        for (let i = 0; i < 20; i++) createFood();
    },

    onLeave(clientId) {
        game.getPlayer(clientId)?.destroy();
    },

    onTick() {
        for (const clientId of game.getClients()) {
            if (!game.getPlayer(clientId)) createPlayer(clientId);
        }

        for (const player of game.getEntitiesByType('player')) {
            const target = player.input?.target;
            if (target?.x != null && target?.y != null) {
                player.moveToward(target.x, target.y, 5, player.sync.radius);
            }
        }
    }
};

game.connect('my-game', callbacks);
Modu.enableDebugUI(game);
</script>
```

## Core Concepts

### Game Initialization

Initialize the engine with `Modu.init()`:

```javascript
const game = Modu.init({
    physics: '2d',           // Required: '2d' or '3d'
    gravity: { x: 0, y: 0 }  // Optional: default { x: 0, y: -30 }
});
```

**Game Object Methods:**
| Method | Description |
|--------|-------------|
| `connect(roomId, callbacks, options?)` | Connect to multiplayer room |
| `getClientId()` | Get local client ID |
| `getClients()` | Get all connected client IDs |
| `getPlayer(clientId)` | Get player entity by client ID |
| `getEntitiesByType(type)` | Get all entities of a type |
| `reset()` | Clear all entities |
| `getFrame()` | Get current server frame |

### Game Callbacks

Games implement lifecycle callbacks passed to `game.connect()`:

```javascript
const callbacks = {
    // Called when room is created - initialize game state
    onRoomCreate() {
        game.reset();
        for (let i = 0; i < 20; i++) new Food();
    },

    // Called when a player joins (optional)
    onJoin(clientId) {
        console.log('Player joined:', clientId);
    },

    // Called when a player leaves
    onLeave(clientId) {
        game.getPlayer(clientId)?.destroy();
    },

    // Called every simulation frame
    onTick() {
        // Spawn players for connected clients
        for (const clientId of game.getClients()) {
            if (!game.getPlayer(clientId)) new MyPlayer(clientId);
        }
    }
};

game.connect('my-room', callbacks);
```

**Note:** There is no `onInput` callback. Input is handled automatically via `InputComponent`.

### Entity2D

Create game entities with `new Entity2D(type)`:

```javascript
const food = new Entity2D('food');
food.setBody({ type: 'static', shape: 'circle', radius: 8, x: 100, y: 100 });
food.sync.color = '#44ff44';
food.sync.radius = 8;
```

**Properties:**
```javascript
entity.id       // Unique ID (e.g., "00000001")
entity.type     // Type string (e.g., "bullet", "food")
entity.x, entity.y  // Position (float)
entity.body     // Physics body
entity.sync     // Synced state (serialized in snapshots)
```

**Methods:**
```javascript
entity.setBody({ type, shape, ... })  // Set up physics body
entity.moveTo(x, y)         // Set position
entity.moveBy(dx, dy)       // Move by offset
entity.moveToward(x, y, speed, stopRadius)  // Move toward target
entity.destroy()            // Destroy entity
```

**Collision handling:**
```javascript
entity.onCollision = (other) => {
    if (other.type === 'food') {
        entity.sync.radius += 2;
        other.destroy();
    }
};
```

### Player

`Player` is an entity with built-in `InputComponent`:

```javascript
const player = new Player();
player.setBody({ type: 'kinematic', shape: 'circle', radius: 20, x: 100, y: 100 });
player.input.setCommands({ target: { mouse: ['position'] } });
player.sync.clientId = clientId;
player.sync.color = '#ff0000';
player.sync.radius = 20;
```

### InputComponent

Declarative input - no manual event listeners needed:

```javascript
// Configure what input to track
player.input.setCommands({
    move: { keys: ['w', 'a', 's', 'd'] },
    aim: { mouse: ['position'] },
    fire: { mouse: ['leftButton'] }
});

// Read input in onTick
const move = player.input?.move;
if (move?.w) player.moveBy(0, -5);
if (move?.d) player.moveBy(5, 0);

const aim = player.input?.aim;
if (aim?.x != null) {
    const angle = Math.atan2(aim.y - player.y, aim.x - player.x);
}

if (player.input?.fire) { /* shooting */ }
```

### Synced State (entity.sync)

The `entity.sync` object is automatically serialized in snapshots. Store all gameplay state here:

```javascript
// Set synced properties
entity.sync.color = '#ff0000';
entity.sync.radius = 20;
entity.sync.health = 100;
entity.sync.clientId = clientId;  // For player entities

// Physics auto-syncs position/velocity
entity.sync.x, entity.sync.y       // Position (fixed-point)
entity.sync.vx, entity.sync.vy    // Velocity (fixed-point)
```

### setBody() Options

Configure physics when creating an entity:

```javascript
entity.setBody({
    type: 'kinematic',    // 'static', 'dynamic', or 'kinematic'
    shape: 'circle',      // 'circle' or 'box'
    radius: 20,           // For circles
    width: 50,            // For boxes
    height: 30,           // For boxes
    x: 100, y: 100,       // Initial position
    isSensor: true        // Optional: detect overlaps without collision response
});
```

**Body Types:**
- `static` - Never moves (walls, obstacles)
- `dynamic` - Full physics simulation (projectiles with gravity)
- `kinematic` - User-controlled, no physics response (players)

### CanvasRenderer

Built-in 2D canvas renderer:

```javascript
const renderer = new CanvasRenderer('#game');

// Renderer auto-draws entities based on:
// - entity.sync.radius + entity.sync.color (circles)
// - entity.sync.w + entity.sync.h + entity.sync.color (boxes)

// Or define custom draw() method in entity class:
class MyEntity extends Entity2D {
    draw(ctx, pos) {
        ctx.fillStyle = this.sync.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, this.sync.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}
```

### Deterministic Random

Use `dRandom()` instead of `Math.random()` for deterministic simulation:

```javascript
// Generate deterministic values (0 to 1)
const value = dRandom();
const x = dRandom() * 800;
const color = '#' + ((dRandom() * 0xFFFFFF) | 0).toString(16).padStart(6, '0');
```

### Debug UI

Show live stats overlay:

```javascript
Modu.enableDebugUI(game);
```

Shows: Room ID, Frame, Tick rate, Client ID, State hash, Bandwidth.

## Examples

The `examples/` folder contains complete game demos:

- **cell-eater.html** - Agar.io style (procedural)
- **cell-eater-oop.html** - Agar.io style (OOP classes)
- **2d-shooter.html** - Top-down shooter with WASD + mouse

```bash
# Build and serve
npm run build:browser
npx http-server -p 3001
# Open http://localhost:3001/examples/cell-eater.html
```

## Determinism Requirements

**CRITICAL**: All game simulation MUST be 100% deterministic:

1. **Use `dRandom()`**: Never use `Math.random()` in simulation

2. **Use Frame Counts**: Never use `Date.now()` or wall-clock time

3. **Physics is Handled**: Entity movement methods use fixed-point internally

## Building

```bash
npm run build          # Build for Node.js (dist/)
npm run build:browser  # Build browser bundle (dist/modu.iife.js)
```

## Testing

```bash
npm test               # Run all tests
npm run test:e2e       # Run E2E browser tests (requires network services)
npm run test:e2e:headed  # E2E tests with visible browsers
```

## License

MIT
