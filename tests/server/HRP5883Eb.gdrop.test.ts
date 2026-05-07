import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

describe.skipIf(!URI)('HRP5883Eb press G drops item', () => {
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

  it('item:spawn seeds typeDef.variables defaults', async () => {
    await init();
    server.engine.events.emit('item:spawn', ['f9haU2W9Pn', { x: 100, y: 100 }]);
    await new Promise(r => setTimeout(r, 10));
    let itemId: string | null = null;
    for (const [id, ent] of (server as any)._entities.entries()) {
      if ((ent as any).category === 'item' && id.startsWith('itm_')) { itemId = id; break; }
    }
    expect(itemId).not.toBeNull();
    expect(server.scripts.variables.getEntityVar(itemId!, 'dropPlaceAllowed')).toBe('anywhere');
  });

  it('inventory:giveItem seeds typeDef.variables defaults', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const playerData = [...players.values()][0];
    server.engine.events.emit('inventory:giveItem', [playerData.unitId, 'f9haU2W9Pn', 1]);
    await new Promise(r => setTimeout(r, 10));
    const inv = (server as any)._entities.get(playerData.unitId)?.stats?.inventory ?? [];
    const givenId = inv[inv.length - 1]?.id;
    expect(server.scripts.variables.getEntityVar(givenId, 'dropPlaceAllowed')).toBe('anywhere');
  });

  it('pressing G with held item drops a world item at the unit position', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    // Move the unit to a known position (avoid origin so we catch the held-item-at-origin bug)
    unit.position.x = 30;
    unit.position.z = 40;

    const dropEvents: any[] = [];
    server.engine.events.on('inventory:dropAt', (...a) => dropEvents.push(a));
    const itemSpawnEvents: any[] = [];
    server.engine.events.on('item:spawn', (...a) => itemSpawnEvents.push(a));

    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'g' }, true);
    await new Promise(r => setTimeout(r, 20));

    expect(dropEvents.length).toBe(1);
    const [, pos] = dropEvents[0] as [string, { x: number; y: number }];
    const tilePx = (server as any)._tilePx;
    // Position passed to inventory:dropAt should equal the unit's position in pixels.
    expect(pos.x).toBeCloseTo(30 * tilePx, 3);
    expect(pos.y).toBeCloseTo(40 * tilePx, 3);

    // And a world item should be spawned at that position.
    expect(itemSpawnEvents.length).toBeGreaterThan(0);
    const lastSpawn = itemSpawnEvents[itemSpawnEvents.length - 1];
    expect(lastSpawn[1].x).toBeCloseTo(30 * tilePx, 3);
    expect(lastSpawn[1].y).toBeCloseTo(40 * tilePx, 3);
  });

  it('pressing G repeatedly without changing slot drops the item only once', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);

    // Reset inventory to a known single-item state. (The game's spawn scripts may
    // pre-populate it; we want a controlled fixture for this regression check.)
    unit.stats.inventory = [];
    unit.stats.currentSlot = 0;
    unit.stats.currentItemId = null;
    server.engine.events.emit('inventory:giveItem', [playerData.unitId, 'f9haU2W9Pn', 1]);
    await new Promise(r => setTimeout(r, 10));
    expect((unit.stats.inventory as any[]).length).toBe(1);
    const heldId = unit.stats.currentItemId as string;
    expect(heldId).toBeTruthy();

    const itemSpawnEvents: any[] = [];
    server.engine.events.on('item:spawn', (...a) => itemSpawnEvents.push(a));

    // Spam G five times without changing slot. The first press should drop the
    // held item; subsequent presses must be no-ops because the slot is now empty.
    for (let i = 0; i < 5; i++) {
      (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'g' }, true);
      (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'g' }, false);
      await new Promise(r => setTimeout(r, 5));
    }

    expect(itemSpawnEvents.length).toBe(1);
    expect(unit.stats.currentItemId).toBeNull();
    // The carried-item entity should have been destroyed on drop, not left
    // dangling for the script to re-resolve via a stale currentItemId.
    expect((server as any)._entities.has(heldId)).toBe(false);
  });

  it('dropping slot 0 leaves trailing slots in place (no shift forward)', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);

    // Three known items in slots 0/1/2.
    unit.stats.inventory = [];
    unit.stats.currentSlot = 0;
    unit.stats.currentItemId = null;
    server.engine.events.emit('inventory:giveItem', [playerData.unitId, 'f9haU2W9Pn', 1]);
    server.engine.events.emit('inventory:giveItem', [playerData.unitId, 'RqZkI3U0pv', 1]);
    server.engine.events.emit('inventory:giveItem', [playerData.unitId, 'Vf8CO2o6Pt', 1]);
    await new Promise(r => setTimeout(r, 5));
    const inv = unit.stats.inventory as Array<{ id?: string; type?: string } | null>;
    expect(inv.length).toBe(3);
    const slot1IdBefore = inv[1]?.id;
    const slot2IdBefore = inv[2]?.id;

    // Drop slot 0.
    server.engine.events.emit('inventory:dropSlot', [playerData.unitId, 0]);
    await new Promise(r => setTimeout(r, 5));

    // Slot 0 must be empty; slots 1 and 2 must keep their original items.
    expect(inv[0]).toBeNull();
    expect(inv[1]?.id).toBe(slot1IdBefore);
    expect(inv[2]?.id).toBe(slot2IdBefore);
  });
});
