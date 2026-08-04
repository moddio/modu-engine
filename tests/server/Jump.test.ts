import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

/**
 * Jumping in a 3D game reaches the engine as `applyImpulseOnEntityXY` with an impulse
 * of `{x: 0, y: 0, z: N}` — Braains3D binds it to space. Two things swallowed it:
 *
 *   1. `ActionRunner._resolveValue` rebuilt every inline `{x, y, …}` literal as `{x, y}`,
 *      so the Z never reached the physics layer at all. The action ran and did nothing.
 *   2. The physics world is rapier2d and has no vertical axis, so even with the Z
 *      present there was nothing for it to act on. Height is purely visual here, so
 *      the server forwards it as a `jumpEntity` UI command and the renderer owns the arc.
 */
const tilePx = 16;

const jumpGameData = () => ({
  map: { width: 20, height: 20, tilewidth: tilePx, tileheight: tilePx, layers: [], tilesets: [] },
  settings: { frameRate: 20 },
  unitTypes: {
    hopper: {
      name: 'Hopper',
      bodies: {
        default: {
          type: 'dynamic',
          width: tilePx, height: tilePx,
          fixtures: [{ shape: { type: 'rectangle' }, friction: 0, restitution: 0, density: 1 }],
        },
      },
      attributes: { speed: { value: 5 } },
      controls: {
        movementMethod: 'velocity',
        abilities: { space: { keyDown: { scriptName: 'doJump', isEntityScript: true } } },
      },
      scripts: {
        doJump: {
          name: 'jump',
          triggers: [],
          actions: [
            {
              type: 'applyImpulseOnEntityXY',
              impulse: { x: 0, y: 0, z: 300 },
              entity: { function: 'thisEntity' },
            },
          ],
        },
      },
    },
  },
  itemTypes: {}, projectileTypes: {}, propTypes: {},
  playerTypes: { p: { name: 'P' } },
  scripts: {},
  variables: {},
});

describe('Jump (vertical impulse)', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;
  let commands: Array<{ command: string; args: unknown[] }>;

  beforeEach(async () => {
    Engine.reset();
    transport = createInMemoryPair();
    server = new GameServer(transport.server, { singlePlayer: true });
    commands = [];
    const raw: any = jumpGameData();
    const migrated = {
      version: '2.0', settings: raw.settings, map: raw.map,
      entities: {
        unitTypes: raw.unitTypes, itemTypes: raw.itemTypes,
        projectileTypes: raw.projectileTypes, playerTypes: raw.playerTypes,
        propTypes: raw.propTypes,
      },
      scripts: {}, variables: {},
    };
    await server.init(migrated as any, raw as any);
    server.start();
    transport.client.onMessage((m: any) => {
      if (m?.type === MessageType.UICommand) commands.push(m.data);
    });
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'T', isMobile: false } });
    (server as any)._tick(50);
  });

  afterEach(() => {
    server.stop();
    Engine.reset();
  });

  it('lifts the unit off the floor instead of faking the arc on the client', () => {
    // This used to broadcast a `jumpEntity` UI command for the renderer to animate,
    // because the world had no vertical axis to act on. It is a real impulse now, so
    // the assertion is the body actually leaving the ground.
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const body = (server as any)._entityBodies.get(playerData.unitId);
    const restY = body.position.y;

    const clientId = [...players.keys()][0];
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'space' }, true);
    (server as any)._tick(50);

    expect(body.position.y).toBeGreaterThan(restY);
    expect(body.linearVelocity.y).toBeGreaterThan(0);
    expect(commands.find((c) => c.command === 'jumpEntity')).toBeUndefined();
  });

  it('comes back down', () => {
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const body = (server as any)._entityBodies.get(playerData.unitId);
    const restY = body.position.y;
    const clientId = [...players.keys()][0];
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'space' }, true);
    // Long enough for the whole arc: up, over, and settled back on the floor.
    for (let i = 0; i < 400; i++) (server as any)._tick(50);
    expect(body.position.y).toBeCloseTo(restY, 1);
  });

  it('does not emit a jump for a purely horizontal impulse', () => {
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    (server as any).engine.events.emit('physics:applyImpulse', [playerData.unitId, { x: 5, y: 5 }, null]);
    (server as any)._tick(50);
    expect(commands.find((c) => c.command === 'jumpEntity')).toBeUndefined();
  });
});
