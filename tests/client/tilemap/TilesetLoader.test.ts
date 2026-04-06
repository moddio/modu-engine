import { describe, it, expect, beforeAll } from 'vitest';
import { TilesetLookup } from '../../../engine/client/renderer/tilemap/TilesetLoader';

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
});
