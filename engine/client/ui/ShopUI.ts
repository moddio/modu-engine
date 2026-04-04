import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface ShopItem {
  id: string;
  name: string;
  cost: number;
  description?: string;
}

export class ShopUI implements UIComponent {
  readonly name = 'shop';
  readonly events = new EventEmitter();
  visible = false;
  items: ShopItem[] = [];

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.events.emit('hide'); }

  setItems(items: ShopItem[]): void {
    this.items = items;
    this.events.emit('itemsChanged', items);
  }

  purchase(itemId: string): void {
    const item = this.items.find(i => i.id === itemId);
    if (item) this.events.emit('purchase', item);
  }

  destroy(): void { this.visible = false; this.items = []; }
}
