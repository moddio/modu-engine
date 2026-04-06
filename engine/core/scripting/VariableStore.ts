export class VariableStore {
  private _global = new Map<string, { value: unknown; type: string }>();
  private _entity = new Map<string, Map<string, unknown>>(); // entityId -> vars
  private _player = new Map<string, Map<string, unknown>>(); // playerId -> vars

  // Global
  getGlobal(name: string): unknown {
    return this._global.get(name)?.value;
  }

  setGlobal(name: string, value: unknown, type?: string): void {
    this._global.set(name, { value, type: type ?? typeof value });
  }

  loadGlobals(variables: Record<string, { value: unknown; type: string }>): void {
    for (const [key, v] of Object.entries(variables)) {
      this._global.set(key, { ...v });
    }
  }

  // Entity
  getEntityVar(entityId: string, name: string): unknown {
    return this._entity.get(entityId)?.get(name);
  }

  setEntityVar(entityId: string, name: string, value: unknown): void {
    let vars = this._entity.get(entityId);
    if (!vars) {
      vars = new Map();
      this._entity.set(entityId, vars);
    }
    vars.set(name, value);
  }

  // Player
  getPlayerVar(playerId: string, name: string): unknown {
    return this._player.get(playerId)?.get(name);
  }

  setPlayerVar(playerId: string, name: string, value: unknown): void {
    let vars = this._player.get(playerId);
    if (!vars) {
      vars = new Map();
      this._player.set(playerId, vars);
    }
    vars.set(name, value);
  }

  removeEntity(entityId: string): void {
    this._entity.delete(entityId);
  }

  removePlayer(playerId: string): void {
    this._player.delete(playerId);
  }

  reset(): void {
    this._global.clear();
    this._entity.clear();
    this._player.clear();
  }
}
