# Physics 2D

Modu Engine includes a deterministic 2D physics system via the `Physics2DSystem` plugin.

## Setup

```javascript
import { createGame, Physics2DSystem } from 'modu';

const game = createGame();
const physics = game.addPlugin(Physics2DSystem, {
    gravity: { x: 0, y: 0 }  // Top-down game
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gravity` | `{ x, y }` | `{ x: 0, y: 0 }` | Gravity vector |

```javascript
// Top-down (no gravity)
game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });

// Platformer (gravity down)
game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: -100 } });
```

## Body2D Component

Entities with physics need the `Body2D` component:

```javascript
import { Body2D, BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC,
         SHAPE_CIRCLE, SHAPE_RECT } from 'modu';

game.defineEntity('player')
    .with(Transform2D)
    .with(Body2D, {
        shapeType: SHAPE_CIRCLE,
        radius: 20,
        bodyType: BODY_KINEMATIC,
        isSensor: false
    })
    .register();
```

### Body2D Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `vx`, `vy` | number | 0 | Velocity |
| `angularVelocity` | number | 0 | Rotation speed |
| `radius` | number | 10 | Circle radius |
| `width`, `height` | number | 0 | Box dimensions |
| `mass` | number | 1 | Mass for physics |
| `restitution` | number | 0 | Bounciness (0-1) |
| `friction` | number | 0 | Surface friction |
| `bodyType` | number | 0 | Body type constant |
| `shapeType` | number | 0 | Shape type constant |
| `isSensor` | boolean | false | Trigger mode |

## Body Types

| Constant | Value | Behavior |
|----------|-------|----------|
| `BODY_DYNAMIC` | 0 | Full physics simulation |
| `BODY_STATIC` | 1 | Never moves (walls, obstacles) |
| `BODY_KINEMATIC` | 2 | Code-controlled, no physics response |

```javascript
import { BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC } from 'modu';

// Walls - never move
.with(Body2D, { bodyType: BODY_STATIC })

// Players - controlled by code
.with(Body2D, { bodyType: BODY_KINEMATIC })

// Projectiles - physics-driven
.with(Body2D, { bodyType: BODY_DYNAMIC })
```

## Shape Types

| Constant | Value | Use |
|----------|-------|-----|
| `SHAPE_RECT` | 0 | Boxes, walls |
| `SHAPE_CIRCLE` | 1 | Players, projectiles |

```javascript
import { SHAPE_CIRCLE, SHAPE_RECT } from 'modu';

// Circle
.with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 20 })

// Box
.with(Body2D, { shapeType: SHAPE_RECT, width: 50, height: 30 })
```

## Collision Detection

### `physics.onCollision(typeA, typeB, handler)`

Register collision handlers between entity types:

```javascript
// Player eats food
physics.onCollision('player', 'food', (player, food) => {
    if (food.destroyed) return;

    const sprite = player.get(Sprite);
    sprite.radius += 2;
    player.get(Body2D).radius += 2;
    food.destroy();
});

// Bullet hits enemy
physics.onCollision('bullet', 'enemy', (bullet, enemy) => {
    if (bullet.destroyed || enemy.destroyed) return;

    const health = enemy.get(Health);
    health.current -= 25;
    bullet.destroy();
});
```

### Same-Type Collisions

For collisions between the same type, the handler is called once per pair:

```javascript
// Cells eating each other
physics.onCollision('cell', 'cell', (cellA, cellB) => {
    if (cellA.destroyed || cellB.destroyed) return;

    const spriteA = cellA.get(Sprite);
    const spriteB = cellB.get(Sprite);

    // Larger cell eats smaller
    if (spriteA.radius > spriteB.radius * 1.2) {
        spriteA.radius += spriteB.radius * 0.5;
        cellB.destroy();
    }
});
```

## Sensors (Triggers)

Sensors detect overlaps without physics response:

```javascript
game.defineEntity('trigger-zone')
    .with(Transform2D)
    .with(Body2D, {
        shapeType: SHAPE_CIRCLE,
        radius: 100,
        bodyType: BODY_STATIC,
        isSensor: true  // No collision response
    })
    .register();

// Detect entry
physics.onCollision('player', 'trigger-zone', (player, zone) => {
    console.log('Player entered zone');
    // Trigger game event
});
```

## Movement

### Entity Helper Methods

```javascript
// Move towards target (deterministic)
entity.moveTowards({ x: 100, y: 100 }, speed);

// Move with stop radius
entity.moveTowardsWithStop({ x: 100, y: 100 }, speed, stopRadius);

// Set velocity directly
entity.setVelocity(vx, vy);

// Stop movement
entity.stop();
```

### Direct Body2D Manipulation

```javascript
const body = entity.get(Body2D);
body.vx = 10;
body.vy = 5;
```

## Common Patterns

### Top-Down Player Movement

```javascript
const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });

game.addSystem(() => {
    const target = input.get('target');

    for (const entity of game.query('player')) {
        if (entity.get(Player).clientId !== game.localClientId) continue;

        if (target) {
            const sprite = entity.get(Sprite);
            entity.moveTowardsWithStop(target, 5, sprite.radius);
        }
    }
}, { phase: 'update' });
```

### Projectile

```javascript
game.defineEntity('bullet')
    .with(Transform2D)
    .with(Body2D, {
        shapeType: SHAPE_CIRCLE,
        radius: 4,
        bodyType: BODY_KINEMATIC
    })
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 4 })
    .register();

function spawnBullet(x, y, angle, speed) {
    const bullet = game.spawn('bullet', {
        x, y,
        color: game.internString('color', '#ffcc00')
    });

    const body = bullet.get(Body2D);
    body.vx = Math.cos(angle) * speed;
    body.vy = Math.sin(angle) * speed;

    bullet.life = 60;  // 3 seconds at 20 FPS
    return bullet;
}

// Bullet lifetime system
game.addSystem(() => {
    for (const bullet of game.query('bullet')) {
        bullet.life--;
        if (bullet.life <= 0) bullet.destroy();
    }
}, { phase: 'update' });

// Bullet hits enemy
physics.onCollision('bullet', 'enemy', (bullet, enemy) => {
    if (bullet.destroyed || enemy.destroyed) return;
    enemy.get(Health).current -= 25;
    bullet.destroy();
});
```

### Walls

```javascript
game.defineEntity('wall')
    .with(Transform2D)
    .with(Body2D, {
        shapeType: SHAPE_RECT,
        bodyType: BODY_STATIC
    })
    .with(Sprite, { shape: SHAPE_RECT })
    .register();

function spawnWall(x, y, width, height) {
    const wall = game.spawn('wall', { x, y });

    wall.get(Body2D).width = width;
    wall.get(Body2D).height = height;
    wall.get(Sprite).width = width;
    wall.get(Sprite).height = height;
    wall.get(Sprite).color = game.internString('color', '#444444');

    return wall;
}
```

### Collectible Items

```javascript
game.defineEntity('coin')
    .with(Transform2D)
    .with(Body2D, {
        shapeType: SHAPE_CIRCLE,
        radius: 10,
        bodyType: BODY_STATIC,
        isSensor: true  // No physics collision
    })
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 10 })
    .register();

physics.onCollision('player', 'coin', (player, coin) => {
    if (coin.destroyed) return;
    player.score += 10;
    coin.destroy();
});
```

## Determinism

The physics engine is fully deterministic:

- Uses 16.16 fixed-point math internally
- No floating-point operations in simulation
- Same inputs = same results across all clients

This is critical for multiplayer synchronization.

## Performance Tips

1. **Use BODY_STATIC** for immovable objects (reduces calculations)
2. **Use sensors** for trigger zones instead of dynamic bodies
3. **Limit entity count** - each body adds collision checks
4. **Destroy unused entities** - don't just hide them

## Plugin Methods

### `physics.setGravity(x, y)`

Change gravity at runtime:

```javascript
physics.setGravity(0, -100);  // Enable gravity
physics.setGravity(0, 0);     // Disable gravity
```

### `physics.clear()`

Remove all physics bodies:

```javascript
physics.clear();
```

## Next Steps

- [Components](./components.md) - Body2D reference
- [Entities](./entities.md) - Entity creation
- [Systems](./systems.md) - Writing game logic
- [Determinism](./determinism.md) - Sync requirements
