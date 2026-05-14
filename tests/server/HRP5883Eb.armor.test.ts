import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;
const WOLF_HELMET = 'Tl1m28OOY9'; // bonus.passive.unitAttribute.health = +40

describe.skipIf(!URI)('HRP5883Eb armor passive bonus repro', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;
  let rawGameData: any;

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
  });

  afterEach(() => { server.stop(); Engine.reset(); });

  it('Wolf Helmet game-data has passive +40% health bonus', () => {
    const it = rawGameData.itemTypes[WOLF_HELMET];
    expect(it).toBeDefined();
    expect(it.name).toBe('Wolf Helmet');
    expect(it.bonus?.passive?.unitAttribute?.health).toBeDefined();
    expect(it.bonus.passive.unitAttribute.health.value).toBe(40);
  });

  it('picking up Wolf Helmet should increase unit health (max)', async () => {
    const migrated = GameMigrator.migrate({ data: rawGameData } as any);
    await server.init(migrated as any, rawGameData);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Tester', isMobile: false } });
    await new Promise(r => setTimeout(r, 200));

    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);

    const healthBefore = (unit.stats as any).attr_health;
    console.log('health before pickup:', JSON.stringify(healthBefore));

    // Give a Wolf Helmet — same path as picking it up off the ground
    server.engine.events.emit('inventory:giveItem', [unit.id, WOLF_HELMET, 1]);
    await new Promise(r => setTimeout(r, 50));

    const inv = (unit.stats as any).inventory as any[];
    const slot = inv.findIndex((it: any) => it?.type === WOLF_HELMET);
    expect(slot).toBeGreaterThanOrEqual(0);

    const healthAfter = (unit.stats as any).attr_health;
    console.log('health after pickup:', JSON.stringify(healthAfter));

    // If passive bonus is applied, the max should be >= original + 40
    const beforeMax = Number(healthBefore?.max) || 0;
    const afterMax = Number(healthAfter?.max) || 0;
    console.log('max delta:', afterMax - beforeMax);

    // This is the assertion that should pass if armor "works"
    expect(afterMax, 'wearing Wolf Helmet should increase max health by +40').toBeGreaterThan(beforeMax);
  });
});
