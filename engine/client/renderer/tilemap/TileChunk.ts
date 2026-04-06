export interface TileUV {
  u: number;
  v: number;
  uSize: number;
  vSize: number;
  tilesetIndex: number;
}

export interface ChunkGeometryData {
  positions: number[];
  uvs: number[];
  normals: number[];
  indices: number[];
}

/**
 * Build merged voxel geometry for a chunk of tiles.
 * Each non-empty tile becomes a 3D block with a top face and 4 side faces.
 * Matches taro Voxels.ts where each tile is a 1×1×1 unit cube.
 */
export function buildChunkGeometry(
  tiles: number[],
  width: number,
  height: number,
  tileW: number,
  tileH: number,
  getUV: (gid: number) => TileUV | null,
): ChunkGeometryData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const blockHeight = 1; // Each tile block is 1 unit tall

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gid = tiles[y * width + x];
      if (gid === 0) continue;

      const uv = getUV(gid);
      if (!uv) continue;

      const x0 = x * tileW;
      const z0 = y * tileH;
      const x1 = x0 + tileW;
      const z1 = z0 + tileH;
      const yTop = 0;
      const yBot = -blockHeight;

      // === TOP FACE (visible from above) ===
      positions.push(
        x0, yTop, z0,
        x1, yTop, z0,
        x1, yTop, z1,
        x0, yTop, z1,
      );
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      uvs.push(
        uv.u, uv.v + uv.vSize,
        uv.u + uv.uSize, uv.v + uv.vSize,
        uv.u + uv.uSize, uv.v,
        uv.u, uv.v,
      );
      let i = vertexCount;
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      vertexCount += 4;

      // === SIDE FACES (only add if on edge of chunk or adjacent tile is empty) ===
      // For simplicity, always add sides — the performance cost is minimal for small maps
      // In future, check neighbors to cull hidden faces

      // Front face (Z = z1, facing +Z)
      positions.push(x0, yTop, z1, x1, yTop, z1, x1, yBot, z1, x0, yBot, z1);
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      uvs.push(uv.u, uv.v + uv.vSize, uv.u + uv.uSize, uv.v + uv.vSize, uv.u + uv.uSize, uv.v, uv.u, uv.v);
      i = vertexCount;
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      vertexCount += 4;

      // Back face (Z = z0, facing -Z)
      positions.push(x1, yTop, z0, x0, yTop, z0, x0, yBot, z0, x1, yBot, z0);
      normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
      uvs.push(uv.u, uv.v + uv.vSize, uv.u + uv.uSize, uv.v + uv.vSize, uv.u + uv.uSize, uv.v, uv.u, uv.v);
      i = vertexCount;
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      vertexCount += 4;

      // Right face (X = x1, facing +X)
      positions.push(x1, yTop, z1, x1, yTop, z0, x1, yBot, z0, x1, yBot, z1);
      normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
      uvs.push(uv.u, uv.v + uv.vSize, uv.u + uv.uSize, uv.v + uv.vSize, uv.u + uv.uSize, uv.v, uv.u, uv.v);
      i = vertexCount;
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      vertexCount += 4;

      // Left face (X = x0, facing -X)
      positions.push(x0, yTop, z0, x0, yTop, z1, x0, yBot, z1, x0, yBot, z0);
      normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
      uvs.push(uv.u, uv.v + uv.vSize, uv.u + uv.uSize, uv.v + uv.vSize, uv.u + uv.uSize, uv.v, uv.u, uv.v);
      i = vertexCount;
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      vertexCount += 4;
    }
  }

  return { positions, uvs, normals, indices };
}
