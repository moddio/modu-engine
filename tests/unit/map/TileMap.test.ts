import { describe, it, expect } from 'vitest';
import { TileMap } from '../../../engine/core/map/TileMap';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('TileMap', () => {
  it('creates with dimensions', () => {
    const tm = new TileMap(10, 10, 64, 64);
    expect(tm.mapWidth).toBe(10);
    expect(tm.mapHeight).toBe(10);
    expect(tm.tileWidth).toBe(64);
  });

  it('worldToTile converts coordinates', () => {
    const tm = new TileMap(10, 10, 64, 64);
    const tile = tm.worldToTile(new Vec2(100, 200));
    expect(tile.x).toBe(1); // 100/64 = 1.56 -> floor = 1
    expect(tile.y).toBe(3); // 200/64 = 3.125 -> floor = 3
  });

  it('tileToWorld returns tile center', () => {
    const tm = new TileMap(10, 10, 64, 64);
    const world = tm.tileToWorld(new Vec2(1, 3));
    expect(world.x).toBe(96);  // 1*64 + 32
    expect(world.y).toBe(224); // 3*64 + 32
  });

  it('all tiles default to walkable', () => {
    const tm = new TileMap(5, 5);
    expect(tm.isWalkable(0, 0)).toBe(true);
    expect(tm.isWalkable(4, 4)).toBe(true);
  });

  it('setTile and getTile', () => {
    const tm = new TileMap(5, 5);
    tm.setTile(1, 1, { type: 1, walkable: false });
    expect(tm.getTile(1, 1)?.type).toBe(1);
    expect(tm.isWalkable(1, 1)).toBe(false);
  });

  it('out of bounds is not walkable', () => {
    const tm = new TileMap(5, 5);
    expect(tm.isWalkable(-1, 0)).toBe(false);
    expect(tm.isWalkable(5, 0)).toBe(false);
  });
});
