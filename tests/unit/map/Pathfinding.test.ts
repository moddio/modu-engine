import { describe, it, expect } from 'vitest';
import { Pathfinding } from '../../../engine/core/map/Pathfinding';
import { TileMap } from '../../../engine/core/map/TileMap';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Pathfinding', () => {
  function createMap(): TileMap {
    return new TileMap(10, 10, 64, 64);
  }

  it('finds straight path', () => {
    const map = createMap();
    const path = Pathfinding.findPath(map, new Vec2(32, 32), new Vec2(32 + 64 * 3, 32));
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });

  it('returns null when no path exists', () => {
    const map = createMap();
    // Wall off the destination
    for (let x = 0; x < 10; x++) map.setTile(x, 5, { type: 1, walkable: false });
    const path = Pathfinding.findPath(map, new Vec2(32, 32), new Vec2(32, 32 + 64 * 8));
    expect(path).toBeNull();
  });

  it('returns null for unwalkable destination', () => {
    const map = createMap();
    map.setTile(5, 5, { type: 1, walkable: false });
    const path = Pathfinding.findPath(map, new Vec2(32, 32), new Vec2(5 * 64 + 32, 5 * 64 + 32));
    expect(path).toBeNull();
  });

  it('navigates around obstacles', () => {
    const map = createMap();
    // Create a wall with a gap
    for (let y = 0; y < 9; y++) map.setTile(5, y, { type: 1, walkable: false });
    // Gap at y=9
    const path = Pathfinding.findPath(map, new Vec2(32, 32), new Vec2(9 * 64 + 32, 32));
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(3); // Must go around
  });

  it('path starts near start and ends near destination', () => {
    const map = createMap();
    const path = Pathfinding.findPath(map, new Vec2(32, 32), new Vec2(5 * 64 + 32, 5 * 64 + 32));
    expect(path).not.toBeNull();
    const first = path![0];
    const last = path![path!.length - 1];
    expect(first.x).toBeCloseTo(32, -1);
    expect(first.y).toBeCloseTo(32, -1);
    expect(last.x).toBeCloseTo(5 * 64 + 32, -1);
    expect(last.y).toBeCloseTo(5 * 64 + 32, -1);
  });

  it('returns null for out of bounds', () => {
    const map = createMap();
    expect(Pathfinding.findPath(map, new Vec2(-100, -100), new Vec2(32, 32))).toBeNull();
  });
});
