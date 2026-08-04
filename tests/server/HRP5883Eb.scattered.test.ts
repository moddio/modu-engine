import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

// User report: meat dropped by mobs sometimes can't be picked up at all. The
// pig-loot script runs `setVelocityOfEntityXY(getLastCreatedItem, ±12 random)`
// right after `spawnItem` to scatter the meat — but `_streamTransforms` skips
// items, so the meat's *server* position drifts while the *client* visual
// stays at the spawn position. The player walks toward where they SEE the
// meat (its initial spawn position), but the pickup region uses the meat's
// drifted server position; `entitiesInRegion` doesn't find it, and the press
// E silently no-ops.
describe.skipIf(!URI)('HRP5883Eb scattered-loot pickup', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;
  let rawGameData: any;
  let clientCreates: Array<{ id: string; x: number; z: number }>;
  let clientSnapshots: Array<{ entityId: string; transform: unknown }>;

  beforeEach(async () => {
    Engine.reset();
    if (!rawGameData) {
      const c = new MongoClient(URI!);
      await c.connect();
      const db = c.db('moddio');
      const game = await db.collection('games').findOne({ gameSlug: 'HRP5883Eb' });
      const releases = game!.releases || [];
      const ref = [...releases].reverse().find((r: any) => r.isStable) || releases[releases.length - 1];
      const releaseId = new ObjectId(ref.release.toString());
      const rel =
        (await db.collection('releases').findOne({ _id: releaseId })) ||
        (await db.collection('t3releases').findOne({ _id: releaseId }));
      rawGameData = rel!.data;
      await c.close();
    }
    transport = createInMemoryPair();
    server = new GameServer(transport.server);
    clientCreates = [];
    clientSnapshots = [];
  });

  afterEach(() => { server.stop(); Engine.reset(); });

  async function init() {
    const migrated = GameMigrator.migrate({ data: rawGameData } as any);
    await server.init(migrated as any, rawGameData);
    server.start();
    transport.client.onMessage((msg: any) => {
      if (msg.type === MessageType.EntityCreate && msg.data?.category === 'item') {
        clientCreates.push({ id: msg.data.entityId, x: msg.data.x, z: msg.data.z });
      } else if (msg.type === MessageType.Snapshot) {
        for (const t of msg.data.transforms ?? []) clientSnapshots.push(t);
      }
    });
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Tester', isMobile: false } });
    await new Promise(r => setTimeout(r, 50));
  }

  // Scattered meat: client must be told where the item ACTUALLY is server-side
  // after the velocity push, otherwise the visual lies and any pickup attempt
  // at the visible position misses the entity.
  it('client sees scattered items at their server-authoritative position', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);

    const tilePx = (server as any)._tilePx;
    const spawnPx = { x: unit.position.x * tilePx + 200, y: unit.position.z * tilePx + 200 };
    const stackType = 'M94GUBy6iN';
    server.engine.events.emit('item:spawn', [stackType, spawnPx]);
    await new Promise(r => setTimeout(r, 30));

    // Find the just-spawned meat.
    let meatId: string | null = null;
    for (const [id, e] of (server as any)._entities.entries()) {
      const ee: any = e;
      if (ee.category === 'item' && ee.stats?.type === stackType && !ee.stats?.ownerId) meatId = id;
    }
    expect(meatId).not.toBeNull();
    const meat: any = (server as any)._entities.get(meatId!);
    const initialPos = { x: meat.position.x, z: meat.position.z };

    // Push the meat with a stiff velocity for one second of sim — the same shape
    // the pig-loot script applies after each spawn.
    server.engine.events.emit('physics:setVelocity', [meatId, 12, 12]);
    for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 50));

    const finalPos = { x: meat.position.x, z: meat.position.z };
    const drifted = Math.hypot(finalPos.x - initialPos.x, finalPos.z - initialPos.z);
    expect(drifted, 'velocity must move the meat at least one tile').toBeGreaterThan(1);

    // Client must have observed the same drift via Snapshot transforms.
    const meatSnaps = clientSnapshots.filter(s => s.entityId === meatId);
    expect(meatSnaps.length, 'client received no transforms for the scattered meat').toBeGreaterThan(0);
  });

  // Server-side guarantee that motivates the streaming change above: pickup
  // must succeed when the player stands near the item's *current* position,
  // even after that position has drifted from the spawn point. This already
  // works at the server layer (entitiesInRegion uses live positions) and is
  // here as a guard against future regressions that swap `_entities`'s position
  // source for the spawn-time copy.
  it('pickup at the drifted server position succeeds', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);

    const tilePx = (server as any)._tilePx;
    const stackType = 'M94GUBy6iN';
    const beforeMeat = ((unit.stats as any).inventory as any[])
      .filter(it => it?.type === stackType)
      .reduce((s, it) => s + (Number(it.quantity) || 0), 0);

    // Spawn far from the unit, push it with velocity, then teleport the unit
    // to wherever the meat ended up.
    server.engine.events.emit('item:spawn', [stackType, { x: unit.position.x * tilePx + 600, y: unit.position.z * tilePx + 600 }]);
    await new Promise(r => setTimeout(r, 30));
    let meatId: string | null = null;
    for (const [id, e] of (server as any)._entities.entries()) {
      const ee: any = e;
      if (ee.category === 'item' && ee.stats?.type === stackType && !ee.stats?.ownerId) meatId = id;
    }
    expect(meatId).not.toBeNull();
    server.engine.events.emit('physics:setVelocity', [meatId!, 12, -8]);
    for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 50));

    const meat: any = (server as any)._entities.get(meatId!);
    // Walk the unit to the meat (at the drifted position).
    server.engine.events.emit('physics:setVelocity', [unit.id, 0, 0]);
    const unitBody = (server as any)._entityBodies.get(unit.id);
    if (unitBody) {
      const Vec2 = unitBody.position.constructor as any;
      unitBody.position = new Vec2(((server as any)._tileToPhysics(meat.position.x)), ((server as any)._tileToPhysics(meat.position.z)));
    }
    await new Promise(r => setTimeout(r, 60));

    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 50));

    const afterMeat = ((unit.stats as any).inventory as any[])
      .filter(it => it?.type === stackType)
      .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    expect(afterMeat, 'pickup at drifted position must succeed').toBe(beforeMeat + 1);
  });
});
