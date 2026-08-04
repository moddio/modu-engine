# 3D-Only Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `GameServer` onto `rapier3d` and delete the 2D backend, so a unit can stand on a car instead of shoving it.

**Architecture:** The 3D wrapper (`PhysicsWorld3d`/`RigidBody3d`) already exists but nothing calls it. Bring it to parity with what `GameServer` uses, give props real heights baked from their GLB bounding boxes, rebuild wall colliders as cuboids, then convert `GameServer` from `Vec2`/scalar-angle to `Vec3`/quaternion and delete `rapier2d`.

**Tech Stack:** TypeScript, `@dimforge/rapier3d-compat` 0.14, vitest, three.js (client).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-04-3d-only-physics-design.md`. Read it first.
- Engine repo is `/app/data/home/moddio-sdk/packages/engine`; the game is `/app/data/home/braains3d`.
- The engine ships as a prebuilt bundle. After engine changes affecting the game, run `npm run sync:engine` from the game and `npm run verify`.
- Units are **capsules**. Props are **cuboids**. Props need not stack cleanly.
- The tile map stays. Wall height comes from the count of stacked `walls*` layers.
- Physics is Y-up: world `(x, y, z)` = (east, **height**, south). Tile coords map `tile.x → x`, `tile.y → z`. This is the opposite of the old 2D code, where physics `y` meant world `z`.
- `2` decimal tile precision is enough for all assertions; use `toBeCloseTo(..., 2)` unless a case says otherwise.
- Never leave `rapier2d` and `rapier3d` both wired at once past Task 8.

---

### Task 1: Bake prop heights into the export

37 of 38 prop types have no Z extent, so every prop would collide as a uniform 1-tile box. glTF accessors carry `POSITION` min/max; all 48 of this game's GLBs have them.

**Files:**
- Create: `/app/data/home/braains3d/tools/bake-prop-heights.mjs`
- Modify: `/app/data/home/braains3d/package.json` (add `"bake:heights"` script)
- Modify: `/app/data/home/braains3d/public/game.json` (output — regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: every `propTypes[*].bodies.default.fixtures[0]` gains `shape.depth` (number, tiles) and `scale.z` (number), plus `shape._bboxMinY` / `shape._bboxMaxY` (model units) so an off-origin model is auditable.

- [ ] **Step 1: Write the failing test**

Create `/app/data/home/braains3d/tools/bake-prop-heights.test.mjs`:

```js
import { readGlbBounds, heightTilesFor } from './bake-prop-heights.mjs';
import { strict as assert } from 'node:assert';

// A known asset: the table measures 3.00 x 1.00 x 2.00 in model units (Y is height).
const b = readGlbBounds('public/assets/cache.modd.io/asset/3DObject/1736230669069_table.glb');
assert.ok(Math.abs((b.max[1] - b.min[1]) - 1.0) < 0.01, `table height ${b.max[1] - b.min[1]}`);

// baseScale mirrors the renderer: longest footprint side (tiles) / longest model dim.
// A 2-tile-long body on a 3.00-unit-long model => 0.667, so height 1.00 => 0.667 tiles.
const h = heightTilesFor({ bodyWidthPx: 32, bodyHeightPx: 16, tilePx: 16 }, b);
assert.ok(Math.abs(h - 0.667) < 0.01, `height tiles ${h}`);
console.log('ok');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /app/data/home/braains3d && node tools/bake-prop-heights.test.mjs`
Expected: FAIL, `Cannot find module './bake-prop-heights.mjs'`.

- [ ] **Step 3: Implement the bake tool**

Create `/app/data/home/braains3d/tools/bake-prop-heights.mjs`:

```js
/**
 * Bake each prop's real height into the export.
 *
 * Props ship no Z extent (37 of 38 have `scale.z === 1`), so 3D physics would give a
 * police car and a bed the same 1-tile collider. glTF stores per-accessor POSITION
 * min/max, so the bounding box is readable from the GLB's JSON chunk without decoding
 * a single vertex.
 *
 * Records min/max rather than just the height: a model whose mesh straddles y=0 has a
 * correct height but the wrong resting offset, and that must be auditable rather than
 * silently half-burying the prop.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function readGlbBounds(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a GLB: ${path}`);
  let off = 12;
  let json = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) { json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8')); break; }
    off += 8 + len;
  }
  if (!json) throw new Error(`no JSON chunk: ${path}`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const acc = json.accessors?.[prim.attributes?.POSITION];
      if (!acc?.min || !acc?.max) continue;
      found = true;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], acc.min[i]); max[i] = Math.max(max[i], acc.max[i]); }
    }
  }
  if (!found) throw new Error(`no POSITION bounds: ${path}`);
  return { min, max };
}

/**
 * Mirror of the renderer's GLB sizing (GameRenderer.createEntity, GLB branch): the model
 * is scaled so its longest horizontal dimension matches the longest side of the body
 * footprint. Height follows from that same scale.
 */
export function heightTilesFor({ bodyWidthPx, bodyHeightPx, tilePx }, bounds) {
  const longestTiles = Math.max(bodyWidthPx, bodyHeightPx) / tilePx;
  const dx = bounds.max[0] - bounds.min[0];
  const dz = bounds.max[2] - bounds.min[2];
  const maxDim = Math.max(dx, dz);
  if (!(maxDim > 0) || !(longestTiles > 0)) return 1;
  const baseScale = longestTiles / maxDim;
  return (bounds.max[1] - bounds.min[1]) * baseScale;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /app/data/home/braains3d && node tools/bake-prop-heights.test.mjs`
Expected: prints `ok`.

- [ ] **Step 5: Add the CLI that rewrites game.json**

Append to `bake-prop-heights.mjs`:

```js
function main() {
  const ROOT = process.cwd();
  const gamePath = join(ROOT, 'public', 'game.json');
  const gameExport = JSON.parse(readFileSync(gamePath, 'utf8'));
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'assets', 'manifest.json'), 'utf8'));
  const byUrl = new Map(manifest.files.map((f) => [f.url, f.path]));
  const tilePx = Number(gameExport.data?.map?.tilewidth) || 16;

  let baked = 0; const skipped = [];
  for (const [id, type] of Object.entries(gameExport.data?.propTypes ?? {})) {
    const body = type?.bodies?.default;
    const fixture = body?.fixtures?.[0];
    const url = type?.cellSheet?.url;
    const rel = url && byUrl.get(url);
    if (!body || !fixture || !rel) { skipped.push(`${type?.name ?? id}: no body/fixture/asset`); continue; }
    let bounds;
    try { bounds = readGlbBounds(join(ROOT, 'public', rel)); }
    catch (e) { skipped.push(`${type?.name ?? id}: ${e.message}`); continue; }
    const h = heightTilesFor({ bodyWidthPx: Number(body.width), bodyHeightPx: Number(body.height), tilePx }, bounds);
    fixture.shape = { ...(fixture.shape ?? {}), type: fixture.shape?.type ?? 'rectangle', depth: 1, _bboxMinY: bounds.min[1], _bboxMaxY: bounds.max[1] };
    fixture.scale = { ...(fixture.scale ?? { x: 1, y: 1 }), z: h };
    baked++;
  }
  writeFileSync(gamePath, JSON.stringify(gameExport));
  console.log(`baked heights into ${baked} prop type(s)`);
  skipped.forEach((s) => console.log(`  skipped ${s}`));
}

if (process.argv[1]?.endsWith('bake-prop-heights.mjs')) main();
```

Add to `package.json` scripts: `"bake:heights": "node tools/bake-prop-heights.mjs"`.

- [ ] **Step 6: Run it and sanity-check the spread**

Run: `cd /app/data/home/braains3d && npm run bake:heights`
Expected: `baked heights into 38 prop type(s)`, 0 skipped.

Then confirm heights actually differ per prop (this is the whole point):

```bash
node -e "const g=JSON.parse(require('fs').readFileSync('public/game.json','utf8')).data;
const h=Object.values(g.propTypes).map(p=>[p.name,p.bodies?.default?.fixtures?.[0]?.scale?.z]).filter(x=>x[1]);
h.sort((a,b)=>b[1]-a[1]); console.log('tallest',h.slice(0,3)); console.log('shortest',h.slice(-3));"
```
Expected: a lamp/cabinet at the tall end, a rug/book at the short end — **not** all 1.

- [ ] **Step 7: Commit**

```bash
cd /app/data/home/braains3d
git add tools/bake-prop-heights.mjs tools/bake-prop-heights.test.mjs package.json public/game.json
git commit -m "feat(tools): bake prop heights from GLB bounds"
```
(If braains3d is not a git repo, skip the commit — it is not, as of 2026-08-04.)

---

### Task 2: `RigidBody3d` parity

`GameServer` uses `linearDamping`, `angularDamping`, `mass`, `lockRotation` and collision groups. The 3D wrapper has none of them.

**Files:**
- Modify: `engine/core/physics/RigidBody3d.ts`
- Modify: `engine/core/physics/PhysicsWorld3d.ts` (`ColliderDef3d` gains `category`/`mask`)
- Test: `tests/unit/physics/RigidBody3d.test.ts`

**Interfaces:**
- Consumes: `Vec3` from `engine/core/math/Vec3`.
- Produces: on `RigidBody3d` — `get/set linearDamping: number`, `get/set angularDamping: number`, `get mass: number`, `lockRotation(locked: boolean): void`, `lockRotationAxes(x: boolean, y: boolean, z: boolean): void`. On `ColliderDef3d` — optional `category?: number`, `mask?: number`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/physics/RigidBody3d.test.ts` (inside the existing top-level `describe`):

```ts
  it('round-trips damping and reports mass', async () => {
    const world = await makeWorld();
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    body.addCollider({ shape: 'box', halfExtents: new Vec3(0.5, 0.5, 0.5), density: 1 });
    body.linearDamping = 2.5;
    body.angularDamping = 0.75;
    expect(body.linearDamping).toBeCloseTo(2.5, 5);
    expect(body.angularDamping).toBeCloseTo(0.75, 5);
    expect(body.mass).toBeGreaterThan(0);
  });

  it('locks rotation so game logic can own facing', async () => {
    const world = await makeWorld();
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    body.addCollider({ shape: 'box', halfExtents: new Vec3(0.5, 0.5, 0.5), density: 1 });
    body.lockRotation(true);
    body.angularVelocity = new Vec3(0, 5, 0);
    world.step(50);
    expect(body.angularVelocity.length()).toBeCloseTo(0, 5);
  });
```

`makeWorld()` is the existing helper in that file; if it is not present, use whatever the file already does to build a `PhysicsWorld3d` — do not invent a second helper.

- [ ] **Step 2: Run to verify they fail**

Run: `cd /app/data/home/moddio-sdk/packages/engine && npx vitest run tests/unit/physics/RigidBody3d.test.ts`
Expected: FAIL — `body.linearDamping` is `undefined`, `body.lockRotation is not a function`.

- [ ] **Step 3: Implement**

In `RigidBody3d.ts`, after the `angularVelocity` accessors:

```ts
  get linearDamping(): number { return this.raw.linearDamping(); }
  set linearDamping(v: number) { this.raw.setLinearDamping(v); }

  get angularDamping(): number { return this.raw.angularDamping(); }
  set angularDamping(v: number) { this.raw.setAngularDamping(v); }

  /** Total mass, including every attached collider. */
  get mass(): number { return this.raw.mass(); }

  /**
   * Freeze or release every rotational degree of freedom.
   *
   * Locked is right for anything whose facing is written by game logic — units turn to
   * face the cursor, items point along the swing arc — because physics spin would fight
   * those writes every tick. Scenery is the opposite case: a shoved sofa has to turn.
   */
  lockRotation(locked: boolean): void {
    this.raw.lockRotations(locked, true);
  }

  /**
   * Lock individual axes. In 3D a prop should usually keep its yaw (Y) free while pitch
   * and roll stay locked, or a shoved table tips onto its side instead of spinning.
   */
  lockRotationAxes(x: boolean, y: boolean, z: boolean): void {
    this.raw.setEnabledRotations(x, y, z, true);
  }
```

In `PhysicsWorld3d.ts`, extend `ColliderDef3d` with `category?: number; mask?: number;` and, in `RigidBody3d.addCollider`, before `createCollider`:

```ts
    if (def.category !== undefined && def.mask !== undefined) {
      shape.setCollisionGroups((def.category << 16) | def.mask);
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/physics/RigidBody3d.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/core/physics/RigidBody3d.ts engine/core/physics/PhysicsWorld3d.ts tests/unit/physics/RigidBody3d.test.ts
git commit -m "feat(physics): bring RigidBody3d to parity with the 2D wrapper"
```

---

### Task 3: `MapPhysics3d` — walls as cuboids

Wall height comes from how many `walls*` layers a cell appears in. In braains3d, `walls`, `walls2`, `walls3`, `walls4` occupy the identical 408 cells, so every wall is 4 tiles tall.

**Files:**
- Create: `engine/core/physics/MapPhysics3d.ts`
- Test: `tests/unit/physics/MapPhysics3d.test.ts`

**Interfaces:**
- Consumes: `PhysicsWorld3d`, `RigidBody3d`, `Vec3`, `CollisionCategory`, `DefaultCollisionMask`.
- Produces: `createWallBodiesFromMap3d(physics: PhysicsWorld3d, layers: number[][], mapWidth: number, mapHeight: number, tileWidth: number, scaleRatio?: number): RigidBody3d[]` — one static body per occupied column, sized `tile × (levels × tile) × tile`, resting on `y = 0`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/physics/MapPhysics3d.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld3d } from '../../../engine/core/physics/PhysicsWorld3d';
import { createWallBodiesFromMap3d } from '../../../engine/core/physics/MapPhysics3d';
import { Vec3 } from '../../../engine/core/math/Vec3';

beforeAll(async () => { await RAPIER.init(); });

describe('MapPhysics3d', () => {
  // 2x1 map. Cell 0 is walled on 3 layers, cell 1 on none.
  const layers = [[1, 0], [1, 0], [1, 0]];

  it('creates one body per occupied column, not one per layer', () => {
    const w = new PhysicsWorld3d(new Vec3(0, -9.81, 0));
    const bodies = createWallBodiesFromMap3d(w, layers, 2, 1, 16, 30);
    expect(bodies).toHaveLength(1);
  });

  it('makes the column as tall as the number of stacked layers', () => {
    const w = new PhysicsWorld3d(new Vec3(0, -9.81, 0));
    const [body] = createWallBodiesFromMap3d(w, layers, 2, 1, 16, 30);
    const tile = 16 / 30;
    // Centre sits at half the column height, so the base rests on y = 0.
    expect(body.position.y).toBeCloseTo((3 * tile) / 2, 5);
  });

  it('drops a box onto a wall column instead of through it', () => {
    const w = new PhysicsWorld3d(new Vec3(0, -9.81, 0));
    createWallBodiesFromMap3d(w, layers, 2, 1, 16, 30);
    const tile = 16 / 30;
    const box = w.createBody({ type: 'dynamic', position: new Vec3(tile / 2, 3 * tile + 2, tile / 2) });
    box.addCollider({ shape: 'box', halfExtents: new Vec3(tile / 4, tile / 4, tile / 4), density: 1 });
    for (let i = 0; i < 120; i++) w.step(16);
    expect(box.position.y).toBeGreaterThan(3 * tile);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/physics/MapPhysics3d.test.ts`
Expected: FAIL — cannot resolve `MapPhysics3d`.

- [ ] **Step 3: Implement**

Create `engine/core/physics/MapPhysics3d.ts`:

```ts
import { PhysicsWorld3d } from './PhysicsWorld3d';
import { Vec3 } from '../math/Vec3';
import { CollisionCategory, DefaultCollisionMask } from './CollisionFilter';
import type { RigidBody3d } from './RigidBody3d';

/**
 * Build static wall geometry from a map's stacked wall layers.
 *
 * The 2D version made one flat box per wall tile. In 3D a wall needs height, and the
 * map already encodes it: the editor stacks `walls`, `walls2`, `walls3`… on the same
 * footprint, one layer per storey. So the number of layers a cell appears in IS its
 * height in tiles, and each occupied column becomes a single cuboid rather than N
 * overlapping boxes — fewer colliders and no internal faces for a unit to catch on.
 */
export function createWallBodiesFromMap3d(
  physics: PhysicsWorld3d,
  layers: number[][],
  mapWidth: number,
  mapHeight: number,
  tileWidth: number,
  scaleRatio = 30,
): RigidBody3d[] {
  const bodies: RigidBody3d[] = [];
  const tile = tileWidth / scaleRatio;
  const half = tile / 2;

  for (let z = 0; z < mapHeight; z++) {
    for (let x = 0; x < mapWidth; x++) {
      const i = z * mapWidth + x;
      let levels = 0;
      for (const layer of layers) if (layer[i]) levels++;
      if (levels === 0) continue;

      const height = levels * tile;
      const body = physics.createBody({
        type: 'static',
        // Y is the centre of the column, so its base sits on the ground plane.
        position: new Vec3(x * tile + half, height / 2, z * tile + half),
      });
      body.addCollider({
        shape: 'box',
        halfExtents: new Vec3(half, height / 2, half),
        friction: 0.1,
        restitution: 0,
        category: CollisionCategory.WALL,
        mask: DefaultCollisionMask[CollisionCategory.WALL],
      });
      bodies.push(body);
    }
  }
  return bodies;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/physics/MapPhysics3d.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add engine/core/physics/MapPhysics3d.ts tests/unit/physics/MapPhysics3d.test.ts
git commit -m "feat(physics): build wall columns as 3D cuboids from stacked layers"
```

---

### Task 4: `GameServer` on the 3D world

The conversion. `GameServer` is 4,037 lines with ~75 uses of the 2D API.

**Files:**
- Modify: `engine/server/GameServer.ts`
- Test: `tests/physics/PhysicsConformance3d.test.ts` (new; the 2D suite is deleted in Task 8)

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces: `entity.position` gains a real `y` (height, tiles). `_tileToPhysics`/`_physicsToTile` keep their signatures. `entity.rotation` stays a scalar yaw in radians, now extracted from the body quaternion.

- [ ] **Step 1: Swap the imports and the world**

In `GameServer.ts`: replace `PhysicsWorld`/`RigidBody`/`Vec2` imports with `PhysicsWorld3d`/`RigidBody3d`/`Vec3`, and `createWallBodiesFromMap` with `createWallBodiesFromMap3d`. In `init()`, build `new PhysicsWorld3d(new Vec3(0, -9.81, 0))` instead of the zero-gravity 2D world.

- [ ] **Step 2: Convert `_createEntityBody`**

Positions become `new Vec3(this._tileToPhysics(x), y, this._tileToPhysics(z))`, where `y` is the entity's resting height (0 for anything on the ground). Colliders become boxes sized from the footprint and the height baked in Task 1:

```ts
const halfW = this._tileToPhysics(widthTiles) / 2;
const halfD = this._tileToPhysics(depthTiles) / 2;
const halfH = this._tileToPhysics(heightTiles) / 2;
```

Units get a capsule instead (see Task 5). Props get `lockRotationAxes(false, true, false)` — yaw free, pitch and roll locked, so a shoved table spins rather than tipping.

- [ ] **Step 3: Convert `_syncPhysicsToEntities`**

```ts
const pos = body.position;
entity.position.x = this._physicsToTile(pos.x);
entity.position.y = this._physicsToTile(pos.y); // height
entity.position.z = this._physicsToTile(pos.z);
// Yaw out of the quaternion. Replaces the scalar body.angle negation: a quaternion
// already carries the frame, so there is no handedness fudge to apply.
const q = body.rotation;
entity.rotation = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
```

- [ ] **Step 4: Delete `_applyGroundFriction` and its state**

Remove the method, the `_groundFriction` map, every `.delete()`/`.clear()` of it, `_resolveGroundFriction`, `_resolveContactRadius`, `GROUND_GRAVITY_TILES`, `DEFAULT_GROUND_FRICTION`, `DEFAULT_CONTACT_RADIUS_TILES` and `SPIN_FRICTION_SCALE`. Real normal forces plus collider friction replace all of it. Set prop collider `friction` to the fixture's authored value (default `0.6`).

- [ ] **Step 5: Write the 3D conformance tests**

Create `tests/physics/PhysicsConformance3d.test.ts` with, at minimum:

```ts
it('lands a unit on a crate instead of pushing through it', async () => {
  // Drop a unit above a crate; it comes to rest above the crate's top, not at y=0.
});

it('lets a unit walk off an edge and fall', async () => {
  // Stand a unit on a crate, drive it sideways, assert y decreases to ground.
});

it('keeps a prop from launching when shoved', async () => {
  // Shove hard; assert |y| stays near resting height.
});

it('stops a unit walking through a wall at any height below its top', async () => {
  // Drive a unit at a 4-tile wall column; assert x does not pass the wall plane.
});
```

Fill each body in against the harness in the old `PhysicsConformance.test.ts` (`boot`, `bootAndTrack`, `propBody`, `propEntity`, `tick`), ported to 3D.

- [ ] **Step 6: Run the suite**

Run: `npx vitest run tests/physics/PhysicsConformance3d.test.ts`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add engine/server/GameServer.ts tests/physics/PhysicsConformance3d.test.ts
git commit -m "feat(physics): run GameServer on the 3D world"
```

---

### Task 5: Units as capsules, jump as a real impulse

**Files:**
- Modify: `engine/server/GameServer.ts`
- Modify: `engine/core/physics/PhysicsWorld3d.ts` (`ColliderDef3d.shape` gains `'capsule'`)
- Modify: `engine/core/physics/RigidBody3d.ts` (`addCollider` handles capsules)
- Test: `tests/physics/PhysicsConformance3d.test.ts`

**Interfaces:**
- Produces: `ColliderDef3d` supports `shape: 'capsule'` with `halfHeight: number` and `radius: number`.

- [ ] **Step 1: Add capsule support**

In `ColliderDef3d`: `shape: 'box' | 'sphere' | 'capsule'; halfHeight?: number;`. In `addCollider`:

```ts
    } else if (def.shape === 'capsule') {
      shape = RAPIER.ColliderDesc.capsule(def.halfHeight ?? 0.5, def.radius ?? 0.25);
```

- [ ] **Step 2: Give units capsules**

In `_createEntityBody`, when `category === 'unit'`: radius from half the footprint's shorter side, `halfHeight = max(0, heightTiles/2 − radius)` in physics units. Lock all rotation on units (`lockRotation(true)`) — facing stays owned by game logic.

- [ ] **Step 3: Replace the jump UI command with an impulse**

At `GameServer.ts:421`, replace the `jumpEntity` broadcast with a vertical impulse on the body:

```ts
body.applyImpulse(new Vec3(0, vz * body.mass, 0));
```

- [ ] **Step 4: Test that a unit lands on a crate after jumping**

```ts
it('a jumping unit clears a crate and stands on it', async () => {
  // Position a unit beside a 1-tile crate, apply the jump impulse, drive forward,
  // and assert it comes to rest at crate height rather than at ground level.
});
```

- [ ] **Step 5: Run and commit**

```bash
npx vitest run tests/physics/PhysicsConformance3d.test.ts
git add -A && git commit -m "feat(physics): capsule units and a real jump impulse"
```

---

### Task 6: Put `z` on the wire

**Files:**
- Modify: `engine/core/protocol/Messages.ts`
- Test: `tests/unit/protocol/Messages.test.ts` (or the existing protocol test file)

**Interfaces:**
- Produces: `TransformData` gains `z: number`; `encodeTransform`/`decodeTransform` round-trip it at the same `POSITION_SCALE`.

- [ ] **Step 1: Write the failing test**

```ts
it('round-trips height through the transform codec', () => {
  const t = { x: 12.5, y: 4.25, z: 1.875, rotation: 1.2 };
  const back = decodeTransform(encodeTransform(t));
  expect(back.z).toBeCloseTo(1.875, 3);
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: `back.z` is `undefined`.

- [ ] **Step 3: Add `z`** to `TransformData`, `EncodedTransform`, `encodeTransform` and `decodeTransform`, mirroring how `x` is handled.

- [ ] **Step 4: Only stream entities that moved**

In `_streamTransforms`, skip any entity whose position and rotation are unchanged since the previous snapshot. 69 props at 20 Hz dominate this game's traffic and almost none of them move.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run tests/unit/protocol
git add -A && git commit -m "feat(protocol): carry height in transforms"
```

---

### Task 7: Renderer reads real height

**Files:**
- Modify: `engine/client/renderer/GameRenderer.ts`
- Modify: `/app/data/home/braains3d/src/GameClient.tsx` (pass `z` through)
- Modify: `/app/data/home/braains3d/src/GameRenderer.ts` (same, the game's copy)

- [ ] **Step 1: Take `z` in `updateTransforms`** — extend the target record to `{ x, y, z, ry }` and lerp `obj.position.y` toward the streamed height alongside x/z.
- [ ] **Step 2: Delete `triggerJump`, `JUMP_GRAVITY`, `_jumpingEntities`** and the `jumpEntity` UI command handler. Height is the server's now.
- [ ] **Step 3: Reconcile `_entityFloorY`/`_worldY`** — they exist only because the server sent no height. Keep them as the *spawn* height when a snapshot has not arrived yet; the lerp takes over after.
- [ ] **Step 4: Verify in the browser**

```bash
cd /app/data/home/braains3d && npm run sync:engine && npm run verify && npm run build
```
Then load the game and jump onto a car.

- [ ] **Step 5: Commit.**

---

### Task 8: Delete the 2D backend

**Files:**
- Delete: `engine/core/physics/PhysicsWorld.ts`, `engine/core/physics/RigidBody.ts`, `engine/core/physics/MapPhysics.ts`, `tests/physics/PhysicsConformance.test.ts`, `tests/unit/physics/PhysicsWorld.test.ts`, `tests/unit/physics/RigidBody.test.ts`, `tests/unit/physics/MapPhysics.test.ts`
- Modify: `engine/core/physics/index.ts`, `engine/core/GameMigrator.ts` (drop `physicsEngine`), `package.json` (drop `@dimforge/rapier2d-compat`)

- [ ] **Step 1: Delete the files above.**
- [ ] **Step 2: Remove `physicsEngine`** from `GameMigrator`'s settings type and its default.
- [ ] **Step 3: Drop the dependency:** `npm uninstall @dimforge/rapier2d-compat`.
- [ ] **Step 4: Full suite + typecheck**

```bash
npx vitest run && npx tsc --noEmit -p tsconfig.json
```
Expected: green, and no import of a deleted module.

- [ ] **Step 5: Sync and verify the game**

```bash
cd /app/data/home/braains3d && npm run sync:engine && npm run verify && npx tsc --noEmit
```

- [ ] **Step 6: Commit.**

---

## Self-review

**Spec coverage:** heights → Task 1; `RigidBody3d` parity → Task 2; `MapPhysics3d` → Task 3; `GameServer` 3D + ground-friction deletion → Task 4; capsules and jump → Task 5; protocol `z` and static-entity omission → Task 6; renderer → Task 7; 2D deletion and suite replacement → Tasks 4/8. Every spec section maps to a task.

**Known risk carried into execution:** Task 4 is far larger than the others and will not survive as one commit in practice. Split it at the first point the suite goes green rather than forcing it whole.
