import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

describe.skipIf(!URI)('HRP5883Eb press E picks up nearby item', () => {
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
    await new Promise(r => setTimeout(r, 50));
  }

  it('drops via G then picks back up via E into the unit inventory', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    // playerJoinsGame swaps the player to a freshly-spawned fighter inside the
    // `spawn` region; let any post-join scripts settle so we read the live unit.
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);
    expect(unit).toBeDefined();

    // Drop the currently-held item with G — produces a free world item right
    // at the unit's feet, well within the smallest pickup region.
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'g' }, true);
    await new Promise(r => setTimeout(r, 30));

    // There must be a free world item near the unit now.
    let freeItemId: string | null = null;
    for (const [id, ent] of (server as any)._entities.entries()) {
      const e = ent as any;
      if (e.category === 'item' && !e.stats?.ownerId) { freeItemId = id; break; }
    }
    expect(freeItemId, 'expected G to drop a free world item').not.toBeNull();
    const beforeQty = (unit.stats as any).inventory.reduce((s: number, it: any) => s + (Number(it?.quantity) || 0), 0);

    // Press E — bound to startCasting the `pick up item` ability in this game.
    // The script's `getEntityType(getSelectedEntity) == "item"` gate must
    // resolve correctly for the dropped item to be picked back up.
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 50));

    // Pickup either re-stacks the dropped item (quantity bumps) or appends a
    // new slot — either way the total carried quantity must increase.
    const afterQty = (unit.stats as any).inventory.reduce((s: number, it: any) => s + (Number(it?.quantity) || 0), 0);
    expect(afterQty).toBeGreaterThan(beforeQty);

    // The world item should now be hidden / owned by the unit.
    const after = (server as any)._entities.get(freeItemId!);
    if (after) expect((after.stats as any).ownerId).toBe(unit.id);
  });

  it('refuses pickup when the inventory is full of distinct types — world item stays available', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);
    const invSize = Number((unit.stats as any).inventorySize) || 0;
    expect(invSize).toBeGreaterThan(0);

    // Top up to inventorySize with distinct itemTypes that aren't already
    // carried, so no slot will stack on pickup attempt.
    const have = new Set<string>(((unit.stats as any).inventory ?? []).filter((it: any) => it).map((it: any) => it.type));
    const fillerTypes = Object.keys(rawGameData.itemTypes ?? {}).filter(t => !have.has(t));
    expect(fillerTypes.length).toBeGreaterThanOrEqual(invSize);
    while (((unit.stats as any).inventory ?? []).filter((it: any) => it).length < invSize) {
      const next = fillerTypes.shift()!;
      server.engine.events.emit('inventory:giveItem', [unit.id, next, 1]);
      await new Promise(r => setTimeout(r, 5));
    }
    expect((unit.stats as any).inventory.length).toBe(invSize);

    // Spawn a brand-new world item next to the unit.
    const tilePx = (server as any)._tilePx;
    const newType = fillerTypes.shift()!;
    server.engine.events.emit('item:spawn', [newType, { x: unit.position.x * tilePx + 4, y: unit.position.z * tilePx }]);
    await new Promise(r => setTimeout(r, 30));
    let freeId: string | null = null;
    for (const [id, e] of (server as any)._entities.entries()) {
      const ee: any = e;
      if (ee.category === 'item' && !ee.stats?.ownerId && ee.stats?.type === newType) { freeId = id; break; }
    }
    expect(freeId).not.toBeNull();

    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 50));

    // The world item must still be a free, non-hidden, unowned entity so the
    // player can recover it after making room. Inventory must not have grown
    // past inventorySize into an invisible 10th slot.
    const after = (server as any)._entities.get(freeId!);
    expect(after).toBeDefined();
    expect((after.stats as any).isHidden).not.toBe(true);
    expect((after.stats as any).ownerId).toBeFalsy();
    expect((unit.stats as any).inventory.length).toBeLessThanOrEqual(invSize);
  });

  it('respects maxQuantity: a second world copy of an unstackable item goes to a new slot', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);

    // Rare Chest has maxQuantity: 1 — can never stack. Pick a type the player
    // doesn't already carry so we know the starting count, give the unit one,
    // spawn a second world chest next to them, then press E. With the old
    // stack-anywhere behaviour the second world chest would silently merge
    // into the slot at quantity 2 (over the cap) and the world entity would
    // be hidden; the player would just see "x2" or a stuck record. With the
    // maxQuantity-aware fix it must instead occupy a fresh empty slot, and
    // both records must hold quantity 1.
    const chestType = 'K5GBtlsv4B';
    expect(((unit.stats as any).inventory as any[]).every((it: any) => it?.type !== chestType)).toBe(true);
    server.engine.events.emit('inventory:giveItem', [unit.id, chestType, 1]);
    await new Promise(r => setTimeout(r, 10));
    const lenBefore = ((unit.stats as any).inventory as any[]).filter(it => it).length;

    const tilePx = (server as any)._tilePx;
    server.engine.events.emit('item:spawn', [chestType, { x: unit.position.x * tilePx + 4, y: unit.position.z * tilePx }]);
    await new Promise(r => setTimeout(r, 30));

    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 50));

    const chestSlotsAfter = ((unit.stats as any).inventory as any[]).filter(it => it?.type === chestType);
    expect(chestSlotsAfter.length).toBe(2);
    for (const it of chestSlotsAfter) expect(Number(it.quantity)).toBe(1);
    expect(((unit.stats as any).inventory as any[]).filter(it => it).length).toBe(lenBefore + 1);
  });

  it('rapid repeat E presses do not duplicate the same dropped item', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);

    // Drop the held item and remember its type.
    const droppedType = (unit.stats as any).inventory[(unit.stats as any).currentSlot]?.type;
    expect(droppedType).toBeTruthy();
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'g' }, true);
    await new Promise(r => setTimeout(r, 30));
    const qtyBefore = ((unit.stats as any).inventory as any[])
      .filter(it => it?.type === droppedType)
      .reduce((s, it) => s + (Number(it.quantity) || 0), 0);

    // Hammer E faster than the 100 ms cooldown to make sure cooldown alone
    // doesn't mask the bug — a hidden held item must be excluded from
    // entitiesInRegion regardless of how often the script runs.
    for (let i = 0; i < 6; i++) {
      (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
      await new Promise(r => setTimeout(r, 5));
    }
    // Wait past the cooldown so a fresh cast WOULD have re-picked-up if the
    // hidden item were still visible to entitiesInRegion.
    await new Promise(r => setTimeout(r, 200));
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 30));

    const qtyAfter = ((unit.stats as any).inventory as any[])
      .filter(it => it?.type === droppedType)
      .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    expect(qtyAfter).toBe(qtyBefore + 1);
  });
});
