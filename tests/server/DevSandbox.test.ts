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

  function firstUnitAttrId(unit: any): string {
    const k = Object.keys(unit.stats).find((s) => s.startsWith('attr_'));
    if (!k) throw new Error('unit has no attr_* stat');
    return k.slice('attr_'.length);
  }

  it('/dev set raises a unit attribute (and its max if needed)', async () => {
    await init({ singlePlayer: true });
    const [clientId, playerData] = firstPlayer();
    const unit = (server as any)._entities.get(playerData.unitId);
    const attrId = firstUnitAttrId(unit);

    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: `/dev set ${attrId} 99999` } });
    await new Promise(r => setTimeout(r, 50));

    expect(Number(unit.stats[`attr_${attrId}`].value)).toBe(99999);
    expect(Number(unit.stats[`attr_${attrId}`].max)).toBeGreaterThanOrEqual(99999);
  });

  it('/dev set player updates a player attribute', async () => {
    await init({ singlePlayer: true });
    const [clientId, playerData] = firstPlayer();
    const playerId = playerData.player.id;

    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev set player devTestAttr 1234' } });
    await new Promise(r => setTimeout(r, 50));

    const p = (server as any)._entities.get(playerId);
    expect(Number(p.stats['attr_devTestAttr'].value)).toBe(1234);
  });

  it('/dev set with a bad number replies with usage and does not throw', async () => {
    await init({ singlePlayer: true });
    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev set hp abc' } });
    await new Promise(r => setTimeout(r, 50));
    expect(lastSystemChat()).toMatch(/usage|number/i);
  });

  it('/dev tp <x> <y> moves the controlled unit to those tile coords', async () => {
    await init({ singlePlayer: true });
    const [clientId, playerData] = firstPlayer();
    const unit = (server as any)._entities.get(playerData.unitId);

    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev tp 7 9' } });
    await new Promise(r => setTimeout(r, 50));

    expect(unit.position.x).toBeCloseTo(7, 1);
    expect(unit.position.z).toBeCloseTo(9, 1);
  });

  it('/dev tp <regionName> moves the unit to the region center', async () => {
    await init({ singlePlayer: true });
    const [clientId, playerData] = firstPlayer();
    const unit = (server as any)._entities.get(playerData.unitId);
    const regions = (server as any)._regionVars as Map<string, any>;
    if (regions.size === 0) return; // fixture has no regions — nothing to assert
    const [name, r] = [...regions.entries()][0];
    const map = (server as any)._gameData.map as { width: number; height: number };
    const expX = (r.x + r.width / 2) * map.width;
    const expZ = (r.y + r.height / 2) * map.height;

    transport.client.send({ type: MessageType.PlayerChat, data: { text: `/dev tp ${name}` } });
    await new Promise(r2 => setTimeout(r2, 60));

    expect(unit.position.x).toBeCloseTo(expX, 0);
    expect(unit.position.z).toBeCloseTo(expZ, 0);
  });

  it('/dev tp with an unknown region replies with the region list', async () => {
    await init({ singlePlayer: true });
    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev tp __nope__' } });
    await new Promise(r => setTimeout(r, 50));
    expect(lastSystemChat()).toMatch(/region|usage/i);
  });

  function lastUICommand(command: string): any | null {
    for (let i = sent.length - 1; i >= 0; i--) {
      const m = sent[i];
      if (m?.type === MessageType.UICommand && m.data?.command === command) return m.data;
    }
    return null;
  }

  it('/dev shop lists shop ids', async () => {
    await init({ singlePlayer: true });
    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev shop' } });
    await new Promise(r => setTimeout(r, 50));
    const shops = Object.keys((server as any)._rawGameData.shops ?? {});
    expect(lastSystemChat()).toContain(shops[0]);
  });

  it('/dev shop <id> sends an openShop UICommand', async () => {
    await init({ singlePlayer: true });
    const [clientId, playerData] = firstPlayer();
    const shopId = Object.keys((server as any)._rawGameData.shops ?? {})[0];

    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: `/dev shop ${shopId}` } });
    await new Promise(r => setTimeout(r, 50));

    const cmd = lastUICommand('openShop');
    expect(cmd).not.toBeNull();
    expect(cmd.args[1]).toBe(shopId);
  });

  it('/dev shop <bad id> replies with the shop list', async () => {
    await init({ singlePlayer: true });
    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev shop __nope__' } });
    await new Promise(r => setTimeout(r, 50));
    expect(lastSystemChat()).toMatch(/shop/i);
  });

  it('/dev list units and items list valid type ids', async () => {
    await init({ singlePlayer: true });
    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev list units' } });
    await new Promise(r => setTimeout(r, 30));
    const unitIds = [...(server as any).types.getAll('unitTypes').keys()];
    expect(lastSystemChat()).toContain(unitIds[0]);
  });

  it('/dev spawn item gives the item to the controlled unit', async () => {
    await init({ singlePlayer: true });
    const [clientId, playerData] = firstPlayer();
    const unit = (server as any)._entities.get(playerData.unitId);
    const itemTypeId = [...(server as any).types.getAll('itemTypes').keys()][0] as string;
    const before = ((unit.stats as any).inventory ?? []).filter((s: any) => s?.type === itemTypeId).length;

    transport.client.send({ type: MessageType.PlayerChat, data: { text: `/dev spawn item ${itemTypeId} 3` } });
    await new Promise(r => setTimeout(r, 50));

    const after = ((unit.stats as any).inventory ?? []).filter((s: any) => s?.type === itemTypeId).length;
    expect(after).toBeGreaterThan(before);
  });

  it('/dev spawn unit creates units of that type', async () => {
    await init({ singlePlayer: true });
    const unitTypeId = [...(server as any).types.getAll('unitTypes').keys()][0] as string;
    const countOf = () =>
      [...((server as any)._entities as Map<string, any>).values()]
        .filter((e) => e?.category === 'unit' && (e.stats as any)?.type === unitTypeId).length;
    const before = countOf();

    transport.client.send({ type: MessageType.PlayerChat, data: { text: `/dev spawn unit ${unitTypeId} 2` } });
    await new Promise(r => setTimeout(r, 50));

    expect(countOf()).toBe(before + 2);
  });

  it('/dev spawn unit with an unknown type hints at /dev list units', async () => {
    await init({ singlePlayer: true });
    sent = [];
    transport.client.send({ type: MessageType.PlayerChat, data: { text: '/dev spawn unit __nope__' } });
    await new Promise(r => setTimeout(r, 50));
    expect(lastSystemChat()).toMatch(/list units/i);
  });
});
