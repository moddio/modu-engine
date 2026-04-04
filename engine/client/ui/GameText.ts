import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface TextNotification {
  id: string;
  text: string;
  duration: number;
  createdAt: number;
}

export class GameText implements UIComponent {
  readonly name = 'gameText';
  readonly events = new EventEmitter();
  visible = true;
  notifications: TextNotification[] = [];
  private _nextId = 0;

  show(): void { this.visible = true; }
  hide(): void { this.visible = false; }

  notify(text: string, duration: number = 3000): string {
    const id = `notif_${++this._nextId}`;
    const notif: TextNotification = { id, text, duration, createdAt: Date.now() };
    this.notifications.push(notif);
    this.events.emit('notify', notif);
    return id;
  }

  update(): void {
    const now = Date.now();
    const before = this.notifications.length;
    this.notifications = this.notifications.filter(n => now - n.createdAt < n.duration);
    if (this.notifications.length !== before) {
      this.events.emit('updated', this.notifications);
    }
  }

  clear(): void { this.notifications = []; }

  destroy(): void { this.clear(); }
}
