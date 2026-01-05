# Modu Engine

Deterministic multiplayer game engine with rollback networking and fixed-point physics.

## Features

- **Rollback Netcode**: GGPO-style client-side prediction with automatic state sync
- **Fixed-Point Math**: 16.16 format integers for 100% cross-platform determinism
- **ECS Architecture**: Entity-Component-System design with composable behaviors
- **2D Physics**: Rigid body simulation with circles, boxes, and collision detection
- **Plugin System**: Modular renderer, physics, and input plugins
- **Deterministic RNG**: Seeded `dRandom()` for reproducible randomness
- **Late Joiner Sync**: Automatic snapshot-based synchronization for players joining mid-game
- **Zero External Dependencies**: Pure TypeScript, no runtime dependencies

## Installation

```bash
npm install modu-engine
```

Or use the CDN:

```html
<script src="https://cdn.moduengine.com/modu.min.js"></script>
```

## Quick Start

```html
<canvas id="game" width="800" height="600"></canvas>
<script src="https://cdn.moduengine.com/modu.min.js"></script>
<script>
const canvas = document.getElementById('game');
const game = createGame();
game.addPlugin(Simple2DRenderer, canvas);

game.defineEntity('player')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
    .with(Player)
    .register();

const input = game.addPlugin(InputPlugin, canvas);
input.action('move', { type: 'vector', bindings: ['wasd'] });

game.addSystem(() => {
    for (const p of game.query('player')) {
        const dir = game.world.getInput(p.get(Player).clientId)?.move;
        if (dir) p.setVelocity(dir.x * 5, dir.y * 5);
    }
});

game.connect('my-room', {
    onConnect(id) {
        game.spawn('player', {
            x: dRandom() * 800,
            y: dRandom() * 600,
            clientId: id
        });
    }
});
</script>
```

## Core Concepts

### Game Creation

Create a game with `createGame()` and add plugins:

```javascript
const game = createGame();

// Add renderer
game.addPlugin(Simple2DRenderer, canvas);

// Add physics (optional)
const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });

// Add input
const input = game.addPlugin(InputPlugin, canvas);
```

### Defining Entities

Define entity types by composing components:

```javascript
game.defineEntity('player')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 20, bodyType: BODY_KINEMATIC })
    .with(Player)
    .register();

game.defineEntity('bullet')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 4, color: '#ff0' })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 4, bodyType: BODY_KINEMATIC, isSensor: true })
    .register();

game.defineEntity('wall')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_RECT })
    .with(Body2D, { shapeType: SHAPE_RECT, bodyType: BODY_STATIC })
    .register();
```

### Built-in Components

| Component | Description |
|-----------|-------------|
| `Transform2D` | Position (x, y), rotation, scale |
| `Sprite` | Visual rendering (shape, color, radius/width/height) |
| `Body2D` | Physics body (shape, bodyType, isSensor) |
| `Player` | Marks entity as player-controlled, stores clientId |

### Custom Components

Define custom components for game-specific data:

```javascript
const Health = defineComponent('Health', {
    current: 100,
    max: 100
});

const Shooter = defineComponent('Shooter', {
    cooldownUntil: { type: 'f32', default: 0 }
});

const Bullet = defineComponent('Bullet', {
    ownerId: 0,
    expiresAt: { type: 'f32', default: 0 }
});

// Use in entity definition
game.defineEntity('player')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
    .with(Player)
    .with(Health)
    .with(Shooter)
    .register();
```

### Systems

Add systems for game logic. Systems run every tick:

```javascript
// Movement system
game.addSystem(() => {
    for (const player of game.query('player')) {
        const input = game.world.getInput(player.get(Player).clientId);
        if (input?.move) {
            player.setVelocity(input.move.x * 5, input.move.y * 5);
        }
    }
}, { phase: 'update' });

// Bullet lifetime system
game.addSystem(() => {
    for (const bullet of game.query('bullet')) {
        if (game.time >= bullet.get(Bullet).expiresAt) {
            bullet.destroy();
        }
    }
}, { phase: 'update' });
```

### Entity Operations

```javascript
// Spawn entity
const player = game.spawn('player', { x: 100, y: 200, clientId: id });

// Access components
const transform = player.get(Transform2D);
const sprite = player.get(Sprite);
const health = player.get(Health);

// Check for component
if (player.has(DeadState)) { ... }

// Add/remove components dynamically
player.addComponent(DeadState, { respawnAt: game.time + 3000 });
player.removeComponent(DeadState);

// Movement helpers
player.setVelocity(vx, vy);
player.moveTowards(target, speed);
player.moveTowardsWithStop(target, speed, stopRadius);

// Destroy entity
player.destroy();

// Query entities
const players = game.query('player');
const bullets = game.query('bullet');
const allFood = game.getEntitiesByType('food');
const myPlayer = game.getEntityByClientId(clientId);
```

### Input

Define input actions with bindings:

```javascript
const input = game.addPlugin(InputPlugin, canvas);

// Vector input (WASD movement)
input.action('move', { type: 'vector', bindings: ['wasd'] });
input.action('move', { type: 'vector', bindings: ['keys:wasd', 'keys:arrows'] });

// Mouse position
input.action('target', { type: 'vector', bindings: ['mouse'] });

// Button input
input.action('shoot', { type: 'button', bindings: ['mouse:left'] });

// Read input in systems
const input = game.world.getInput(clientId);
if (input?.move) { /* { x, y } */ }
if (input?.target) { /* { x, y } */ }
if (input?.shoot) { /* true/false */ }
```

### Collision Handling

```javascript
const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });

// Collision between types
physics.onCollision('bullet', 'player', (bullet, player) => {
    if (bullet.get(Bullet).ownerId === player.get(Player).clientId) return;
    player.get(Health).current -= 25;
    bullet.destroy();
});

physics.onCollision('bullet', 'wall', (bullet) => {
    bullet.destroy();
});

physics.onCollision('cell', 'food', (cell, food) => {
    cell.get(Sprite).radius += 2;
    food.destroy();
});
```

### Connection & Lifecycle

```javascript
game.connect('my-room', {
    // Called when room is created (first player joins)
    onRoomCreate() {
        // Spawn initial game state
        for (let i = 0; i < 20; i++) spawnFood();
    },

    // Called when a player connects
    onConnect(clientId) {
        game.spawn('player', {
            x: dRandom() * 800,
            y: dRandom() * 600,
            clientId
        });
    },

    // Called when a player disconnects
    onDisconnect(clientId) {
        game.getEntityByClientId(clientId)?.destroy();
    }
});
```

### Game Properties

```javascript
game.time          // Current game time in ms
game.getFrame()    // Current frame number
game.getClientId() // Local player's client ID
game.world         // Access to world state
```

### Deterministic Random

Use `dRandom()` instead of `Math.random()` for deterministic simulation:

```javascript
const value = dRandom();                    // 0 to 1
const x = dRandom() * 800;                  // Random position
const index = (dRandom() * array.length) | 0;  // Random array index
```

### String Interning

For frequently used strings (like colors), use interning to avoid memory issues:

```javascript
const COLORS = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b'];
const colorStr = COLORS[(dRandom() * COLORS.length) | 0];
const color = game.internString('color', colorStr);

game.spawn('player', { x: 100, y: 100, color });
```

### Debug UI

Show live stats overlay:

```javascript
Modu.enableDebugUI(game);
```

Shows: Room ID, Frame, Tick rate, Client ID, State hash, Bandwidth.

## Body Types

| Type | Description |
|------|-------------|
| `BODY_STATIC` | Never moves (walls, obstacles) |
| `BODY_DYNAMIC` | Full physics simulation (projectiles with gravity) |
| `BODY_KINEMATIC` | User-controlled, no physics response (players) |

## Shape Types

| Type | Properties |
|------|------------|
| `SHAPE_CIRCLE` | `radius` |
| `SHAPE_RECT` | `width`, `height` |

## Examples

The `examples/` folder contains complete game demos:

- **cell-eater.html** - Agar.io style game
- **2d-shooter.html** - Top-down shooter with WASD + mouse aiming

```bash
# Build and serve
npm run build:browser
npx http-server -p 3000
# Open http://localhost:3000/examples/cell-eater.html
```

## Determinism Requirements

**CRITICAL**: All game simulation MUST be 100% deterministic:

1. **Use `dRandom()`**: Never use `Math.random()` in simulation
2. **Use Frame Counts**: Never use `Date.now()` or wall-clock time in simulation
3. **Fixed-Point Math**: Physics uses fixed-point internally for cross-platform consistency

## Building

```bash
npm run build          # Build for Node.js (dist/)
npm run build:browser  # Build browser bundle (dist/modu.iife.js)
```

## Testing

```bash
npm test               # Run all tests
npm run test:e2e       # Run E2E browser tests
npm run test:e2e:headed  # E2E tests with visible browsers
```

## License

MIT
