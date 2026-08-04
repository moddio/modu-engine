import { Engine } from '../core/Engine';
import { GameLoader } from '../core/GameLoader';
import { EventEmitter } from '../core/events/EventEmitter';
import { DevMode } from '../../editor/DevMode';
import { Client } from './Client';
import { MapTabController } from './MapTabController';

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
  private _client: Client;
  private _gameLoader: GameLoader;
  private _devMode: DevMode;
  private _mapTabController: MapTabController;

  constructor(client: Client, gameLoader: GameLoader) {
    this._client = client;
    this._gameLoader = gameLoader;
    this._devMode = new DevMode();
    this._mapTabController = new MapTabController({
      devMode: this._devMode,
      camera: client.camera,
      entityManager: client.entityManager,
    });
  }

  expose(): void {
    if (typeof window === 'undefined') return;

    window.modu = {
      engine: this._client.engine,
      gameData: this._gameLoader.gameData as Record<string, unknown> | null,
      events: this._client.engine.events,
      editor: this._devMode,
      network: {
        send: (event: string, data: unknown) => {
          this._client.engine.events.emit(event, data);
        },
      },
    };
  }

  get devMode(): DevMode { return this._devMode; }

  dispose(): void {
    this._mapTabController.dispose();
  }
}
