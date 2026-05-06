import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

/**
 * `confinedWithinMapBoundaries` (default true on unit/item/projectile types,
 * matching the editor's defaultGameObjects.service.ts) clamps an entity's
 * post-physics position to within [tileW/2, mapW*tileW - tileW/2] in pixel
 * space — i.e. [0.5, mapW - 0.5] in tile units. The clamp lives inside
 * `_syncPhysicsToEntities` so it runs after every Rapier step, mirroring
 * taro's Rapier2dComponent loop.
 */
const baseGameData = () => ({
  version: '2.0' as const,
  settings: { frameRate: 20 },
  map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      slayer: {
        name: 'Slayer',
        body: { type: 'dynamic', width: 16, height: 16, linearDamping: 0 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 200 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
        // Default true — explicitly set here to make the intent visible.
        confinedWithinMapBoundaries: true,
      },
      ghost: {
        name: 'Ghost',
        body: { type: 'dynamic', width: 16, height: 16, linearDamping: 0 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 200 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
        // Opt-out: must be allowed to leave the map.
        confinedWithinMapBoundaries: false,
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: {},
  },
  scripts: {},
  variables: {},
});

describe('GameServer confinedWithinMapBoundaries', () => {
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

  const joinAs = async (data: any, typeId: string) => {
    // Force the placeholder unit type by listing only that one in unitTypes.
    const trimmed = JSON.parse(JSON.stringify(data));
    trimmed.entities.unitTypes = { [typeId]: data.entities.unitTypes[typeId] };
    await server.init(trimmed as any);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({
      type: MessageType.JoinGame,
      data: { playerName: 'Tester', isMobile: false },
    });
    (server as any)._tick(50);
    return Array.from((server as any)._entities.values() as Iterable<any>)
      .find((e: any) => e.stats?.type === typeId);
  };

  // Drive the unit hard against the eastern boundary by holding 'd' for many
  // ticks — without the clamp this position would grow without bound.
  const driveEast = (server: GameServer, unit: any, ticks = 200) => {
    unit._inputKeys = new Set(['d']);
    for (let i = 0; i < ticks; i++) (server as any)._tick(50);
  };

  const driveWest = (server: GameServer, unit: any, ticks = 200) => {
    unit._inputKeys = new Set(['a']);
    for (let i = 0; i < ticks; i++) (server as any)._tick(50);
  };

  const driveNorth = (server: GameServer, unit: any, ticks = 200) => {
    unit._inputKeys = new Set(['w']);
    for (let i = 0; i < ticks; i++) (server as any)._tick(50);
  };

  const driveSouth = (server: GameServer, unit: any, ticks = 200) => {
    unit._inputKeys = new Set(['s']);
    for (let i = 0; i < ticks; i++) (server as any)._tick(50);
  };

  it('clamps a confined unit to the eastern map edge', async () => {
    const unit = await joinAs(baseGameData(), 'slayer');
    driveEast(server, unit);
    // 10×10 map → maxX = 10 - 0.5 = 9.5.
    expect(unit.position.x).toBeLessThanOrEqual(9.5 + 1e-6);
    expect(unit.position.x).toBeGreaterThan(9.0); // actually pushed against the edge
  });

  it('clamps a confined unit to the western map edge', async () => {
    const unit = await joinAs(baseGameData(), 'slayer');
    driveWest(server, unit);
    expect(unit.position.x).toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(unit.position.x).toBeLessThan(1.0);
  });

  it('clamps a confined unit on the Z axis (north / south)', async () => {
    const unit = await joinAs(baseGameData(), 'slayer');
    driveNorth(server, unit);
    expect(unit.position.z).toBeGreaterThanOrEqual(0.5 - 1e-6);

    // Reset velocity by clearing keys then drive south.
    unit._inputKeys = new Set();
    (server as any)._tick(50);
    driveSouth(server, unit);
    expect(unit.position.z).toBeLessThanOrEqual(9.5 + 1e-6);
  });

  it('lets a unit with confinedWithinMapBoundaries:false leave the map', async () => {
    const unit = await joinAs(baseGameData(), 'ghost');
    driveEast(server, unit);
    // No clamp: the body is free to march past the eastern edge.
    expect(unit.position.x).toBeGreaterThan(10);
  });

  it('keeps the rapier body in sync with the clamped position', async () => {
    const unit = await joinAs(baseGameData(), 'slayer');
    driveEast(server, unit);
    const body = (server as any)._entityBodies.get(unit.id);
    // Body translation in physics units → tile units must match the entity's
    // clamped X. If the body marched past 9.5 the next physics step would
    // start out-of-bounds, so the snap-back must update both sides.
    const bodyX = (server as any)._physicsToTile(body.position.x);
    expect(bodyX).toBeCloseTo(unit.position.x, 5);
    expect(bodyX).toBeLessThanOrEqual(9.5 + 1e-6);
  });
});
