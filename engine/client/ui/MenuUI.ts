import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export class MenuUI implements UIComponent {
  readonly name = 'menu';
  readonly events = new EventEmitter();
  visible = false;

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.events.emit('hide'); }
  destroy(): void { this.visible = false; }
}
