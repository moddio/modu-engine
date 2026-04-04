import { Vec2 } from '../math/Vec2';
import { TileMap } from './TileMap';

interface PathNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

export class Pathfinding {
  static findPath(map: TileMap, start: Vec2, end: Vec2): Vec2[] | null {
    const startTile = map.worldToTile(start);
    const endTile = map.worldToTile(end);

    if (
      !map.grid.isInBounds(startTile.x, startTile.y) ||
      !map.grid.isInBounds(endTile.x, endTile.y)
    )
      return null;
    if (!map.isWalkable(endTile.x, endTile.y)) return null;

    const open: PathNode[] = [];
    const closed = new Set<string>();
    const key = (x: number, y: number) => `${x},${y}`;

    const startNode: PathNode = {
      x: startTile.x,
      y: startTile.y,
      g: 0,
      h: heuristic(startTile.x, startTile.y, endTile.x, endTile.y),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.g + startNode.h;
    open.push(startNode);

    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];

    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift()!;

      if (current.x === endTile.x && current.y === endTile.y) {
        return reconstructPath(current, map);
      }

      closed.add(key(current.x, current.y));

      for (const [dx, dy] of dirs) {
        const nx = current.x + dx;
        const ny = current.y + dy;

        if (!map.grid.isInBounds(nx, ny)) continue;
        if (!map.isWalkable(nx, ny)) continue;
        if (closed.has(key(nx, ny))) continue;

        // Diagonal movement: check both adjacent tiles are walkable
        if (dx !== 0 && dy !== 0) {
          if (
            !map.isWalkable(current.x + dx, current.y) ||
            !map.isWalkable(current.x, current.y + dy)
          )
            continue;
        }

        const moveCost = dx !== 0 && dy !== 0 ? 1.414 : 1;
        const g = current.g + moveCost;
        const h = heuristic(nx, ny, endTile.x, endTile.y);

        const existing = open.find((n) => n.x === nx && n.y === ny);
        if (existing) {
          if (g < existing.g) {
            existing.g = g;
            existing.f = g + existing.h;
            existing.parent = current;
          }
        } else {
          open.push({ x: nx, y: ny, g, h, f: g + h, parent: current });
        }
      }
    }

    return null; // No path found
  }
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  // Octile distance
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (1.414 - 1) * Math.min(dx, dy);
}

function reconstructPath(node: PathNode, map: TileMap): Vec2[] {
  const path: Vec2[] = [];
  let current: PathNode | null = node;
  while (current) {
    path.unshift(map.tileToWorld(new Vec2(current.x, current.y)));
    current = current.parent;
  }
  return path;
}
