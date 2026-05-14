import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { Engine } from '../../engine/core/Engine';

/**
 * Regression: karmaslayers `Poop` item "moves so fast" bug.
 *
 * The Poop Helmet's per-second script (`itemTypes.QeZ9oTuFIK.scripts.9eIvTzrcsb`)
 * spawns a Poop item and calls `applyForceOnEntityAngle(force=375)` once to nudge
 * it behind the wearer. Rapier's `addForce` is *persistent* (keeps integrating
 * every step until `resetForces` runs), whereas Box2D's `applyForce` — which
 * taro, and therefore the script's force=375 calibration, was tuned against —
 * is *one-shot per step*. Without resetting after each world.step, the Poop
 * accelerates toward terminal velocity F/(m·damping) = 375/(1·5) = 75 phys/s and
 * rockets ~14.5 tiles across the map instead of falling behind the wearer.
 *
 * The fix lives in `PhysicsWorld.step` (resetForces after integration). This test
 * asserts the post-fix trajectory: one force pulse → damping-only decay.
 */
const gameData = () => ({
  version: '2.0' as const,
  settings: { frameRate: 20 },
  map: { width: 30, height: 30, tilewidth: 64, tileheight: 64, layers: [], tilesets: [] },
  entities: {
    unitTypes: {},
    itemTypes: {
      poop: {
        name: 'Poop',
        type: 'weapon',
        bodies: {
          dropped: {
            type: 'dynamic',
            width: 30, height: 30,
            linearDamping: 5,
            angularDamping: 1,
            fixtures: [{
              density: 1, friction: 0, restitution: 0,
              shape: { type: 'rectangle' },
              isSensor: false,
            }],
            collidesWith: { units: false, items: false, projectiles: false, walls: true, debris: false },
            bullet: false,
            affectedByGravity: false,
          },
        },
        controls: {},
      },
    },
    projectileTypes: {}, playerTypes: {},
  },
  scripts: {},
  variables: {},
});

describe('Poop dropped-body: one-shot applyForce semantics', () => {
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

  it('decelerates after a single applyForce(375) — does not approach terminal velocity', async () => {
    await server.init(gameData() as any);
    server.start();

    server.engine.events.emit('item:spawn', ['poop', { x: 15 * 64, y: 15 * 64 }]);
    (server as any)._tick(50);

    const bodies = (server as any)._entityBodies as Map<string, any>;
    const itemEntry = [...bodies.entries()].find(([id]) => id.startsWith('itm_'));
    expect(itemEntry).toBeDefined();
    const [eid, body] = itemEntry!;

    // Single force pulse, mirroring the Poop Helmet script.
    server.engine.events.emit('physics:applyForce', [eid, 375, 0]);

    // After the next tick, body has integrated one step of force: Δv = F·dt/m = 15.
    (server as any)._tick(50);
    const v1 = body.linearVelocity;
    expect(v1.x).toBeCloseTo(15, 1);

    // Subsequent ticks have NO further force — velocity should DECAY via damping=5
    // (factor ≈ 0.8 per 50ms step). With the buggy persistent force, velocity
    // instead INCREASES toward 75. Tick 2: buggy=27, correct=12.
    (server as any)._tick(50);
    expect(body.linearVelocity.x).toBeLessThan(v1.x);
    expect(body.linearVelocity.x).toBeCloseTo(12, 1);

    // After 1 second (20 more ticks), velocity should be effectively zero.
    // With the bug, velocity would be ≥75 (terminal). Correct decay leaves <1.
    for (let i = 0; i < 20; i++) (server as any)._tick(50);
    expect(body.linearVelocity.x).toBeLessThan(1);

    // Total displacement should be a small fraction of one tile (~2 tiles max),
    // not the 14+ tiles the persistent-force bug produced.
    const tilesTraveled = (body.position.x - 32) * 30 / 64;
    expect(tilesTraveled).toBeLessThan(3);
    expect(tilesTraveled).toBeGreaterThan(0.5);
  });
});
