import { PhysicsWorld3d } from './PhysicsWorld3d';
import { Vec3 } from '../math/Vec3';
import { CollisionCategory, DefaultCollisionMask } from './CollisionFilter';
import type { RigidBody3d } from './RigidBody3d';

/**
 * Build static wall geometry from a map's stacked wall layers.
 *
 * The 2D version made one flat box per wall tile, because a flat world has nothing to
 * say about height. The map has always known it, though: the editor stacks `walls`,
 * `walls2`, `walls3`… over an identical footprint, one layer per storey, and braains3d's
 * four wall layers sit on the same 408 cells. So the number of layers a cell appears in
 * *is* its height in tiles.
 *
 * Each occupied column becomes a single cuboid rather than N stacked boxes. Overlapping
 * boxes would give a unit internal faces to snag on at every storey boundary, and cost
 * four times the broad-phase work for geometry that never moves.
 *
 * Y is up. `layers[i][z * mapWidth + x]` is a tile id, 0 meaning empty.
 */
export function createWallBodiesFromMap3d(
  physics: PhysicsWorld3d,
  layers: number[][],
  mapWidth: number,
  mapHeight: number,
  tileWidth: number,
  scaleRatio = 30,
): RigidBody3d[] {
  const bodies: RigidBody3d[] = [];
  const tile = tileWidth / scaleRatio;
  const half = tile / 2;

  for (let z = 0; z < mapHeight; z++) {
    for (let x = 0; x < mapWidth; x++) {
      const i = z * mapWidth + x;

      let levels = 0;
      for (const layer of layers) if (layer?.[i]) levels++;
      if (levels === 0) continue;

      const height = levels * tile;
      const body = physics.createBody({
        type: 'static',
        // Centre the column vertically so its base rests on the ground plane, y = 0.
        position: new Vec3(x * tile + half, height / 2, z * tile + half),
      });
      body.addCollider({
        shape: 'box',
        halfExtents: new Vec3(half, height / 2, half),
        friction: 0.1,
        restitution: 0,
        category: CollisionCategory.WALL,
        mask: DefaultCollisionMask[CollisionCategory.WALL],
      });
      bodies.push(body);
    }
  }

  return bodies;
}

/**
 * A static floor spanning the whole map, with its top face at y = 0.
 *
 * The 2D world needed no such thing: it had no gravity and no vertical axis, so nothing
 * could fall. The moment gravity is real, every entity drops out of the world unless
 * something holds it up — and a unit falling past a crate never collides with it, which
 * looks exactly like the collider being missing.
 *
 * One slab rather than a body per floor tile: the floor is flat and unbroken, and 1,995
 * tile-sized boxes would be 1,995 broad-phase entries plus a seam between every pair for
 * a capsule to catch on.
 */
export function createGroundBody(
  physics: PhysicsWorld3d,
  mapWidth: number,
  mapHeight: number,
  tileWidth: number,
  scaleRatio = 30,
  thickness = 1,
): RigidBody3d {
  const tile = tileWidth / scaleRatio;
  const w = (mapWidth * tile) / 2;
  const d = (mapHeight * tile) / 2;
  const body = physics.createBody({
    type: 'static',
    // Sunk by half its thickness so the top face lands exactly on y = 0.
    position: new Vec3(w, -thickness / 2, d),
  });
  body.addCollider({
    shape: 'box',
    halfExtents: new Vec3(w, thickness / 2, d),
    friction: 0.6,
    restitution: 0,
    category: CollisionCategory.WALL,
    mask: DefaultCollisionMask[CollisionCategory.WALL],
  });
  return body;
}
