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

  /** Load variables from game data */
  loadVariables(variables: Record<string, { value: unknown; type: string }>): void {
    this.variables.loadGlobals(variables);
  }

  /** Fire a trigger — runs all matching scripts */
  trigger(name: string, context: TriggerContext = {}): void {
    const scriptIds = this.triggers.getScriptsForTrigger(name);
    for (const id of scriptIds) {
      this.runScript(id, { triggeredBy: context });
    }
  }

  /** Run a specific script by ID */
  runScript(scriptId: string, vars: ActionVars = {}): void {
    const script = this.triggers.getScript(scriptId);
    if (!script) return;
    this.actions.run(script.actions, vars);
  }

  get scriptCount(): number {
    return this.triggers.scriptCount;
  }

  reset(): void {
    this.variables.reset();
  }
}
