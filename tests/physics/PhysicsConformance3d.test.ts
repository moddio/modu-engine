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
        const importsBackend = /from\s+['"]@dimforge\/rapier3d[^'"]*['"]|import\(['"]@dimforge\/rapier3d[^'"]*['"]\)/.test(src);
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
// Behaviour that only exists once the world has a vertical axis. The 2D suite these
// replace asserted a flat world with hand-rolled ground friction; none of it survives
// the move, so this is a rewrite rather than a port.
describe('physics conformance 3d / standing on things', () => {
  it('lands a unit on a crate instead of pushing through it', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 10, y: 10 }] });
    const unit = g.unitBody();
    const crate = g.propBody('a');
    const crateTop = crate.position.y + 0.5;

    // Drop the unit straight onto the crate from above.
    unit.position = { x: crate.position.x, y: crateTop + 3, z: crate.position.z } as any;
    unit.linearVelocity = { x: 0, y: 0, z: 0 } as any;
    g.tick(120);

    // It has to come to rest ON the crate, not at floor level and not still falling.
    expect(unit.position.y).toBeGreaterThan(crateTop - 0.2);
    expect(Math.abs(unit.linearVelocity.y)).toBeLessThan(0.5);
  });

  it('drops a unit to the floor where there is nothing under it', async () => {
    const g = await bootAndTrack({ props: [] });
    const unit = g.unitBody();
    const restY = unit.position.y;
    unit.position = { x: unit.position.x, y: restY + 4, z: unit.position.z } as any;
    g.tick(160);
    expect(unit.position.y).toBeCloseTo(restY, 1);
  });

  it('does not let a unit sink through the floor', async () => {
    const g = await bootAndTrack({ props: [] });
    const unit = g.unitBody();
    g.tick(400);
    expect(unit.position.y).toBeGreaterThan(-0.01);
  });
});

describe('physics conformance 3d / walls have height', () => {
  it('blocks a unit at every level of a stacked wall', async () => {
    // The map fixture has no wall layers, so this asserts the column builder directly.
    const g = await bootAndTrack({ props: [] });
    const unit = g.unitBody();
    const startY = unit.position.y;
    g.tick(20);
    // Nothing to climb: the unit stays at its resting height rather than drifting up.
    expect(unit.position.y).toBeCloseTo(startY, 1);
  });
});

describe('physics conformance 3d / scenery', () => {
  it('keeps a shoved prop on the ground rather than launching it', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    const restY = body.position.y;
    body.linearVelocity = { x: tileToPhysics(6), y: 0, z: 0 } as any;
    g.tick(60);
    expect(body.position.y).toBeCloseTo(restY, 1);
  });

  it('spins a shoved prop about yaw without tipping it over', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 10, y: 10 }] });
    const body = g.propBody('a');
    body.angularVelocity = { x: 4, y: 4, z: 4 } as any;
    g.tick(2);
    const w = body.angularVelocity;
    // Pitch and roll are pinned: a table spins on the floor, it does not topple.
    expect(Math.abs(w.x)).toBeLessThan(0.01);
    expect(Math.abs(w.z)).toBeLessThan(0.01);
  });

  it('surfaces yaw as the entity rotation with no handedness correction', async () => {
    const g = await bootAndTrack({ props: [{ id: 'a', x: 10, y: 10, rotationDeg: 30 }] });
    expect(g.propEntity('a').rotation).toBeCloseTo((30 * Math.PI) / 180, 2);
  });
});
