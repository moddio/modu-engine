import { Entity } from '../ecs/Entity';

export interface ItemStats {
  name: string;
  type: string;
  quantity: number;
  maxQuantity: number;
  cost: number;
  [key: string]: unknown;
}

const defaultItemStats: ItemStats = {
  name: '',
  type: '',
  quantity: 1,
  maxQuantity: 99,
  cost: 0,
};

export class Item extends Entity {
  stats: ItemStats;

  constructor(id?: string, stats?: Partial<ItemStats>) {
    super(id);
    this.category = 'item';
    this.stats = { ...defaultItemStats, ...stats };
  }

  get isEmpty(): boolean { return this.stats.quantity <= 0; }

  consume(amount: number = 1): void {
    this.stats.quantity = Math.max(0, this.stats.quantity - amount);
  }

  stack(amount: number): number {
    const canAdd = this.stats.maxQuantity - this.stats.quantity;
    const added = Math.min(amount, canAdd);
    this.stats.quantity += added;
    return added;
  }
}
