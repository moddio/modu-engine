# Canvas Renderer

Modu Engine includes an `AutoRenderer` plugin for automatic 2D canvas rendering.

## Using AutoRenderer

```javascript
import { createGame, AutoRenderer } from 'modu';

const canvas = document.getElementById('game');
const game = createGame();
game.addPlugin(AutoRenderer, canvas);
```

The `AutoRenderer` automatically draws entities based on their `Sprite` component.

## Options

```javascript
game.addPlugin(AutoRenderer, canvas, {
    scale: 1,           // Render scale
    smoothing: true     // Image smoothing
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scale` | `number` | `1` | Render scale factor |
| `smoothing` | `boolean` | `true` | Enable image smoothing |

## How It Renders Entities

The `AutoRenderer` draws entities with a `Sprite` component:

### Circles

```javascript
game.defineEntity('ball')
    .with(Transform2D)
    .with(Sprite, {
        shape: SHAPE_CIRCLE,
        radius: 20,
        layer: 1
    })
    .register();

// Spawn with color
game.spawn('ball', {
    x: 100, y: 100,
    color: game.internString('color', '#ff0000')
});
```

### Rectangles

```javascript
game.defineEntity('wall')
    .with(Transform2D)
    .with(Sprite, {
        shape: SHAPE_RECT,
        width: 100,
        height: 20,
        layer: 0
    })
    .register();

game.spawn('wall', {
    x: 400, y: 300,
    color: game.internString('color', '#444466')
});
```

### Sprite Properties

| Property | Description |
|----------|-------------|
| `shape` | `SHAPE_CIRCLE` or `SHAPE_RECT` |
| `radius` | Circle radius |
| `width`, `height` | Rectangle dimensions |
| `color` | Interned color string ID |
| `layer` | Z-order (higher = in front) |
| `visible` | Whether to render |

## Complete Example

```javascript
import { createGame, Transform2D, Body2D, Sprite, Player,
         Physics2DSystem, AutoRenderer, InputPlugin,
         SHAPE_CIRCLE, SHAPE_RECT, BODY_KINEMATIC, BODY_STATIC, dRandom } from 'modu';

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
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 25, layer: 1 })
    .with(Body2D, { shapeType: SHAPE_CIRCLE, radius: 25, bodyType: BODY_KINEMATIC })
    .with(Player)
    .register();

game.defineEntity('wall')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_RECT, layer: 0 })
    .with(Body2D, { shapeType: SHAPE_RECT, bodyType: BODY_STATIC })
    .register();

function spawnWall(x, y, w, h) {
    const wall = game.spawn('wall', { x, y });
    wall.get(Sprite).width = w;
    wall.get(Sprite).height = h;
    wall.get(Sprite).color = game.internString('color', '#444466');
    wall.get(Body2D).width = w;
    wall.get(Body2D).height = h;
    return wall;
}

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

// Callbacks - run on ALL clients
const callbacks = {
    onRoomCreate() {
        // Only first client runs this
        spawnWall(400, 10, 800, 20);   // Top
        spawnWall(400, 590, 800, 20);  // Bottom
        spawnWall(10, 300, 20, 600);   // Left
        spawnWall(790, 300, 20, 600);  // Right
    },

    onConnect(clientId) {
        // Runs on all clients when anyone connects
        const color = game.internString('color',
            '#' + ((dRandom() * 0xFFFFFF) | 0).toString(16).padStart(6, '0')
        );
        game.spawn('player', {
            x: 400,
            y: 300,
            clientId,
            color
        });
    },

    onDisconnect(clientId) {
        game.getEntityByClientId(clientId)?.destroy();
    }
};

game.connect('my-room', callbacks);
```

## Custom Rendering

For full control, use the `render` callback instead of `AutoRenderer`:

```javascript
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const game = createGame();

// No AutoRenderer - custom rendering instead
const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });

const callbacks = {
    // ... other callbacks

    render() {
        // Clear
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw entities
        for (const entity of game.query(Sprite)) {
            const sprite = entity.get(Sprite);
            if (!sprite.visible) continue;

            const x = entity.render.interpX;
            const y = entity.render.interpY;

            ctx.fillStyle = game.getString('color', sprite.color) || '#ffffff';

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

        // Draw UI
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px monospace';
        ctx.fillText(`Frame: ${game.frame}`, 10, 20);
    }
};

game.connect('my-room', callbacks);
```

## Interpolation

Entity positions are interpolated between simulation frames for smooth rendering:

```javascript
// Use interpolated position for drawing
entity.render.interpX
entity.render.interpY

// Raw simulation position
entity.get(Transform2D).x
entity.get(Transform2D).y
```

The `AutoRenderer` handles this automatically. For custom rendering, use `entity.render.interpX/Y`.

## Using Other Renderers

Modu Engine works with any renderer:

### Pixi.js

```javascript
import { createGame, Transform2D, Sprite, Player } from 'modu';

const app = new PIXI.Application({ width: 800, height: 600 });
document.body.appendChild(app.view);

const sprites = new Map();

const callbacks = {
    render() {
        for (const entity of game.query('player')) {
            const sprite = entity.get(Sprite);
            let pixiSprite = sprites.get(entity.eid);

            if (!pixiSprite) {
                pixiSprite = new PIXI.Graphics();
                app.stage.addChild(pixiSprite);
                sprites.set(entity.eid, pixiSprite);
            }

            const color = game.getString('color', sprite.color);
            pixiSprite.clear();
            pixiSprite.beginFill(parseInt(color.slice(1), 16));
            pixiSprite.drawCircle(0, 0, sprite.radius);
            pixiSprite.x = entity.render.interpX;
            pixiSprite.y = entity.render.interpY;
        }

        // Clean up destroyed entities
        for (const [eid, pixiSprite] of sprites) {
            const entity = game.world.getEntity(eid);
            if (!entity || entity.destroyed) {
                app.stage.removeChild(pixiSprite);
                sprites.delete(eid);
            }
        }
    }
};
```

### Three.js (for 3D)

```javascript
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();

const meshes = new Map();

const callbacks = {
    render() {
        for (const entity of game.query('player')) {
            const sprite = entity.get(Sprite);
            let mesh = meshes.get(entity.eid);

            if (!mesh) {
                const geometry = new THREE.SphereGeometry(sprite.radius / 10);
                const color = game.getString('color', sprite.color);
                const material = new THREE.MeshBasicMaterial({ color });
                mesh = new THREE.Mesh(geometry, material);
                scene.add(mesh);
                meshes.set(entity.eid, mesh);
            }

            mesh.position.set(
                entity.render.interpX / 100,
                entity.render.interpY / 100,
                0
            );
        }

        renderer.render(scene, camera);
    }
};
```

## Next Steps

- [Components](./components.md) - Sprite component reference
- [Systems](./systems.md) - Writing render systems
- [Entities](./entities.md) - Entity system
