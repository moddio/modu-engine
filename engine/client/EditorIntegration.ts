import { Engine } from '../core/Engine';
import { GameLoader } from '../core/GameLoader';
import { EventEmitter } from '../core/events/EventEmitter';
import { DevMode } from '../../editor/DevMode';

declare global {
  interface Window {
    modu: ModuGlobal;
    inGameEditor?: Record<string, (...args: unknown[]) => void>;
  }
}

export interface ModuGlobal {
  engine: Engine;
  gameData: Record<string, unknown> | null;
  events: EventEmitter;
  editor: DevMode;
  network: { send: (event: string, data: unknown) => void };
}

export class EditorIntegration {
  private _engine: Engine;
  private _gameLoader: GameLoader;
  private _devMode: DevMode;

  constructor(engine: Engine, gameLoader: GameLoader) {
    this._engine = engine;
    this._gameLoader = gameLoader;
    this._devMode = new DevMode();
  }

  expose(): void {
    if (typeof window === 'undefined') return;

    window.modu = {
      engine: this._engine,
      gameData: this._gameLoader.gameData as Record<string, unknown> | null,
      events: this._engine.events,
      editor: this._devMode,
      network: {
        send: (event: string, data: unknown) => {
          this._engine.events.emit(event, data);
        },
      },
    };
  }

  get devMode(): DevMode { return this._devMode; }
}
