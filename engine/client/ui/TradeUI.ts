import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export class TradeUI implements UIComponent {
  readonly name = 'trade';
  readonly events = new EventEmitter();
  visible = false;
  partnerId: string | null = null;

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.partnerId = null; this.events.emit('hide'); }

  startTrade(partnerId: string): void {
    this.partnerId = partnerId;
    this.show();
    this.events.emit('tradeStart', partnerId);
  }

  acceptTrade(): void { this.events.emit('tradeAccept'); }
  cancelTrade(): void { this.events.emit('tradeCancel'); this.hide(); }

  destroy(): void { this.hide(); }
}
