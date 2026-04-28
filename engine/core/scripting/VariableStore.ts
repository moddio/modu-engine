interface VarEntry { value: unknown; type: string }

export class VariableStore {
  private _global = new Map<string, VarEntry>();
  private _entity = new Map<string, Map<string, VarEntry>>(); // entityId -> name -> {value,type}
  private _player = new Map<string, Map<string, VarEntry>>(); // playerId -> name -> {value,type}

  // Global
  getGlobal(name: string): unknown {
    return this._global.get(name)?.value;
  }

  /** Iterate global variable entries, optionally filtered by stored type tag. */
  *globalEntries(filterType?: string): IterableIterator<[string, unknown, string]> {
    for (const [name, entry] of this._global) {
      if (filterType && entry.type !== filterType) continue;
      yield [name, entry.value, entry.type];
    }
  }

  setGlobal(name: string, value: unknown, type?: string): void {
    // Preserve declared dataType (e.g. 'region', 'unit', 'itemTypeGroup') across mutations
    // when the caller doesn't override — taro behaviour: dataType is set once on declaration.
    const existing = this._global.get(name);
    this._global.set(name, { value, type: type ?? existing?.type ?? typeof value });
  }

  loadGlobals(variables: Record<string, { value: unknown; type: string }>): void {
    for (const [key, v] of Object.entries(variables)) {
      this._global.set(key, { ...v });
    }
  }

  // Entity
  getEntityVar(entityId: string, name: string): unknown {
    return this._entity.get(entityId)?.get(name)?.value;
  }

  /** Iterate one entity's vars. Yields [name, value, type]. */
  *entityEntries(entityId: string, filterType?: string): IterableIterator<[string, unknown, string]> {
    const vars = this._entity.get(entityId);
    if (!vars) return;
    for (const [name, entry] of vars) {
      if (filterType && entry.type !== filterType) continue;
      yield [name, entry.value, entry.type];
    }
  }

  setEntityVar(entityId: string, name: string, value: unknown, type?: string): void {
    let vars = this._entity.get(entityId);
    if (!vars) {
      vars = new Map();
      this._entity.set(entityId, vars);
    }
    const existing = vars.get(name);
    vars.set(name, { value, type: type ?? existing?.type ?? typeof value });
  }

  // Player
  getPlayerVar(playerId: string, name: string): unknown {
    return this._player.get(playerId)?.get(name)?.value;
  }

  *playerEntries(playerId: string, filterType?: string): IterableIterator<[string, unknown, string]> {
    const vars = this._player.get(playerId);
    if (!vars) return;
    for (const [name, entry] of vars) {
      if (filterType && entry.type !== filterType) continue;
      yield [name, entry.value, entry.type];
    }
  }

  setPlayerVar(playerId: string, name: string, value: unknown, type?: string): void {
    let vars = this._player.get(playerId);
    if (!vars) {
      vars = new Map();
      this._player.set(playerId, vars);
    }
    const existing = vars.get(name);
    vars.set(name, { value, type: type ?? existing?.type ?? typeof value });
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
