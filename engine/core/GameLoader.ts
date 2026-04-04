import { Engine } from './Engine';
import { ScriptEngine } from './scripting/ScriptEngine';

export interface GameData {
  version: string;
  settings: Record<string, unknown>;
  map?: Record<string, unknown>;
  entities: {
    unitTypes?: Record<string, unknown>;
    itemTypes?: Record<string, unknown>;
    projectileTypes?: Record<string, unknown>;
    playerTypes?: Record<string, unknown>;
  };
  scripts: Record<string, { name: string; triggers?: string[]; code: string; interval?: number }>;
  variables: Record<string, { value: unknown; type: string }>;
  abilities?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  assets?: {
    images?: Array<{ key: string; url: string }>;
    sounds?: Array<{ key: string; url: string }>;
    tilesets?: Array<{ key: string; url: string; tileWidth?: number; tileHeight?: number }>;
  };
}

export class GameLoader {
  private _engine: Engine;
  private _scripts: ScriptEngine;
  private _gameData: GameData | null = null;

  constructor(engine?: Engine) {
    this._engine = engine ?? Engine.instance();
    this._scripts = new ScriptEngine(this._engine.events);
  }

  get gameData(): GameData | null { return this._gameData; }
  get scripts(): ScriptEngine { return this._scripts; }

  load(data: GameData): void {
    this._gameData = data;
    this._loadSettings(data.settings);
    this._loadScripts(data.scripts);
    this._loadVariables(data.variables);
  }

  loadFromJSON(json: string): void {
    const data = JSON.parse(json) as GameData;
    if (data.version !== '2.0') {
      throw new Error(`Unsupported game data version: ${data.version}. Run GameMigrator first.`);
    }
    this.load(data);
  }

  private _loadSettings(settings: Record<string, unknown>): void {
    if (typeof settings.frameRate === 'number') {
      this._engine.clock.tickRate = settings.frameRate;
    }
  }

  private _loadScripts(scripts: Record<string, { name: string; code: string; triggers?: string[]; interval?: number }>): void {
    for (const [key, script] of Object.entries(scripts)) {
      if (script.code) {
        this._scripts.load(key, script.code);
      }
    }
  }

  private _loadVariables(variables: Record<string, { value: unknown; type: string }>): void {
    for (const [key, variable] of Object.entries(variables)) {
      this._engine.events.emit('variableSet', [key, variable.value]);
    }
  }

  getEntityTypes(category: string): Record<string, unknown> {
    return (this._gameData?.entities as Record<string, Record<string, unknown>>)?.[category] ?? {};
  }

  getVariable(name: string): unknown {
    return this._gameData?.variables[name]?.value;
  }

  reset(): void {
    this._gameData = null;
    this._scripts.reset();
  }
}
