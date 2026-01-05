# Game Lifecycle

Understanding how Modu Engine runs your game.

## Game Callbacks

When you call `game.connect(roomId, callbacks)`, you pass an object with lifecycle callbacks:

```javascript
const callbacks = {
    onRoomCreate() { },
    onConnect(clientId) { },
    onDisconnect(clientId) { },
    onSnapshot(entities) { },
    onTick(frame) { },
    render() { }
};

game.connect('my-room', callbacks);
```

## Callback Execution Order

### On Room Creation (First Client)

```
onRoomCreate()      // Initialize game state
  ↓
onConnect(clientA)  // First client connects
  ↓
Systems run         // First simulation frame
  ↓
onTick(0)           // Post-tick callback
  ↓
render()            // Render frame
```

### On Late Joiner

```
// Snapshot loaded from server (state restored)
  ↓
onSnapshot(entities)  // Set up non-serializable state
  ↓
onConnect(clientB)    // New client connects
  ↓
// Catchup: systems run for each missed frame
  ↓
onTick(frame)         // Continue from current frame
```

### On Disconnect

```
onDisconnect(clientA) // Client disconnects
  ↓
Systems run           // Continue simulation
```

## Callback Details

### `onRoomCreate()`

Called once when a room is created (not for late joiners). Use this to set up initial game state:

```javascript
onRoomCreate() {
    // Spawn initial entities
    for (let i = 0; i < 20; i++) {
        game.spawn('food', {
            x: dRandom() * 800,
            y: dRandom() * 600,
            color: game.internString('color', '#44ff44')
        });
    }
}
```

**Important**: Late joiners do NOT run `onRoomCreate()` - they receive state via snapshot.

### `onConnect(clientId)`

Called when any client connects to the room. Runs on ALL clients.

```javascript
onConnect(clientId) {
    console.log('Player connected:', clientId);

    // Spawn player for this client
    game.spawn('player', {
        x: 400 + dRandom() * 100,
        y: 300 + dRandom() * 100,
        clientId,
        color: game.internString('color', '#ff0000')
    });
}
```

### `onDisconnect(clientId)`

Called when a client disconnects. Runs on ALL remaining clients.

```javascript
onDisconnect(clientId) {
    game.getEntityByClientId(clientId)?.destroy();
}
```

### `onSnapshot(entities)`

Called after snapshot restore for late joiners. Use this to set up non-serializable state.

```javascript
onSnapshot(entities) {
    console.log(`Restored ${entities.length} entities`);

    // Re-attach any runtime state that wasn't serialized
    for (const entity of entities) {
        if (entity.type === 'player') {
            // Set up client-side state
        }
    }
}
```

This callback only fires for late joiners who receive a snapshot.

### `onTick(frame)`

Called after each simulation frame. Use for logic that should run after all systems.

```javascript
onTick(frame) {
    // Log every 60 frames (3 seconds at 20 FPS)
    if (frame % 60 === 0) {
        console.log(`Frame ${frame}, ${game.getAllEntities().length} entities`);
    }
}
```

**Note**: Most game logic should be in systems, not `onTick`. Use `onTick` for debugging or logic that must run after all systems.

### `render()`

Called every render frame. Only needed if you're doing custom rendering instead of using `AutoRenderer`.

```javascript
render() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const entity of game.query(Sprite)) {
        drawEntity(ctx, entity);
    }
}
```

## Frame Execution Order

Each simulation frame runs in this order:

```
1. input phase systems
2. update phase systems
3. prePhysics phase systems
4. physics phase systems
5. postPhysics phase systems
6. onTick() callback
7. render phase systems (client only)
8. render() callback (client only)
```

## Systems vs Callbacks

| Use | When |
|-----|------|
| **Systems** | Game logic that runs every frame |
| **onRoomCreate** | Initial world setup |
| **onConnect** | Spawn player entities |
| **onDisconnect** | Clean up player entities |
| **onSnapshot** | Late joiner initialization |
| **onTick** | Post-system logic, debugging |
| **render** | Custom rendering |

## Common Patterns

### Player Spawning

Spawn players in `onConnect`:

```javascript
onConnect(clientId) {
    const color = game.internString('color',
        '#' + ((dRandom() * 0xFFFFFF) | 0).toString(16).padStart(6, '0')
    );
    game.spawn('player', {
        x: 100 + dRandom() * 600,
        y: 100 + dRandom() * 400,
        clientId,
        color
    });
}
```

### Food Respawning

Use a system for continuous spawning:

```javascript
const FOOD_COUNT = 50;

game.addSystem(() => {
    const current = game.query('food').count();
    for (let i = current; i < FOOD_COUNT; i++) {
        game.spawn('food', {
            x: dRandom() * 800,
            y: dRandom() * 600,
            color: game.internString('color', '#44ff44')
        });
    }
}, { phase: 'update' });
```

### Frame-Based Timers

Use frame counts, never wall-clock time:

```javascript
game.addSystem(() => {
    for (const bullet of game.query('bullet')) {
        bullet.life--;
        if (bullet.life <= 0) {
            bullet.destroy();
        }
    }
}, { phase: 'update' });
```

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
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 8, bodyType: BODY_STATIC, isSensor: true })
    .register();

// Movement system - runs every frame on all clients
game.addSystem(() => {
    const target = input.get('target');
    for (const entity of game.query('player')) {
        // Only control your own player
        if (entity.get(Player).clientId === game.localClientId && target) {
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

// Callbacks - all run on ALL clients (deterministic)
const callbacks = {
    // Only runs for first client (creates the room)
    onRoomCreate() {
        for (let i = 0; i < 20; i++) {
            game.spawn('food', {
                x: dRandom() * 800,
                y: dRandom() * 600,
                color: game.internString('color', '#44ff44')
            });
        }
    },

    // Runs on all clients when anyone connects
    onConnect(clientId) {
        game.spawn('player', {
            x: 400,
            y: 300,
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

- [Systems](./systems.md) - Writing game logic
- [Entities](./entities.md) - Entity system
- [Components](./components.md) - Component reference
