import { Engine } from '../Engine';
import { TriggerManager, TriggerContext } from './TriggerManager';
import { ActionRunner, ActionVars } from './ActionRunner';
import { VariableStore } from './VariableStore';
import type { ScriptDef } from '../GameLoader';

export class ScriptEngine {
  readonly triggers: TriggerManager;
  readonly actions: ActionRunner;
  readonly variables: VariableStore;
  private _engine: Engine;

  constructor(engine?: Engine) {
    this._engine = engine ?? Engine.instance();
    this.variables = new VariableStore();
    this.triggers = new TriggerManager();
    this.actions = new ActionRunner(this._engine, this.variables);
  }

  /** Load scripts from game data */
  load(scripts: Record<string, ScriptDef>): void {
    this.triggers.load(scripts);
  }

  /** Load scripts attached to entity-type definitions. Only scripts whose
   *  parent matches the triggering entity's type id will run when the trigger fires. */
  loadEntityTypeScripts(category: string, types: Record<string, unknown> | undefined): void {
    this.triggers.loadEntityTypeScripts(category, types);
  }

  /** Load variables from game data */
  loadVariables(variables: Record<string, { value: unknown; type: string }>): void {
    this.variables.loadGlobals(variables);
  }

  /** Fire a trigger — runs all matching scripts.
   *
   *  If the triggering entity has a type id (`context.entityTypeId`), only scripts
   *  whose `parent` matches that type id (or top-level scripts with no parent)
   *  will run. This is how taro per-unit-type scripts dispatch correctly:
   *  `entityTouchesWall` for a fighter doesn't run the wall handler attached
   *  to a goblin.
   *
   *  If the triggering entity's type isn't supplied, the engine resolves it
   *  automatically from `context.unitId` / `itemId` / `projectileId`.
   */
  trigger(name: string, context: TriggerContext = {}): void {
    // ActionRunner subscribes to a few trigger names on engine.events to maintain
    // bookkeeping (e.g. tracking the last-created entity for getLastCreatedUnit/Item/
    // Projectile). Mirror every trigger fire there so listeners run regardless of
    // whether any user script is bound to the same name. Without this mirror, calls
    // like spawnUnit (which only call this.trigger('entityCreatedGlobal', ...))
    // never reached the bookkeeping listener and getLastCreatedUnit stayed null.
    this._engine.events.emit(name, context);

    const scriptIds = this.triggers.getScriptsForTrigger(name);
    if (scriptIds.length === 0) return;

    // Auto-resolve entity type from triggering entity id if not pre-populated.
    let typeId = context.entityTypeId;
    let typeCategory = context.entityTypeCategory;
    if (!typeId) {
      const entityId = (context.unitId ?? context.itemId ?? context.projectileId) as string | undefined;
      if (entityId) {
        const ent = this._engine.findById(entityId);
        const stats = (ent as any)?.stats;
        if (stats?.type) {
          typeId = stats.type as string;
          // Infer category from the entity's category attribute set by Unit/Item/Projectile classes.
          const cat = (ent as any).category as string | undefined;
          if (cat === 'unit') typeCategory = 'unitTypes';
          else if (cat === 'item') typeCategory = 'itemTypes';
          else if (cat === 'projectile') typeCategory = 'projectileTypes';
        }
      }
    }

    for (const id of scriptIds) {
      const script = this.triggers.getScript(id);
      if (!script) continue;

      // Top-level scripts (no parent) — run unconditionally.
      if (!script.parent) {
        this.runScript(id, { triggeredBy: { ...context, entityTypeId: typeId, entityTypeCategory: typeCategory } });
        continue;
      }

      // Per-type script. When the trigger carries a specific entity (e.g. `entityTouchesWall`
      // for unit u1), only run the script if that entity's type matches the script's parent.
      if (typeId) {
        if (script.parent !== typeId) continue;
        if (script.parentCategory && typeCategory && script.parentCategory !== typeCategory) continue;
        // Sensor-style triggers (`unitEntersSensor`, `itemEntersSensor`) need to disambiguate
        // "this entity" (the sensor owner — script.parent matches its type) from the entering
        // unit/item (which goes into `getTriggeringUnit`/`getTriggeringItem`). The emitter
        // passes `thisEntity` in the context; surface it on vars so the ActionRunner's
        // `thisEntity` resolver returns the sensor owner directly instead of falling back
        // to `tb.unitId` (which holds the entering unit's id).
        const vars: ActionVars = {
          triggeredBy: { ...context, entityTypeId: typeId, entityTypeCategory: typeCategory },
        };
        if (typeof context.thisEntity === 'string') vars.thisEntity = context.thisEntity;
        this.runScript(id, vars);
        continue;
      }

      // Context-less global triggers (e.g. `secondTick` / `frameTick`) must fan out across
      // every live entity of the script's parent type so per-unit logic (`thisEntity`) runs
      // once per unit. In taro this is implicit because per-entity scripts run during the
      // entity's own tick; modu has a single global ScriptEngine, so we iterate here.
      const cat = script.parentCategory;
      const entityCategory = cat === 'unitTypes' ? 'unit'
        : cat === 'itemTypes' ? 'item'
        : cat === 'projectileTypes' ? 'projectile'
        : null;
      if (!entityCategory) continue;

      // Snapshot to a list — the script body may spawn/destroy entities mid-iteration.
      const candidates = this._engine.root.children.filter(
        (e) => e.category === entityCategory && (e as any).stats?.type === script.parent,
      );
      for (const ent of candidates) {
        const idKey = entityCategory === 'unit' ? 'unitId'
          : entityCategory === 'item' ? 'itemId'
          : 'projectileId';
        this.runScript(id, {
          triggeredBy: {
            ...context,
            [idKey]: ent.id,
            entityId: ent.id,
            entityTypeId: script.parent,
            entityTypeCategory: cat,
          },
          thisEntity: ent.id,
        });
      }
    }
  }

  /** Run a specific script by ID */
  runScript(scriptId: string, vars: ActionVars = {}): void {
    const script = this.triggers.getScript(scriptId);
    if (!script) return;
    try {
      this.actions.run(script.actions, vars);
    } catch (err) {
      console.error('[runScript] threw', { scriptId, error: err });
      throw err;
    }
  }

  get scriptCount(): number {
    return this.triggers.scriptCount;
  }

  reset(): void {
    this.variables.reset();
  }
}
