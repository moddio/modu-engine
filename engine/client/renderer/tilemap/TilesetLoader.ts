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

    const uSize = ts.tilewidth / ts.imagewidth;
    const vSize = ts.tileheight / ts.imageheight;

    return {
      u: col * uSize,
      v: 1 - (row + 1) * vSize,
      uSize,
      vSize,
      tilesetIndex: this._tilesets.indexOf(ts),
    };
  }
}
