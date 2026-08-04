import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

/**
 * PHYSICS CONFORMANCE SUITE
 * =========================
 *
 * This file is the behavioural contract for whatever rigid-body backend sits behind
 * `engine/core/physics`. It exists so that swapping rapier2d for Box2D (or anything
 * else) is a mechanical job with a pass/fail signal, instead of a guess followed by
 * weeks of "the sofa feels wrong now".
 *
 * RULES FOR THIS FILE — please keep them:
 *
 *  1. **Never import the backend.** No `@dimforge/rapier2d-compat`, no `RAPIER.*`.
 *     Everything goes through `PhysicsWorld` / `RigidBody` or through observable
 *     GameServer state. A test that reaches for `body.raw` is testing rapier, not the
 *     game, and will have to be rewritten during the very migration it was meant to
 *     protect.
 *  2. **Assert on outcomes a player could see** — where an entity ended up, whether it
 *     stopped, whether it got through the doorway — not on solver internals like
 *     impulse counts or contact-manifold contents. Different backends reach the same
 *     outcome by different arithmetic.
 *  3. **Use tolerances wide enough for a different solver, narrow enough to catch a
 *     regression.** Roughly: positions to ~5% of a tile, times to ~1 tick, and
 *     directional/monotonic assertions ("stopped", "did not pass") wherever an exact
 *     number would be over-fitting to rapier.
 *
 * When a case here fails after a backend swap, the failure message should tell you
 * which *game behaviour* broke. That is the whole point.
 */

const tilePx = 16;
const SCALE_RATIO = 30;          // engine-wide physics scale: physics units = px / 30
const tileToPhysics = (t: number) => (t * tilePx) / SCALE_RATIO;
const physicsToTiles = (p: number) => (p * SCALE_RATIO) / tilePx;

type Overrides = {
  groundFriction?: number;
  unitControls?: Record<string, any>;
  unitBody?: Record<string, any>;
  propBody?: Record<string, any>;
  propType?: string;
  props?: Array<{ id: string; entity?: string; x: number; y: number; rotationDeg?: number }>;
  extraPropTypes?: Record<string, any>;
};

/**
 * A deliberately small world: no tile layers, no map-boundary confinement, one unit
 * type and one prop type. Everything a case needs is passed in, so each test reads as
 * a self-contained statement about one behaviour.
 */
function makeGameData(o: Overrides = {}) {
  const props = o.props ?? [];
  return {
    map: { width: 40, height: 40, tilewidth: tilePx, tileheight: tilePx, layers: [], tilesets: [] },
    settings: {
      frameRate: 20,
      ...(o.groundFriction !== undefined ? { physics: { groundFriction: o.groundFriction } } : {}),
    },
    unitTypes: {
      walker: {
        name: 'Walker',
        bodies: {
          default: {
            type: 'dynamic',
            width: tilePx,
            height: tilePx,
            linearDamping: 0,
            angularDamping: 0,
            fixtures: [{ shape: { type: 'rectangle' }, friction: 0.01, restitution: 0.01, density: 1.5 }],
            ...(o.unitBody ?? {}),
          },
        },
        attributes: { speed: { value: 5 } },
        controls: { movementMethod: 'velocity', movementControlScheme: 'wasd', ...(o.unitControls ?? {}) },
        confinedWithinMapBoundaries: false,
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: { p: { name: 'P' } },
    propTypes: {
      crate: {
        name: 'Crate',
        bodies: {
          default: {
            type: 'dynamic',
            width: 2 * tilePx,
            height: 2 * tilePx,
            linearDamping: 1,
            angularDamping: 1,
            fixtures: [{
              shape: { type: 'rectangle' }, friction: 0.01, restitution: 0.01,
              density: 1, overrideMass: true, mass: 10, scale: { x: 1, y: 1, z: 1 },
            }],
            ...(o.propBody ?? {}),
          },
        },
      },
      ...(o.extraPropTypes ?? {}),
    },
    scripts: {
      initialize: {
        name: 'initialize',
        actions: props.map((p) => ({
          type: 'createEntityAtPositionWithDimensions',
          actionId: p.id,
          entityType: 'propTypes',
          entity: p.entity ?? o.propType ?? 'crate',
          position: { x: p.x, y: p.y, z: 0 },
          rotation: { y: p.rotationDeg ?? 0 },
          scale: {},
        })),
      },
    },
    variables: {},
  };
}

/** Boot a server on the given data and join one player. Returns handles for probing. */
async function boot(o: Overrides = {}) {
  Engine.reset();
  const transport = createInMemoryPair();
  const server = new GameServer(transport.server, { singlePlayer: true });
  const raw: any = makeGameData(o);
  const migrated = {
    version: '2.0',
    settings: raw.settings,
    map: raw.map,
    entities: {
      unitTypes: raw.unitTypes, itemTypes: raw.itemTypes,
      projectileTypes: raw.projectileTypes, playerTypes: raw.playerTypes,
      propTypes: raw.propTypes,
    },
    scripts: {},
    variables: {},
  };
  await server.init(migrated as any, raw as any);
  server.start();
  transport.client.onMessage(() => {});
  await transport.client.connect();
  transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'T', isMobile: false } });

  const s = server as any;
  s._tick(50);

  const entities: Map<string, any> = s._entities;
  const bodies: Map<string, any> = s._entityBodies;
  const [clientId, playerData] = [...(s._players as Map<string, any>).entries()][0];

  return {
    server,
    transport,
    tick: (n = 1) => { for (let i = 0; i < n; i++) s._tick(50); },
    press: (key: string, down: boolean) => s._onPlayerInput(clientId, { device: 'keyboard', key }, down),
    unitId: playerData.unitId as string,
    unit: () => entities.get(playerData.unitId),
    unitBody: () => bodies.get(playerData.unitId),
    props: () => [...entities.entries()].filter(([, e]) => e.category === 'prop'),
    propBody: (actionId: string) => bodies.get(`init_${actionId}`),
    propEntity: (actionId: string) => entities.get(`init_${actionId}`),
    world: () => s._physics,
  };
}

let live: Awaited<ReturnType<typeof boot>> | null = null;
const bootAndTrack = async (o: Overrides = {}) => { live = await boot(o); return live; };

afterEach(() => {
  live?.server.stop();
  live = null;
  Engine.reset();
});

// ---------------------------------------------------------------------------
describe('physics conformance / backend isolation', () => {
  /**
   * The migration cost of swapping backends is exactly the number of files that know
   * which backend it is. Keep that at "the physics folder, and nothing else". If this
   * fails, a backend type or import has leaked into game code and needs to be hidden
   * behind PhysicsWorld/RigidBody before the swap can be mechanical.
   */
  it('confines all backend knowledge to engine/core/physics', () => {
    const engineDir = path.resolve(__dirname, '../../engine');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) { walk(full); continue; }
        if (!name.endsWith('.ts')) continue;
        const rel = path.relative(engineDir, full).replace(/\\/g, '/');
        if (rel.startsWith('core/physics/')) continue;
        const src = fs.readFileSync(full, 'utf8');
        // An import of the backend package, or a reach through the escape hatch.
        const importsBackend = /from\s+['"]@dimforge\/rapier2d[^'"]*['"]|import\(['"]@dimforge\/rapier2d[^'"]*['"]\)/.test(src);
        // `.raw` on a RigidBody — allowed to exist, but not outside the physics folder.
        const usesRaw = /\braw\.(setLinear|setAngular|lockRotations|applyImpulse|addForce|addTorque|translation|linvel|angvel|setTranslation|setRotation|mass|handle)\b/.test(src);
        if (importsBackend || usesRaw) offenders.push(rel);
      }
    };
    walk(engineDir);

    expect(
      offenders,
      `These files know about the physics backend directly, so a backend swap would have to touch them:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('physics conformance / mass', () => {
  it('derives a non-zero mass from density', async () => {
    const g = await bootAndTrack({
      propBody: { fixtures: [{ shape: { type: 'rectangle' }, density: 2, friction: 0, restitution: 0 }] },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    expect(g.propBody('a').mass).toBeGreaterThan(0);
  });

  it('lets an explicit mass override win over density', async () => {
    // 3D exports routinely ship `density: 0` next to `overrideMass: true, mass: N`.
    // Honouring only the density leaves a massless dynamic body, and no contact solver
    // can stop a body with zero mass — units walked through walls.
    const g = await bootAndTrack({
      propBody: {
        fixtures: [{ shape: { type: 'rectangle' }, density: 0, overrideMass: true, mass: 17, friction: 0, restitution: 0 }],
      },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    expect(g.propBody('a').mass).toBeCloseTo(17, 3);
  });

  it('spins an explicit-mass body the way the torque points', async () => {
    // Setting a mass override without also supplying the shape's angular inertia
    // leaves the inertia unset, and rapier then integrates torque against garbage: a
    // positive torque produced a *negative* angular velocity. Every prop in a 3D
    // export sets `overrideMass`, so this affected all of them. Assert the physical
    // invariant — a body accelerates in the direction it is twisted — rather than any
    // particular inertia number, which is shape- and backend-specific.
    const g = await bootAndTrack({
      groundFriction: 0,
      propBody: {
        angularDamping: 0,
        fixtures: [{ shape: { type: 'rectangle' }, density: 0, overrideMass: true, mass: 17, friction: 0, restitution: 0 }],
      },
      props: [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 25, y: 25 }],
    });
    const ccw = g.propBody('a');
    const cw = g.propBody('b');
    expect(ccw.angularVelocity).toBe(0);
    expect(cw.angularVelocity).toBe(0);

    // Two untouched bodies rather than one body torqued twice: re-zeroing a body's
    // angular velocity mid-simulation lands in the solver's warm-start cache and the
    // second result is no longer a clean reading.
    ccw.applyTorque(50);
    cw.applyTorque(-50);
    g.tick();

    expect(ccw.angularVelocity).toBeGreaterThan(0);
    expect(cw.angularVelocity).toBeLessThan(0);
    expect(Math.abs(cw.angularVelocity)).toBeCloseTo(ccw.angularVelocity, 5);
  });

  it('gives a mass-overridden body the same inertia scale as a density-derived one', async () => {
    // Guards the *magnitude* of the supplied inertia, not just its sign: an explicit
    // mass and an equivalent density describe the same physical object, so they must
    // respond to the same torque within the same order of magnitude.
    const dims = { width: 2 * tilePx, height: 2 * tilePx };
    const area = tileToPhysics(2) * tileToPhysics(2);
    const spin = async (fixture: Record<string, any>) => {
      const g = await boot({
        groundFriction: 0,
        propBody: { ...dims, angularDamping: 0, fixtures: [{ shape: { type: 'rectangle' }, friction: 0, restitution: 0, ...fixture }] },
        props: [{ id: 'a', x: 10, y: 10 }],
      });
      g.propBody('a').applyTorque(50);
      g.tick();
      const w = g.propBody('a').angularVelocity;
      const m = g.propBody('a').mass;
      g.server.stop();
      Engine.reset();
      return { w, m };
    };
    const byMass = await spin({ density: 0, overrideMass: true, mass: 10 });
    const byDensity = await spin({ density: 10 / area });

    expect(byMass.m).toBeCloseTo(byDensity.m, 2);
    expect(byMass.w / byDensity.w).toBeGreaterThan(0.5);
    expect(byMass.w / byDensity.w).toBeLessThan(2);
  });

  it('changes velocity by impulse/mass', async () => {
    const g = await bootAndTrack({
      groundFriction: 0,
      propBody: {
        linearDamping: 0,
        fixtures: [{ shape: { type: 'rectangle' }, density: 0, overrideMass: true, mass: 10, friction: 0, restitution: 0 }],
      },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    const body = g.propBody('a');
    body.linearVelocity = { x: 0, y: 0 };
    body.applyImpulse({ x: 20, y: 0 });
    g.tick();
    // J/m = 20/10 = 2 physics units/s.
    expect(body.linearVelocity.x).toBeCloseTo(2, 1);
  });
});

// ---------------------------------------------------------------------------
describe('physics conformance / damping', () => {
  it('leaves an undamped body at constant velocity', async () => {
    const g = await bootAndTrack({
      groundFriction: 0,
      propBody: { linearDamping: 0, angularDamping: 0 },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    const body = g.propBody('a');
    body.linearVelocity = { x: 3, y: 0 };
    g.tick(20);
    expect(body.linearVelocity.x).toBeCloseTo(3, 2);
  });

  it('decays velocity at the authored linear damping rate', async () => {
    // Both rapier and Box2D integrate damping as v ← v / (1 + λ·dt). Assert the
    // resulting curve, not the formula, so a backend that uses exp(-λ·dt) still passes
    // inside tolerance.
    const g = await bootAndTrack({
      groundFriction: 0,
      propBody: { linearDamping: 2, angularDamping: 0 },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    const body = g.propBody('a');
    body.linearVelocity = { x: 4, y: 0 };
    g.tick(20); // 1 second at 20Hz
    const expected = 4 / Math.pow(1 + 2 * 0.05, 20); // ≈ 0.594
    expect(body.linearVelocity.x).toBeGreaterThan(expected * 0.7);
    expect(body.linearVelocity.x).toBeLessThan(expected * 1.4);
  });

  it('honours the authored damping value rather than a hard-coded one', async () => {
    const slow = await boot({ groundFriction: 0, propBody: { linearDamping: 0.5 }, props: [{ id: 'a', x: 10, y: 10 }] });
    slow.propBody('a').linearVelocity = { x: 4, y: 0 };
    slow.tick(20);
    const slowV = slow.propBody('a').linearVelocity.x;
    slow.server.stop();
    Engine.reset();

    const fast = await bootAndTrack({ groundFriction: 0, propBody: { linearDamping: 4 }, props: [{ id: 'a', x: 10, y: 10 }] });
    fast.propBody('a').linearVelocity = { x: 4, y: 0 };
    fast.tick(20);
    expect(fast.propBody('a').linearVelocity.x).toBeLessThan(slowV);
  });
});

// ---------------------------------------------------------------------------
describe('physics conformance / ground friction', () => {
  /**
   * The world is viewed from above, so there is no floor and no gravity to press a
   * prop against it. Damping alone is viscous: it decays asymptotically and a body
   * never actually stops. Dry friction is the missing effect — a constant `μ·g`
   * deceleration that brings a prop to rest in finite time. Without it a single shove
   * sent a 30kg car 7.5 tiles over 13 seconds.
   */
  it('brings a shoved prop to a complete stop, not an asymptote', async () => {
    const g = await bootAndTrack({ propBody: { linearDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    body.linearVelocity = { x: 3, y: 0 };
    g.tick(60); // 3 seconds
    expect(body.linearVelocity.x).toBe(0);
  });

  it('stops it within a plausible shove distance', async () => {
    const g = await bootAndTrack({ propBody: { linearDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    const start = g.propEntity('a').position.x;
    body.linearVelocity = { x: tileToPhysics(4), y: 0 }; // shoved at 4 tiles/s
    g.tick(80);
    const travelled = g.propEntity('a').position.x - start;
    expect(travelled).toBeGreaterThan(0.2);
    expect(travelled).toBeLessThan(2.5);
  });

  it('stops light and heavy props in the same distance', async () => {
    // Coulomb deceleration is μ·g — independent of mass. A backend that models it as a
    // force without dividing by mass would stop the heavy prop far later.
    const g = await bootAndTrack({
      groundFriction: 0.6,
      propBody: { linearDamping: 0 },
      extraPropTypes: {
        heavy: {
          name: 'Heavy',
          bodies: {
            default: {
              type: 'dynamic', width: 2 * tilePx, height: 2 * tilePx, linearDamping: 0, angularDamping: 1,
              fixtures: [{ shape: { type: 'rectangle' }, density: 0, overrideMass: true, mass: 500, friction: 0.01, restitution: 0.01 }],
            },
          },
        },
      },
      props: [{ id: 'light', x: 5, y: 5 }, { id: 'heavy', entity: 'heavy', x: 5, y: 25 }],
    });
    const run = (id: string) => {
      const start = g.propEntity(id).position.x;
      g.propBody(id).linearVelocity = { x: tileToPhysics(4), y: 0 };
      return () => g.propEntity(id).position.x - start;
    };
    const lightDist = run('light');
    const heavyDist = run('heavy');
    g.tick(80);
    expect(g.propBody('light').mass).toBeLessThan(g.propBody('heavy').mass / 10);
    expect(lightDist()).toBeCloseTo(heavyDist(), 1);
  });

  it('scales the stopping distance with the friction coefficient', async () => {
    const slippery = await boot({ groundFriction: 0.1, propBody: { linearDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const s0 = slippery.propEntity('a').position.x;
    slippery.propBody('a').linearVelocity = { x: tileToPhysics(4), y: 0 };
    slippery.tick(120);
    const slipperyDist = slippery.propEntity('a').position.x - s0;
    slippery.server.stop();
    Engine.reset();

    const grippy = await bootAndTrack({ groundFriction: 1.5, propBody: { linearDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const g0 = grippy.propEntity('a').position.x;
    grippy.propBody('a').linearVelocity = { x: tileToPhysics(4), y: 0 };
    grippy.tick(120);
    expect(grippy.propEntity('a').position.x - g0).toBeLessThan(slipperyDist / 2);
  });

  it('does not apply to units, whose deceleration is authored as damping', async () => {
    // Units author `linearDamping: 0` deliberately; adding floor drag on top would
    // fight the movement code. Probed in impulse mode because a velocity-mode unit has
    // its velocity reassigned every tick, which would mask any drag either way.
    const g = await bootAndTrack({
      unitControls: { movementMethod: 'impulse' },
      unitBody: { linearDamping: 0 },
      props: [],
    });
    const body = g.unitBody();
    body.linearVelocity = { x: 2, y: 0 };
    g.tick(10);
    expect(Math.abs(body.linearVelocity.x)).toBeCloseTo(2, 2);
  });

  it('settles a spinning prop instead of letting it turn forever', async () => {
    const g = await bootAndTrack({ propBody: { angularDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    body.angularVelocity = 3;
    g.tick(80);
    expect(body.angularVelocity).toBe(0);
  });

  it('lets a shove-strength spin survive long enough to be seen', async () => {
    // Settling is only half the contract: a prop also has to *visibly turn* on the way
    // there. Walking a unit into a prop's corner imparts only ~0.5 rad/s, so an angular
    // decrement bigger than that zeroes the spin on the very next tick — every shove,
    // for every prop. The prop then slides across the floor without ever turning, which
    // is indistinguishable from the rotation-locked bodies props used to be created as.
    const g = await bootAndTrack({ propBody: { angularDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    const start = g.propEntity('a').rotation;

    body.angularVelocity = 0.5;
    g.tick(1);
    expect(body.angularVelocity).not.toBe(0);

    g.tick(60);
    // ~6°: the threshold where a turn reads as a turn rather than as jitter.
    expect(Math.abs(g.propEntity('a').rotation - start)).toBeGreaterThan(0.1);
  });

  it('spends one friction budget across sliding and spinning, not two', async () => {
    // Coulomb friction at the contact patch is a single budget. Deducting the full μ·g
    // from the linear velocity AND the full μ·g/R from the angular velocity in the same
    // tick spends it twice, and the rotational half is what disappears first: a prop
    // shoved hard enough to skate two tiles should still be turning while it travels.
    const g = await bootAndTrack({ propBody: { linearDamping: 0, angularDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    const start = g.propEntity('a').rotation;

    body.linearVelocity = { x: tileToPhysics(4), y: 0 };
    body.angularVelocity = 0.5;
    g.tick(20);

    // While it is still sliding, most of the friction is opposing the slide, so the
    // spin must not already be gone.
    expect(Math.abs(g.propEntity('a').rotation - start)).toBeGreaterThan(0.1);
  });

  it('turns a shoved prop the way the shove points', async () => {
    // `entity.rotation` is a three.js yaw; `body.angle` is a 2D physics angle. Positions
    // map (x, y) → (x, z), which reverses orientation in a right-handed Y-up frame, so
    // the two differ by a sign. Reading one straight into the other mirrors every
    // physics-driven turn: shoving a box's top-left corner rightward — which has to
    // swing it clockwise — spun it anticlockwise on screen.
    const g = await bootAndTrack({ propBody: { linearDamping: 0, angularDamping: 0 }, props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    const before = g.propEntity('a').rotation;

    // Impulse toward +x applied above the centre line (−z, the top edge on screen).
    body.angularVelocity = 0;
    body.linearVelocity = { x: 0, y: 0 };
    body.applyImpulse({ x: tileToPhysics(6), y: 0 });
    body.angularVelocity = 1; // physics-frame CCW, which must read as clockwise yaw
    g.tick(4);

    // A clockwise on-screen turn is a *decreasing* three.js yaw.
    expect(g.propEntity('a').rotation).toBeLessThan(before);
  });

  it('stops a large prop spinning more slowly than a small one', async () => {
    // Angular deceleration from a contact patch of radius R goes as μ·g/R, so a big
    // prop must keep its spin longer than a small one. A hardcoded radius makes a
    // wardrobe settle exactly as fast as a stool.
    const g = await bootAndTrack({
      propBody: { angularDamping: 0 },
      extraPropTypes: {
        big: {
          name: 'Big',
          bodies: {
            default: {
              type: 'dynamic', width: 6 * tilePx, height: 6 * tilePx, linearDamping: 1, angularDamping: 0,
              fixtures: [{
                shape: { type: 'rectangle' }, friction: 0.01, restitution: 0.01,
                density: 1, overrideMass: true, mass: 10, scale: { x: 1, y: 1, z: 1 },
              }],
            },
          },
        },
      },
      props: [{ id: 'small', x: 5, y: 5 }, { id: 'big', entity: 'big', x: 5, y: 25 }],
    });
    g.propBody('small').angularVelocity = 3;
    g.propBody('big').angularVelocity = 3;
    g.tick(6);
    expect(Math.abs(g.propBody('big').angularVelocity)).toBeGreaterThan(Math.abs(g.propBody('small').angularVelocity));
  });

  it('leaves static props alone', async () => {
    const g = await bootAndTrack({
      propBody: { type: 'static' },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    const before = { ...g.propEntity('a').position };
    g.tick(40);
    expect(g.propEntity('a').position.x).toBeCloseTo(before.x, 6);
    expect(g.propEntity('a').position.z).toBeCloseTo(before.z, 6);
  });
});

// ---------------------------------------------------------------------------
describe('physics conformance / rotation ownership', () => {
  /**
   * Rotation splits by category. Units, items and projectiles have their facing
   * rewritten by game logic every tick, so physics spin would fight those writes and
   * they stay locked. Props are physical scenery with nothing driving their facing —
   * locking them made a shoved sofa slide in a dead-straight line, which is both wrong
   * and the strongest visual cue of "sliding on ice".
   */
  it('spawns a prop at the angle the initialize script placed it at', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 10, y: 10, rotationDeg: 30 }] });
    expect(g.propEntity('a').rotation).toBeCloseTo(Math.PI / 6, 4);
  });

  it('keeps that angle across ticks when nothing touches it', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 10, y: 10, rotationDeg: 45 }] });
    g.tick(40);
    expect(g.propEntity('a').rotation).toBeCloseTo(Math.PI / 4, 4);
  });

  it('lets a prop spin when torque is applied', async () => {
    const g = await bootAndTrack({
      groundFriction: 0,
      propBody: { angularDamping: 0 },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    const body = g.propBody('a');
    expect(body.angularVelocity).toBe(0);
    body.angularVelocity = 1.5;
    g.tick(5);
    expect(Math.abs(body.angularVelocity)).toBeGreaterThan(0.5);
    expect(g.propEntity('a').rotation).not.toBe(0);
  });

  it('surfaces the physics angle as the entity rotation, negated into the render frame', async () => {
    // The two are not the same number: `body.angle` is a 2D physics angle and
    // `entity.rotation` is a three.js yaw, and they wind opposite ways. Physics turns
    // +x toward +y (which is world +z); a three.js yaw about +Y turns +x toward −z.
    // That is true whatever the camera does, so surfacing one as the other unconverted
    // mirrors every physics-driven rotation.
    const g = await bootAndTrack({
      groundFriction: 0,
      propBody: { angularDamping: 0 },
      props: [{ id: 'a', x: 10, y: 10 }],
    });
    g.propBody('a').angularVelocity = 2;
    g.tick(10);
    const bodyAngle = g.propBody('a').angle;
    expect(bodyAngle).not.toBeCloseTo(0, 3); // the spin actually happened
    expect(g.propEntity('a').rotation).toBeCloseTo(-bodyAngle, 5);
  });

  it('round-trips an authored angle through the physics frame unchanged', async () => {
    // The negation has to be applied on the way in as well as out, or fixing the spin
    // direction would flip all the map's authored scenery instead.
    const g = await bootAndTrack({ props: [{ id: 'a', x: 10, y: 10, rotationDeg: 30 }] });
    expect(g.propEntity('a').rotation).toBeCloseTo((30 * Math.PI) / 180, 3);
  });

  it('keeps unit rotation locked so game logic owns facing', async () => {
    const g = await bootAndTrack({ props: [] });
    const body = g.unitBody();
    body.angularVelocity = 5;
    g.tick(2);
    expect(body.angularVelocity).toBe(0);
    expect(body.angle).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
describe('physics conformance / collision response', () => {
  it('stops a unit walking into a static prop', async () => {
    const g = await bootAndTrack({
      propBody: { type: 'static' },
      props: [{ id: 'wall', x: 10, y: 5 }],
    });
    g.unitBody().position = { x: tileToPhysics(6), y: tileToPhysics(5) };
    g.press('d', true);
    g.tick(200);
    // The 2-tile crate is centred at x=10, so its left face is x=9; a 1-tile unit
    // settles near 8.5. Unblocked it would have run well past x=20.
    expect(g.unit().position.x).toBeGreaterThan(7);
    expect(g.unit().position.x).toBeLessThan(9.5);
  });

  it('stops a unit even when the fixture uses overrideMass with density 0', async () => {
    const g = await bootAndTrack({
      unitBody: {
        fixtures: [{ shape: { type: 'rectangle' }, density: 0, overrideMass: true, mass: 20, friction: 0, restitution: 0 }],
      },
      propBody: { type: 'static' },
      props: [{ id: 'wall', x: 10, y: 5 }],
    });
    g.unitBody().position = { x: tileToPhysics(6), y: tileToPhysics(5) };
    g.press('d', true);
    g.tick(200);
    expect(g.unit().position.x).toBeLessThan(9.5);
  });

  it('lets a unit push a dynamic prop out of the way', async () => {
    const g = await bootAndTrack({ props: [{ id: 'box', x: 10, y: 5 }] });
    g.unitBody().position = { x: tileToPhysics(6), y: tileToPhysics(5) };
    const startX = g.propEntity('box').position.x;
    g.press('d', true);
    g.tick(200);
    expect(g.propEntity('box').position.x).toBeGreaterThan(startX + 0.5);
  });

  it('does not block a unit with a sensor fixture', async () => {
    const g = await bootAndTrack({
      propBody: { type: 'static', fixtures: [{ shape: { type: 'rectangle' }, isSensor: true, density: 1 }] },
      props: [{ id: 'trigger', x: 10, y: 5 }],
    });
    g.unitBody().position = { x: tileToPhysics(6), y: tileToPhysics(5) };
    g.press('d', true);
    g.tick(200);
    expect(g.unit().position.x).toBeGreaterThan(11);
  });

  it('honours collidesWith so a filtered body passes through', async () => {
    const g = await bootAndTrack({
      unitBody: {
        fixtures: [{
          shape: { type: 'rectangle' }, density: 1.5, friction: 0, restitution: 0,
          collidesWith: { walls: true, units: true, items: true, projectiles: true, props: false },
        }],
      },
      propBody: { type: 'static' },
      props: [{ id: 'wall', x: 10, y: 5 }],
    });
    g.unitBody().position = { x: tileToPhysics(6), y: tileToPhysics(5) };
    g.press('d', true);
    g.tick(200);
    // `collidesWith` has no prop key in taro, so the engine keeps the PROP bit on by
    // default. This asserts the *default*, which is what the game data relies on.
    expect(g.unit().position.x).toBeLessThan(9.5);
  });
});

// ---------------------------------------------------------------------------
describe('physics conformance / determinism', () => {
  it('produces identical results from identical inputs', async () => {
    const run = async () => {
      const g = await boot({ props: [{ id: 'a', x: 10, y: 5, rotationDeg: 20 }] });
      g.unitBody().position = { x: tileToPhysics(6), y: tileToPhysics(5) };
      g.press('d', true);
      g.tick(100);
      const snapshot = {
        unit: [g.unit().position.x, g.unit().position.z],
        prop: [g.propEntity('a').position.x, g.propEntity('a').position.z, g.propEntity('a').rotation],
      };
      g.server.stop();
      Engine.reset();
      return snapshot;
    };
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
describe('physics conformance / coordinate contract', () => {
  /**
   * Three spaces, and every conversion between them must use the same constants:
   *   taro pixels → tile units (÷ map.tilewidth) → physics units (÷ 30).
   * Colliders sized in the wrong space is how a 0.5-tile unit ended up 1.81 tiles wide
   * and too fat for the map's doorways.
   */
  it('places a prop where the initialize script says, in tile units', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 12, y: 7 }] });
    expect(g.propEntity('a').position.x).toBeCloseTo(12, 5);
    expect(g.propEntity('a').position.z).toBeCloseTo(7, 5);
  });

  it('keeps entity positions in tile units and body positions in physics units', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 12, y: 7 }] });
    expect(physicsToTiles(g.propBody('a').position.x)).toBeCloseTo(12, 4);
    expect(physicsToTiles(g.propBody('a').position.y)).toBeCloseTo(7, 4);
  });

  it('moves a unit at its authored speed in tiles per second', async () => {
    const g = await bootAndTrack({ props: [] });
    g.press('d', true);
    g.tick();
    const tilesPerSecond = physicsToTiles(g.unitBody().linearVelocity.x);
    expect(tilesPerSecond).toBeGreaterThan(0);
    // Sanity band, not an exact figure: the mapping from `attributes.speed` to
    // tiles/s is taro's, and this only guards against an order-of-magnitude slip.
    expect(tilesPerSecond).toBeLessThan(20);
  });
});
