# Systems

Systems are functions that implement game logic by operating on entities each frame.

## Adding Systems

```javascript
game.addSystem(() => {
    for (const entity of game.query('player')) {
        // Update logic
    }
});
```

### System Options

```javascript
game.addSystem(systemFn, {
    phase: 'update',   // Execution phase
    order: 0,          // Order within phase (lower = earlier)
    client: false      // Client-only system
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `phase` | string | `'update'` | When the system runs |
| `order` | number | `0` | Execution order within phase |
| `client` | boolean | `false` | Only runs on client (not during rollback) |

## System Phases

Systems run in this order each frame:

| Phase | Description | Use For |
|-------|-------------|---------|
| `'input'` | Apply network inputs | Processing player input |
| `'update'` | Game logic | Most game logic |
| `'prePhysics'` | Pre-physics setup | Save state for interpolation |
| `'physics'` | Physics simulation | Handled by Physics2DSystem |
| `'postPhysics'` | Post-physics cleanup | React to physics results |
| `'render'` | Rendering | Drawing (client-only) |

```
Frame start
    ↓
input phase
    ↓
update phase
    ↓
prePhysics phase
    ↓
physics phase
    ↓
postPhysics phase
    ↓
render phase (client only)
    ↓
Frame end
```

## Common System Patterns

### Movement System

```javascript
game.addSystem(() => {
    const target = input.get('target');

    for (const entity of game.query('player')) {
        const player = entity.get(Player);

        // Only control local player
        if (player.clientId !== game.localClientId) continue;

        if (target) {
            const sprite = entity.get(Sprite);
            entity.moveTowardsWithStop(target, 5, sprite.radius);
        }
    }
}, { phase: 'update' });
```

### Health/Death System

```javascript
game.addSystem(() => {
    for (const entity of game.query(Health)) {
        const health = entity.get(Health);
        if (health.current <= 0) {
            entity.destroy();
        }
    }
}, { phase: 'update', order: 100 });  // Run late in update phase
```

### Lifetime System

```javascript
// Assume entities have a 'life' property for remaining frames
game.addSystem(() => {
    for (const bullet of game.query('bullet')) {
        bullet.life--;
        if (bullet.life <= 0) {
            bullet.destroy();
        }
    }
}, { phase: 'update' });
```

### AI System

```javascript
game.addSystem(() => {
    for (const enemy of game.query('enemy')) {
        const transform = enemy.get(Transform2D);

        // Find nearest player
        let nearestPlayer = null;
        let nearestDist = Infinity;

        for (const player of game.query('player')) {
            const dist = enemy.distanceTo(player.get(Transform2D));
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestPlayer = player;
            }
        }

        // Move towards player
        if (nearestPlayer && nearestDist < 500) {
            const targetPos = nearestPlayer.get(Transform2D);
            enemy.moveTowards(targetPos, 2);
        }
    }
}, { phase: 'update' });
```

### Spawning System

```javascript
const FOOD_COUNT = 50;

game.addSystem(() => {
    const foodCount = game.query('food').count();
    const needed = FOOD_COUNT - foodCount;

    for (let i = 0; i < needed; i++) {
        game.spawn('food', {
            x: dRandom() * 800,
            y: dRandom() * 600,
            color: game.internString('color', '#44ff44')
        });
    }
}, { phase: 'update' });
```

### Custom Rendering System

```javascript
game.addSystem(() => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all entities with Sprite
    for (const entity of game.query(Sprite)) {
        const sprite = entity.get(Sprite);
        if (!sprite.visible) continue;

        const x = entity.render.interpX;
        const y = entity.render.interpY;

        ctx.fillStyle = game.getString('color', sprite.color);

        if (sprite.shape === SHAPE_CIRCLE) {
            ctx.beginPath();
            ctx.arc(x, y, sprite.radius, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(
                x - sprite.width / 2,
                y - sprite.height / 2,
                sprite.width,
                sprite.height
            );
        }
    }
}, { phase: 'render', client: true });
```

## Removing Systems

`addSystem()` returns an unregister function:

```javascript
const unregister = game.addSystem(() => {
    // System logic
});

// Later, remove the system
unregister();
```

## System Execution Order

Systems in the same phase run in order by their `order` value:

```javascript
// Runs first (order: 0)
game.addSystem(() => {
    console.log('First');
}, { phase: 'update', order: 0 });

// Runs second (order: 10)
game.addSystem(() => {
    console.log('Second');
}, { phase: 'update', order: 10 });

// Runs third (order: 100)
game.addSystem(() => {
    console.log('Third');
}, { phase: 'update', order: 100 });
```

## Querying in Systems

### By Type Name

```javascript
for (const entity of game.query('player')) {
    // All entities of type 'player'
}
```

### By Component

```javascript
for (const entity of game.query(Health)) {
    // All entities with Health component
}
```

### Query Methods

```javascript
const query = game.query('enemy');

// Count without iterating
const count = query.count();

// Get first match
const first = query.first();

// Convert to array
const enemies = query.toArray();

// Find with predicate
const lowHealth = query.find(e => e.get(Health).current < 20);
```

## Determinism

Systems must be deterministic for multiplayer sync:

**Safe:**
- `dRandom()` - Deterministic random
- `game.frame` - Current frame number
- Fixed-point math functions
- Component data

**Unsafe:**
- `Math.random()` - Non-deterministic
- `Date.now()` - Wall-clock time
- `performance.now()` - Varies between clients
- External state not in components

```javascript
// GOOD - Deterministic
game.addSystem(() => {
    if (game.frame % 60 === 0) {  // Every 3 seconds at 20 FPS
        spawnEnemy();
    }
});

// BAD - Non-deterministic
game.addSystem(() => {
    if (Date.now() % 3000 < 50) {  // Will desync!
        spawnEnemy();
    }
});
```

## Client-Only Systems

Use `client: true` for systems that only run on the client:

```javascript
// Rendering - client only
game.addSystem(() => {
    drawUI();
}, { phase: 'render', client: true });

// Sound effects - client only
game.addSystem(() => {
    for (const entity of game.query('explosion')) {
        if (entity.justSpawned) {
            playSound('explosion');
        }
    }
}, { phase: 'postPhysics', client: true });
```

Client-only systems don't run during rollback/resimulation.

## Next Steps

- [Entities](./entities.md) - Entity system
- [Components](./components.md) - Component reference
- [Physics](./physics-2d.md) - Physics and collisions
- [Game Lifecycle](./game-lifecycle.md) - Callback flow
