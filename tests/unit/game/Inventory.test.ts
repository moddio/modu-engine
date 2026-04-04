import { describe, it, expect } from 'vitest';
import { Inventory } from '../../../engine/core/game/Inventory';
import { Item } from '../../../engine/core/game/Item';

describe('Inventory', () => {
  it('creates with capacity', () => {
    const inv = new Inventory(5);
    expect(inv.capacity).toBe(5);
    expect(inv.usedSlots).toBe(0);
    expect(inv.isFull).toBe(false);
  });

  it('add item to empty slot', () => {
    const inv = new Inventory(5);
    const item = new Item(undefined, { name: 'sword', type: 'weapon' });
    expect(inv.add(item)).toBe(true);
    expect(inv.usedSlots).toBe(1);
  });

  it('rejects when full', () => {
    const inv = new Inventory(1);
    inv.add(new Item(undefined, { type: 'a' }));
    expect(inv.add(new Item(undefined, { type: 'b' }))).toBe(false);
    expect(inv.isFull).toBe(true);
  });

  it('stacks same type items', () => {
    const inv = new Inventory(5);
    inv.add(new Item(undefined, { type: 'arrow', quantity: 10 }));
    inv.add(new Item(undefined, { type: 'arrow', quantity: 5 }));
    expect(inv.usedSlots).toBe(1);
    expect(inv.getSlot(0)?.item?.stats.quantity).toBe(15);
  });

  it('remove returns item', () => {
    const inv = new Inventory(5);
    const item = new Item(undefined, { type: 'sword' });
    inv.add(item);
    const removed = inv.remove(0);
    expect(removed).toBe(item);
    expect(inv.usedSlots).toBe(0);
  });

  it('remove returns null for empty slot', () => {
    const inv = new Inventory(5);
    expect(inv.remove(0)).toBeNull();
  });

  it('findByType', () => {
    const inv = new Inventory(5);
    inv.add(new Item(undefined, { type: 'sword', name: 'Excalibur' }));
    inv.add(new Item(undefined, { type: 'potion', name: 'Health' }));
    expect(inv.findByType('potion')?.stats.name).toBe('Health');
    expect(inv.findByType('shield')).toBeNull();
  });

  it('clear empties all slots', () => {
    const inv = new Inventory(5);
    inv.add(new Item(undefined, { type: 'a' }));
    inv.add(new Item(undefined, { type: 'b' }));
    inv.clear();
    expect(inv.usedSlots).toBe(0);
  });
});
