import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';
import { Vec2 } from '../../engine/core/math/Vec2';

/**
 * Game data with two unit types:
 *  - `mob`: AI-enabled, idleBehaviour = 'stay' so _processAI is a no-op and tests
 *    can set body.linearVelocity directly.
 *  - `player`: not AI, used to drive the player join flow.
 *  - `mobAI`: AI-enabled WITH idleBehaviour = 'stay', joined as the player's unit
 *    in the "player skip" test (defensive: even if a player's unit type happens
 *    to have ai.enabled, the new loop must skip the player).
 */
const GAME_DATA = {
  version: '2.0',
  settings: { frameRate: 20 },
  map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      mob: {
        name: 'Mob',
        body: { type: 'dynamic', width: 40, height: 40, linearDamping: 0 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 40 } },
        ai: { enabled: true, idleBehaviour: 'stay', maxTravelDistance: 200 },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
      },
      mobAI: {
        name: 'MobAI',
        body: { type: 'dynamic', width: 40, height: 40, linearDamping: 0 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 40 } },
        ai: { enabled: true, idleBehaviour: 'stay', maxTravelDistance: 200 },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
      },
      nonAi: {
        name: 'NonAI',
        body: { type: 'dynamic', width: 40, height: 40, linearDamping: 0 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 40 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: {},
  },
  scripts: {},
  variables: {},
};

describe('GameServer AI face-movement-direction', () => {
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

  /** Spawn an AI unit (no owner) and let one tick stabilise position. */
  const spawnMobAndSettle = async (typeId: string = 'mob') => {
    await server.init(GAME_DATA as any);
    server.start();
    const typeDef = (GAME_DATA.entities.unitTypes as any)[typeId];
    const unit = (server as any).spawnUnit(typeId, typeDef, '');
    (server as any)._tick(50);
    return unit;
  };

  const setVelAndTick = (unit: any, vx: number, vy: number) => {
    const body = (server as any)._entityBodies.get(unit.id);
    body.linearVelocity = new Vec2(vx, vy);
    (server as any)._tick(50);
  };

  it('AI unit moving east (+x) → rotation = -π/2', async () => {
    const unit = await spawnMobAndSettle();
    setVelAndTick(unit, 5, 0);
    expect(unit.rotation).toBeCloseTo(-Math.PI / 2, 3);
  });

  it('AI unit moving north (engine -y) → rotation = 0', async () => {
    const unit = await spawnMobAndSettle();
    setVelAndTick(unit, 0, -5);
    expect(unit.rotation).toBeCloseTo(0, 3);
  });

  it('AI unit moving west (-x) → rotation = π/2', async () => {
    const unit = await spawnMobAndSettle();
    setVelAndTick(unit, -5, 0);
    expect(unit.rotation).toBeCloseTo(Math.PI / 2, 3);
  });

  it('AI unit moving south (engine +y) → rotation = ±π', async () => {
    const unit = await spawnMobAndSettle();
    setVelAndTick(unit, 0, 5);
    expect(Math.abs(unit.rotation)).toBeCloseTo(Math.PI, 3);
  });

  it('AI unit nearly stationary (|v|² < threshold) keeps prior rotation', async () => {
    const unit = await spawnMobAndSettle();
    // First, rotate the unit by moving it east.
    setVelAndTick(unit, 5, 0);
    expect(unit.rotation).toBeCloseTo(-Math.PI / 2, 3);
    // Now drop velocity below threshold (mag = 0.05, mag² = 0.0025 < 0.01).
    // The rotation should NOT snap to atan2(0, 0) = 0; it should stay where it was.
    setVelAndTick(unit, 0.05, 0);
    expect(unit.rotation).toBeCloseTo(-Math.PI / 2, 3);
  });

  it('non-AI unit (typeDef.ai missing) is not rotated by the new loop', async () => {
    const unit = await spawnMobAndSettle('nonAi');
    setVelAndTick(unit, 5, 0);
    // _syncPhysicsToEntities writes body.angle (=0) to entity.rotation, and
    // the new loop skips this unit because ai.enabled is not set.
    expect(unit.rotation).toBe(0);
  });

  it('player-controlled unit is skipped even when its type has ai.enabled', async () => {
    // Force the playerType to spawn the AI-enabled `mobAI` type so we can
    // verify the player-skip in the new loop.
    const data = JSON.parse(JSON.stringify(GAME_DATA));
    await server.init(data);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({
      type: MessageType.JoinGame,
      data: { playerName: 'Tester', isMobile: false },
    });
    // The player will be assigned the first unit type — ensure that's `mob` (AI-enabled).
    // Object key order in our data has `mob` first, so the player gets `mob`.
    const unit: any = Array.from((server as any)._entities.values() as Iterable<any>)
      .find((e: any) => e.stats?.type === 'mob' && e.stats?.ownerId);
    expect(unit).toBeTruthy();
    (server as any)._tick(50);
    setVelAndTick(unit, 5, 0);
    // Player has no _mousePosition set, so the player face-mouse loop leaves rotation alone.
    // The new AI loop must skip players, so rotation stays at body.angle = 0.
    expect(unit.rotation).toBe(0);
  });
});
