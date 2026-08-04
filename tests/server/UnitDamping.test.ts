import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';
import { Vec2 } from '../../engine/core/math/Vec2';

/**
 * Reproduces the "unit feels too slippery" bug on HRP5883Eb.
 *
 * The slayer unit type declares `linearDamping: {x:10, y:10, z:0}` and
 * `controls.movementMethod: 'velocity'`. With velocity-mode movement, the
 * engine sets `body.linearVelocity` directly while keys are held, so damping
 * only governs deceleration after the player releases the keys. The data's
 * damping of 10 maps to v(t) = v0 * exp(-10*t), i.e. ~99% gone after 0.5s.
 *
 * The engine previously attenuated dynamic-unit damping by 10x (capped at 2),
 * which makes sense for `impulse`/`force`-mode movement where equilibrium
 * velocity = (impulse_per_tick * tickrate) / damping — but for velocity-mode
 * units the attenuation just slows deceleration 10x and the unit slides for
 * seconds after the player releases WASD. The fix: only attenuate damping for
 * impulse/force-driven units; velocity-mode units honour the raw data value.
 */
const slayerLikeGameData = () => ({
  version: '2.0' as const,
  settings: { frameRate: 20 },
  map: { width: 30, height: 30, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      slayer: {
        name: 'Slayer',
        body: { type: 'dynamic', width: 16, height: 16, linearDamping: 10 },
        bodies: {
          default: {
            type: 'dynamic',
            width: 16, height: 16,
            linearDamping: { x: 10, y: 10, z: 0 },
            fixtures: [{
              shape: { type: 'circle' },
              friction: 0, restitution: 0, density: 1,
              size: { x: 0.75, y: 0.75, z: 0.625 },
            }],
          },
        },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 5 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
        confinedWithinMapBoundaries: false,
      },
    },
    itemTypes: {}, projectileTypes: {}, playerTypes: {},
  },
  scripts: {},
  variables: {},
});

describe('Unit deceleration honours data linearDamping', () => {
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

  it('velocity-mode unit with linearDamping=10 stops within 0.5s of releasing keys', async () => {
    await server.init(slayerLikeGameData() as any);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'T', isMobile: false } });
    (server as any)._tick(50);

    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const body = (server as any)._entityBodies.get(playerData.unitId);
    expect(body).toBeDefined();

    // Set initial velocity (mimicking what _processMovement does when 'd' is held).
    body.linearVelocity = new Vec2(5, 0);
    expect(body.linearVelocity.x).toBeCloseTo(5, 1);

    // No input keys → _processMovement won't overwrite velocity; body decays per damping.
    // Tick 10 × 50ms = 500ms. With damping=10, v(0.5)=5*exp(-5)≈0.034.
    // With buggy attenuation (damping=1), v(0.5)=5*exp(-0.5)≈3.03 → still 60% of full speed.
    for (let i = 0; i < 10; i++) (server as any)._tick(50);

    const v = body.linearVelocity;
    const speed = Math.hypot(v.x, v.y);
    // The data says damping=10 → expected speed after 0.5s is ~0.034. Allow
    // generous slack but fail clearly if the attenuation under-damps to ~3.
    expect(speed).toBeLessThan(0.5);
  });
});
