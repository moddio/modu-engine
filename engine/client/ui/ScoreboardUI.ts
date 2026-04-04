import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface ScoreEntry {
  playerId: string;
  name: string;
  score: number;
}

export class ScoreboardUI implements UIComponent {
  readonly name = 'scoreboard';
  readonly events = new EventEmitter();
  visible = false;
  entries: ScoreEntry[] = [];

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.events.emit('hide'); }

  update(entries: ScoreEntry[]): void {
    this.entries = entries.sort((a, b) => b.score - a.score);
    this.events.emit('updated', this.entries);
  }

  destroy(): void { this.visible = false; this.entries = []; }
}
