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

  it('creates 4 vertices and 6 indices for a single tile', () => {
    const tiles = new Array(16 * 16).fill(0);
    tiles[0] = 1;
    const result = buildChunkGeometry(tiles, 16, 16, 1, 1, mockGetUV);
    expect(result.positions.length).toBe(4 * 3);
    expect(result.uvs.length).toBe(4 * 2);
    expect(result.indices.length).toBe(6);
  });

  it('creates geometry for multiple tiles', () => {
    const tiles = new Array(16 * 16).fill(0);
    tiles[0] = 1;
    tiles[1] = 2;
    tiles[16] = 3;
    const result = buildChunkGeometry(tiles, 16, 16, 1, 1, mockGetUV);
    expect(result.positions.length).toBe(3 * 4 * 3);
    expect(result.indices.length).toBe(3 * 6);
  });

  it('places tiles at correct world positions', () => {
    const tiles = [1, 0, 0, 0]; // 2x2 grid, only (0,0) filled
    const result = buildChunkGeometry(tiles, 2, 2, 2.0, 2.0, mockGetUV);
    // First vertex should be at (0, 0, 0)
    expect(result.positions[0]).toBe(0);  // x0
    expect(result.positions[1]).toBe(0);  // y (flat)
    expect(result.positions[2]).toBe(0);  // z0
    // Second vertex should be at (2, 0, 0)
    expect(result.positions[3]).toBe(2);  // x1
  });

  it('generates upward-facing normals', () => {
    const tiles = [1];
    const result = buildChunkGeometry(tiles, 1, 1, 1, 1, mockGetUV);
    // All normals should be (0, 1, 0)
    for (let i = 0; i < result.normals.length; i += 3) {
      expect(result.normals[i]).toBe(0);
      expect(result.normals[i + 1]).toBe(1);
      expect(result.normals[i + 2]).toBe(0);
    }
  });
});
