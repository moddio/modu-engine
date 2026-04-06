import { describe, it, expect, beforeEach } from 'vitest';
import { EntityTypeRegistry } from '../../engine/core/game/EntityTypeRegistry';

describe('EntityTypeRegistry', () => {
  let registry: EntityTypeRegistry;

  const sampleData = {
    unitTypes: {
      soldier: { name: 'Soldier', hp: 100, speed: 5 },
      tank: { name: 'Tank', hp: 500, speed: 2 },
    },
    itemTypes: {
      sword: { name: 'Sword', damage: 25 },
    },
  };

  beforeEach(() => {
    registry = new EntityTypeRegistry();
  });

  it('load() stores types by category', () => {
    registry.load(sampleData);
    expect(registry.categoryCount).toBe(2);
    expect(registry.typeCount('unitTypes')).toBe(2);
    expect(registry.typeCount('itemTypes')).toBe(1);
  });

  it('get() retrieves by category and typeId', () => {
    registry.load(sampleData);
    const soldier = registry.get('unitTypes', 'soldier');
    expect(soldier).not.toBeNull();
    expect(soldier!.name).toBe('Soldier');
    expect(soldier!.hp).toBe(100);
  });

  it('clone() returns deep copy that does not affect original', () => {
    registry.load(sampleData);
    const cloned = registry.clone('unitTypes', 'soldier');
    expect(cloned).not.toBeNull();
    expect(cloned!.name).toBe('Soldier');

    // Modify clone
    cloned!.name = 'Modified';
    cloned!.hp = 999;

    // Original should be unchanged
    const original = registry.get('unitTypes', 'soldier');
    expect(original!.name).toBe('Soldier');
    expect(original!.hp).toBe(100);
  });

  it('getAll() returns all types in a category', () => {
    registry.load(sampleData);
    const units = registry.getAll('unitTypes');
    expect(units.size).toBe(2);
    expect(units.has('soldier')).toBe(true);
    expect(units.has('tank')).toBe(true);
  });

  it('returns null for missing types', () => {
    registry.load(sampleData);
    expect(registry.get('unitTypes', 'nonexistent')).toBeNull();
    expect(registry.get('missingCategory', 'soldier')).toBeNull();
    expect(registry.clone('unitTypes', 'nonexistent')).toBeNull();
  });

  it('getAll() returns empty map for missing category', () => {
    registry.load(sampleData);
    const missing = registry.getAll('nonexistent');
    expect(missing.size).toBe(0);
  });

  it('skips undefined categories during load', () => {
    registry.load({ unitTypes: undefined, itemTypes: { sword: { name: 'Sword' } } });
    expect(registry.categoryCount).toBe(1);
    expect(registry.get('unitTypes', 'anything')).toBeNull();
  });
});
