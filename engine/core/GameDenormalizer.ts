/**
 * INGESTION: 3D export → the raw-pixel game data the engine consumes.
 *
 * `GameServer` and the renderers have one ingestion contract: taro-shaped game data
 * with every length in **raw pixels**. 3D-renderer games do not arrive that way. They
 * are stored with body dimensions, pixel positions and camera zoom **pre-divided** by
 * `map.originalTileWidth` (the original tile size, typically 64), so a unit body 40 px
 * wide is stored as `0.625`. Converting back is the caller's job, and this is the
 * supported way to do it.
 *
 * It lives in the engine rather than in each app because it is the other half of that
 * contract: get it wrong and nothing downstream can be right, but the failure surfaces
 * far away — as a 20-tile-wide collider, a camera 64× too far out, or every
 * script-spawned unit stacked on the map's top-left tile. It previously existed as two
 * hand-synced copies in `braains3d` and `packages/web`, which had drifted by 166 lines;
 * the web copy was missing three fixes the standalone copy had.
 *
 * Apply only when `game.defaultRenderer === '3d'`. 2D data is already in raw-pixel form
 * and must NOT be touched. The input is never mutated.
 *
 * @see GameMigrator — runs *after* this, and is a shape adapter only (it performs no
 *      unit conversion, which is why this pass has to happen first).
 */
export function denormalize3DGameData(data: Record<string, any>): Record<string, any> {
  const map = data?.map as Record<string, any> | undefined;
  const scale: number = (map?.originalTileWidth ?? map?.tilewidth ?? 64) as number;
  if (!Number.isFinite(scale) || scale <= 0) return data;

  // `map.originalTileWidth` is the export's own record that it went through the 3D
  // normalization pass — every length divided by that tile size, the legacy 2D `body`
  // mirror included. Its ABSENCE means no such pass ran, and only the fields the 3D
  // editor authors (`bodies.*`) are in tile units; the mirror still holds whatever
  // taro's 2D editor last wrote, in raw pixels.
  //
  //   celleater  originalTileWidth: 64 → body 0.625 (= 40 px normalized), bodies.default 0.434
  //   Braains3D  originalTileWidth: —  → body 40    (raw px, taro's stock), bodies.default 1.809
  //
  // Scaling the mirror in the second case multiplies an already-pixel value: 40 → 640,
  // and since GameServer._createEntityBody resolves `typeDef.body` first, the unit gets
  // a 20×20 TILE collider. Falling back to `tilewidth` for `scale` is a reasonable guess
  // for the 3D fields, but it is never right for a mirror that was never normalized.
  const bodyMirrorWasNormalized = Number.isFinite(Number(map?.originalTileWidth));

  // When the mirror was NOT part of that pass it is a stale 2D leftover, and
  // `GameServer._createEntityBody` resolves `typeDef.body || bodies.default` — it
  // would size the collider off the artifact rather than off the body the 3D editor
  // actually authored (and that GameRenderer draws). For Braains3D that is taro's
  // stock 40×40 px = 2.5 tiles against a 1.81×0.52 tile model, so the unit stops
  // three quarters of a tile short of every wall. Drop the stale mirror so the engine
  // falls through to `bodies.default`; it carries type, damping, fixtures and
  // collidesWith, so nothing is lost. Exports that did go through the pass keep both.
  const dropStaleBodyMirror = !bodyMirrorWasNormalized;

  // Deep clone so we don't mutate the cached mongo object.
  const out = JSON.parse(JSON.stringify(data));

  scaleEntities(out.unitTypes, scale, false, bodyMirrorWasNormalized, dropStaleBodyMirror);
  // Item bodies' `unitAnchor`/`itemAnchor` come out of the editor pre-divided by
  // tilePx an extra time vs. body width/height, so they need an additional *s to
  // land in raw pixels (matches what the renderer's `getAnchoredOffset` expects).
  scaleEntities(out.itemTypes, scale, true, bodyMirrorWasNormalized, dropStaleBodyMirror);
  scaleEntities(out.projectileTypes, scale, false, bodyMirrorWasNormalized, dropStaleBodyMirror);
  // propTypes carries bodies exactly like the others — 38 of them here, 69 of the
  // 72 spawned entities. Omitting it left prop bodies normalized while unit bodies
  // became pixels, so the two collections reached GameRenderer in different units.
  // That inconsistency is what made the GLB scaling look correct for furniture and
  // 16× too large for the player at the same time.
  scaleEntities(out.propTypes, scale, false, bodyMirrorWasNormalized, dropStaleBodyMirror);
  scaleParticleTypes(out.particleTypes, scale);
  scaleCameraZoom(out.settings, scale);

  // Region variables (`getRandomPositionInRegion`, `centerOfRegion`, the spawn
  // area, …) must reach the engine as raw pixels — its resolvers divide by tilePx
  // to get tile units. Left unscaled they collapse to a sub-tile value at the
  // origin and every script-spawned unit lands on the map's top-left tile.
  // See scaleRegionVariables for the two storage formats it has to tell apart.
  const mapW = Number(map?.width) || 0;
  const mapH = Number(map?.height) || 0;
  if (mapW > 0 && mapH > 0) {
    scaleRegionVariables(out.variables, mapW * scale, mapH * scale, scale);
  }

  // Literal `xyCoordinate` action positions in scripts are stored pre-divided
  // by `originalTileWidth` too — e.g. the `initialize` script spawns props at
  // {x: 62, y: 11} meaning tile (62, 11) on a 65×64-tile map. The engine's
  // `xyCoordinate` resolver returns x/y verbatim and the spawn handler divides
  // by tilePx, so without rescaling those NPCs land at sub-tile values clustered
  // at the map's top-left corner. We only touch literal numbers; nested function
  // references (e.g. `getPositionX(getEntityPosition(...))`) already return raw
  // pixels per the taro convention and must be left alone.
  scaleXyCoordinateLiterals(out.scripts, scale);

  return out;
}

function scaleXyCoordinateLiterals(node: unknown, s: number): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) scaleXyCoordinateLiterals(child, s);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.function === 'xyCoordinate') {
    if (typeof obj.x === 'number') obj.x = (obj.x as number) * s;
    if (typeof obj.y === 'number') obj.y = (obj.y as number) * s;
  }
  for (const child of Object.values(obj)) scaleXyCoordinateLiterals(child, s);
}

/**
 * Regions come in two flavours across exports, and guessing wrong throws the
 * spawn point clean off the map:
 *
 *   fractions of the map — {x: 0.71875, y: 0.1875, width: 0.0156}
 *   tile units           — {x: 11.14,  y: 30.01,  width: 4.75}   ← Braains3D
 *
 * Both must end up in raw pixels, since the engine's region resolvers divide by
 * tilePx to get back to tiles. Fractions therefore scale by the map's full pixel
 * span; tile units only by the tile size. Applying the fraction rule to
 * Braains3D's tile-unit spawn multiplied it by the whole map (11.14 → tile
 * 389.9 on a 35-tile map), the engine clamped that to the far corner, and the
 * player spawned in the map's bottom-right corner instead of mid-map.
 *
 * A region is only read as fractional when x, y, width and height are all ≤ 1.
 * In tile units that would mean a sub-tile region pinned to the top-left corner,
 * which no editor produces.
 */
function isFractionalRegion(r: Record<string, any>): boolean {
  const vals = ['x', 'y', 'width', 'height']
    .map((k) => r[k])
    .filter((n): n is number => typeof n === 'number');
  return vals.length > 0 && vals.every((n) => Math.abs(n) <= 1);
}

function scaleRegionVariables(
  variables: Record<string, any> | undefined,
  mapPxW: number,
  mapPxH: number,
  tilePx: number,
): void {
  if (!variables || typeof variables !== 'object') return;
  for (const v of Object.values(variables)) {
    if (!v || typeof v !== 'object' || (v as any).dataType !== 'region') continue;
    const r = (v as any).default ?? (v as any).value;
    if (!r || typeof r !== 'object') continue;
    const fractional = isFractionalRegion(r);
    const scaleX = fractional ? mapPxW : tilePx;
    const scaleY = fractional ? mapPxH : tilePx;
    if (typeof r.x === 'number') r.x = r.x * scaleX;
    if (typeof r.y === 'number') r.y = r.y * scaleY;
    if (typeof r.width === 'number') r.width = r.width * scaleX;
    if (typeof r.height === 'number') r.height = r.height * scaleY;
  }
}

function scaleEntities(
  types: Record<string, any> | undefined,
  s: number,
  isItem: boolean,
  scaleLegacyBody: boolean,
  dropLegacyBody: boolean,
): void {
  if (!types || typeof types !== 'object') return;
  for (const t of Object.values(types)) scaleEntity(t as any, s, isItem, scaleLegacyBody, dropLegacyBody);
}

function scaleEntity(
  t: Record<string, any> | undefined,
  s: number,
  isItem: boolean,
  scaleLegacyBody: boolean,
  dropLegacyBody: boolean,
): void {
  if (!t || typeof t !== 'object') return;
  scaleBodies(t.bodies, s, isItem, scaleLegacyBody);
  if (scaleLegacyBody) scaleBody(t.body, s, isItem, true);
  // Only drop it when there is a 3D body to fall through to — and carry over the
  // material properties first. The mirror is stale in its *geometry* (taro's stock
  // 40×40 against an authored 1.81×0.52), but its damping/friction/restitution are
  // the values the game was tuned with: Braains3D's units read `linearDamping: 5`
  // there while the 3D body leaves it at `{x:0,y:0,z:0}`. Dropping the mirror whole
  // therefore threw away the deceleration the data asks for and the unit slid.
  else if (dropLegacyBody && t.bodies?.default) {
    inheritMaterialProps(t.body, t.bodies.default);
    delete t.body;
  }
  scaleXY(t.spawnPosition, s);
  scaleXY(t.bulletStartPosition, s);
  scaleHitBox(t.damageHitBox, s);
  // Item types embed a full projectile definition under `defaultProjectile`. The nested
  // projectile is *not* an item, so its anchors don't get the item-only extra scale.
  scaleEntity(t.defaultProjectile, s, false, scaleLegacyBody, dropLegacyBody);
}

function scaleBodies(
  bodies: Record<string, any> | undefined,
  s: number,
  isItem: boolean,
  trusted: boolean,
): void {
  if (!bodies || typeof bodies !== 'object') return;
  for (const b of Object.values(bodies)) scaleBody(b as any, s, isItem, trusted);
}

/**
 * Is this length already in raw pixels?
 *
 * Only ever asked when the export carries no `map.originalTileWidth`, i.e. when
 * nothing records which fields the 3D pass touched and every conversion is inference.
 * Such exports are demonstrably inconsistent *within a single collection* — Braains3D's
 * projectiles are `1.3` and `2.0` tile units next to a `potato` at `40`, and its units
 * pair a `1.809` tile `bodies.default` with taro's stock `40×40` mirror.
 *
 * A tile is `s` pixels, so a body measured in tiles is a small number (these range
 * 0.26–3.2) while one measured in pixels is at least a tile across. Anything ≥ `s`
 * would, if scaled, become a collider ≥ `s` TILES — 40 tiles on a 35×57 map — which no
 * editor produces. The two populations are separated by a 5× margin here; `verify.ts`
 * asserts the resulting colliders against the map, so a bad call fails loudly.
 */
function alreadyPixels(value: number, s: number): boolean {
  return Math.abs(value) >= s;
}

function scaleBody(
  body: Record<string, any> | undefined,
  s: number,
  isItem: boolean,
  trusted: boolean,
): void {
  if (!body || typeof body !== 'object') return;
  const scaleLen = (v: number) => (trusted || !alreadyPixels(v, s) ? v * s : v);
  if (typeof body.width === 'number') body.width = scaleLen(body.width);
  if (typeof body.height === 'number') body.height = scaleLen(body.height);
  const anchorScale = isItem ? s * s : s;
  scaleXY(body.unitAnchor, anchorScale);
  scaleXY(body.itemAnchor, anchorScale);
  const fixtures = body.fixtures;
  if (Array.isArray(fixtures)) {
    for (const f of fixtures) {
      const sd = f?.shape?.data;
      if (sd && typeof sd === 'object') {
        if (typeof sd.halfWidth === 'number') sd.halfWidth = sd.halfWidth * s;
        if (typeof sd.halfHeight === 'number') sd.halfHeight = sd.halfHeight * s;
      }
    }
  }
}

function scaleXY(p: Record<string, any> | undefined, s: number): void {
  if (!p || typeof p !== 'object') return;
  if (typeof p.x === 'number') p.x = p.x * s;
  if (typeof p.y === 'number') p.y = p.y * s;
}

function scaleHitBox(h: Record<string, any> | undefined, s: number): void {
  if (!h || typeof h !== 'object') return;
  if (typeof h.width === 'number') h.width = h.width * s;
  if (typeof h.height === 'number') h.height = h.height * s;
  if (typeof h.offsetX === 'number') h.offsetX = h.offsetX * s;
  if (typeof h.offsetY === 'number') h.offsetY = h.offsetY * s;
}

function scaleParticleTypes(particleTypes: Record<string, any> | undefined, s: number): void {
  if (!particleTypes || typeof particleTypes !== 'object') return;
  for (const p of Object.values(particleTypes)) {
    if (!p || typeof p !== 'object') continue;
    const dim = (p as any).dimensions;
    if (dim && typeof dim === 'object') {
      if (typeof dim.width === 'number') dim.width = dim.width * s;
      if (typeof dim.height === 'number') dim.height = dim.height * s;
    }
    scaleXY((p as any).emitZone, s);
    const speed = (p as any).speed;
    if (speed && typeof speed === 'object') {
      if (typeof speed.min === 'number') speed.min = speed.min * s;
      if (typeof speed.max === 'number') speed.max = speed.max * s;
    }
  }
}

/** The 3D editor writes camera zoom as a *string* in some exports — Braains3D's
 *  `settings.camera.zoom` is `{ type: 'static', default: '12.5' }`. A
 *  `typeof === 'number'` test silently skips those, leaving the zoom normalized
 *  while every other field around it got scaled, which puts the camera
 *  `originalTileWidth`× too far from the map. Accept anything numeric-looking
 *  and normalize it to a number on the way out. */
function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function scaleCameraZoom(settings: Record<string, any> | undefined, s: number): void {
  const cam = settings?.camera;
  if (!cam || typeof cam !== 'object') return;
  const flat = asNumber(cam.zoom);
  if (flat !== null) {
    cam.zoom = flat * s;
  } else if (cam.zoom && typeof cam.zoom === 'object') {
    const def = asNumber(cam.zoom.default);
    if (def !== null) cam.zoom.default = def * s;
  }
}

/**
 * Copy the legacy mirror's physical material settings onto the 3D body when the 3D
 * body does not specify them itself. Geometry is deliberately NOT copied — that is
 * exactly the part of the mirror that goes stale.
 */
function inheritMaterialProps(
  mirror: Record<string, any> | undefined,
  target: Record<string, any> | undefined,
): void {
  if (!mirror || !target) return;
  const unset = (v: unknown): boolean => {
    if (v === undefined || v === null) return true;
    // The 3D schema writes per-axis objects; all-zero means "not tuned here".
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every((n) => !Number(n));
    return !Number(v);
  };
  for (const key of ['linearDamping', 'angularDamping', 'friction', 'restitution', 'rotationSpeed']) {
    if (mirror[key] !== undefined && unset(target[key])) target[key] = mirror[key];
  }
}
