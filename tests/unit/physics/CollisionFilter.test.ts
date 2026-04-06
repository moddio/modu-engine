import { describe, it, expect } from 'vitest';
import {
  CollisionCategory,
  DefaultCollisionMask,
  categoryForEntityType,
} from '../../../engine/core/physics/CollisionFilter';

describe('CollisionFilter', () => {
  describe('categoryForEntityType', () => {
    it('returns correct bits for each type', () => {
      expect(categoryForEntityType('unit')).toBe(CollisionCategory.UNIT);
      expect(categoryForEntityType('item')).toBe(CollisionCategory.ITEM);
      expect(categoryForEntityType('projectile')).toBe(CollisionCategory.PROJECTILE);
      expect(categoryForEntityType('prop')).toBe(CollisionCategory.PROP);
      expect(categoryForEntityType('wall')).toBe(CollisionCategory.WALL);
      expect(categoryForEntityType('region')).toBe(CollisionCategory.REGION);
      expect(categoryForEntityType('sensor')).toBe(CollisionCategory.SENSOR);
    });

    it('defaults to UNIT for unknown types', () => {
      expect(categoryForEntityType('unknown')).toBe(CollisionCategory.UNIT);
      expect(categoryForEntityType('')).toBe(CollisionCategory.UNIT);
    });
  });

  describe('DefaultCollisionMask', () => {
    it('walls do not collide with walls', () => {
      const wallMask = DefaultCollisionMask[CollisionCategory.WALL];
      expect(wallMask & CollisionCategory.WALL).toBe(0);
    });

    it('walls collide with units', () => {
      const wallMask = DefaultCollisionMask[CollisionCategory.WALL];
      expect(wallMask & CollisionCategory.UNIT).not.toBe(0);
    });

    it('units collide with walls, units, props, items, projectiles', () => {
      const unitMask = DefaultCollisionMask[CollisionCategory.UNIT];
      expect(unitMask & CollisionCategory.WALL).not.toBe(0);
      expect(unitMask & CollisionCategory.UNIT).not.toBe(0);
      expect(unitMask & CollisionCategory.PROP).not.toBe(0);
      expect(unitMask & CollisionCategory.ITEM).not.toBe(0);
      expect(unitMask & CollisionCategory.PROJECTILE).not.toBe(0);
    });

    it('units do not collide with regions by default', () => {
      const unitMask = DefaultCollisionMask[CollisionCategory.UNIT];
      expect(unitMask & CollisionCategory.REGION).toBe(0);
    });

    it('regions collide only with units', () => {
      const regionMask = DefaultCollisionMask[CollisionCategory.REGION];
      expect(regionMask & CollisionCategory.UNIT).not.toBe(0);
      expect(regionMask & CollisionCategory.WALL).toBe(0);
      expect(regionMask & CollisionCategory.PROP).toBe(0);
    });

    it('sensors collide only with units', () => {
      const sensorMask = DefaultCollisionMask[CollisionCategory.SENSOR];
      expect(sensorMask & CollisionCategory.UNIT).not.toBe(0);
      expect(sensorMask & CollisionCategory.WALL).toBe(0);
    });

    it('items collide with walls and units only', () => {
      const itemMask = DefaultCollisionMask[CollisionCategory.ITEM];
      expect(itemMask & CollisionCategory.WALL).not.toBe(0);
      expect(itemMask & CollisionCategory.UNIT).not.toBe(0);
      expect(itemMask & CollisionCategory.PROP).toBe(0);
    });

    it('projectiles collide with walls, units, and props', () => {
      const projMask = DefaultCollisionMask[CollisionCategory.PROJECTILE];
      expect(projMask & CollisionCategory.WALL).not.toBe(0);
      expect(projMask & CollisionCategory.UNIT).not.toBe(0);
      expect(projMask & CollisionCategory.PROP).not.toBe(0);
      expect(projMask & CollisionCategory.ITEM).toBe(0);
    });
  });
});
