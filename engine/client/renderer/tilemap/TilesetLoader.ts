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
      tilesetIndex: this._tilesets.indexOf(ts),
    };
  }
}
