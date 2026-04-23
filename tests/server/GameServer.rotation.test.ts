import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

const GAME_DATA = {
  version: '2.0',
  settings: { frameRate: 20 },
  map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      slayer: {
        name: 'Slayer',
        body: { type: 'dynamic', width: 40, height: 40, linearDamping: 5 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 40 } },
        controls: {
          movementMethod: 'velocity',
          movementType: 'wasd',
          mouseBehaviour: { rotateToFaceMouseCursor: true },
        },
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: {},
  },
  scripts: {},
  variables: {},
};

describe('GameServer rotateToFaceMouseCursor', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;

  beforeEach(() => {
    Engine.reset();
    transport = createInMemoryPair();
    server = new GameServer(transport.server);
  });

  afterEach(() => {
    server.stop();
    Engine.reset();
  });

  /**
   * Spawn a unit and run one tick to let `_syncPhysicsToEntities` stabilise
   * `unit.position` — the rotate-to-face logic runs AFTER that sync, so tests
   * need to place the mouse relative to the post-sync position.
   */
  const joinAndSettle = async () => {
    await server.init(GAME_DATA as any);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({
      type: MessageType.JoinGame,
      data: { playerName: 'Tester', isMobile: false },
    });
    const unit = Array.from((server as any)._entities.values() as Iterable<any>)
      .find((e: any) => e.stats?.type === 'slayer');
    (server as any)._tick(50);
    return unit;
  };

  const placeAndTick = (unit: any, dx: number, dy: number) => {
    unit._mousePosition = { x: unit.position.x + dx, y: unit.position.z + dy };
    (server as any)._tick(50);
  };

  it('mouse east of unit → rotation = -π/2', async () => {
    const unit = await joinAndSettle();
    placeAndTick(unit, 5, 0);
    expect(unit.rotation).toBeCloseTo(-Math.PI / 2, 3);
  });

  it('mouse north (engine -y) of unit → rotation = 0', async () => {
    const unit = await joinAndSettle();
    placeAndTick(unit, 0, -5);
    expect(unit.rotation).toBeCloseTo(0, 3);
  });

  it('mouse west of unit → rotation = π/2', async () => {
    const unit = await joinAndSettle();
    placeAndTick(unit, -5, 0);
    expect(unit.rotation).toBeCloseTo(Math.PI / 2, 3);
  });

  it('mouse south (engine +y) of unit → rotation = ±π', async () => {
    const unit = await joinAndSettle();
    placeAndTick(unit, 0, 5);
    expect(Math.abs(unit.rotation)).toBeCloseTo(Math.PI, 3);
  });

  it('skips rotation when mouse position is unset', async () => {
    const unit = await joinAndSettle();
    unit._mousePosition = undefined;
    // Physics sync resets rotation to body.angle each tick; this test confirms we
    // do not reintroduce a bogus rotation when there is no mouse data.
    (server as any)._tick(50);
    expect(unit.rotation).toBe(0);
  });

  it('skips rotation when unitType lacks rotateToFaceMouseCursor', async () => {
    const gameData = JSON.parse(JSON.stringify(GAME_DATA));
    gameData.entities.unitTypes.slayer.controls.mouseBehaviour.rotateToFaceMouseCursor = false;
    await server.init(gameData);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({
      type: MessageType.JoinGame,
      data: { playerName: 'Tester', isMobile: false },
    });
    const unit: any = Array.from((server as any)._entities.values() as Iterable<any>)
      .find((e: any) => e.stats?.type === 'slayer');
    (server as any)._tick(50);
    unit._mousePosition = { x: unit.position.x + 5, y: unit.position.z };
    (server as any)._tick(50);
    expect(unit.rotation).toBe(0);
  });
});
