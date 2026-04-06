import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export type NotificationType = 'info' | 'warning' | 'error' | 'success';

export interface GameNotification {
  id: string;
  text: string;
  type: NotificationType;
  duration: number;  // ms
  createdAt: number;
}

export class GameTextUI implements UIComponent {
  readonly name = 'gameText';
  readonly events = new EventEmitter();
  visible = true;
  private _notifications: GameNotification[] = [];
  private _nextId = 0;

  get notifications(): GameNotification[] { return this._notifications; }

  show(text: string, type: NotificationType = 'info', duration: number = 3000): string {
    const id = `notif_${++this._nextId}`;
    const notif: GameNotification = { id, text, type, duration, createdAt: Date.now() };
    this._notifications.push(notif);
    this.events.emit('notification', notif);
    return id;
  }

  remove(id: string): void {
    this._notifications = this._notifications.filter(n => n.id !== id);
  }

  /** Remove expired notifications */
  update(now: number): void {
    const before = this._notifications.length;
    this._notifications = this._notifications.filter(n => now - n.createdAt < n.duration);
    if (this._notifications.length !== before) {
      this.events.emit('updated', { notifications: this._notifications });
    }
  }

  // UIComponent interface — show(text) overrides, so provide explicit hide/destroy
  hide(): void { this.visible = false; }
  destroy(): void { this._notifications = []; }
}
