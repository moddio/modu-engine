import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface ScoreEntry {
  playerId: string;
  name: string;
  score: number;
  isCurrentPlayer: boolean;
}

export class ScoreboardUI implements UIComponent {
  readonly name = 'scoreboard';
  readonly events = new EventEmitter();
  visible = false;
  private _entries: ScoreEntry[] = [];
  private _scoreAttribute = 'score';

  get entries(): ScoreEntry[] { return this._entries; }
  get scoreAttribute(): string { return this._scoreAttribute; }

  setScoreAttribute(attr: string): void {
    this._scoreAttribute = attr;
  }

  update(entries: ScoreEntry[]): void {
    this._entries = entries.sort((a, b) => b.score - a.score);
    this.events.emit('updated', { entries: this._entries });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.events.emit(this.visible ? 'show' : 'hide');
  }

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.events.emit('hide'); }
  destroy(): void { this.visible = false; this._entries = []; }
}
