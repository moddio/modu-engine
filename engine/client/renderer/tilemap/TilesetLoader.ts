export interface TilesetDef {
  firstgid: number;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  imagewidth: number;
  imageheight: number;
  image: string;
  name?: string;
  spacing?: number;
  margin?: number;
}

export interface TileUV {
  u: number;
  v: number;
  uSize: number;
  vSize: number;
  /** Half a texel in UV space. Tile atlases are routinely exported with no gutter
   *  between tiles (spacing = margin = 0), so a quad textured with the exact rect
   *  lets the sampler pick up the neighbouring tile along every shared edge — which
   *  reads as a thin wireframe grid over the whole tilemap. Geometry builders inset
   *  by this much on each side. `u`/`v`/`uSize`/`vSize` stay the true tile bounds. */
  uInset: number;
  vInset: number;
  tilesetIndex: number;
}

export class TilesetLookup {
  private _tilesets: TilesetDef[];

  constructor(tilesets: TilesetDef[]) {
    this._tilesets = [...tilesets].sort((a, b) => b.firstgid - a.firstgid);
  }

  get tilesetCount(): number { return this._tilesets.length; }

  findTileset(gid: number): TilesetDef | null {
    if (gid === 0) return null;
    for (const ts of this._tilesets) {
      if (gid >= ts.firstgid) return ts;
    }
    return null;
  }

  getUV(gid: number): TileUV | null {
    if (gid === 0) return null;
    const ts = this.findTileset(gid);
    if (!ts) return null;

    const localId = gid - ts.firstgid;
    const col = localId % ts.columns;
    const row = Math.floor(localId / ts.columns);

    const spacing = ts.spacing ?? 0;
    const margin = ts.margin ?? 0;

    // Pixel position of this tile in the atlas, accounting for margin and spacing
    const pixelX = margin + col * (ts.tilewidth + spacing);
    const pixelY = margin + row * (ts.tileheight + spacing);

    const u = pixelX / ts.imagewidth;
    const v = 1 - (pixelY + ts.tileheight) / ts.imageheight;
    const uSize = ts.tilewidth / ts.imagewidth;
    const vSize = ts.tileheight / ts.imageheight;

    return {
      u,
      v,
      uSize,
      vSize,
      uInset: 0.5 / ts.imagewidth,
      vInset: 0.5 / ts.imageheight,
      tilesetIndex: this._tilesets.indexOf(ts),
    };
  }
}

/**
 * Is every texel of this tile below the alpha cut-off?
 *
 * 128 matches the chunk material's `alphaTest: 0.5`: a tile the shader would discard
 * entirely can never contribute a pixel, so emitting voxel geometry for it is pure
 * cost — and pure risk, because the quads still rasterize and at grazing angles UV
 * interpolation can drift off the tile and sample a neighbouring one.
 */
export function isTileBlank(rgba: ArrayLike<number>, alphaCutoff = 128): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] >= alphaCutoff) return false;
  }
  return true;
}
