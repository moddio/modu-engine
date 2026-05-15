import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;
const MEAT = 'M94GUBy6iN'; // stackable, maxQuantity 64

describe.skipIf(!URI)('HRP5883Eb dropping a stack preserves its quantity', () => {
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

  it('press G to drop a stack of 3 meat → world item carries quantity 3, re-pickup restores 3', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);
    expect(unit).toBeDefined();

    // Give the unit a single slot holding 3 meat, then select it so "press G to
    // drop the held item" drops that stack.
    server.engine.events.emit('inventory:giveItem', [unit.id, MEAT, 3]);
    await new Promise(r => setTimeout(r, 20));
    const inv = (unit.stats as any).inventory as Array<any>;
    const meatSlot = inv.findIndex(r => r?.type === MEAT && Number(r.quantity) === 3);
    expect(meatSlot, 'meat x3 slot present').toBeGreaterThanOrEqual(0);
    server.engine.events.emit('inventory:selectSlot', [unit.id, meatSlot]);
    await new Promise(r => setTimeout(r, 20));

    // Snapshot free world meat ids, press G (game's "drop held item" script →
    // inventory:dropAt), then pick out the entity this drop newly created.
    const freeMeatIds = () => [...(server as any)._entities.entries()]
      .filter(([, e]: any) => e.category === 'item' && e.stats?.type === MEAT && !e.stats?.ownerId && e.stats?.isHidden !== true)
      .map(([id]: any) => id as string);
    const before = new Set(freeMeatIds());
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'g' }, true);
    await new Promise(r => setTimeout(r, 40));
    const newId = freeMeatIds().find(id => !before.has(id));
    expect(newId, 'press G spawned a free world meat').toBeTruthy();
    const worldMeat = (server as any)._entities.get(newId!);
    expect(Number(worldMeat.stats.quantity)).toBe(3);

    // And picking it back up must restore the full stack of 3.
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 60));
    const meatTotal = ((unit.stats as any).inventory as any[])
      .filter(it => it?.type === MEAT)
      .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    expect(meatTotal).toBe(3);
  });

  // Faithful repro of the user's exact flow: hold 1 meat, walk over / press E to
  // pick up another → the slot stacks to qty 2 (correct). Press G to drop the
  // stack, then press E to pick it back up → must restore 2, not collapse to 1.
  // The stack-pickup bumps the inventory *record* quantity but never the backing
  // carried-item *entity*'s stats.quantity, and inventory:dropAt (the press-G
  // path) reads the stale entity quantity. giveItem masks this because it
  // registers the backing entity with the right quantity up front.
  it('stack via pickup then press G to drop → world item keeps quantity 2, re-pickup restores 2', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [clientId, playerData] = [...players.entries()][0];
    await new Promise(r => setTimeout(r, 100));
    const unit = (server as any)._entities.get(playerData.unitId);
    const tilePx = (server as any)._tilePx;

    // Hold exactly one meat.
    server.engine.events.emit('inventory:giveItem', [unit.id, MEAT, 1]);
    await new Promise(r => setTimeout(r, 20));
    const inv = (unit.stats as any).inventory as Array<any>;
    const meatSlot = inv.findIndex(r => r?.type === MEAT && Number(r.quantity) === 1);
    expect(meatSlot).toBeGreaterThanOrEqual(0);
    server.engine.events.emit('inventory:selectSlot', [unit.id, meatSlot]);
    await new Promise(r => setTimeout(r, 20));

    // Pick up one more meat → the held slot stacks to quantity 2.
    server.engine.events.emit('item:spawn', [MEAT, { x: unit.position.x * tilePx + 8, y: unit.position.z * tilePx }]);
    await new Promise(r => setTimeout(r, 20));
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 50));
    expect(Number((unit.stats as any).inventory[meatSlot]?.quantity)).toBe(2);

    // Press G to drop the held stack of 2.
    const freeMeatIds = () => [...(server as any)._entities.entries()]
      .filter(([, e]: any) => e.category === 'item' && e.stats?.type === MEAT && !e.stats?.ownerId && e.stats?.isHidden !== true)
      .map(([id]: any) => id as string);
    const before = new Set(freeMeatIds());
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'g' }, true);
    await new Promise(r => setTimeout(r, 40));
    const newId = freeMeatIds().find(id => !before.has(id));
    expect(newId, 'press G spawned a free world meat').toBeTruthy();
    const worldMeat = (server as any)._entities.get(newId!);
    expect(Number(worldMeat.stats.quantity)).toBe(2);

    // Pick it back up → the full stack of 2 must return. Wait past the pickup
    // ability's ~100 ms cooldown first (an earlier E press did the stacking).
    await new Promise(r => setTimeout(r, 250));
    (server as any)._onPlayerInput(clientId, { device: 'keyboard', key: 'e' }, true);
    await new Promise(r => setTimeout(r, 60));
    const meatTotal = ((unit.stats as any).inventory as any[])
      .filter(it => it?.type === MEAT)
      .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    expect(meatTotal).toBe(2);
  });
});
