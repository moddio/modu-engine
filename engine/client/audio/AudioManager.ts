import { EventEmitter } from '../../core/events/EventEmitter';

export class AudioManager {
  readonly events = new EventEmitter();
  private _volume = 1;
  private _muted = false;

  get volume(): number { return this._volume; }
  set volume(v: number) { this._volume = Math.max(0, Math.min(1, v)); }

  get muted(): boolean { return this._muted; }
  set muted(v: boolean) { this._muted = v; }

  play(_soundId: string, _options?: { volume?: number; loop?: boolean }): void {
    // Will use Web Audio API
  }

  stop(_soundId: string): void {}

  stopAll(): void {}
}
