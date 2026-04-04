import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface ConsoleMessage {
  type: 'log' | 'warn' | 'error' | 'info';
  text: string;
  timestamp: number;
}

export class DevConsole implements UIComponent {
  readonly name = 'devConsole';
  readonly events = new EventEmitter();
  visible = false;
  messages: ConsoleMessage[] = [];
  private _maxMessages: number;

  constructor(maxMessages: number = 200) {
    this._maxMessages = maxMessages;
  }

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.events.emit('hide'); }

  log(text: string): void { this._add('log', text); }
  warn(text: string): void { this._add('warn', text); }
  error(text: string): void { this._add('error', text); }
  info(text: string): void { this._add('info', text); }

  clear(): void { this.messages = []; this.events.emit('clear'); }

  private _add(type: ConsoleMessage['type'], text: string): void {
    const msg: ConsoleMessage = { type, text, timestamp: Date.now() };
    this.messages.push(msg);
    if (this.messages.length > this._maxMessages) this.messages.shift();
    this.events.emit('message', msg);
  }

  destroy(): void { this.visible = false; this.messages = []; }
}
