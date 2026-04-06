import { Engine } from '../Engine';
import { ConditionEvaluator } from './ConditionEvaluator';
import { VariableStore } from './VariableStore';

export type ActionVars = Record<string, unknown>;

export class ActionRunner {
  private _engine: Engine;
  private _conditions: ConditionEvaluator;
  private _variables: VariableStore;

  constructor(engine: Engine, variables: VariableStore) {
    this._engine = engine;
    this._conditions = new ConditionEvaluator();
    this._variables = variables;
  }

  /** Execute a list of actions. Returns 'break', 'return', 'continue', or undefined. */
  run(actions: Array<Record<string, unknown>>, vars: ActionVars = {}): string | undefined {
    for (const action of actions) {
      if (action.disabled) continue;

      const result = this._executeAction(action, vars);
      if (result === 'break' || result === 'return' || result === 'continue') {
        return result;
      }
    }
    return undefined;
  }

  private _executeAction(
    action: Record<string, unknown>,
    vars: ActionVars,
  ): string | undefined {
    const type = action.type as string;

    switch (type) {
      // --- Control flow ---
      case 'condition': {
        const cond = this._conditions.evaluate(action.conditions, (v) =>
          this._resolveValue(v, vars),
        );
        if (cond) {
          return this.run((action.then as any[]) ?? [], vars);
        } else {
          return this.run((action.else as any[]) ?? [], vars);
        }
      }

      case 'repeat': {
        const count = Number(this._resolveValue(action.count, vars)) || 0;
        for (let i = 0; i < count; i++) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, i });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'break':
        return 'break';
      case 'continue':
        return 'continue';
      case 'return':
        return 'return';

      case 'comment':
        return undefined; // No-op

      // --- Variables ---
      case 'setVariable': {
        const name = action.variableName as string;
        const value = this._resolveValue(action.value, vars);
        this._variables.setGlobal(name, value);
        return undefined;
      }

      case 'increaseVariableByNumber': {
        const name = action.variableName as string;
        const current = Number(this._variables.getGlobal(name)) || 0;
        const delta = Number(this._resolveValue(action.number, vars)) || 0;
        this._variables.setGlobal(name, current + delta);
        return undefined;
      }

      case 'decreaseVariableByNumber': {
        const name = action.variableName as string;
        const current = Number(this._variables.getGlobal(name)) || 0;
        const delta = Number(this._resolveValue(action.number, vars)) || 0;
        this._variables.setGlobal(name, current - delta);
        return undefined;
      }

      case 'setEntityVariable': {
        const entityId = this._resolveValue(action.entity, vars) as string;
        const name = action.variableName as string;
        const value = this._resolveValue(action.value, vars);
        if (entityId) this._variables.setEntityVar(entityId, name, value);
        return undefined;
      }

      case 'setPlayerVariable': {
        const playerId = this._resolveValue(action.player, vars) as string;
        const name = action.variableName as string;
        const value = this._resolveValue(action.value, vars);
        if (playerId) this._variables.setPlayerVar(playerId, name, value);
        return undefined;
      }

      // --- Entity attribute (handled directly, not forwarded as scriptAction) ---
      case 'setEntityAttribute': {
        const entityId = this._resolveValue(action.entity, vars) as string;
        const attrId = action.attribute as string;
        const value = Number(this._resolveValue(action.value, vars));
        if (entityId && attrId) {
          this._engine.events.emit('setEntityAttribute', [entityId, attrId, value]);
        }
        return undefined;
      }

      // --- Entity actions (emit events for game systems to handle) ---
      case 'createUnitAtPosition':
      case 'createItemAtPositionWithQuantity':
      case 'createProjectileAtPosition':
      case 'destroyEntity':
      case 'teleportEntity':
      case 'hideEntity':
      case 'showEntity':
      case 'moveEntity':
      case 'rotateEntityToRadians':
      case 'setEntityAttributeMax':
      case 'setEntityAttributeMin':
      case 'playEntityAnimation':
      case 'makeUnitPickupItem':
      case 'dropItem':
      case 'giveNewItemToUnit':
      case 'startUsingItem':
      case 'stopUsingItem': {
        this._engine.events.emit('scriptAction', [type, action, vars]);
        return undefined;
      }

      // --- Iteration ---
      case 'forAllUnits':
      case 'forAllItems':
      case 'forAllProjectiles':
      case 'forAllProps':
      case 'forAllPlayers': {
        this._engine.events.emit('scriptAction', [type, action, vars]);
        return undefined;
      }

      default: {
        // Unknown action — emit as event for extensibility
        this._engine.events.emit('scriptAction', [type, action, vars]);
        return undefined;
      }
    }
  }

  /** Resolve a parameter value. Primitives pass through. Objects with 'function' key are dynamic lookups. */
  resolveValue(val: unknown, vars: ActionVars): unknown {
    return this._resolveValue(val, vars);
  }

  private _resolveValue(text: unknown, vars: ActionVars): unknown {
    if (text === null || text === undefined) return text;
    if (typeof text !== 'object') return text;

    const obj = text as Record<string, unknown>;

    // Point {x, y}
    if ('x' in obj && 'y' in obj && !('function' in obj)) {
      return {
        x: this._resolveValue(obj.x, vars),
        y: this._resolveValue(obj.y, vars),
      };
    }

    // Function reference
    if ('function' in obj) {
      return this._resolveFunction(obj, vars);
    }

    return text;
  }

  private _resolveFunction(obj: Record<string, unknown>, vars: ActionVars): unknown {
    const fn = obj.function as string;

    switch (fn) {
      case 'getVariable':
        return this._variables.getGlobal(obj.variableName as string);
      case 'getEntityVariable':
        return this._variables.getEntityVar(
          this._resolveValue(obj.entity, vars) as string,
          obj.variableName as string,
        );
      case 'getPlayerVariable':
        return this._variables.getPlayerVar(
          this._resolveValue(obj.player, vars) as string,
          obj.variableName as string,
        );
      case 'getRandomNumberBetween': {
        const min = Number(this._resolveValue(obj.min, vars)) || 0;
        const max = Number(this._resolveValue(obj.max, vars)) || 0;
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
      case 'getTriggeringUnit':
        return vars.triggeredBy && (vars.triggeredBy as any).unitId;
      case 'getTriggeringPlayer':
        return vars.triggeredBy && (vars.triggeredBy as any).playerId;
      case 'getTriggeringItem':
        return vars.triggeredBy && (vars.triggeredBy as any).itemId;
      case 'getTriggeringProjectile':
        return vars.triggeredBy && (vars.triggeredBy as any).projectileId;
      case 'undefinedValue':
        return undefined;
      case 'calculate': {
        const items = obj.items as any[];
        if (!items || items.length < 3) return 0;
        const a = Number(this._resolveValue(items[1], vars)) || 0;
        const b = Number(this._resolveValue(items[2], vars)) || 0;
        const op = items[0]?.operator;
        switch (op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return b !== 0 ? a / b : 0;
          case '%':
            return b !== 0 ? a % b : 0;
          default:
            return 0;
        }
      }
      default:
        // Unknown function — return undefined
        return undefined;
    }
  }
}
