import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface ChatMessage {
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

export class ChatUI implements UIComponent {
  readonly name = 'chat';
  readonly events = new EventEmitter();
  visible = false;
  private _messages: ChatMessage[] = [];
  readonly maxMessages: number;

  constructor(maxMessages: number = 100) {
    this.maxMessages = maxMessages;
  }

  get messages(): ChatMessage[] { return this._messages; }

  addMessage(msg: ChatMessage): void {
    this._messages.push(msg);
    if (this._messages.length > this.maxMessages) {
      this._messages.shift();
    }
    this.events.emit('message', msg);
  }

  clear(): void {
    this._messages = [];
    this.events.emit('cleared');
  }

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.events.emit('hide'); }
  destroy(): void { this.visible = false; this._messages = []; }
}
