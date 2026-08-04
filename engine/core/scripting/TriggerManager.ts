import type { ScriptDef } from '../GameLoader';

export interface TriggerContext {
  unitId?: string;
  playerId?: string;
  itemId?: string;
  projectileId?: string;
  regionId?: string;
  /** The triggering entity's type id (e.g. 'fighter') used to dispatch per-entity-type scripts */
  entityTypeId?: string;
  /** The category of the triggering entity's type — 'unitTypes' / 'itemTypes' / 'projectileTypes' */
  entityTypeCategory?: string;
  [key: string]: unknown;
}

/** ScriptDef extended with optional parent metadata (where in the data the script lives). */
export interface IndexedScriptDef extends ScriptDef {
  parent?: string;
  parentCategory?: string;
}

/** Normalize a triggers array — taro stores triggers as `{type: string}[]` while migrated
 *  top-level scripts arrive as `string[]`. Either form must work. */
function normalizeTriggers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (typeof t === 'string' ? t : t && typeof t === 'object' ? (t as { type?: string }).type ?? '' : ''))
    .filter(Boolean);
}

export class TriggerManager {
  /** Map from trigger type to array of script IDs */
  private _triggerMap = new Map<string, string[]>();
  private _scripts = new Map<string, IndexedScriptDef>();

  /** Load scripts and build trigger-to-script index */
  load(scripts: Record<string, ScriptDef>): void {
    this._triggerMap.clear();
    this._scripts.clear();
    this._indexBatch(scripts);
  }

  /** Add scripts attached to a specific entity-type (unitTypes/itemTypes/projectileTypes).
   *  Each registered script is tagged with its parent type id + category so
   *  ScriptEngine.trigger can filter dispatch to scripts whose parent matches the
   *  triggering entity's type. */
  loadEntityTypeScripts(category: string, types: Record<string, unknown> | undefined): void {
    if (!types) return;
    for (const [typeId, def] of Object.entries(types)) {
      const tdef = def as { scripts?: Record<string, ScriptDef> } | undefined;
      const entries = tdef?.scripts;
      if (!entries) continue;
      const tagged: Record<string, IndexedScriptDef> = {};
      for (const [sk, ss] of Object.entries(entries)) {
        // Per-type scripts arrive RAW from game data — the migrator only handles
        // top-level scripts. Normalize trigger shape and namespace the script ID
        // so different unit types can reuse the same per-type script key.
        const id = `${category}:${typeId}:${sk}`;
        tagged[id] = {
          ...ss,
          name: (ss as ScriptDef).name ?? sk,
          triggers: normalizeTriggers((ss as ScriptDef).triggers as unknown),
          actions: Array.isArray((ss as ScriptDef).actions) ? (ss as ScriptDef).actions : [],
          parent: typeId,
          parentCategory: category,
        };
      }
      this._indexBatch(tagged);
    }
  }

  private _indexBatch(scripts: Record<string, IndexedScriptDef | ScriptDef>): void {
    for (const [id, script] of Object.entries(scripts)) {
      const norm: IndexedScriptDef = {
        ...(script as IndexedScriptDef),
        triggers: normalizeTriggers((script as ScriptDef).triggers as unknown),
        actions: Array.isArray((script as ScriptDef).actions) ? (script as ScriptDef).actions : [],
      };
      this._scripts.set(id, norm);
      for (const trigger of norm.triggers) {
        const list = this._triggerMap.get(trigger) ?? [];
        list.push(id);
        this._triggerMap.set(trigger, list);
      }
    }
  }

  /** Get all script IDs that respond to a trigger */
  getScriptsForTrigger(triggerName: string): string[] {
    return this._triggerMap.get(triggerName) ?? [];
  }

  /** Get a script definition by ID */
  getScript(id: string): IndexedScriptDef | null {
    return this._scripts.get(id) ?? null;
  }

  get scriptCount(): number {
    return this._scripts.size;
  }

  get triggerCount(): number {
    return this._triggerMap.size;
  }
}
