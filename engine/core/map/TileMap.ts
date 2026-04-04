import { Map2d } from './Map2d';
import { Vec2 } from '../math/Vec2';

export interface TileData {
  type: number;
  walkable: boolean;
}

export class TileMap {
  readonly grid: Map2d<TileData>;
  readonly tileWidth: number;
  readonly tileHeight: number;

  constructor(
    readonly mapWidth: number,
    readonly mapHeight: number,
    tileWidth: number = 64,
    tileHeight: number = 64,
  ) {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
    this.grid = new Map2d<TileData>(mapWidth, mapHeight, { type: 0, walkable: true });
  }

  worldToTile(worldPos: Vec2): Vec2 {
    return new Vec2(
      Math.floor(worldPos.x / this.tileWidth),
      Math.floor(worldPos.y / this.tileHeight),
    );
  }

  tileToWorld(tilePos: Vec2): Vec2 {
    return new Vec2(
      tilePos.x * this.tileWidth + this.tileWidth / 2,
      tilePos.y * this.tileHeight + this.tileHeight / 2,
    );
  }

  getTile(x: number, y: number): TileData | undefined {
    return this.grid.get(x, y);
  }

  setTile(x: number, y: number, data: TileData): void {
    this.grid.set(x, y, data);
  }

  isWalkable(x: number, y: number): boolean {
    const tile = this.grid.get(x, y);
    return tile?.walkable ?? false;
  }
}
