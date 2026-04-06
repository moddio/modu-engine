import type { ScriptDef } from '../GameLoader';

export interface TriggerContext {
  unitId?: string;
  playerId?: string;
  itemId?: string;
  projectileId?: string;
  regionId?: string;
  [key: string]: unknown;
}

export class TriggerManager {
  /** Map from trigger type to array of script IDs */
  private _triggerMap = new Map<string, string[]>();
  private _scripts = new Map<string, ScriptDef>();

  /** Load scripts and build trigger-to-script index */
  load(scripts: Record<string, ScriptDef>): void {
    this._triggerMap.clear();
    this._scripts.clear();

    for (const [id, script] of Object.entries(scripts)) {
      this._scripts.set(id, script);
      for (const trigger of script.triggers) {
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
  getScript(id: string): ScriptDef | null {
    return this._scripts.get(id) ?? null;
  }

  get scriptCount(): number {
    return this._scripts.size;
  }

  get triggerCount(): number {
    return this._triggerMap.size;
  }
}
