import { Engine } from './Engine';

export interface GameData {
  version: string;
  settings: Record<string, unknown>;
  map?: Record<string, unknown>;
  entities: {
    unitTypes?: Record<string, unknown>;
    itemTypes?: Record<string, unknown>;
    projectileTypes?: Record<string, unknown>;
    playerTypes?: Record<string, unknown>;
    propTypes?: Record<string, unknown>;
  };
  scripts: Record<string, ScriptDef>;
  variables: Record<string, { value: unknown; type: string }>;
  abilities?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  assets?: {
    images?: Array<{ key: string; url: string }>;
    sounds?: Array<{ key: string; url: string }>;
    tilesets?: Array<{ key: string; url: string; tileWidth?: number; tileHeight?: number }>;
  };
}

export interface ScriptDef {
  name: string;
  triggers: string[];
  actions: Array<Record<string, unknown>>;
}

export class GameLoader {
  private _engine: Engine;
  private _gameData: GameData | null = null;
  private _variables = new Map<string, { value: unknown; type: string }>();
  private _scripts: Record<string, ScriptDef> = {};
  private _cameraSettings: Record<string, unknown> | null = null;
  private _mapBackgroundColor: string | null = null;

  constructor(engine?: Engine) {
    this._engine = engine ?? Engine.instance();
  }

  get gameData(): GameData | null { return this._gameData; }
  get cameraSettings(): Record<string, unknown> | null { return this._cameraSettings; }
  get mapBackgroundColor(): string | null { return this._mapBackgroundColor; }
  get mapData(): Record<string, unknown> | null { return (this._gameData?.map as Record<string, unknown>) ?? null; }
  get assets(): GameData['assets'] | null { return this._gameData?.assets ?? null; }

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

  getScripts(): Record<string, ScriptDef> {
    return this._scripts;
  }

  getEntityTypes(category: string): Record<string, unknown> {
    return (this._gameData?.entities as Record<string, Record<string, unknown>>)?.[category] ?? {};
  }

  getVariable(name: string): unknown {
    return this._variables.get(name)?.value;
  }

  setVariable(name: string, value: unknown): void {
    const entry = this._variables.get(name);
    if (entry) {
      entry.value = value;
    } else {
      this._variables.set(name, { value, type: typeof value });
    }
    this._engine.events.emit('variableSet', [name, value]);
  }

  private _loadSettings(settings: Record<string, unknown>): void {
    if (typeof settings.frameRate === 'number') {
      this._engine.clock.tickRate = settings.frameRate;
    }
    if (settings.camera && typeof settings.camera === 'object') {
      this._cameraSettings = settings.camera as Record<string, unknown>;
    }
    if (typeof settings.mapBackgroundColor === 'string') {
      this._mapBackgroundColor = settings.mapBackgroundColor;
    }
  }

  private _loadScripts(scripts: Record<string, ScriptDef>): void {
    this._scripts = {};
    for (const [key, script] of Object.entries(scripts)) {
      this._scripts[key] = {
        name: script.name ?? key,
        triggers: Array.isArray(script.triggers) ? script.triggers : [],
        actions: Array.isArray(script.actions) ? script.actions : [],
      };
    }
  }

  private _loadVariables(variables: Record<string, { value: unknown; type: string }>): void {
    for (const [key, variable] of Object.entries(variables)) {
      this._variables.set(key, { ...variable });
      this._engine.events.emit('variableSet', [key, variable.value]);
    }
  }

  reset(): void {
    this._gameData = null;
    this._scripts = {};
    this._variables.clear();
    this._cameraSettings = null;
    this._mapBackgroundColor = null;
  }
}
