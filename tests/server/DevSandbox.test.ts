import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

describe.skipIf(!URI)('Single-player dev sandbox', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;
  let rawGameData: any;
  let sent: any[];

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
  });

  afterEach(() => { server?.stop(); Engine.reset(); });

  async function init(opts?: { singlePlayer?: boolean }) {
    server = new GameServer(transport.server, opts);
    const migrated = GameMigrator.migrate({ data: rawGameData } as any);
    await server.init(migrated as any, rawGameData);
    server.start();
    sent = [];
    transport.client.onMessage((m: any) => sent.push(m));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Tester', isMobile: false } });
    await new Promise(r => setTimeout(r, 150));
  }

  function firstPlayer() {
    const players = (server as any)._players as Map<string, any>;
    return [...players.entries()][0]; // [clientId, playerData]
  }

  it('defaults the single-player flag to false', async () => {
    await init();
    expect((server as any)._singlePlayer).toBe(false);
  });

  it('sets the single-player flag when constructed with the option', async () => {
    await init({ singlePlayer: true });
    expect((server as any)._singlePlayer).toBe(true);
  });

  // Pick any shop entry that has a non-empty price, so the only way a zero-resource
  // unit can receive it is the single-player free-buy bypass.
  function firstPricedShopEntry(): { shopId: string; itemTypeId: string } {
    const shops = (server as any)._rawGameData.shops as Record<string, any>;
    for (const [shopId, shop] of Object.entries<any>(shops)) {
      for (const [itemTypeId, entry] of Object.entries<any>(shop.itemTypes ?? {})) {
        const p = entry?.price ?? {};
        const priced =
          (Number(p.coins) || 0) > 0 ||
          Object.keys(p.playerAttributes ?? {}).length > 0 ||
          Object.keys(p.requiredItemTypes ?? {}).length > 0;
        if (priced && entry.isPurchasable !== false) return { shopId, itemTypeId };
      }
    }
    throw new Error('no priced shop entry in fixture');
  }

  it('single-player: buying a priced item with zero resources still grants it', async () => {
    await init({ singlePlayer: true });
    const [clientId, playerData] = firstPlayer();
    const unit = (server as any)._entities.get(playerData.unitId);
    const { shopId, itemTypeId } = firstPricedShopEntry();
    const before = ((unit.stats as any).inventory ?? []).filter((s: any) => s?.type === itemTypeId).length;

    transport.client.send({ type: MessageType.ShopBuyItem, data: { shopId, itemTypeId } });
    await new Promise(r => setTimeout(r, 50));

    const after = ((unit.stats as any).inventory ?? []).filter((s: any) => s?.type === itemTypeId).length;
    expect(after).toBeGreaterThan(before);
  });

  it('multiplayer: buying a priced item with zero resources is rejected', async () => {
    await init({ singlePlayer: false });
    const [clientId, playerData] = firstPlayer();
    const unit = (server as any)._entities.get(playerData.unitId);
    const { shopId, itemTypeId } = firstPricedShopEntry();
    const before = ((unit.stats as any).inventory ?? []).filter((s: any) => s?.type === itemTypeId).length;

    transport.client.send({ type: MessageType.ShopBuyItem, data: { shopId, itemTypeId } });
    await new Promise(r => setTimeout(r, 50));

    const after = ((unit.stats as any).inventory ?? []).filter((s: any) => s?.type === itemTypeId).length;
    expect(after).toBe(before);
  });

  function lastSystemChat(): string | null {
    for (let i = sent.length - 1; i >= 0; i--) {
      const m = sent[i];
      if (m?.type === MessageType.ChatMessage && m.data?.system) return String(m.data.text ?? '');
    }
    return null;
  }

  it('single-player: /dev help replies with a system chat message and is not echoed', async () => {
    await init({ singlePlayer: true });
    let scriptSawIt = false;
    (server as any).scripts.trigger = ((orig: any) =>
      function (this: any, name: string, ctx: any) {
        if (name === 'playerSendsChatMessage' && /\/dev/.test(ctx?.message ?? '')) scriptSawIt = true;
        return orig.call(this, name, ctx);
      })((server as any).scripts.trigger);

    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev help' } });
    await new Promise(r => setTimeout(r, 50));

    expect(lastSystemChat()).toMatch(/\/dev set/);
    expect(scriptSawIt).toBe(false);
    const echoed = sent.some(m => m?.type === MessageType.ChatMessage && !m.data?.system && /\/dev help/.test(m.data?.text ?? ''));
    expect(echoed).toBe(false);
  });

  it('multiplayer: /dev help is treated as ordinary chat', async () => {
    await init({ singlePlayer: false });
    let scriptSawIt = false;
    (server as any).scripts.trigger = ((orig: any) =>
      function (this: any, name: string, ctx: any) {
        if (name === 'playerSendsChatMessage' && /\/dev help/.test(ctx?.message ?? '')) scriptSawIt = true;
        return orig.call(this, name, ctx);
      })((server as any).scripts.trigger);

    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev help' } });
    await new Promise(r => setTimeout(r, 50));

    expect(scriptSawIt).toBe(true);
    expect(lastSystemChat()).toBeNull();
  });
});
