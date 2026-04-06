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

      positions.push(
        x0, 0, z0,
        x1, 0, z0,
        x1, 0, z1,
        x0, 0, z1,
      );

      normals.push(
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      );

      uvs.push(
        uv.u, uv.v + uv.vSize,
        uv.u + uv.uSize, uv.v + uv.vSize,
        uv.u + uv.uSize, uv.v,
        uv.u, uv.v,
      );

      const i = vertexCount;
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      vertexCount += 4;
    }
  }

  return { positions, uvs, normals, indices };
}
