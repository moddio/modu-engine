/** Collision category bits matching taro engine */
export const CollisionCategory = {
  WALL:       0x0001,
  UNIT:       0x0002,
  PROP:       0x0004,
  ITEM:       0x0008,
  PROJECTILE: 0x0010,
  REGION:     0x0020,
  SENSOR:     0x0040,
} as const;

/** Default collision masks — what each category collides with */
export const DefaultCollisionMask: Record<number, number> = {
  [CollisionCategory.WALL]:       0xFFFE, // Everything except walls
  [CollisionCategory.UNIT]:       0x001F, // Walls, units, props, items, projectiles
  [CollisionCategory.PROP]:       0x001F, // Walls, units, props, items, projectiles
  [CollisionCategory.ITEM]:       0x0003, // Walls, units
  [CollisionCategory.PROJECTILE]: 0x0007, // Walls, units, props
  [CollisionCategory.REGION]:     0x0002, // Units only
  [CollisionCategory.SENSOR]:     0x0002, // Units only
};

export function categoryForEntityType(type: string): number {
  switch (type) {
    case 'unit': return CollisionCategory.UNIT;
    case 'item': return CollisionCategory.ITEM;
    case 'projectile': return CollisionCategory.PROJECTILE;
    case 'prop': return CollisionCategory.PROP;
    case 'wall': return CollisionCategory.WALL;
    case 'region': return CollisionCategory.REGION;
    case 'sensor': return CollisionCategory.SENSOR;
    default: return CollisionCategory.UNIT;
  }
}
