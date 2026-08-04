import { describe, it, expect } from 'vitest';
import { buildChunkGeometry } from '../../../engine/client/renderer/tilemap/TileChunk';

describe('buildChunkGeometry', () => {
  const mockGetUV = (gid: number) => gid === 0 ? null : { u: 0, v: 0, uSize: 0.5, vSize: 0.5, tilesetIndex: 0 };

  it('returns empty arrays for all-zero tile data', () => {
    const tiles = new Array(16 * 16).fill(0);
    const result = buildChunkGeometry(tiles, 16, 16, 1, 1, mockGetUV);
    expect(result.positions.length).toBe(0);
    expect(result.uvs.length).toBe(0);
    expect(result.indices.length).toBe(0);
  });

  it('creates 5 faces (top + 4 sides) for a single voxel tile', () => {
    const tiles = new Array(16 * 16).fill(0);
    tiles[0] = 1;
    const result = buildChunkGeometry(tiles, 16, 16, 1, 1, mockGetUV);
    // 5 faces × 4 vertices each
    expect(result.positions.length).toBe(5 * 4 * 3);
    expect(result.uvs.length).toBe(5 * 4 * 2);
    expect(result.indices.length).toBe(5 * 6);
  });

  it('creates geometry for multiple tiles', () => {
    const tiles = new Array(16 * 16).fill(0);
    tiles[0] = 1;
    tiles[1] = 2;
    tiles[16] = 3;
    const result = buildChunkGeometry(tiles, 16, 16, 1, 1, mockGetUV);
    expect(result.positions.length).toBe(3 * 5 * 4 * 3);
    expect(result.indices.length).toBe(3 * 5 * 6);
  });

  it('places tiles at correct world positions', () => {
    const tiles = [1, 0, 0, 0];
    const result = buildChunkGeometry(tiles, 2, 2, 2.0, 2.0, mockGetUV);
    expect(result.positions[0]).toBe(0);  // x0
    expect(result.positions[1]).toBe(0);  // yTop
    expect(result.positions[2]).toBe(0);  // z0
    expect(result.positions[3]).toBe(2);  // x1
  });

  it('top face has upward normals', () => {
    const tiles = [1];
    const result = buildChunkGeometry(tiles, 1, 1, 1, 1, mockGetUV);
    // First 4 vertices are the top face — normals should be (0, 1, 0)
    for (let i = 0; i < 4; i++) {
      expect(result.normals[i * 3]).toBe(0);
      expect(result.normals[i * 3 + 1]).toBe(1);
      expect(result.normals[i * 3 + 2]).toBe(0);
    }
  });

  it('insets emitted UVs by half a texel so tiles cannot sample their neighbour', () => {
    const inset = 0.5 / 288;
    const uv = { u: 0, v: 0, uSize: 16 / 288, vSize: 16 / 288, uInset: inset, vInset: inset, tilesetIndex: 0 };
    const geo = buildChunkGeometry([1], 1, 1, 1, 1, () => uv);
    const us = geo.uvs.filter((_, i) => i % 2 === 0);
    const vs = geo.uvs.filter((_, i) => i % 2 === 1);
    // Every emitted coordinate sits strictly inside the tile's true rect.
    expect(Math.min(...us)).toBeCloseTo(uv.u + inset, 6);
    expect(Math.max(...us)).toBeCloseTo(uv.u + uv.uSize - inset, 6);
    expect(Math.min(...vs)).toBeCloseTo(uv.v + inset, 6);
    expect(Math.max(...vs)).toBeCloseTo(uv.v + uv.vSize - inset, 6);
  });

  it('falls back to the exact rect when no inset is supplied', () => {
    const uv = { u: 0, v: 0, uSize: 0.25, vSize: 0.25, tilesetIndex: 0 };
    const geo = buildChunkGeometry([1], 1, 1, 1, 1, () => uv);
    const us = geo.uvs.filter((_, i) => i % 2 === 0);
    expect(Math.min(...us)).toBeCloseTo(0, 6);
    expect(Math.max(...us)).toBeCloseTo(0.25, 6);
  });
});
