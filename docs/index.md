# Modu Engine

Local-first multiplayer game engine. Play instantly, sync seamlessly.

## Documentation

### Introduction
- [Getting Started](./getting-started.md) - Build your first game in 5 minutes
- [Concepts](./concepts.md) - How Modu works in 2 minutes
- [Game Lifecycle](./game-lifecycle.md) - Callbacks and frame execution

### ECS
- [Entities](./entities.md) - Defining and spawning game objects
- [Components](./components.md) - Built-in and custom components
- [Systems](./systems.md) - Writing game logic

### Plugins
- [Physics 2D](./physics-2d.md) - Collisions and movement
- [Canvas Renderer](./canvas-renderer.md) - Automatic rendering
- [Debug UI](./debug-ui.md) - Live stats overlay

### Reference
- [Engine API](./engine-api.md) - Full API reference
- [Determinism](./determinism.md) - Rules for sync

## Quick Example

```javascript
const game = createGame();
game.addPlugin(AutoRenderer, canvas);
game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });

game.defineEntity('player')
    .with(Transform2D)
    .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
    .with(Body2D, { radius: 20, bodyType: BODY_KINEMATIC })
    .with(Player)
    .register();

game.connect('my-room', {
    onConnect(clientId) {
        // Runs on ALL clients when someone joins
        game.spawn('player', { x: 400, y: 300, clientId });
    }
});
```
