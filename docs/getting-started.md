# Getting Started

Build your first multiplayer game with Modu Engine in under 5 minutes.

Modu is **local-first** - your game runs immediately with full simulation. Call `game.connect()` when ready to sync with others. Same code works solo or multiplayer.

## Minimal Example

```html
<canvas id="game" width="800" height="600"></canvas>
<script src="modu.iife.js"></script>
<script>
const { createGame, Transform2D, Body2D, Sprite, Player,
        Physics2DSystem, AutoRenderer, InputPlugin, SHAPE_CIRCLE, BODY_KINEMATIC, dRandom } = Modu;

const game = createGame();
game.addPlugin(AutoRenderer, document.getElementById('game'));
game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });
const input = game.addPlugin(InputPlugin, document.getElementById('game'));
input.action('target', { type: 'vector', bindings: ['mouse'] });

game.defineEntity('player')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
    .with(Body2D, { radius: 20, bodyType: BODY_KINEMATIC })
    .with(Player);

// Runs every frame on all clients
game.addSystem(() => {
    const target = input.get('target');
    for (const p of game.query('player')) {
        // Only control your own player
        if (p.get(Player).clientId === game.localClientId && target)
            p.moveTowardsWithStop(target, 5, 20);
    }
});

game.connect('my-room', {
    // Runs on ALL clients when someone joins
    onConnect(id) {
        game.spawn('player', {
            x: dRandom() * 800,  // dRandom() is deterministic across clients
            y: dRandom() * 600,
            clientId: id,
            color: game.internString('color', '#' + ((dRandom() * 0xFFFFFF) | 0).toString(16).padStart(6, '0'))
        });
    },
    onDisconnect(id) {
        game.getEntityByClientId(id)?.destroy();
    }
});
</script>
```

## What Just Happened?

1. **Created the game** with `createGame()` and added rendering, physics, and input plugins
2. **Defined an entity type** using `defineEntity().with(Component)`
3. **Added a system** to handle movement logic each frame
4. **Connected to a room** - on connect, spawns a player; on disconnect, removes them

That's it - you now have a working multiplayer game where players move toward their cursor.

## Next Steps

- [Concepts](./concepts.md) - Understand how the engine works
- [Entities](./entities.md) - Defining and spawning game objects
- [Components](./components.md) - Built-in and custom components
- [Systems](./systems.md) - Writing game logic
