import { PhysicsWorld } from './PhysicsWorld';
import { Vec2 } from '../math/Vec2';
import { CollisionCategory, DefaultCollisionMask } from './CollisionFilter';
import { RigidBody } from './RigidBody';

/**
 * Create static physics bodies from a Tiled map's wall layer.
 * Scans for non-zero tiles and creates box colliders.
 */
export function createWallBodiesFromMap(
  physics: PhysicsWorld,
  layerData: number[],
  mapWidth: number,
  mapHeight: number,
  tileWidth: number,
  tileHeight: number,
  scaleRatio: number = 64,
): RigidBody[] {
  const bodies: RigidBody[] = [];
  const worldTileW = tileWidth / scaleRatio;
  const worldTileH = tileHeight / scaleRatio;

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const gid = layerData[y * mapWidth + x];
      if (gid === 0) continue;

      const worldX = x * worldTileW + worldTileW / 2;
      const worldY = y * worldTileH + worldTileH / 2;

      const body = physics.createBody({
        type: 'static',
        position: new Vec2(worldX, worldY),
      });

      body.addCollider({
        shape: 'box',
        width: worldTileW / 2,
        height: worldTileH / 2,
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
