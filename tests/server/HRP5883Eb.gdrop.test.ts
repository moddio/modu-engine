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

  // User report: dropping a meat at the player's feet makes it "bounce off"
  // immediately. Root cause: `_createEntityBody` was hard-coding every body to
  // `category: UNIT, mask: DefaultCollisionMask[UNIT]` (0x001F = walls + units +
  // props + items + projectiles), ignoring the body fixture's `collidesWith`
  // field. Meat declares `collidesWith.units: false`, but the engine made its
  // body physically resolve against the unit it was dropped on top of, and
  // Rapier shoved the meat out by ~0.3 tiles per half-second.
  it('a dropped item at the unit position is not shoved away by physics', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unit = (server as any)._entities.get(playerData.unitId);
    const unitBody = (server as any)._entityBodies.get(playerData.unitId);
    expect(unitBody, 'unit body must exist').toBeTruthy();

    // Teleport the unit body to an interior tile so wall-collision drift can't
    // masquerade as the bug we're trying to catch.
    const tilePx = (server as any)._tilePx;
    const targetTile = { x: 30, z: 30 };
    // Ground plane is (x, z); keep the body's height so it stays resting on the floor.
    unitBody.position = {
      x: (server as any)._tileToPhysics(targetTile.x),
      y: unitBody.position.y,
      z: (server as any)._tileToPhysics(targetTile.z),
    };
    unitBody.linearVelocity = { x: 0, y: 0, z: 0 };
    unit.position.x = targetTile.x;
    unit.position.z = targetTile.z;

    const meatType = 'M94GUBy6iN';
    server.engine.events.emit('item:spawn', [meatType, { x: targetTile.x * tilePx, y: targetTile.z * tilePx }]);
    await new Promise(r => setTimeout(r, 10));

    let meatId: string | null = null;
    for (const [id, e] of (server as any)._entities.entries()) {
      const ee: any = e;
      if (ee.category === 'item' && ee.stats?.type === meatType && !ee.stats?.ownerId) meatId = id;
    }
    expect(meatId).not.toBeNull();
    const meatBody = (server as any)._entityBodies.get(meatId!);
    expect(meatBody, 'meat body must exist').toBeTruthy();
    const before = { x: meatBody.position.x, y: meatBody.position.y };

    for (let i = 0; i < 10; i++) (server as any)._tick(50);

    const after = { x: meatBody.position.x, y: meatBody.position.y };
    const driftPhys = Math.hypot(after.x - before.x, after.y - before.y);
    const driftTiles = (server as any)._physicsToTile(driftPhys);
    // 1/8 tile threshold. The bug produced ~0.34 tiles of drift; the fix lands
    // it at ~0.003 (numerical noise from the unit body's own settle).
    expect(driftTiles, 'meat should not be shoved by the unit body').toBeLessThan(0.125);
  });

  // User report: even after the unit-collision fix, scattered meat (loot from
  // a kill, where the death script applies setVelocityOfEntityXY ±12) keeps
  // sliding for several seconds before settling. Cause: `_createEntityBody`
  // attenuates linearDamping by 10× for every dynamic body — a tuning meant
  // for unit-movement feel. The meat type's data declares linearDamping=5
  // (Box2d/Rapier per-second decay; v ≈ 0.7% after 1 s), but the engine
  // applies 0.5 (v ≈ 60% after 1 s) so the scatter visibly drifts ~10× longer
  // than the game intended.
  it('a scattered meat settles within ~1 second per its data damping', async () => {
    await init();
    const players = (server as any)._players as Map<string, any>;
    const [, playerData] = [...players.entries()][0];
    const unitBody = (server as any)._entityBodies.get(playerData.unitId);
    const tilePx = (server as any)._tilePx;
    const targetTile = { x: 30, z: 30 };
    // Ground plane is (x, z); keep the body's height so it stays resting on the floor.
    unitBody.position = {
      x: (server as any)._tileToPhysics(targetTile.x),
      y: unitBody.position.y,
      z: (server as any)._tileToPhysics(targetTile.z),
    };

    const meatType = 'M94GUBy6iN';
    server.engine.events.emit('item:spawn', [meatType, { x: targetTile.x * tilePx, y: targetTile.z * tilePx }]);
    await new Promise(r => setTimeout(r, 10));

    let meatId: string | null = null;
    for (const [id, e] of (server as any)._entities.entries()) {
      const ee: any = e;
      if (ee.category === 'item' && ee.stats?.type === meatType && !ee.stats?.ownerId) meatId = id;
    }
    expect(meatId).not.toBeNull();
    const meatBody = (server as any)._entityBodies.get(meatId!);
    // The data's `linearDamping: {x:5,y:5,z:0}` should land on Rapier verbatim;
    // before the fix the engine attenuated it to 0.5, so this read-back is the
    // direct regression check on the attenuation removal.
    expect(meatBody.raw.linearDamping(), 'item damping must respect data, not be attenuated').toBeCloseTo(5, 3);

    // Apply the same scatter the game's death script applies (±12 random),
    // pinned to a deterministic value so the threshold below is meaningful.
    server.engine.events.emit('physics:setVelocity', [meatId, 12, 12]);

    // Tick for ~3 s of sim time. Rapier's empirical decay at damping=5 leaves
    // ~20% of velocity per second, so 3 s reaches ~0.14 phys/s (well-stopped).
    // The bug (damping=0.5) only got the body down to ~7 phys/s in the same
    // window — still a visible slide.
    for (let i = 0; i < 60; i++) (server as any)._tick(50);

    const v = meatBody.linearVelocity;
    const speedPhys = Math.hypot(v.x, v.y);
    expect(speedPhys, 'meat should be effectively stopped after 3 s of damping').toBeLessThan(0.5);
  });
});
