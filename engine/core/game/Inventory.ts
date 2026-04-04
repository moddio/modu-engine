import { Component } from '../ecs/Component';
import { Item } from './Item';

export interface InventorySlot {
  item: Item | null;
}

export class Inventory extends Component {
  static readonly id = 'inventory';
  private _slots: InventorySlot[];

  constructor(capacity: number = 10) {
    super();
    this._slots = Array.from({ length: capacity }, () => ({ item: null }));
  }

  get capacity(): number { return this._slots.length; }

  get usedSlots(): number {
    return this._slots.filter(s => s.item !== null).length;
  }

  get isFull(): boolean { return this.usedSlots >= this.capacity; }

  getSlot(index: number): InventorySlot | null {
    return this._slots[index] ?? null;
  }

  add(item: Item): boolean {
    // Try to stack with existing same-type item
    for (const slot of this._slots) {
      if (slot.item && slot.item.stats.type === item.stats.type && slot.item.stats.quantity < slot.item.stats.maxQuantity) {
        const added = slot.item.stack(item.stats.quantity);
        item.stats.quantity -= added;
        if (item.isEmpty) return true;
      }
    }
    // Find empty slot
    for (const slot of this._slots) {
      if (!slot.item) {
        slot.item = item;
        return true;
      }
    }
    return false; // No space
  }

  remove(index: number): Item | null {
    const slot = this._slots[index];
    if (!slot || !slot.item) return null;
    const item = slot.item;
    slot.item = null;
    return item;
  }

  clear(): void {
    for (const slot of this._slots) slot.item = null;
  }

  findByType(type: string): Item | null {
    for (const slot of this._slots) {
      if (slot.item?.stats.type === type) return slot.item;
    }
    return null;
  }
}
