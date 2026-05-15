import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

/**
 * Taro's `Unit.updateNameLabel` (gs/taro/src/gameClasses/Unit.js:1604) hides a
 * unit's overhead name label whenever the unit has no owner *player*
 * (`playerTypeData ? playerTypeData.showNameLabel === false : true` — a falsy
 * playerTypeData, i.e. no owner player, evaluates the ternary to `true` →
 * label hidden). A unit's `_stats.name` in taro is the *owner player's* name
 * (set in `setOwnerPlayer`), never the unitType's editor label.
 *
 * Repro of the reported bug (game HRP5883Eb "Invisible Body - 64x64"): the
 * sensor unitTypes are spawned ownerless, so taro shows no label — but the
 * modu port seeded every unit's `stats.name` with `typeDef.name`, so the
 * renderer drew the editor label above an invisible (transparent-sprite) body.
 */
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
        controls: { movementMethod: 'velocity', movementType: 'wasd', mouseBehaviour: {} },
      },
      invisibleBody: {
        name: 'Invisible Body - 64x64',
        body: { type: 'static', width: 40, height: 40 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd', mouseBehaviour: {} },
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: {},
  },
  scripts: {},
  variables: {},
};

describe('GameServer unit name label (taro getOwner gating)', () => {
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

  // The renderer draws the label from the *broadcast* `stats.name`, not the
  // server-side entity — `spawnUnit` spreads `{...unit.stats, ...typeDef}`, so
  // a regression that lets `typeDef.name` win is only visible in the payload.
  it("a player-owned unit's name is the owner player's name, not the unitType label (entity + broadcast)", async () => {
    await server.init(GAME_DATA as any);
    const creates: any[] = [];
    transport.client.onMessage((msg: any) => {
      if (msg.type === MessageType.EntityCreate) creates.push(msg.data);
    });
    server.start();
    await transport.client.connect();
    transport.client.send({
      type: MessageType.JoinGame,
      data: { playerName: 'Alice', isMobile: false },
    });
    const unit: any = Array.from((server as any)._entities.values() as Iterable<any>)
      .find((e: any) => e.stats?.type === 'slayer');
    expect(unit).toBeTruthy();
    expect(unit.stats.name).toBe('Alice');
    // The client-facing payload must also be the player's name, not 'Slayer'.
    const slayerCreate = creates.find((d) => d?.stats?.type === 'slayer');
    expect(slayerCreate).toBeTruthy();
    expect(slayerCreate.stats.name).toBe('Alice');
    expect(slayerCreate.stats.name).not.toBe('Slayer');
    // typeDef rendering fields must still survive the spread.
    expect(slayerCreate.stats.bodies).toBeTruthy();
  });

  it('an ownerless (script/sensor) unit broadcasts an empty name so no label is drawn', async () => {
    await server.init(GAME_DATA as any);
    const creates: any[] = [];
    transport.client.onMessage((msg: any) => {
      if (msg.type === MessageType.EntityCreate) creates.push(msg.data);
    });
    server.start();
    await transport.client.connect();
    const typeDef = (GAME_DATA.entities.unitTypes as any).invisibleBody;
    const unit: any = (server as any).spawnUnit('invisibleBody', typeDef, '', { x: 1, z: 1 });
    expect(unit.stats.name).toBe('');
    const ibCreate = creates.find((d) => d?.stats?.type === 'invisibleBody');
    expect(ibCreate).toBeTruthy();
    // The bug: typeDef.name ("Invisible Body - 64x64") clobbered the empty
    // runtime name in the EntityCreate broadcast.
    expect(ibCreate.stats.name).toBe('');
    expect(ibCreate.stats.name).not.toBe('Invisible Body - 64x64');
  });
});
