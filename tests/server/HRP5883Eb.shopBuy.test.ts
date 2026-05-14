import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

describe.skipIf(!URI)('HRP5883Eb: shop buy', () => {
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

  async function init() {
    const migrated = GameMigrator.migrate({ data: rawGameData } as any);
    await server.init(migrated as any, rawGameData);
    server.start();
    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Tester', isMobile: false } });
    await new Promise(r => setTimeout(r, 150));
  }

  // Explorer's Shop entry `lEBtDYvOjk`: price = 2× `sciJW3wpgh`, grants 1× lEBtDYvOjk.
  // Verifies the requiredItemTypes consumption path end-to-end.
  it('consumes the price-items from inventory and grants the purchased item', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);

    // Give the unit the 2 sciJW3wpgh required as price.
    server.engine.events.emit('inventory:giveItem', [unit.id, 'sciJW3wpgh', 2]);
    await new Promise(r => setTimeout(r, 30));

    const inv = (): any[] => ((unit.stats as any).inventory ?? []);
    const countOf = (t: string) => inv().reduce((s, it) => s + (it?.type === t ? Number(it.quantity) || 0 : 0), 0);
    expect(countOf('sciJW3wpgh')).toBe(2);
    expect(countOf('lEBtDYvOjk')).toBe(0);

    transport.client.send({
      type: MessageType.ShopBuyItem,
      data: { shopId: 'pSrN3HU1D5', itemTypeId: 'lEBtDYvOjk' },
    });
    await new Promise(r => setTimeout(r, 50));

    // Price consumed, item granted.
    expect(countOf('sciJW3wpgh'), 'price items must be consumed').toBe(0);
    expect(countOf('lEBtDYvOjk'), 'bought item must be granted').toBe(1);
  });

  it('rejects the purchase when the price items are not in inventory', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const inv = (): any[] => ((unit.stats as any).inventory ?? []);
    const countOf = (t: string) => inv().reduce((s, it) => s + (it?.type === t ? Number(it.quantity) || 0 : 0), 0);

    // Make sure the unit doesn't already carry the price item — sciJW3wpgh.
    expect(countOf('sciJW3wpgh')).toBe(0);
    const lEBefore = countOf('lEBtDYvOjk');

    transport.client.send({
      type: MessageType.ShopBuyItem,
      data: { shopId: 'pSrN3HU1D5', itemTypeId: 'lEBtDYvOjk' },
    });
    await new Promise(r => setTimeout(r, 50));

    // Nothing changed — purchase silently rejected.
    expect(countOf('lEBtDYvOjk')).toBe(lEBefore);
  });
});
