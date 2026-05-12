import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

describe.skipIf(!URI)('HRP5883Eb consume inventory item', () => {
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
    await new Promise(r => setTimeout(r, 100));
  }

  it('using a Meat applies its bonus.consume.unitAttribute and decrements the stack', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    expect(unit).toBeDefined();

    // Drop the Slayer's Hunger so the +10 bonus has somewhere to land
    // (defaults at max=100 and consume is clamped to max).
    const HUNGER = 'kR9b4n8N2K';
    server.engine.events.emit('setEntityAttribute', [unit.id, HUNGER, 50]);
    await new Promise(r => setTimeout(r, 10));
    expect((unit.stats as any)[`attr_${HUNGER}`].value).toBe(50);

    // Give the unit one Meat. The itemType (`M94GUBy6iN`) carries
    // `bonus.consume.unitAttribute.kR9b4n8N2K = 10` and `quantity: 1`.
    const MEAT = 'M94GUBy6iN';
    server.engine.events.emit('inventory:giveItem', [unit.id, MEAT, 1]);
    await new Promise(r => setTimeout(r, 10));
    const inv = (unit.stats as any).inventory as Array<{ id?: string; type?: string; quantity?: number } | null>;
    const meatEntry = inv.find((it: any) => it?.type === MEAT) as { id: string; quantity: number } | undefined;
    expect(meatEntry, 'expected the Meat to land in the inventory').toBeDefined();
    const meatItemId = meatEntry!.id;
    expect(meatEntry!.quantity).toBe(1);

    // Fire item:use the same way ActionRunner does when `startUsingItem`
    // resolves a held consumable.
    server.engine.events.emit('item:use', [meatItemId]);
    await new Promise(r => setTimeout(r, 20));

    // Hunger must rise by exactly the bonus amount.
    expect((unit.stats as any)[`attr_${HUNGER}`].value).toBe(60);

    // Stack of 1 must empty and the slot must clear so the player can pick
    // up something else without bumping into a stale id.
    const after = (unit.stats as any).inventory as Array<{ id?: string } | null>;
    expect(after.find((it: any) => it?.id === meatItemId)).toBeUndefined();
  });
});
