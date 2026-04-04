export type Mode = 'singleplayer' | 'multiplayer';

export class GameMode {
  private _mode: Mode;

  constructor(mode: Mode = 'singleplayer') {
    this._mode = mode;
  }

  get mode(): Mode { return this._mode; }

  get isSinglePlayer(): boolean { return this._mode === 'singleplayer'; }
  get isMultiplayer(): boolean { return this._mode === 'multiplayer'; }

  setMode(mode: Mode): void {
    this._mode = mode;
  }
}
