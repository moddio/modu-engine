# Modu Engine

**Local-first Multiplayer Game Engine.** Your game runs instantly on the client. When you go online, it just syncs.

## Why Modu?

- **Instant Play** — No "connecting..." screens. Game runs locally immediately, multiplayer syncs in the background.
- **One Codebase** — Same code works for 1 player or 100. No separate single/multiplayer modes.
- **Zero Sync Code** — Deterministic simulation means all clients agree automatically. No netcode to write.
- **No Server Logic** — Server just relays inputs. Your game code runs on clients only.

## Quick Start

```html
<canvas id="game" width="800" height="600"></canvas>
<script src="https://cdn.moduengine.com/modu.min.js"></script>
<script>
const game = createGame();
game.addPlugin(Simple2DRenderer, document.getElementById('game'));

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
        game.spawn('player', { x: dRandom() * 800, y: dRandom() * 600, clientId: id });
    }
});
</script>
```

## How It Works

1. Player presses a key → input captured locally
2. Input sent to server → server assigns sequence number
3. Broadcast to all clients → everyone gets same inputs in same order
4. Same simulation runs → identical state everywhere

The server never runs game logic. It's just a message broker. Determinism ensures all clients agree.

## Examples

Run the demos:

```bash
npm run build:browser
npx http-server -p 3000
```

- [cell-eater.html](examples/cell-eater.html) — Eat to grow
- [snake.html](examples/snake.html) — Classic snake
- [2d-shooter.html](examples/2d-shooter.html) — Top-down shooter

## Documentation

**[docs.moduengine.com](https://docs.moduengine.com)**

## License

MIT
