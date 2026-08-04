import { describe, it, expect } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { Engine } from '../../engine/core/Engine';
import * as fs from 'fs';
import * as path from 'path';

// Loads the actual celleater game data (from the deployed game) and runs it through
// the same migrate + denormalize pipeline the web app uses, so this test exercises
// the engine against the EXACT shape of data the user is playing against.
function loadFixture(): any {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'celleater-fixture.json'), 'utf-8'));
  return denormalize3D(raw);
}

// Mirrors packages/web/src/app/play/[slug]/denormalize.ts. 3D-renderer games store
// body widths/heights and bullet positions pre-divided by tile width; the play page
// scales them back up before handing data to the engine. Tests must do the same or
// every fixture/sensor radius is 64× too small.
function denormalize3D(data: any): any {
  const scale = data?.map?.originalTileWidth ?? data?.map?.tilewidth ?? 64;
  if (!Number.isFinite(scale) || scale <= 0) return data;
  const out = JSON.parse(JSON.stringify(data));
  const scaleEnt = (t: any) => {
    if (!t) return;
    scaleBody(t.body, scale);
    if (t.bodies) for (const b of Object.values(t.bodies)) scaleBody(b, scale);
    if (t.spawnPosition) scaleXY(t.spawnPosition, scale);
    if (t.bulletStartPosition) scaleXY(t.bulletStartPosition, scale);
    if (t.damageHitBox) scaleHitBox(t.damageHitBox, scale);
    scaleEnt(t.defaultProjectile);
  };
  for (const t of Object.values(out.unitTypes ?? {})) scaleEnt(t);
  for (const t of Object.values(out.itemTypes ?? {})) scaleEnt(t);
  for (const t of Object.values(out.projectileTypes ?? {})) scaleEnt(t);
  return out;
}
function scaleBody(b: any, s: number) {
  if (!b) return;
  if (typeof b.width === 'number') b.width *= s;
  if (typeof b.height === 'number') b.height *= s;
  if (b.unitAnchor) scaleXY(b.unitAnchor, s);
  if (b.itemAnchor) scaleXY(b.itemAnchor, s);
  if (Array.isArray(b.fixtures)) {
    for (const f of b.fixtures) {
      const sd = f?.shape?.data;
      if (sd) {
        if (typeof sd.halfWidth === 'number') sd.halfWidth *= s;
        if (typeof sd.halfHeight === 'number') sd.halfHeight *= s;
      }
    }
  }
}
function scaleXY(p: any, s: number) { if (p?.x) p.x *= s; if (p?.y) p.y *= s; }
function scaleHitBox(h: any, s: number) {
  if (typeof h?.width === 'number') h.width *= s;
  if (typeof h?.height === 'number') h.height *= s;
  if (typeof h?.offsetX === 'number') h.offsetX *= s;
  if (typeof h?.offsetY === 'number') h.offsetY *= s;
}

describe('Real celleater game data', () => {
  it('cell touches food → score grows; with score >= 50 cell touches virus → virus destroyed', async () => {
    Engine.reset();
    const data = loadFixture();
    const migrated = GameMigrator.migrate({ data });
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);
    await server.init(migrated as any, data);
    server.start();

    // Spawn a player + assign humanPlayer playerType so the score attr seeds at 10.
    const PLAYER_ID = 'realtest_p1';
    const player: any = (server as any).engine.spawn(PLAYER_ID);
    player.category = 'player';
    player.stats = { ownerId: '', name: 'P1', controlledBy: 'human' };
    (server as any)._entities.set(PLAYER_ID, player);
    (server as any)._players.set(PLAYER_ID, { unitId: '' });
    (server as any).engine.events.emit('player:assignType', [PLAYER_ID, 'humanPlayer']);

    // Spawn the cell unit owned by the player at a known tile-coord position.
    const cellTypeDef = data.unitTypes.axSpuTp3mh;
    const cell = (server as any).spawnUnit('axSpuTp3mh', cellTypeDef, PLAYER_ID, { x: 25, z: 25 });
    expect(cell).toBeDefined();
    expect((server as any)._entityBodies.get(cell.id)).toBeDefined();

    const initialScore = player.stats.attr_cap4wtDrqa?.value;
    expect(initialScore).toBe(10);

    // Spawn a Yellow Food item right at the cell's pixel position. The item:spawn
    // event takes pixel coords; cell.position is in tile units.
    const tilePx = (server as any)._tilePx;
    (server as any).engine.events.emit('item:spawn', ['cND4jFlNlU', { x: cell.position.x * tilePx, y: cell.position.z * tilePx }]);

    // Tick to register the started intersection between cell and food.
    (server as any)._tick(50);
    (server as any)._tick(50);

    const afterFoodScore = player.stats.attr_cap4wtDrqa?.value;
    expect(afterFoodScore).toBeGreaterThan(initialScore);

    // Now force score above 50 (the script gates virus eat at score >= 50) and spawn
    // a virus right on the cell to verify the eat-virus path also works through real
    // game data + real script logic.
    player.stats.attr_cap4wtDrqa.value = 100;
    const virusTypeDef = data.unitTypes.AEqtttTY10;
    const virus = (server as any).spawnUnit('AEqtttTY10', virusTypeDef, '', { x: cell.position.x, z: cell.position.z });
    expect((server as any)._entities.get(virus.id)).toBeDefined();

    (server as any)._tick(50);
    (server as any)._tick(50);

    expect((server as any)._entities.get(virus.id)).toBeUndefined();
    // Score halves on virus eat (per the script).
    expect(player.stats.attr_cap4wtDrqa.value).toBeLessThan(100);

    server.stop();
    Engine.reset();
  });
});
