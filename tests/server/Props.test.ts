import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

/**
 * `initializeEntities()` used to broadcast an EntityCreate for every prop in the
 * `initialize` script and stop there — the client drew the scenery but the server
 * never registered it. Consequences:
 *   - no collider was ever built, so units walked through every wall, fence and
 *     vehicle on the map (`_createEntityBody` accepted `category: 'prop'` and
 *     CollisionFilter had a PROP mask, but nothing ever passed it);
 *   - `_entities` never held the prop, so findById / entitiesInRegion /
 *     destroyEntity could not see it and no entityCreated script fired.
 *
 * Separately, `GameMigrator` dropped `propTypes` entirely, so
 * `types.get('propTypes', …)` was permanently empty and every script action that
 * resolves a prop bailed out.
 *
 * Body sizes here are in raw pixels, matching the engine's ingestion contract
 * (3D exports are denormalized by the caller before they reach GameServer).
 */
const tilePx = 16;

const gameDataWithProps = () => ({
  map: { width: 20, height: 20, tilewidth: tilePx, tileheight: tilePx, layers: [], tilesets: [] },
  settings: { frameRate: 20 },
  unitTypes: {
    walker: {
      name: 'Walker',
      bodies: {
        default: {
          type: 'dynamic',
          width: tilePx, height: tilePx,
          linearDamping: 0,
          fixtures: [{ shape: { type: 'rectangle' }, friction: 0, restitution: 0, density: 1 }],
        },
      },
      attributes: { speed: { value: 5 } },
      controls: { movementMethod: 'velocity', movementControlScheme: 'wasd' },
      confinedWithinMapBoundaries: false,
    },
  },
  itemTypes: {},
  projectileTypes: {},
  playerTypes: { p: { name: 'P' } },
  // A 2-tile-wide static block sitting at tile x=10, z=5.
  propTypes: {
    crate: {
      name: 'Crate',
      bodies: {
        default: {
          type: 'static',
          width: 2 * tilePx, height: 2 * tilePx,
          fixtures: [{ shape: { type: 'rectangle' }, friction: 0, restitution: 0 }],
        },
      },
    },
  },
  scripts: {
    initialize: {
      name: 'initialize',
      actions: [
        {
          type: 'createEntityAtPositionWithDimensions',
          actionId: 'crate1',
          entityType: 'propTypes',
          entity: 'crate',
          position: { x: 10, y: 5, z: 0 },
          rotation: { y: 0 },
          scale: {},
        },
      ],
    },
  },
  variables: {},
});

describe('Props from the initialize script', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;

  const boot = async () => {
    const raw = gameDataWithProps();
    const migrated = {
      version: '2.0',
      settings: raw.settings,
      map: raw.map,
      entities: {
        unitTypes: raw.unitTypes,
        itemTypes: raw.itemTypes,
        projectileTypes: raw.projectileTypes,
        playerTypes: raw.playerTypes,
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
    (server as any)._tick(50);
    return raw;
  };

  beforeEach(() => {
    Engine.reset();
    transport = createInMemoryPair();
    server = new GameServer(transport.server, { singlePlayer: true });
  });

  afterEach(() => {
    server.stop();
    Engine.reset();
  });

  it('registers the prop as a real entity, not just a broadcast', async () => {
    await boot();
    const entities = (server as any)._entities as Map<string, any>;
    const props = [...entities.values()].filter((e) => e.category === 'prop');
    expect(props).toHaveLength(1);
    expect(props[0].position.x).toBeCloseTo(10, 5);
    expect(props[0].position.z).toBeCloseTo(5, 5);
  });

  it('gives the prop a physics body', async () => {
    await boot();
    const entities = (server as any)._entities as Map<string, any>;
    const bodies = (server as any)._entityBodies as Map<string, any>;
    const [propId] = [...entities.entries()].find(([, e]) => e.category === 'prop')!;
    expect(bodies.get(propId)).toBeDefined();
  });

  it('blocks a unit that walks into it', async () => {
    await boot();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const body = (server as any)._entityBodies.get(playerData.unitId);
    expect(body).toBeDefined();

    // Park the unit to the left of the crate on the same row, then hold 'd' (+x).
    const tileToPhysics = (t: number) => (t * tilePx) / 30;
    body.position = { x: tileToPhysics(6), y: tileToPhysics(5) } as any;
    (server as any)._onPlayerInput(playerData.clientId ?? [...players.keys()][0], { device: 'keyboard', key: 'd' }, true);

    for (let i = 0; i < 200; i++) (server as any)._tick(50);

    // The crate spans 2 tiles centred on x=10, so its left face is at x=9. A unit
    // 1 tile wide stops with its centre near 8.5. Without a prop collider it would
    // have run past x=20 in 200 ticks at speed 5.
    expect(unit.position.x).toBeGreaterThan(7);
    expect(unit.position.x).toBeLessThan(9.5);
  });

  it('stops the unit even when the fixture uses overrideMass with density 0', async () => {
    // 3D `bodies.*` fixtures routinely ship `density: 0` next to
    // `overrideMass: true, mass: N`. Honouring only the density leaves a massless
    // dynamic body that the contact solver cannot resist, and the unit walks straight
    // through walls and props alike.
    Engine.reset();
    transport = createInMemoryPair();
    server = new GameServer(transport.server, { singlePlayer: true });
    const raw: any = gameDataWithProps();
    const fx = raw.unitTypes.walker.bodies.default.fixtures[0];
    fx.density = 0;
    fx.overrideMass = true;
    fx.mass = 20;
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
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'T', isMobile: false } });
    (server as any)._tick(50);

    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const body = (server as any)._entityBodies.get(playerData.unitId);
    const tileToPhysics = (t: number) => (t * tilePx) / 30;
    body.position = { x: tileToPhysics(6), y: tileToPhysics(5) } as any;
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'd' }, true);
    for (let i = 0; i < 200; i++) (server as any)._tick(50);

    expect(unit.position.x).toBeLessThan(9.5);
  });

  it('sizes a collider from the 3D fixture box, not the sprite width/height', async () => {
    // A 3D unit's `bodies.default.width/height` hold the SPRITE size (every Braains3D
    // survivor is 1.81x0.52) while the collider is described by the fixture: a unit
    // `shape` times a per-axis `scale`, in tile units, Z up. Sizing from width/height
    // gave a 1.81-tile-wide axis-aligned box — wider than that map's doorways, which
    // wedged the player the moment walls became solid. Props are the opposite: they
    // ship `scale (1,1,1)` and the real footprint in width/height, so the 3D path is
    // only taken when a scale is actually set.
    Engine.reset();
    transport = createInMemoryPair();
    server = new GameServer(transport.server, { singlePlayer: true });
    const raw: any = gameDataWithProps();
    const walkerBody = raw.unitTypes.walker.bodies.default;
    walkerBody.width = 4 * tilePx;   // deliberately wrong sprite size
    walkerBody.height = 4 * tilePx;
    walkerBody.fixtures[0].shape = { type: 'rectangle', width: 1, height: 1, depth: 1 };
    walkerBody.fixtures[0].scale = { x: 0.5, y: 0.75, z: 2 };

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
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'T', isMobile: false } });
    (server as any)._tick(50);

    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const body = (server as any)._entityBodies.get(playerData.unitId);
    const he = body.raw.collider(0).halfExtents();
    const toTiles = (phys: number) => (phys * 30) / tilePx;
    expect(toTiles(he.x * 2)).toBeCloseTo(0.5, 3);
    expect(toTiles(he.y * 2)).toBeCloseTo(0.75, 3);
  });

  it('keeps using width/height when the fixture scale is unset', async () => {
    await boot();
    const entities = (server as any)._entities as Map<string, any>;
    const bodies = (server as any)._entityBodies as Map<string, any>;
    const [propId] = [...entities.entries()].find(([, e]) => e.category === 'prop')!;
    const he = bodies.get(propId).raw.collider(0).halfExtents();
    const toTiles = (phys: number) => (phys * 30) / tilePx;
    // The crate declares a 2x2 tile body with scale (1,1,1).
    expect(toTiles(he.x * 2)).toBeCloseTo(2, 3);
    expect(toTiles(he.y * 2)).toBeCloseTo(2, 3);
  });
});
