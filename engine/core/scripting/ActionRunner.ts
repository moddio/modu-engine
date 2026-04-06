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

      case 'while': {
        const maxIterations = 10000; // Safety limit
        let iterations = 0;
        while (iterations < maxIterations) {
          const cond = this._conditions.evaluate(action.conditions, (v) => this._resolveValue(v, vars));
          if (!cond) break;
          const result = this.run((action.actions as any[]) ?? [], vars);
          if (result === 'break') break;
          if (result === 'return') return 'return';
          iterations++;
        }
        return undefined;
      }

      case 'for': {
        const start = Number(this._resolveValue(action.start, vars)) || 0;
        const stop = Number(this._resolveValue(action.stop, vars)) || 0;
        for (let i = start; i < stop; i++) {
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

      // --- Entity attribute operations ---
      case 'setEntityAttributeMax': {
        const entityId = this._resolveValue(action.entity, vars) as string;
        const attrId = action.attribute as string;
        const value = Number(this._resolveValue(action.value, vars));
        if (entityId && attrId) {
          this._engine.events.emit('setEntityAttributeMax', [entityId, attrId, value]);
        }
        return undefined;
      }

      case 'setEntityAttributeMin': {
        const entityId = this._resolveValue(action.entity, vars) as string;
        const attrId = action.attribute as string;
        const value = Number(this._resolveValue(action.value, vars));
        if (entityId && attrId) {
          this._engine.events.emit('setEntityAttributeMin', [entityId, attrId, value]);
        }
        return undefined;
      }

      case 'setEntityAttributeRegenerationRate': {
        const entityId = this._resolveValue(action.entity, vars) as string;
        const attrId = action.attribute as string;
        const value = Number(this._resolveValue(action.value, vars));
        if (entityId && attrId) {
          this._engine.events.emit('setEntityAttributeRegenRate', [entityId, attrId, value]);
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
      case 'makeUnitPickupItem':
      case 'dropItem':
      case 'giveNewItemToUnit':
      case 'startUsingItem':
      case 'stopUsingItem': {
        this._engine.events.emit('scriptAction', [type, action, vars]);
        return undefined;
      }

      // --- Animation actions ---
      case 'playEntityAnimation': {
        this._engine.events.emit('entity:playAnimation', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.animation, vars),
        ]);
        return undefined;
      }

      case 'stopPlayEntityAnimation':
      case 'stopAllEntityAnimations': {
        this._engine.events.emit('entity:stopAnimation', [
          this._resolveValue(action.entity, vars),
        ]);
        return undefined;
      }

      // --- UI actions ---
      case 'openShopForPlayer': {
        this._engine.events.emit('ui:openShop', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.shop, vars),
        ]);
        return undefined;
      }

      case 'closeShopForPlayer': {
        this._engine.events.emit('ui:closeShop', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      case 'openDialogueForPlayer': {
        this._engine.events.emit('ui:openDialogue', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.dialogue, vars),
        ]);
        return undefined;
      }

      case 'closeDialogueForPlayer': {
        this._engine.events.emit('ui:closeDialogue', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      case 'showUiTextForPlayer': {
        this._engine.events.emit('ui:showText', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.target, vars),
          this._resolveValue(action.value, vars),
        ]);
        return undefined;
      }

      case 'createFloatingText': {
        this._engine.events.emit('ui:floatingText', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.text, vars),
          action.color ?? '#ffffff',
        ]);
        return undefined;
      }

      case 'showMenu':
      case 'showMenuAndSelectBestServer': {
        this._engine.events.emit('ui:showMenu');
        return undefined;
      }

      // --- Audio actions ---
      case 'playSoundAtPosition': {
        this._engine.events.emit('audio:playSound', [
          this._resolveValue(action.sound, vars),
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      case 'playMusic': {
        this._engine.events.emit('audio:playMusic', [this._resolveValue(action.music, vars)]);
        return undefined;
      }

      case 'stopMusic': {
        this._engine.events.emit('audio:stopMusic');
        return undefined;
      }

      case 'playSoundForPlayer': {
        this._engine.events.emit('audio:playSound', [
          this._resolveValue(action.sound, vars),
          null,
        ]);
        return undefined;
      }

      // --- Player actions ---
      case 'setPlayerName': {
        const playerId = this._resolveValue(action.player, vars) as string;
        const name = this._resolveValue(action.name, vars) as string;
        if (playerId) {
          this._engine.events.emit('player:setName', [playerId, name]);
        }
        return undefined;
      }

      case 'playerCameraTrackUnit': {
        this._engine.events.emit('camera:trackUnit', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.unit, vars),
        ]);
        return undefined;
      }

      case 'positionCamera': {
        this._engine.events.emit('camera:setPosition', [
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      // --- Math/Logic ---
      case 'calculate': {
        // Already handled in _resolveFunction
        return undefined;
      }

      // --- Iteration ---
      case 'forAllUnits': {
        const entityList = this._engine.root.children.filter(e => e.category === 'unit');
        for (const entity of entityList) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedUnit: entity.id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllPlayers': {
        const playerList = this._engine.root.children.filter(e => e.category === 'player');
        for (const entity of playerList) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedPlayer: entity.id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllItems': {
        const itemList = this._engine.root.children.filter(e => e.category === 'item');
        for (const entity of itemList) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedItem: entity.id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllProjectiles': {
        const projList = this._engine.root.children.filter(e => e.category === 'projectile');
        for (const entity of projList) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedProjectile: entity.id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllProps': {
        const propList = this._engine.root.children.filter(e => e.category === 'prop');
        for (const entity of propList) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedProp: entity.id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      // --- Timer actions ---
      case 'setTimeOut': {
        const duration = Number(this._resolveValue(action.duration, vars)) || 0;
        const actions = (action.actions as any[]) ?? [];
        const capturedVars = { ...vars };
        setTimeout(() => {
          this.run(actions, capturedVars);
        }, duration);
        return undefined;
      }

      case 'repeatWithDelay': {
        const count = Number(this._resolveValue(action.count, vars)) || 0;
        const delay = Number(this._resolveValue(action.delay, vars)) || 0;
        const actions = (action.actions as any[]) ?? [];
        const capturedVars = { ...vars };
        for (let i = 0; i < count; i++) {
          setTimeout(() => {
            this.run(actions, { ...capturedVars, i });
          }, delay * (i + 1));
        }
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
      case 'selectedUnit':
        return vars.selectedUnit;
      case 'selectedPlayer':
        return vars.selectedPlayer;
      case 'selectedItem':
        return vars.selectedItem;
      case 'thisEntity':
        return vars.thisEntity ?? (vars.triggeredBy && (vars.triggeredBy as any).unitId);
      case 'getOwner':
        // Get the owner player of an entity
        return undefined; // Will be wired later
      case 'stringToNumber':
        return Number(this._resolveValue(obj.value, vars));
      case 'numberToString':
        return String(this._resolveValue(obj.value, vars));
      case 'concat':
        return String(this._resolveValue(obj.textA, vars)) + String(this._resolveValue(obj.textB, vars));
      case 'getEntityAttribute': {
        const entId = this._resolveValue(obj.entity, vars) as string;
        const attrName = obj.attribute as string;
        // Emit event to get attribute value
        return undefined; // Will be wired to LocalGameSession
      }
      case 'undefinedValue':
        return undefined;

      // --- Count functions ---
      case 'getPlayerCount':
        return this._engine.root.children.filter(e => e.category === 'player').length;
      case 'getUnitCount':
        return this._engine.root.children.filter(e => e.category === 'unit').length;
      case 'getItemCount':
        return this._engine.root.children.filter(e => e.category === 'item').length;

      // --- Timestamp ---
      case 'currentTimeStamp':
        return Date.now();

      // --- Math functions ---
      case 'abs':
        return Math.abs(Number(this._resolveValue(obj.value, vars)));
      case 'sin':
        return Math.sin(Number(this._resolveValue(obj.value, vars)));
      case 'cos':
        return Math.cos(Number(this._resolveValue(obj.value, vars)));
      case 'sqrt':
        return Math.sqrt(Number(this._resolveValue(obj.value, vars)));
      case 'floor':
        return Math.floor(Number(this._resolveValue(obj.value, vars)));
      case 'ceil':
        return Math.ceil(Number(this._resolveValue(obj.value, vars)));
      case 'log':
        return Math.log(Number(this._resolveValue(obj.value, vars)));

      // --- Coordinate and position functions ---
      case 'xyCoordinate':
        return {
          x: Number(this._resolveValue(obj.x, vars)) || 0,
          y: Number(this._resolveValue(obj.y, vars)) || 0,
        };

      case 'entityPosition':
      case 'getEntityPosition': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        if (ent) return { x: ent.position.x * 64, y: ent.position.z * 64 };
        return { x: 0, y: 0 };
      }

      case 'distanceBetweenPositions': {
        const posA = this._resolveValue(obj.positionA, vars) as any;
        const posB = this._resolveValue(obj.positionB, vars) as any;
        if (!posA || !posB) return 0;
        const dx = (posA.x || 0) - (posB.x || 0);
        const dy = (posA.y || 0) - (posB.y || 0);
        return Math.sqrt(dx * dx + dy * dy);
      }

      case 'angleBetweenPositions': {
        const pA = this._resolveValue(obj.positionA, vars) as any;
        const pB = this._resolveValue(obj.positionB, vars) as any;
        if (!pA || !pB) return 0;
        return Math.atan2((pB.y || 0) - (pA.y || 0), (pB.x || 0) - (pA.x || 0));
      }

      // --- Trigger context ---
      case 'lastTriggeringRegion':
        return vars.triggeredBy && (vars.triggeredBy as any).regionId;
      case 'getEntityType':
        return vars.triggeredBy && (vars.triggeredBy as any).entityType;

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
