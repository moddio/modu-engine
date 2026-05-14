import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

const COMMON_CHEST = 'khPoe32YLW';
const UNCOMMON_CHEST = 'wgxhIgpx4A';
const RARE_CHEST = 'K5GBtlsv4B';

describe.skipIf(!URI)('HRP5883Eb common chest "use" — repro', () => {
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

  function giveAndHold(unit: any, typeId: string): { id: string } {
    server.engine.events.emit('inventory:giveItem', [unit.id, typeId, 1]);
    const inv = (unit.stats as any).inventory as Array<any>;
    const slot = inv.findIndex((it: any) => it?.type === typeId);
    expect(slot).toBeGreaterThanOrEqual(0);
    (unit.stats as any).currentSlot = slot;
    (unit.stats as any).currentItemId = inv[slot].id;
    return { id: inv[slot].id };
  }

  it('common chest itemType is intact in game data', () => {
    const it = rawGameData.itemTypes[COMMON_CHEST];
    expect(it).toBeDefined();
    expect(it.name).toBe('Common Chest');
    expect(Object.keys(it.scripts || {}).length).toBeGreaterThan(0);
  });

  it('left-click on a held Common Chest fires item:use without throwing', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const { id: chestId } = giveAndHold(unit, COMMON_CHEST);

    let useEvents = 0;
    server.engine.events.on('item:use', () => { useEvents++; });
    (server as any)._onPlayerInput(clientId, { device: 'mouse', key: 'button1' }, true);
    await new Promise(r => setTimeout(r, 30));
    expect(useEvents).toBeGreaterThan(0);

    const heldEntity = (server as any)._entities.get(chestId);
    // After use, the chest entity should still exist (it's a "weapon" type,
    // not a consumable that decrements on use).
    expect(heldEntity).toBeDefined();
  });

  it('common chest unlock-timer decrements via the per-tick chest script', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const { id: chestId } = giveAndHold(unit, COMMON_CHEST);

    const chest = (server as any)._entities.get(chestId);
    expect(chest, 'chest backing entity').toBeDefined();
    const SRG = 'SRG9VSpNuu';
    const before = chest.stats?.[`attr_${SRG}`]?.value;
    expect(before, 'Unlocks-in-seconds attr starts at chest type max').toBe(8);

    // Fire the chest's own per-tick script (`secondTick`) several times by
    // calling the trigger directly — same path the engine uses on its 1 Hz
    // tick.
    for (let i = 0; i < 3; i++) {
      (server as any).scripts.trigger('secondTick', {});
      await new Promise(r => setTimeout(r, 10));
    }
    const after = chest.stats?.[`attr_${SRG}`]?.value;
    expect(after, 'timer must decrease after secondTick').toBeLessThan(before);
  });

  it('comparison: rare chest unlock-timer decrements identically', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const { id: chestId } = giveAndHold(unit, RARE_CHEST);

    const chest = (server as any)._entities.get(chestId);
    const SRG = 'SRG9VSpNuu';
    const before = chest.stats?.[`attr_${SRG}`]?.value;
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      (server as any).scripts.trigger('secondTick', {});
      await new Promise(r => setTimeout(r, 10));
    }
    const after = chest.stats?.[`attr_${SRG}`]?.value;
    expect(after).toBeLessThan(before);
  });

  // The actual user-visible behaviour: when the player left-clicks an unlocked
  // chest the fighter's `thisUnitUsesItem` script (key XrtbtspuXt) should fire,
  // destroy the chest, and roll a new loot item into the inventory. This is the
  // path the player perceives as "using" the chest.
  it('using an unlocked Common Chest gives loot (Slayer.thisUnitUsesItem)', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const { id: chestId } = giveAndHold(unit, COMMON_CHEST);

    // Force the unlock timer to 0 — same state the per-tick countdown reaches.
    const chest = (server as any)._entities.get(chestId);
    const SRG = 'SRG9VSpNuu';
    chest.stats[`attr_${SRG}`].value = 0;


    const invQtyBefore = (unit.stats.inventory as any[])
      .filter((it: any) => it && it.type !== COMMON_CHEST)
      .reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
    const stillHasChestBefore = (unit.stats.inventory as any[]).some((it: any) => it?.id === chestId);
    expect(stillHasChestBefore).toBe(true);

    // Simulate the player left-clicking — this is what the fighter's button1
    // binding does (entity script `SUsgkMrvxm` → `startUsingItem`).
    (server as any)._onPlayerInput(clientId, { device: 'mouse', key: 'button1' }, true);
    await new Promise(r => setTimeout(r, 80));

    // Expected: the chest entity is destroyed and the slot cleared.
    const stillHasChestAfter = (unit.stats.inventory as any[]).some((it: any) => it?.id === chestId);
    expect(stillHasChestAfter, 'chest must be destroyed after use').toBe(false);

    // Expected: loot was rolled and added to the inventory.
    const invQtyAfter = (unit.stats.inventory as any[])
      .filter((it: any) => it && it.type !== COMMON_CHEST)
      .reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
    expect(invQtyAfter, 'loot quantity must increase').toBeGreaterThan(invQtyBefore);
  });

  it('comparison: using an unlocked Rare Chest gives loot the same way', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const { id: chestId } = giveAndHold(unit, RARE_CHEST);

    const chest = (server as any)._entities.get(chestId);
    const SRG = 'SRG9VSpNuu';
    chest.stats[`attr_${SRG}`].value = 0;

    const invQtyBefore = (unit.stats.inventory as any[])
      .filter((it: any) => it && it.type !== RARE_CHEST)
      .reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);

    (server as any)._onPlayerInput(clientId, { device: 'mouse', key: 'button1' }, true);
    await new Promise(r => setTimeout(r, 80));

    const stillHasChest = (unit.stats.inventory as any[]).some((it: any) => it?.id === chestId);
    expect(stillHasChest).toBe(false);
    const invQtyAfter = (unit.stats.inventory as any[])
      .filter((it: any) => it && it.type !== RARE_CHEST)
      .reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
    expect(invQtyAfter).toBeGreaterThan(invQtyBefore);
  });
});
