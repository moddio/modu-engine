import { describe, it, expect, beforeAll } from 'vitest';
import { TilesetLookup, isTileBlank } from '../../../engine/client/renderer/tilemap/TilesetLoader';

describe('TilesetLookup', () => {
  const tilesets = [
    { firstgid: 1, columns: 18, tilecount: 324, tilewidth: 16, tileheight: 16, imagewidth: 288, imageheight: 288, image: 'top.png', name: 'top' },
    { firstgid: 325, columns: 18, tilecount: 324, tilewidth: 16, tileheight: 16, imagewidth: 288, imageheight: 288, image: 'side.png', name: 'side' },
  ];

  let lookup: TilesetLookup;

  beforeAll(() => {
    lookup = new TilesetLookup(tilesets);
  });

  it('returns null for GID 0', () => {
    expect(lookup.findTileset(0)).toBeNull();
    expect(lookup.getUV(0)).toBeNull();
  });

  it('finds first tileset for GID 1', () => {
    expect(lookup.findTileset(1)?.name).toBe('top');
  });

  it('finds first tileset for GID 324', () => {
    expect(lookup.findTileset(324)?.name).toBe('top');
  });

  it('finds second tileset for GID 325', () => {
    expect(lookup.findTileset(325)?.name).toBe('side');
  });

  it('returns correct UV for GID 1 (first tile, top-left)', () => {
    const uv = lookup.getUV(1);
    expect(uv).not.toBeNull();
    expect(uv!.u).toBeCloseTo(0, 4);
    expect(uv!.v).toBeCloseTo(1 - 16/288, 4);
    expect(uv!.uSize).toBeCloseTo(16/288, 4);
    expect(uv!.vSize).toBeCloseTo(16/288, 4);
  });

  it('returns correct UV for GID 2 (second tile in row)', () => {
    const uv = lookup.getUV(2);
    expect(uv!.u).toBeCloseTo(16/288, 4);
  });

  it('returns correct UV for GID 19 (first tile in second row)', () => {
    const uv = lookup.getUV(19);
    expect(uv!.u).toBeCloseTo(0, 4);
    expect(uv!.v).toBeCloseTo(1 - 2 * 16/288, 4);
  });

  it('reports tileset count', () => {
    expect(lookup.tilesetCount).toBe(2);
  });

  it('accounts for spacing in UV calculation', () => {
    const spacedTileset = [
      { firstgid: 1, columns: 4, tilecount: 16, tilewidth: 16, tileheight: 16, imagewidth: 67, imageheight: 67, image: 'spaced.png', name: 'spaced', spacing: 1, margin: 0 },
    ];
    const spacedLookup = new TilesetLookup(spacedTileset);
    // Tile 2 (col=1): pixelX = 0 + 1*(16+1) = 17
    const uv = spacedLookup.getUV(2);
    expect(uv!.u).toBeCloseTo(17 / 67, 4);
  });

  it('accounts for margin in UV calculation', () => {
    const marginTileset = [
      { firstgid: 1, columns: 4, tilecount: 16, tilewidth: 16, tileheight: 16, imagewidth: 70, imageheight: 70, image: 'margin.png', name: 'margin', spacing: 0, margin: 3 },
    ];
    const marginLookup = new TilesetLookup(marginTileset);
    // Tile 1 (col=0): pixelX = 3 + 0*(16+0) = 3
    const uv = marginLookup.getUV(1);
    expect(uv!.u).toBeCloseTo(3 / 70, 4);
  });

  it('reports a half-texel inset for gutterless atlases', () => {
    const uv = lookup.getUV(1);
    // The rect itself stays the true tile bounds; the inset is advisory and applied
    // by geometry builders so no face samples its neighbour across a shared edge.
    expect(uv!.uInset).toBeCloseTo(0.5 / 288, 6);
    expect(uv!.vInset).toBeCloseTo(0.5 / 288, 6);
    expect(uv!.u).toBeCloseTo(0, 4);
    expect(uv!.uSize).toBeCloseTo(16 / 288, 4);
  });

  describe('isTileBlank', () => {
    const tile = (alpha: number[]) => alpha.flatMap((a) => [255, 0, 0, a]);

    it('treats a fully transparent tile as blank', () => {
      expect(isTileBlank(tile([0, 0, 0, 0]))).toBe(true);
    });

    it('treats a tile the alphaTest would keep as not blank', () => {
      expect(isTileBlank(tile([0, 0, 128, 0]))).toBe(false);
    });

    it('treats alpha entirely below the 0.5 cut-off as blank, matching alphaTest', () => {
      // These texels would all be discarded by `alphaTest: 0.5`, so the tile can
      // never draw anything and must not become geometry.
      expect(isTileBlank(tile([1, 60, 127, 12]))).toBe(true);
    });
  });
});
