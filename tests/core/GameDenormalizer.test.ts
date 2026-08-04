import { describe, it, expect } from 'vitest';
import { denormalize3DGameData } from '../../engine/core/GameDenormalizer';

/**
 * The ingestion contract: a 3D export goes in, taro-shaped raw-pixel game data comes
 * out. Every case here is a bug that actually shipped — the failure mode is written
 * next to the assertion, because none of them look like a units bug at the point they
 * surface (they look like a giant player, a grey viewport, or a map of scenery stacked
 * in one corner).
 */

const baseMap = (extra: Record<string, unknown> = {}) => ({
  width: 65, height: 64, tilewidth: 16, tileheight: 16, layers: [], tilesets: [], ...extra,
});

/** A 3D export that went through the normalization pass — `originalTileWidth` present. */
const normalizedExport = () => ({
  map: baseMap({ originalTileWidth: 64 }),
  settings: {},
  unitTypes: {
    hero: {
      body: { type: 'dynamic', width: 0.625, height: 0.625, linearDamping: 3, fixtures: [] },
      bodies: { default: { type: 'dynamic', width: 0.434, height: 0.434, fixtures: [] } },
    },
  },
  itemTypes: {}, projectileTypes: {}, propTypes: {}, variables: {},
});

/** A 3D export that did NOT — `originalTileWidth` absent, legacy mirror is stale 2D. */
const unnormalizedExport = () => ({
  map: baseMap(),
  settings: {},
  unitTypes: {
    hero: {
      body: { type: 'dynamic', width: 40, height: 40, linearDamping: 3, friction: 0.5, fixtures: [] },
      bodies: {
        default: {
          type: 'dynamic', width: 1.809, height: 0.52,
          fixtures: [{ shape: { type: 'rectangle' }, density: 1 }],
        },
      },
    },
  },
  itemTypes: {}, projectileTypes: {},
  propTypes: {
    sofa: { bodies: { default: { type: 'dynamic', width: 3, height: 1.6, linearDamping: 1, fixtures: [] } } },
  },
  variables: {},
});

describe('GameDenormalizer / the originalTileWidth marker', () => {
  it('is what decides whether the legacy 2D body mirror gets scaled', () => {
    // `originalTileWidth` is the export's own record that the normalization pass ran
    // over *every* length, the legacy `body` mirror included. Present → the mirror is
    // normalized and must be scaled back up with everything else.
    const out = denormalize3DGameData(normalizedExport());
    expect(out.unitTypes.hero.body.width).toBeCloseTo(40, 5); // 0.625 × 64
  });

  it('leaves an unnormalized mirror alone instead of multiplying raw pixels again', () => {
    // Without the marker, only the fields the 3D editor authors (`bodies.*`) are in
    // tile units; the mirror still holds whatever taro's 2D editor last wrote, in raw
    // pixels. Scaling it turned 40px into 640px — and since the engine resolves
    // `typeDef.body` before `bodies.default`, the unit got a 20×20 TILE collider.
    const out = denormalize3DGameData(unnormalizedExport());
    expect(out.unitTypes.hero.body?.width ?? 40).toBeLessThan(100);
  });

  it('drops the stale mirror so the engine falls through to bodies.default', () => {
    // The mirror is taro's stock 40×40px = 2.5 tiles, against a 1.81×0.52 tile body the
    // 3D editor actually authored and the renderer actually draws. Sizing the collider
    // off the artifact left the unit stopping three quarters of a tile short of every
    // wall.
    const out = denormalize3DGameData(unnormalizedExport());
    expect(out.unitTypes.hero.body).toBeUndefined();
    expect(out.unitTypes.hero.bodies.default.width).toBeCloseTo(1.809 * 16, 4);
  });

  it('carries the mirror-only material properties across before dropping it', () => {
    // Damping, friction and restitution live on the legacy mirror in some exports and
    // nowhere else. Deleting it without inheriting them first is how props ended up
    // with no damping at all.
    const out = denormalize3DGameData(unnormalizedExport());
    expect(out.unitTypes.hero.bodies.default.linearDamping).toBe(3);
    expect(out.unitTypes.hero.bodies.default.friction).toBe(0.5);
  });
});

describe('GameDenormalizer / collections', () => {
  it('scales propTypes, not just units and items', () => {
    // propTypes carry `bodies.*` exactly like every other collection and are the bulk
    // of a 3D map (Braains3D: 38 types, 69 of 72 spawned entities). Omitting them left
    // prop bodies in tile units while unit bodies became pixels, so the renderer got
    // two collections in different spaces — furniture looked right and the player was
    // 16× too big, at the same time.
    const out = denormalize3DGameData(unnormalizedExport());
    expect(out.propTypes.sofa.bodies.default.width).toBeCloseTo(3 * 16, 4);
    expect(out.propTypes.sofa.bodies.default.height).toBeCloseTo(1.6 * 16, 4);
  });

  it('does not mutate its input', () => {
    const input = unnormalizedExport();
    const before = JSON.stringify(input);
    denormalize3DGameData(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns the data untouched when the scale is unusable', () => {
    const input: any = { map: baseMap({ tilewidth: 0, originalTileWidth: 0 }), unitTypes: {} };
    expect(denormalize3DGameData(input)).toBe(input);
  });
});

describe('GameDenormalizer / region variables', () => {
  const withRegion = (region: Record<string, number>) => ({
    map: baseMap(),
    settings: {},
    unitTypes: {}, itemTypes: {}, projectileTypes: {}, propTypes: {},
    variables: { spawn: { dataType: 'region', value: region } },
  });

  it('expands a fractional region to raw pixels inside the map', () => {
    // The 3D editor stores regions as fractions of the map (a 1-tile spawn area on a
    // 65×64 map is {x: 0.71875, y: 0.1875, width: 0.0156}). The engine's resolvers
    // divide by tilePx to get tiles, so an unscaled fraction collapses to a sub-tile
    // value at the origin and every script-spawned unit lands on the top-left tile.
    const out = denormalize3DGameData(withRegion({ x: 0.71875, y: 0.1875, width: 0.0156, height: 0.0156 }));
    const r = out.variables.spawn.value;
    expect(r.x).toBeGreaterThan(1);
    expect(r.x).toBeLessThan(65 * 16);
    expect(r.y).toBeLessThan(64 * 16);
  });

  it('treats a region that is already in tile units as tile units', () => {
    // The fraction rule only applies when *every* one of x/y/w/h is ≤ 1. A region like
    // {x: 30, y: 12, width: 4, height: 4} is plainly tiles, and scaling it by the map
    // dimensions would fling it far outside the world.
    const out = denormalize3DGameData(withRegion({ x: 30, y: 12, width: 4, height: 4 }));
    const r = out.variables.spawn.value;
    expect(r.x).toBeLessThanOrEqual(65 * 16);
    expect(r.y).toBeLessThanOrEqual(64 * 16);
    expect(r.width).toBeLessThanOrEqual(65 * 16);
  });
});

describe('GameDenormalizer / camera', () => {
  const withZoom = (zoom: unknown) => ({
    map: baseMap(),
    settings: { camera: { zoom } },
    unitTypes: {}, itemTypes: {}, projectileTypes: {}, propTypes: {}, variables: {},
  });

  it('denormalizes the camera zoom', () => {
    // A zoom left normalized put the camera 64× too far from the map — the entire
    // viewport rendered as flat grey with the world a speck in the distance.
    const out = denormalize3DGameData(withZoom(0.25));
    expect(out.settings.camera.zoom).toBeGreaterThan(1);
  });

  it('accepts a numeric string, which is how some exports store it', () => {
    const out = denormalize3DGameData(withZoom('0.25'));
    expect(Number(out.settings.camera.zoom)).toBeGreaterThan(1);
    expect(Number.isFinite(Number(out.settings.camera.zoom))).toBe(true);
  });

  it('scales the zoom unconditionally, unlike body dimensions', () => {
    // Body dimensions get an `alreadyPixels` plausibility check because exports without
    // `originalTileWidth` mix normalized and raw values. Camera zoom has no such
    // ambiguity — a 3D export always stores it normalized — so it is always scaled.
    // Documented here because the asymmetry looks like an oversight otherwise.
    const out = denormalize3DGameData(withZoom(800));
    expect(Number(out.settings.camera.zoom)).toBe(800 * 16);
  });

  it('handles the {default: n} object form as well as a flat number', () => {
    const out = denormalize3DGameData({
      map: baseMap(),
      settings: { camera: { zoom: { default: 0.25 } } },
      unitTypes: {}, itemTypes: {}, projectileTypes: {}, propTypes: {}, variables: {},
    });
    expect(Number(out.settings.camera.zoom.default)).toBeCloseTo(0.25 * 16, 5);
  });
});
