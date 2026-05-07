import { Engine } from '../Engine';
import { ConditionEvaluator } from './ConditionEvaluator';
import { VariableStore } from './VariableStore';

export type ActionVars = Record<string, unknown>;

/** Categories taro exposes to scripts. Mirrors ActionComponent.js:8 (`entityCategories`).
 *  Used to filter `entitiesInRegion`-style readers so they don't surface players
 *  (which extend Unit but carry their own category) or internal bookkeeping nodes. */
const SCRIPT_ENTITY_CATEGORIES: ReadonlySet<string> = new Set(['unit', 'item', 'projectile', 'region', 'prop']);

export class ActionRunner {
  private _engine: Engine;
  private _conditions: ConditionEvaluator;
  private _variables: VariableStore;
  private _lastCreatedUnitId: string | null = null;
  private _lastCreatedItemId: string | null = null;
  private _lastCreatedProjectileId: string | null = null;

  /** Pixels per tile in source game data. Used to convert taro pixel coords → engine tile-units. */
  mapTilePx = 64;
  /** Raw map data (layers, width, height) used by isPositionInWall / getMapTileId.
   *  GameServer / LocalGameSession set this from gameData.map. */
  mapData: Record<string, unknown> | null = null;
  /** Entity-type registries: category ('itemTypes', 'unitTypes', etc.) → typeId → def.
   *  Lets resolvers like getItemMaxQuantity inspect a type's static metadata. */
  typeRegistries: Record<string, Record<string, unknown>> = {};
  /** Per-player last chat message, populated by GameServer when a chat packet arrives.
   *  Read by `getLastChatMessageSentByPlayer` and `lastPlayerMessage`. */
  private _lastChatByPlayer = new Map<string, string>();
  setLastChatForPlayer(playerId: string, text: string): void { this._lastChatByPlayer.set(playerId, text); }

  /** Linear velocity for an entity in physics units. Set by GameServer to bridge
   *  the physics world (private to GameServer) into script readers like
   *  `getEntityVelocityX/Y/Z`. Returns null when no body exists. */
  velocityProvider: ((entityId: string) => { x: number; y: number; z?: number } | null) | null = null;

  /** Camera state for the active client. Set by SinglePlayer / client renderer.
   *  Server-side scripts (multiplayer GameServer) leave this null and camera
   *  readers fall back to safe defaults. */
  cameraStateProvider: (() => { x: number; y: number; width: number; height: number; pitch: number; yaw: number } | null) | null = null;

  /** Game owner's userId — used by `playerIsCreator`. Set by GameServer / loader
   *  from `defaultData.owner` in the loaded game data. */
  gameOwnerUserId: string | null = null;

  constructor(engine: Engine, variables: VariableStore) {
    this._engine = engine;
    this._conditions = new ConditionEvaluator();
    this._variables = variables;

    // Track the most recently spawned unit/item so `getLastCreatedUnit`/`getLastCreatedItem` resolve.
    // GameServer emits `entityCreatedGlobal` with a single payload object.
    this._engine.events.on('entityCreatedGlobal', (payload: unknown) => {
      const p = (payload ?? {}) as { entityId?: string; unitId?: string; itemId?: string; category?: string };
      if (p.unitId) this._lastCreatedUnitId = p.unitId;
      if (p.itemId) this._lastCreatedItemId = p.itemId;
      const ext = p as { projectileId?: string };
      if (ext.projectileId) this._lastCreatedProjectileId = ext.projectileId;
      if (p.entityId && p.category === 'unit') this._lastCreatedUnitId = p.entityId;
      if (p.entityId && p.category === 'item') this._lastCreatedItemId = p.entityId;
      if (p.entityId && p.category === 'projectile') this._lastCreatedProjectileId = p.entityId;
    });
  }

  get lastCreatedUnitId(): string | null { return this._lastCreatedUnitId; }
  setLastCreatedUnitId(id: string | null): void { this._lastCreatedUnitId = id; }

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
        if (entityId) {
          this._variables.setEntityVar(entityId, name, value);
          // Mirror to entity.stats.variables and broadcast — taro stores entity-scoped
          // vars on entity._stats.variables, so they ride EntityCreate / EntityStatsUpdate.
          this._engine.events.emit('setEntityVariable', [entityId, name, value]);
        }
        return undefined;
      }

      case 'setPlayerVariable': {
        const playerId = this._resolveValue(action.player, vars) as string;
        const name = action.variableName as string;
        const value = this._resolveValue(action.value, vars);
        if (playerId) {
          this._variables.setPlayerVar(playerId, name, value);
          this._engine.events.emit('setPlayerVariable', [playerId, name, value]);
        }
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
      case 'dropItem': {
        this._engine.events.emit('scriptAction', [type, action, vars]);
        return undefined;
      }

      // --- Inventory actions ---
      case 'giveNewItemToUnit':
      case 'giveNewItemWithQuantityToUnit': {
        this._engine.events.emit('inventory:giveItem', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.itemType, vars),
          Number(this._resolveValue(action.quantity, vars)) || 1,
        ]);
        return undefined;
      }

      case 'dropItemAtPosition': {
        this._engine.events.emit('inventory:dropAt', [
          this._resolveValue(action.item, vars),
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      case 'dropItemInInventorySlot': {
        this._engine.events.emit('inventory:dropSlot', [
          this._resolveValue(action.unit, vars),
          Number(this._resolveValue(action.slotIndex, vars)),
        ]);
        return undefined;
      }

      case 'dropAllItems': {
        this._engine.events.emit('inventory:dropAll', [this._resolveValue(action.unit, vars)]);
        return undefined;
      }

      case 'makeUnitSelectItemAtSlot': {
        this._engine.events.emit('inventory:selectSlot', [
          this._resolveValue(action.unit, vars),
          Number(this._resolveValue(action.slotIndex, vars)),
        ]);
        return undefined;
      }

      case 'startUsingItem':
      case 'useItemOnce': {
        const resolved = this._resolveValue(action.entity, vars);
        this._engine.events.emit('item:use', [resolved]);
        return undefined;
      }

      case 'stopUsingItem': {
        this._engine.events.emit('item:stopUse', [this._resolveValue(action.entity, vars)]);
        return undefined;
      }

      case 'setItemAmmo': {
        this._engine.events.emit('item:setAmmo', [
          this._resolveValue(action.entity, vars),
          Number(this._resolveValue(action.ammo, vars)),
        ]);
        return undefined;
      }

      case 'updateItemQuantity': {
        this._engine.events.emit('item:setQuantity', [
          this._resolveValue(action.entity, vars),
          Number(this._resolveValue(action.quantity, vars)),
        ]);
        return undefined;
      }

      // Restore ammo on the triggering item to its max — taro reads `entity` (the triggering item) directly.
      case 'refillAmmo': {
        this._engine.events.emit('item:refillAmmo', [
          this._resolveValue(action.item ?? action.entity, vars) ?? (vars.triggeredBy as { itemId?: string } | undefined)?.itemId,
        ]);
        return undefined;
      }

      // Rename an item (taro streamUpdateData [{name}]). Distinct from setUnitNameLabel which targets unit's overhead label.
      case 'setItemName': {
        this._engine.events.emit('item:setName', [
          this._resolveValue(action.item, vars),
          this._resolveValue(action.name, vars),
        ]);
        return undefined;
      }

      // Reassign unit ownership (taro: unit.setOwnerPlayer(player.id())).
      case 'setUnitOwner': {
        this._engine.events.emit('unit:setOwner', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.player, vars),
        ]);
        return undefined;
      }

      case 'changeItemInventoryImage': {
        this._engine.events.emit('item:changeImage', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.image, vars),
        ]);
        return undefined;
      }

      // --- Visibility targeting ---
      case 'makeUnitInvisibleToFriendlyPlayers':
      case 'makeUnitVisibleToFriendlyPlayers':
      case 'makeUnitInvisibleToNeutralPlayers':
      case 'makeUnitVisibleToNeutralPlayers':
      case 'hideUnitFromPlayer':
      case 'showUnitToPlayer':
      case 'hideUnitUI':
      case 'showUnitUI': {
        this._engine.events.emit('entity:visibility', [type, this._resolveValue(action.entity, vars), this._resolveValue(action.player, vars)]);
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

      case 'hideUiTextForPlayer': {
        this._engine.events.emit('ui:hideText', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.target, vars),
        ]);
        return undefined;
      }

      case 'updateUiTextForPlayer': {
        this._engine.events.emit('ui:updateText', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.target, vars),
          this._resolveValue(action.value, vars),
        ]);
        return undefined;
      }

      case 'showUiElementForPlayer':
      case 'hideUiElementForPlayer':
      case 'removeElement': {
        this._engine.events.emit('ui:element', [type, this._resolveValue(action.target, vars), this._resolveValue(action.player, vars)]);
        return undefined;
      }

      case 'setUIElementProperty': {
        this._engine.events.emit('ui:setProperty', [
          this._resolveValue(action.target, vars),
          this._resolveValue(action.property, vars),
          this._resolveValue(action.value, vars),
        ]);
        return undefined;
      }

      case 'setUIElementHtml': {
        this._engine.events.emit('ui:setHtml', [
          this._resolveValue(action.target, vars),
          this._resolveValue(action.value, vars),
        ]);
        return undefined;
      }

      case 'showInputModalToPlayer': {
        this._engine.events.emit('ui:inputModal', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.title, vars),
          this._resolveValue(action.fieldLabel, vars),
        ]);
        return undefined;
      }

      case 'showCustomModalToPlayer': {
        this._engine.events.emit('ui:customModal', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.title, vars),
          this._resolveValue(action.htmlContent, vars),
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
      // Each forAll<X> takes a group expression (e.g. allUnitsOwnedByPlayer, humanPlayers,
      // allItemsOfItemType) that resolves to an array of entity ids. When present, iterate
      // only those ids; otherwise fall back to every entity of that category. Without the
      // filter pass, scripts like celleater's `forAllUnits(allUnitsOwnedByPlayer(viruses))`
      // ran their body on every unit on the map, overwriting unrelated entities' state.
      case 'forAllUnits': {
        const ids = this._resolveEntityGroup(action.unitGroup, vars, 'unit');
        for (const id of ids) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedUnit: id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllPlayers': {
        const ids = this._resolveEntityGroup(action.playerGroup, vars, 'player');
        for (const id of ids) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedPlayer: id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllItems': {
        const ids = this._resolveEntityGroup(action.itemGroup, vars, 'item');
        for (const id of ids) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedItem: id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllProjectiles': {
        const ids = this._resolveEntityGroup(action.projectileGroup, vars, 'projectile');
        for (const id of ids) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedProjectile: id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'forAllProps': {
        const ids = this._resolveEntityGroup((action as any).propGroup, vars, 'prop');
        for (const id of ids) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedProp: id });
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

      // --- Quest system ---
      case 'addQuestToPlayer': {
        this._engine.events.emit('quest:add', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.quest, vars),
        ]);
        return undefined;
      }

      case 'removeQuestForPlayer': {
        this._engine.events.emit('quest:remove', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.quest, vars),
        ]);
        return undefined;
      }

      case 'completeQuest': {
        this._engine.events.emit('quest:complete', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.quest, vars),
        ]);
        return undefined;
      }

      case 'setQuestProgress': {
        this._engine.events.emit('quest:setProgress', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.quest, vars),
          this._resolveValue(action.progress, vars),
        ]);
        return undefined;
      }

      // --- Buff system ---
      case 'addAttributeBuffToUnit': {
        this._engine.events.emit('buff:add', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.attribute, vars),
          Number(this._resolveValue(action.value, vars)),
          Number(this._resolveValue(action.duration, vars)),
        ]);
        return undefined;
      }

      case 'addPercentageAttributeBuffToUnit': {
        this._engine.events.emit('buff:addPercent', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.attribute, vars),
          Number(this._resolveValue(action.percentage, vars)),
          Number(this._resolveValue(action.duration, vars)),
        ]);
        return undefined;
      }

      case 'removeAllAttributeBuffs': {
        this._engine.events.emit('buff:removeAll', [
          this._resolveValue(action.unit, vars),
        ]);
        return undefined;
      }

      // --- Trading ---
      case 'makePlayerTradeWithPlayer': {
        this._engine.events.emit('trade:initiate', [
          this._resolveValue(action.playerA, vars),
          this._resolveValue(action.playerB, vars),
        ]);
        return undefined;
      }

      // sendCoinsToPlayer / sendCoinsToPlayer2 share one handler below.

      // --- More entity actions ---
      case 'changeUnitType': {
        this._engine.events.emit('entity:changeType', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.unitType, vars),
        ]);
        return undefined;
      }

      case 'changeEntityModelSprite': {
        this._engine.events.emit('entity:changeModel', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.sprite, vars),
        ]);
        return undefined;
      }

      case 'flipEntitySprite': {
        this._engine.events.emit('entity:flip', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.flip, vars),
        ]);
        return undefined;
      }

      case 'setUnitSpeed': {
        this._engine.events.emit('entity:setSpeed', [
          this._resolveValue(action.entity, vars),
          Number(this._resolveValue(action.speed, vars)),
        ]);
        return undefined;
      }

      // Direct movement (taro: unit.ability.move{Up,Down,Left,Right} / stopMovingX/Y).
      // Separate cases so handlers can branch on direction without parsing the type string.
      case 'startMovingUnitUp':
      case 'startMovingUnitDown':
      case 'startMovingUnitLeft':
      case 'startMovingUnitRight': {
        const dir = type.replace('startMovingUnit', '').toLowerCase(); // up|down|left|right
        this._engine.events.emit('unit:startMove', [this._resolveValue(action.unit ?? action.entity, vars), dir]);
        return undefined;
      }
      case 'stopMovingUnitX':
      case 'stopMovingUnitY':
      case 'stopMovingUnit': {
        const axis = type === 'stopMovingUnit' ? 'both' : type.endsWith('X') ? 'x' : 'y';
        this._engine.events.emit('unit:stopMove', [this._resolveValue(action.unit ?? action.entity, vars), axis]);
        return undefined;
      }

      // bonusSpeed delta (taro streamUpdateData [{bonusSpeed}]). Distinct from setUnitSpeed which sets base.
      case 'changeUnitSpeed': {
        this._engine.events.emit('unit:changeSpeed', [
          this._resolveValue(action.entity ?? action.unit, vars),
          Number(this._resolveValue(action.unitSpeed ?? action.speed, vars)) || 0,
        ]);
        return undefined;
      }

      // No taro counterpart (only getRotateSpeed exists). Wired as event so a handler can update unitType.rotateSpeed.
      case 'setRotateSpeed': {
        this._engine.events.emit('unit:setRotateSpeed', [
          this._resolveValue(action.unit ?? action.unitType ?? action.entity, vars),
          Number(this._resolveValue(action.rotateSpeed ?? action.speed, vars)) || 0,
        ]);
        return undefined;
      }

      case 'enableAI':
      case 'disableAI': {
        this._engine.events.emit('ai:enabled', [
          this._resolveValue(action.unit ?? action.entity, vars),
          type === 'enableAI',
        ]);
        return undefined;
      }

      // Item, not unit: rotateToFaceMouseCursor is a per-item flag (taro streamUpdateData on item).
      case 'enableRotateToFaceMouseCursor':
      case 'disableRotateToFaceMouseCursor': {
        this._engine.events.emit('item:rotateToCursor', [
          this._resolveValue(action.item ?? action.entity, vars),
          type === 'enableRotateToFaceMouseCursor',
        ]);
        return undefined;
      }

      case 'setUnitNameLabel': {
        this._engine.events.emit('entity:setNameLabel', [
          this._resolveValue(action.unit ?? action.entity, vars),
          this._resolveValue(action.name, vars),
        ]);
        return undefined;
      }

      case 'hideUnitNameLabel': {
        this._engine.events.emit('entity:hideNameLabel', [this._resolveValue(action.entity, vars)]);
        return undefined;
      }

      case 'showUnitNameLabel': {
        this._engine.events.emit('entity:showNameLabel', [this._resolveValue(action.entity, vars)]);
        return undefined;
      }

      case 'changeScaleOfEntityBody':
      case 'changeScaleOfEntitySprite': {
        this._engine.events.emit('entity:setScale', [
          this._resolveValue(action.entity, vars),
          Number(this._resolveValue(action.scale, vars)),
        ]);
        return undefined;
      }

      case 'makeUnitInvisible': {
        this._engine.events.emit('entity:setVisible', [this._resolveValue(action.entity, vars), false]);
        return undefined;
      }

      case 'makeUnitVisible': {
        this._engine.events.emit('entity:setVisible', [this._resolveValue(action.entity, vars), true]);
        return undefined;
      }

      case 'applyForceOnEntityXY':
      case 'applyForceOnEntityAngle': {
        this._engine.events.emit('physics:applyForce', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.force, vars),
          this._resolveValue(action.angle, vars),
        ]);
        return undefined;
      }

      case 'applyImpulseOnEntityXY':
      case 'applyImpulseOnEntityAngle': {
        this._engine.events.emit('physics:applyImpulse', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.impulse, vars),
          this._resolveValue(action.angle, vars),
        ]);
        return undefined;
      }

      // taro `setVelocityOfEntityXY` — directly sets body linear velocity.
      // velocity is a 2-component vector. Was previously missing from the switch
      // entirely; ~300 uses in this game.
      case 'setVelocityOfEntityXY': {
        const v = this._resolveValue(action.velocity, vars) as { x?: number; y?: number } | null;
        this._engine.events.emit('physics:setVelocity', [
          this._resolveValue(action.entity, vars),
          Number(v?.x ?? 0) || 0,
          Number(v?.y ?? 0) || 0,
        ]);
        return undefined;
      }

      // Force in entity-local frame (force.x = strafe, force.y = forward). Taro rotates by entity's facing.
      case 'applyForceOnEntityXYRelative': {
        const f = this._resolveValue(action.force, vars) as { x?: number; y?: number } | null;
        this._engine.events.emit('physics:applyForceRelative', [
          this._resolveValue(action.entity, vars),
          Number(f?.x ?? 0) || 0,
          Number(f?.y ?? 0) || 0,
        ]);
        return undefined;
      }

      // No taro counterpart — fires impulse along entity's facing direction at given magnitude.
      case 'applyImpulseOnEntityDirection': {
        this._engine.events.emit('physics:applyImpulseDirection', [
          this._resolveValue(action.entity, vars),
          Number(this._resolveValue(action.impulse ?? action.magnitude, vars)) || 0,
        ]);
        return undefined;
      }

      case 'applyTorqueOnEntity': {
        this._engine.events.emit('physics:applyTorque', [
          this._resolveValue(action.entity, vars),
          Number(this._resolveValue(action.torque, vars)) || 0,
        ]);
        return undefined;
      }

      // Velocity along an explicit angle (radians). Taro: cos/sin(angle - π/2) * speed.
      case 'setEntityVelocityAtAngle': {
        this._engine.events.emit('physics:setVelocityAtAngle', [
          this._resolveValue(action.entity, vars),
          Number(this._resolveValue(action.speed, vars)) || 0,
          Number(this._resolveValue(action.angle, vars)) || 0,
        ]);
        return undefined;
      }

      // No taro counterpart — set velocity by direction vector + speed (separate from explicit angle variant).
      case 'setEntityVelocityDirection': {
        const dir = this._resolveValue(action.direction, vars) as { x?: number; y?: number } | null;
        this._engine.events.emit('physics:setVelocityDirection', [
          this._resolveValue(action.entity, vars),
          Number(dir?.x ?? 0) || 0,
          Number(dir?.y ?? 0) || 0,
          Number(this._resolveValue(action.speed, vars)) || 0,
        ]);
        return undefined;
      }

      // Spawn a free-standing item at a position. ~300 uses in Karmaslayers.
      case 'spawnItem': {
        this._engine.events.emit('item:spawn', [
          this._resolveValue(action.itemType, vars),
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      // Player-attribute writes (parallel to setEntityAttribute on units/items).
      case 'setPlayerAttribute': {
        const playerId = this._resolveValue(action.entity ?? action.player, vars) as string;
        const attrId = (action.attribute ?? action.attributeType) as string;
        const value = Number(this._resolveValue(action.value, vars));
        if (playerId && attrId && Number.isFinite(value)) {
          this._engine.events.emit('player:setAttribute', [playerId, attrId, value]);
        }
        return undefined;
      }
      case 'setPlayerAttributeMax': {
        const playerId = this._resolveValue(action.entity ?? action.player, vars) as string;
        const attrId = (action.attribute ?? action.attributeType) as string;
        const value = Number(this._resolveValue(action.value, vars));
        if (playerId && attrId && Number.isFinite(value)) {
          this._engine.events.emit('player:setAttributeMax', [playerId, attrId, value]);
        }
        return undefined;
      }

      // AI commands. The unit's _aiState target is consumed by GameServer._processAI.
      case 'aiAttackUnit': {
        this._engine.events.emit('ai:attackUnit', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.targetUnit, vars),
        ]);
        return undefined;
      }
      case 'aiMoveToPosition': {
        this._engine.events.emit('ai:moveToPosition', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      // Projectile linkage — set who owns / what spawned this projectile.
      case 'setOwnerUnitOfProjectile': {
        this._engine.events.emit('projectile:setOwner', [
          this._resolveValue(action.projectile, vars),
          this._resolveValue(action.unit, vars),
        ]);
        return undefined;
      }
      case 'setSourceItemOfProjectile': {
        this._engine.events.emit('projectile:setSource', [
          this._resolveValue(action.projectile, vars),
          this._resolveValue(action.item, vars),
        ]);
        return undefined;
      }

      // Single-shot UI text that auto-clears after `time` ms — extension of updateUiTextForPlayer.
      case 'updateUiTextForTimeForPlayer': {
        this._engine.events.emit('ui:updateTextForTime', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.target, vars),
          this._resolveValue(action.value, vars),
          Number(this._resolveValue(action.time, vars)) || 3000,
        ]);
        return undefined;
      }
      case 'updateUiTextForEveryone': {
        this._engine.events.emit('ui:updateTextForEveryone', [
          this._resolveValue(action.target, vars),
          this._resolveValue(action.value, vars),
        ]);
        return undefined;
      }

      // Broadcast show/hide of a HUD text element to all players (taro UI element id, e.g. 'center-lg').
      case 'showUiTextForEveryone': {
        this._engine.events.emit('ui:showTextForEveryone', [
          this._resolveValue(action.target, vars),
          this._resolveValue(action.value, vars),
        ]);
        return undefined;
      }
      case 'hideUiTextForEveryone': {
        this._engine.events.emit('ui:hideTextForEveryone', [
          this._resolveValue(action.target, vars),
        ]);
        return undefined;
      }

      case 'showDismissibleInputModalToPlayer': {
        this._engine.events.emit('ui:dismissibleInputModal', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.inputLabel ?? action.title, vars),
        ]);
        return undefined;
      }

      case 'changeDescriptionOfItem': {
        this._engine.events.emit('item:setDescription', [
          this._resolveValue(action.item, vars),
          this._resolveValue(action.string ?? action.description, vars),
        ]);
        return undefined;
      }

      case 'playerCameraSetZoom': {
        this._engine.events.emit('camera:setZoom', [
          this._resolveValue(action.player, vars),
          Number(this._resolveValue(action.zoom, vars)) || 0,
        ]);
        return undefined;
      }

      case 'playerCameraSetPitch': {
        this._engine.events.emit('camera:setPitch', [
          this._resolveValue(action.player, vars),
          Number(this._resolveValue(action.angle, vars)) || 0,
        ]);
        return undefined;
      }
      case 'playerCameraSetYaw': {
        this._engine.events.emit('camera:setYaw', [
          this._resolveValue(action.player, vars),
          Number(this._resolveValue(action.angle, vars)) || 0,
        ]);
        return undefined;
      }
      case 'playerCameraStopTracking': {
        this._engine.events.emit('camera:stopTracking', [this._resolveValue(action.player, vars)]);
        return undefined;
      }
      case 'playerCameraUnlock': {
        this._engine.events.emit('camera:unlock', [this._resolveValue(action.player, vars)]);
        return undefined;
      }
      // Pixel-rect deadzone within which the followed unit doesn't push the camera.
      case 'setCameraDeadzone': {
        this._engine.events.emit('camera:setDeadzone', [
          this._resolveValue(action.player, vars),
          Number(this._resolveValue(action.width, vars)) || 0,
          Number(this._resolveValue(action.height, vars)) || 0,
        ]);
        return undefined;
      }

      case 'setItemFireRate': {
        this._engine.events.emit('item:setFireRate', [
          this._resolveValue(action.item, vars),
          Number(this._resolveValue(action.fireRate, vars)) || 0,
        ]);
        return undefined;
      }

      // Bonus coin grant. Game uses sendCoinsToPlayer2 (not sendCoinsToPlayer).
      case 'sendCoinsToPlayer2':
      case 'sendCoinsToPlayer': {
        this._engine.events.emit('player:sendCoins', [
          this._resolveValue(action.player, vars),
          Number(this._resolveValue(action.coins, vars)) || 0,
        ]);
        return undefined;
      }

      case 'loadPlayerDataAndApplyIt': {
        this._engine.events.emit('data:player', [
          'loadPlayerDataAndApplyIt',
          this._resolveValue(action.player, vars),
          this._resolveValue(action.unit, vars),
        ]);
        return undefined;
      }
      case 'playMusicForPlayerRepeatedly': {
        this._engine.events.emit('audio:playMusicForPlayer', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.music, vars),
          true, // repeat
        ]);
        return undefined;
      }

      case 'endGame': {
        this._engine.events.emit('game:end');
        return undefined;
      }

      // --- Iteration over arbitrary entity / region groups ---
      // entityGroup resolves to an array of ids; selected* var is set per iteration.
      case 'forAllEntities': {
        const ids = this._resolveValue(action.entityGroup, vars);
        const list = Array.isArray(ids) ? ids : [];
        for (const id of list) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedEntity: id });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }
      case 'forAllRegions': {
        const regions = this._resolveValue(action.regionGroup, vars);
        const list = Array.isArray(regions) ? regions : [];
        for (const r of list) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, selectedRegion: r });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      case 'makePlayerSelectUnit': {
        this._engine.events.emit('player:selectUnit', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.unit, vars),
        ]);
        return undefined;
      }

      case 'assignPlayerType': {
        // Taro game data writes the player slot as `entity` (matching the rest of the
        // entity-targeted actions); pre-existing engine code only read `action.player`,
        // so the playerId resolved to undefined and the type never actually attached
        // to the joining player.
        this._engine.events.emit('player:assignType', [
          this._resolveValue(action.entity ?? action.player, vars),
          this._resolveValue(action.playerType, vars),
        ]);
        return undefined;
      }

      case 'kickPlayer': {
        this._engine.events.emit('player:kick', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      // Spawn a controlled-by-human player whose clientId is -1 (taro convention for bots).
      case 'addBotPlayer': {
        this._engine.events.emit('player:addBot', [this._resolveValue(action.name, vars) ?? '']);
        return undefined;
      }

      // Group ops are stored as global variables (taro: taro.game.data.variables[groupName].value is array).
      // We mirror that: read array off VariableStore globals, push/splice, write back.
      case 'addPlayerToPlayerGroup':
      case 'addUnitToUnitGroup': {
        const groupName = (action.playerGroup as { variableName?: string } | undefined)?.variableName
          ?? (action.unitGroup as { variableName?: string } | undefined)?.variableName;
        const member = this._resolveValue(action.player ?? action.unit, vars);
        if (groupName && member != null) {
          const list = (this._variables.getGlobal(groupName) as unknown[] | undefined) ?? [];
          const next = [...list, member];
          this._variables.setGlobal(groupName, next, type === 'addPlayerToPlayerGroup' ? 'playerGroup' : 'unitGroup');
        }
        return undefined;
      }
      case 'removePlayerFromPlayerGroup':
      case 'removeUnitFromUnitGroup': {
        const groupName = (action.playerGroup as { variableName?: string } | undefined)?.variableName
          ?? (action.unitGroup as { variableName?: string } | undefined)?.variableName;
        const member = this._resolveValue(action.player ?? action.unit, vars);
        if (groupName && member != null) {
          const list = (this._variables.getGlobal(groupName) as unknown[] | undefined) ?? [];
          const next = list.filter((m) => m !== member);
          this._variables.setGlobal(groupName, next, type === 'removePlayerFromPlayerGroup' ? 'playerGroup' : 'unitGroup');
        }
        return undefined;
      }

      case 'sendPlayerToMap':
      case 'sendPlayerToGame': {
        this._engine.events.emit('player:sendTo', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.map, vars) || this._resolveValue(action.game, vars),
        ]);
        return undefined;
      }

      case 'makePlayerSendChatMessage': {
        this._engine.events.emit('chat:systemMessage', [
          this._resolveValue(action.message, vars),
        ]);
        return undefined;
      }

      // --- Chat ---
      // taro game data uses `sendChatMessage` (broadcast) + `sendChatMessageToPlayer` (whisper).
      // Both were previously missing — they fell through to the default `scriptAction` emit
      // and then were silently dropped by GameServer's narrow switch.
      case 'sendChatMessage': {
        this._engine.events.emit('chat:broadcast', [
          this._resolveValue(action.message, vars),
        ]);
        return undefined;
      }
      case 'sendChatMessageToPlayer': {
        this._engine.events.emit('chat:toPlayer', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.message, vars),
        ]);
        return undefined;
      }

      case 'startEmittingParticles': {
        this._engine.events.emit('particle:start', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.particle, vars),
        ]);
        return undefined;
      }

      case 'stopEmittingParticles': {
        this._engine.events.emit('particle:stop', [this._resolveValue(action.entity, vars)]);
        return undefined;
      }

      // --- Movement actions ---
      case 'setUnitTargetPosition': {
        this._engine.events.emit('entity:moveTo', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      case 'setUnitTargetUnit': {
        this._engine.events.emit('entity:moveToUnit', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.unit, vars),
        ]);
        return undefined;
      }

      case 'rotateEntityToFacePosition': {
        this._engine.events.emit('entity:facePosition', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      case 'makeUnitToAlwaysFaceMouseCursor': {
        this._engine.events.emit('entity:faceMouse', [this._resolveValue(action.entity, vars), true]);
        return undefined;
      }

      case 'makeUnitToAlwaysFacePosition': {
        this._engine.events.emit('entity:facePosition', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }

      // --- Region actions ---
      case 'transformRegionDimensions': {
        this._engine.events.emit('region:transform', [
          this._resolveValue(action.region, vars),
          this._resolveValue(action.x, vars),
          this._resolveValue(action.y, vars),
          this._resolveValue(action.width, vars),
          this._resolveValue(action.height, vars),
        ]);
        return undefined;
      }

      case 'changeRegionColor': {
        this._engine.events.emit('region:setColor', [
          this._resolveValue(action.region, vars),
          this._resolveValue(action.color, vars),
        ]);
        return undefined;
      }

      // --- Ability actions ---
      case 'castAbility':
      case 'startCastingAbility': {
        this._engine.events.emit('ability:cast', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.ability, vars),
        ]);
        return undefined;
      }

      case 'stopCastingAbility': {
        this._engine.events.emit('ability:stop', [this._resolveValue(action.entity, vars)]);
        return undefined;
      }

      case 'setLastAttackingUnit': {
        this._engine.events.emit('combat:setLastAttacker', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.attacker, vars),
        ]);
        return undefined;
      }

      case 'setLastAttackedUnit': {
        this._engine.events.emit('combat:setLastAttacked', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.target, vars),
        ]);
        return undefined;
      }

      // --- Layer and map actions ---
      case 'setLayerOpacity':
      case 'changeLayerOpacity': {
        this._engine.events.emit('map:layerOpacity', [
          this._resolveValue(action.layer, vars),
          Number(this._resolveValue(action.opacity, vars)),
        ]);
        return undefined;
      }

      case 'editMapTile':
      case 'editMapTiles': {
        this._engine.events.emit('map:editTile', [action]);
        return undefined;
      }

      case 'loadMapFromString': {
        this._engine.events.emit('map:loadFromString', [this._resolveValue(action.mapData, vars)]);
        return undefined;
      }

      // --- Entity outline ---
      case 'toggleOutlineOnEntity': {
        this._engine.events.emit('entity:outline', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.enabled, vars),
          this._resolveValue(action.color, vars),
        ]);
        return undefined;
      }

      // --- Data persistence ---
      case 'savePlayerData':
      case 'loadPlayerData': {
        this._engine.events.emit('data:player', [type, this._resolveValue(action.player, vars)]);
        return undefined;
      }

      case 'saveUnitData':
      case 'loadUnitData': {
        this._engine.events.emit('data:unit', [type, this._resolveValue(action.unit, vars)]);
        return undefined;
      }

      case 'saveCurrentMapState': {
        this._engine.events.emit('data:saveMap');
        return undefined;
      }

      // --- Chat actions ---
      case 'addChatFilter': {
        this._engine.events.emit('chat:addFilter', [this._resolveValue(action.word, vars)]);
        return undefined;
      }

      case 'banPlayerFromChat': {
        this._engine.events.emit('chat:ban', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      case 'unbanPlayerFromChat': {
        this._engine.events.emit('chat:unban', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      // --- Server control ---
      case 'startAcceptingPlayers': {
        this._engine.events.emit('server:acceptPlayers', [true]);
        return undefined;
      }

      case 'stopAcceptingPlayers': {
        this._engine.events.emit('server:acceptPlayers', [false]);
        return undefined;
      }

      // --- Floating text / fading text ---
      case 'setFadingTextOfUnit': {
        this._engine.events.emit('ui:fadingText', [
          this._resolveValue(action.unit, vars),
          this._resolveValue(action.text, vars),
          this._resolveValue(action.color, vars),
        ]);
        return undefined;
      }

      case 'createDynamicFloatingText': {
        this._engine.events.emit('ui:dynamicFloatingText', [
          this._resolveValue(action.text, vars),
          this._resolveValue(action.position, vars),
          this._resolveValue(action.color, vars),
        ]);
        return undefined;
      }

      // --- Backpack / skin shop ---
      case 'openBackpackForPlayer': {
        this._engine.events.emit('ui:openBackpack', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      case 'closeBackpackForPlayer': {
        this._engine.events.emit('ui:closeBackpack', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      case 'openSkinShop': {
        this._engine.events.emit('ui:openSkinShop');
        return undefined;
      }

      // --- Ads ---
      case 'playAdForPlayer':
      case 'playAdForEveryone': {
        this._engine.events.emit('ad:play', [this._resolveValue(action.player, vars)]);
        return undefined;
      }

      // --- Web3 ---
      case 'openWalletConnect': {
        this._engine.events.emit('web3:walletConnect');
        return undefined;
      }

      // --- Entity reset / creation ---
      case 'resetEntity': {
        this._engine.events.emit('entity:reset', [this._resolveValue(action.entity, vars)]);
        return undefined;
      }

      case 'createEntityAtPositionWithDimensions':
      case 'createEntityAtPositionWithDimensions2d': {
        this._engine.events.emit('entity:createAtPosition', [action]);
        return undefined;
      }

      // --- Script execution ---
      case 'runScript': {
        const scriptId = this._resolveValue(action.scriptName, vars) as string;
        if (scriptId) {
          this._engine.events.emit('script:run', [scriptId, { ...vars }]);
        }
        return undefined;
      }

      case 'runEntityScript': {
        this._engine.events.emit('script:runOnEntity', [
          this._resolveValue(action.entity, vars),
          this._resolveValue(action.scriptName, vars),
          { ...vars },
        ]);
        return undefined;
      }

      case 'runScriptOnClient':
      case 'runEntityScriptOnClient': {
        // In single player, same as running on server
        this._engine.events.emit('script:run', [
          this._resolveValue(action.scriptName, vars),
          { ...vars },
        ]);
        return undefined;
      }

      // --- Network actions ---
      case 'sendPostRequest':
      case 'requestPost': {
        this._engine.events.emit('network:postRequest', [
          this._resolveValue(action.url, vars),
          this._resolveValue(action.data, vars),
        ]);
        return undefined;
      }

      case 'sendDataFromClientToServer': {
        this._engine.events.emit('network:clientToServer', [this._resolveValue(action.data, vars)]);
        return undefined;
      }

      case 'sendDataFromServerToClient': {
        this._engine.events.emit('network:serverToClient', [
          this._resolveValue(action.client, vars),
          this._resolveValue(action.data, vars),
        ]);
        return undefined;
      }

      // --- Map / world / lighting ---
      // Emit `world:setGravity` so physics bodies pick up the new vector. Component decides axis count.
      case 'setGravity': {
        this._engine.events.emit('world:setGravity', [
          Number(this._resolveValue(action.x, vars)) || 0,
          Number(this._resolveValue(action.y, vars)) || 0,
          Number(this._resolveValue(action.z, vars)) || 0,
        ]);
        return undefined;
      }
      case 'setAmbientLightColor': {
        this._engine.events.emit('renderer:ambientColor', [this._resolveValue(action.color, vars)]);
        return undefined;
      }
      case 'setAmbientLightIntensity': {
        this._engine.events.emit('renderer:ambientIntensity', [
          Math.max(0, Number(this._resolveValue(action.intensity, vars)) || 0),
        ]);
        return undefined;
      }
      case 'setDirectionalLightColor': {
        this._engine.events.emit('renderer:directionalColor', [this._resolveValue(action.color, vars)]);
        return undefined;
      }
      case 'setDirectionalLightIntensity': {
        this._engine.events.emit('renderer:directionalIntensity', [
          Math.max(0, Number(this._resolveValue(action.intensity, vars)) || 0),
        ]);
        return undefined;
      }
      case 'setDirectionalLightPosition': {
        this._engine.events.emit('renderer:directionalPosition', [
          this._resolveValue(action.position, vars),
        ]);
        return undefined;
      }
      // taro splits this into setFogEnabled/Near/Far/Color/Density. We accept a top-level `setFog` toggle
      // (no taro counterpart, but listed in the audit) plus the named variants.
      case 'setFog': {
        this._engine.events.emit('renderer:fogEnabled', [Boolean(this._resolveValue(action.enabled, vars))]);
        return undefined;
      }
      case 'setFogColor': {
        this._engine.events.emit('renderer:fogColor', [this._resolveValue(action.color, vars)]);
        return undefined;
      }
      case 'setFogDensity': {
        this._engine.events.emit('renderer:fogDensity', [
          Number(this._resolveValue(action.density, vars)) || 0,
        ]);
        return undefined;
      }
      case 'setSkyboxOpacity': {
        const o = Number(this._resolveValue(action.opacity, vars));
        if (Number.isFinite(o)) {
          this._engine.events.emit('renderer:skyboxOpacity', [Math.max(0, Math.min(1, o))]);
        }
        return undefined;
      }

      // --- UI element manipulation (class + realtime CSS). setUIElementProperty/Html already handled above. ---
      case 'addClassToUIElement':
      case 'removeClassFromUIElement': {
        this._engine.events.emit('ui:elementClass', [
          type === 'addClassToUIElement' ? 'add' : 'remove',
          this._resolveValue(action.elementId, vars),
          this._resolveValue(action.className, vars),
          this._resolveValue(action.player, vars),
        ]);
        return undefined;
      }
      case 'appendRealtimeCSSForPlayer': {
        this._engine.events.emit('ui:appendCSS', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.value ?? action.css, vars),
        ]);
        return undefined;
      }

      // --- Iteration helpers ---
      // Group sources are JSON objects keyed by typeId (taro convention). Iterate keys.
      case 'forAllUnitTypes':
      case 'forAllItemTypes': {
        const group = this._resolveValue(
          type === 'forAllUnitTypes' ? action.unitTypeGroup : action.itemTypeGroup,
          vars,
        ) as Record<string, unknown> | null;
        if (!group || typeof group !== 'object') return undefined;
        const bindKey = type === 'forAllUnitTypes' ? 'selectedUnitType' : 'selectedItemType';
        for (const key of Object.keys(group)) {
          const result = this.run((action.actions as any[]) ?? [], { ...vars, [bindKey]: key });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }
      // Iterate arbitrary object/array; binds both element value and key.
      case 'forAllElementsInObject': {
        const obj = this._resolveValue(action.object, vars) as Record<string, unknown> | null;
        if (!obj || typeof obj !== 'object') return undefined;
        for (const [key, value] of Object.entries(obj)) {
          const result = this.run((action.actions as any[]) ?? [], {
            ...vars,
            selectedElement: value,
            selectedElementsKey: key,
          });
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }
      // for-in over a global variable (taro: source variable holds object/JSON-array string, main holds the key).
      case 'forIn': {
        const sourceName = action.variableNameSource as string | undefined;
        const mainName = action.variableNameMain as string | undefined;
        if (!sourceName) return undefined;
        let source = this._variables.getGlobal(sourceName);
        if (typeof source === 'string') {
          const trimmed = source.trim();
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try { source = JSON.parse(trimmed); } catch { return undefined; }
          }
        }
        if (!source || typeof source !== 'object') return undefined;
        for (const key of Object.keys(source as Record<string, unknown>)) {
          if (mainName) this._variables.setGlobal(mainName, key);
          const result = this.run((action.actions as any[]) ?? [], vars);
          if (result === 'break') break;
          if (result === 'return') return 'return';
        }
        return undefined;
      }

      // Debug-only: render a line between two world positions for the given duration.
      case 'renderLineBetweenPositions': {
        this._engine.events.emit('debug:renderLine', [
          this._resolveValue(action.startPosition ?? action.from, vars),
          this._resolveValue(action.endPosition ?? action.to, vars),
          this._resolveValue(action.color, vars),
          Number(this._resolveValue(action.duration, vars)) || 0,
        ]);
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

  // Resolve a forAll<X> group expression to a list of entity ids. Most group helpers
  // (allUnitsOwnedByPlayer, humanPlayers, allItemsOfItemType, ...) already return id arrays.
  // When the group is missing or doesn't resolve to an array, fall back to every entity of
  // that category — preserves the prior unfiltered behavior for any callers that omit the
  // group field rather than silently iterating nothing.
  private _resolveEntityGroup(group: unknown, vars: ActionVars, category: string): string[] {
    if (group !== undefined && group !== null) {
      const resolved = this._resolveValue(group, vars);
      if (Array.isArray(resolved)) return resolved as string[];
    }
    return this._engine.root.children
      .filter(e => e.category === category)
      .map(e => e.id);
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
      case 'getLastCreatedUnit':
        return this._lastCreatedUnitId;
      case 'getLastCreatedItem':
        return this._lastCreatedItemId;
      case 'getLastCreatedProjectile':
        return this._lastCreatedProjectileId;
      case 'vector3': {
        return {
          x: Number(this._resolveValue(obj.x, vars)) || 0,
          y: Number(this._resolveValue(obj.y, vars)) || 0,
          z: Number(this._resolveValue(obj.z, vars)) || 0,
        };
      }
      case 'vector2': {
        return {
          x: Number(this._resolveValue(obj.x, vars)) || 0,
          y: Number(this._resolveValue(obj.y, vars)) || 0,
        };
      }
      case 'centerOfRegion': {
        // Scripts work in taro pixel coords throughout (matches getEntityPosition which returns pixels).
        // GameServer converts to tile-units at the final spawn step.
        const region = this._resolveValue(obj.region, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        if (!region) return { x: 0, y: 0 };
        return {
          x: (region.x ?? 0) + (region.width ?? 0) / 2,
          y: (region.y ?? 0) + (region.height ?? 0) / 2,
        };
      }
      case 'getRandomPositionInRegion': {
        const region = this._resolveValue(obj.region, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        if (!region) return { x: 0, y: 0 };
        return {
          x: (region.x ?? 0) + Math.random() * (region.width ?? 0),
          y: (region.y ?? 0) + Math.random() * (region.height ?? 0),
        };
      }
      case 'getEntityVariable': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const name = this._resolveVariableKey(obj, vars);
        if (!eid || !name) return undefined;
        return this._variables.getEntityVar(eid, name);
      }
      case 'getPlayerVariable': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const name = this._resolveVariableKey(obj, vars);
        if (!pid || !name) return undefined;
        return this._variables.getPlayerVar(pid, name);
      }
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
      case 'thisEntity': {
        // `thisEntity` is the entity the per-type script is attached to. For
        // projectile scripts that's projectileId; for item scripts itemId; for
        // unit scripts unitId. Pick the entity matching the script's parent
        // category when known, otherwise fall back to whichever id is present.
        if (vars.thisEntity) return vars.thisEntity;
        const tb = vars.triggeredBy as any;
        if (!tb) return undefined;
        if (tb.entityTypeCategory === 'projectileTypes') return tb.projectileId ?? tb.entityId;
        if (tb.entityTypeCategory === 'itemTypes') return tb.itemId ?? tb.entityId;
        if (tb.entityTypeCategory === 'unitTypes') return tb.unitId ?? tb.entityId;
        return tb.unitId ?? tb.itemId ?? tb.projectileId ?? tb.entityId;
      }
      case 'getOwnerOfUnit':
      case 'getOwner': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.ownerId;
      }
      case 'stringToNumber':
        return Number(this._resolveValue(obj.value, vars));
      case 'numberToString':
        return String(this._resolveValue(obj.value, vars));
      case 'concat':
        return String(this._resolveValue(obj.textA, vars)) + String(this._resolveValue(obj.textB, vars));
      case 'getEntityAttribute': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const attr = (obj.attribute ?? obj.attributeType) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.[`attr_${attr}`]?.value;
      }
      case 'undefinedValue':
        return undefined;

      // --- Missing resolvers referenced by taro game data ---
      case 'getLastPlayerSelectingDialogueOption':
        // Populated by the UI dialogue-option response handler in vars.
        return vars.lastDialogueOptionPlayerId ?? (vars.triggeredBy as any)?.playerId;
      case 'getItemCurrentlyHeldByUnit': {
        const uid = this._resolveValue(obj.entity ?? obj.unit, vars) as string;
        const ent = this._engine.findById(uid);
        return (ent as any)?.stats?.currentItemId;
      }
      case 'getPlayerAttribute': {
        const pid = this._resolveValue(obj.entity ?? obj.player, vars) as string;
        const attr = (obj.attribute ?? obj.attributeType) as string;
        const player = this._engine.findById(pid);
        return (player as any)?.stats?.[`attr_${attr}`]?.value;
      }
      case 'entityAttributeMax': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const attr = (obj.attribute ?? obj.attributeType) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.[`attr_${attr}`]?.max;
      }
      case 'entityAttributeMin': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const attr = (obj.attribute ?? obj.attributeType) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.[`attr_${attr}`]?.min;
      }
      case 'getSourceItemOfProjectile': {
        // Script data nests the projectile under `entity:` (legacy editor shape)
        // while ActionComponent's runtime emitted `projectile:`. Accept both —
        // reading only `obj.projectile` left every Karmaslayers damage chain
        // resolving to undefined because the editor-authored CdoRHe0nNK uses
        // `entity:`, so the entire fighter-attacks-mob branch was gated off.
        const pid = this._resolveValue(obj.projectile ?? obj.entity, vars) as string;
        const proj = this._engine.findById(pid);
        return (proj as any)?.stats?.sourceId;
      }
      case 'getSourceUnitOfProjectile': {
        const pid = this._resolveValue(obj.projectile ?? obj.entity, vars) as string;
        const proj = this._engine.findById(pid);
        // The firing unit. _fireGunProjectile stamps both `sourceUnitId` (the
        // firing unit) and `sourceId` (the firing item record); the previous
        // implementation collapsed both resolvers onto `sourceId`, so any
        // script using `getSourceUnitOfProjectile` got the item id instead of
        // the unit id and downstream `getOwner(...)` calls returned nothing.
        return (proj as any)?.stats?.sourceUnitId ?? (proj as any)?.stats?.sourceId;
      }
      case 'getProjectileTypeOfProjectile': {
        const pid = this._resolveValue(obj.projectile, vars) as string;
        const p = this._engine.findById(pid);
        return (p as any)?.stats?.type;
      }
      case 'getItemMaxQuantity':
      case 'maxValueOfItemType': {
        const tid = this._resolveValue(obj.itemType ?? obj.entity ?? obj.item, vars);
        if (typeof tid !== 'string') return 0;
        const def = this.typeRegistries.itemTypes?.[tid] as { maxQuantity?: number } | undefined;
        // taro itemTypes use maxQuantity; default to a large but finite cap so calculations
        // that compare against it (`Math.min(current+n, max)`) don't blow up.
        return Number(def?.maxQuantity ?? 99);
      }
      case 'getItemQuantity': {
        const iid = this._resolveValue(obj.item ?? obj.entity, vars) as string;
        const item = this._engine.findById(iid);
        return (item as any)?.stats?.quantity ?? 1;
      }
      case 'getItemTypeName': {
        const tid = this._resolveValue(obj.itemType, vars);
        return typeof tid === 'string' ? tid : '';
      }
      case 'unitIsCarryingItemType': {
        const uid = this._resolveValue(obj.entity ?? obj.unit, vars) as string;
        const tid = this._resolveValue(obj.itemType, vars) as string;
        const unit = this._engine.findById(uid);
        const inv = ((unit as any)?.stats?.inventory ?? []) as Array<{ type?: string }>;
        return Array.isArray(inv) && inv.some(it => it?.type === tid);
      }
      case 'getNumberOfUnitsOfUnitType': {
        const tid = this._resolveValue(obj.unitType, vars);
        return this._engine.root.children.filter(e => e.category === 'unit' && (e as any).stats?.type === tid).length;
      }
      case 'getNumberOfItemsPresent': {
        return this._engine.root.children.filter(e => e.category === 'item').length;
      }
      case 'allUnitsInRegion': {
        const region = this._resolveValue(obj.region, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        if (!region) return [];
        const px = this.mapTilePx;
        const x0 = (region.x ?? 0) / px, z0 = (region.y ?? 0) / px;
        const x1 = x0 + (region.width ?? 0) / px, z1 = z0 + (region.height ?? 0) / px;
        return this._engine.root.children
          .filter(e => e.category === 'unit')
          .filter(e => {
            const p = (e as any).position;
            return p && p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
          })
          .map(e => e.id);
      }

      // Returns entity ids of script-visible categories inside the region.
      // taro filters by `entityCategories` (ParameterComponent.js, entitiesInRegion);
      // without that filter players surface here in addition to their controlled
      // units, double-counting under forAllEntities damage scripts.
      case 'entitiesInRegion': {
        const region = this._resolveValue(obj.region, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        if (!region) return [];
        const px = this.mapTilePx;
        const x0 = (region.x ?? 0) / px, z0 = (region.y ?? 0) / px;
        const x1 = x0 + (region.width ?? 0) / px, z1 = z0 + (region.height ?? 0) / px;
        return this._engine.root.children
          .filter(e => SCRIPT_ENTITY_CATEGORIES.has(e.category))
          // Held items live on as hidden entities at their original world
          // position so resolvers (`getOwnerOfItem`, attribute lookups, etc.)
          // can still find them after pickup. Without skipping them here, the
          // pickup script's `forAllEntities(entitiesInRegion)` re-grabs the
          // same hidden item on every subsequent E press, stacking its quantity
          // by 1 each time — a free-duplication exploit.
          .filter(e => !((e as any).stats?.isHidden))
          .filter(e => {
            const p = (e as any).position;
            return p && p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
          })
          .map(e => e.id);
      }

      // All region values from the variable store. Returned as a list of region
      // objects (same references as the variable values), so scripts can call
      // `nameOfRegion(selectedRegion)` to recover the variable name.
      case 'allRegions': {
        const list: unknown[] = [];
        for (const [, value, type] of this._variables.globalEntries('region')) {
          list.push(value);
        }
        return list;
      }
      case 'nameOfRegion': {
        const target = this._resolveValue(obj.region, vars);
        for (const [name, value, type] of this._variables.globalEntries('region')) {
          if (value === target) return name;
        }
        return '';
      }
      case 'selectedRegion':
        return vars.selectedRegion;
      case 'selectedEntity':
        return vars.selectedEntity;
      // C8 iteration bindings (forAllUnitTypes / forAllItemTypes / forAllElementsInObject).
      case 'selectedUnitType':
        return vars.selectedUnitType;
      case 'selectedItemType':
        return vars.selectedItemType;
      case 'selectedElement':
        return vars.selectedElement;
      case 'selectedElementsKey':
        return vars.selectedElementsKey;
      case 'allUnitsOfUnitType': {
        const tid = this._resolveValue(obj.unitType, vars);
        return this._engine.root.children.filter(e => e.category === 'unit' && (e as any).stats?.type === tid).map(e => e.id);
      }
      case 'allUnitsOwnedByPlayer': {
        const pid = this._resolveValue(obj.player, vars) as string;
        return this._engine.root.children.filter(e => e.category === 'unit' && (e as any).stats?.ownerId === pid).map(e => e.id);
      }
      case 'allItemsOfItemType': {
        const tid = this._resolveValue(obj.itemType, vars);
        return this._engine.root.children
          .filter(e => e.category === 'item' && (e as any).stats?.type === tid)
          .map(e => e.id);
      }
      case 'getNumberOfPlayersOfPlayerType': {
        const tid = this._resolveValue(obj.playerType, vars);
        return this._engine.root.children.filter(e =>
          e.category === 'player' &&
          ((e as any).stats?.playerTypeId === tid || (e as any).stats?.playerType === tid),
        ).length;
      }
      case 'getItemDescription': {
        const iid = this._resolveValue(obj.item ?? obj.entity, vars) as string;
        const item = this._engine.findById(iid);
        return (item as any)?.stats?.description ?? '';
      }
      case 'targetUnit':
        return vars.targetUnit;
      case 'getLastAttackingUnit': {
        // Three sources, in priority order: explicit script var, trigger ctx (entityGetsAttacked
        // populates this), then the entity's stored lastAttackingUnit stat written by
        // combat:setLastAttacker — taro reads from `entity._stats.lastAttackingUnitId`.
        if (vars.lastAttackingUnit) return vars.lastAttackingUnit;
        const tb = vars.triggeredBy as any;
        if (tb?.lastAttackingUnit) return tb.lastAttackingUnit;
        const eid = (this._resolveValue(obj.unit ?? obj.entity, vars) as string) || (tb?.unitId as string);
        if (!eid) return undefined;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.lastAttackingUnit;
      }
      case 'getLastAttackedUnit': {
        const tb = vars.triggeredBy as any;
        if (tb?.lastAttackedUnit) return tb.lastAttackedUnit;
        const eid = (this._resolveValue(obj.unit ?? obj.entity, vars) as string) || (tb?.unitId as string);
        if (!eid) return undefined;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.lastAttackedUnit;
      }
      case 'getLastCastingUnit':
        return vars.lastCastingUnit ?? (vars.triggeredBy as any)?.lastCastingUnit;
      case 'getLastChatMessageSentByPlayer': {
        const pid = this._resolveValue(obj.player, vars) as string;
        return this._lastChatByPlayer.get(pid) ?? '';
      }
      case 'getRandomItemTypeFromItemTypeGroup': {
        // taro: group shape is `{itemTypeId: {probability: N}}` and the pick is
        // probability-weighted (ParameterComponent.js:2008). Falling back to uniform
        // random made high-rarity drops as common as commons. Arrays / bare-id
        // groups still get uniform random as a safe default.
        const group = this._resolveValue(obj.itemTypeGroup ?? obj.itemGroup, vars);
        if (!group) return '';
        if (Array.isArray(group)) {
          const arr = group as string[];
          return arr.length ? arr[Math.floor(Math.random() * arr.length)] : '';
        }
        if (typeof group !== 'object') return '';
        const entries = Object.entries(group as Record<string, unknown>);
        if (!entries.length) return '';
        const weights = entries.map(([id, info]) => ({
          id,
          p: Math.max(0, Number((info as { probability?: number } | null)?.probability) || 0),
        }));
        const total = weights.reduce((s, w) => s + w.p, 0);
        if (total <= 0) {
          // No probabilities defined — fall back to uniform pick across keys.
          return entries[Math.floor(Math.random() * entries.length)][0];
        }
        const r = Math.random() * total;
        let acc = 0;
        for (const w of weights) {
          acc += w.p;
          if (r < acc) return w.id;
        }
        return weights[weights.length - 1].id;
      }
      case 'updateStringArrayElement': {
        // Returns a new array with element at index replaced. Pure — no mutation.
        const arr = this._resolveValue(obj.array ?? obj.stringArray, vars);
        const idx = Number(this._resolveValue(obj.index, vars)) || 0;
        const value = this._resolveValue(obj.value, vars);
        if (!Array.isArray(arr)) return [];
        const out = [...arr];
        if (idx >= 0 && idx < out.length) out[idx] = value;
        return out;
      }
      case 'getMapTileId': {
        // Tile id at a tile-coordinate position; needs map data. Return 0 for now.
        // GameServer will populate `mapData` on the runner once we wire it up.
        return 0;
      }
      case 'isPositionInWall': {
        // Check the wall layer for a non-zero tile at this pixel position.
        const pos = this._resolveValue(obj.position, vars) as { x?: number; y?: number } | null;
        if (!pos || !this.mapData) return false;
        const map = this.mapData;
        const tx = Math.floor((pos.x ?? 0) / this.mapTilePx);
        const ty = Math.floor((pos.y ?? 0) / this.mapTilePx);
        const layers = (map.layers ?? []) as Array<{ name?: string; data?: number[] }>;
        const wall = layers.find(l => l.name === 'walls');
        if (!wall?.data) return false;
        const w = (map.width as number) || 0;
        const h = (map.height as number) || 0;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
        return wall.data[ty * w + tx] !== 0;
      }
      case 'allItemsOwnedByUnit': {
        const uid = this._resolveValue(obj.unit, vars) as string;
        const unit = this._engine.findById(uid);
        const inv = ((unit as any)?.stats?.inventory ?? []) as Array<{ id?: string }>;
        return Array.isArray(inv) ? inv.map(it => it?.id).filter(Boolean) : [];
      }
      case 'getPlayerUsername':
      case 'getPlayerName': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = this._engine.findById(pid);
        return (p as any)?.stats?.name ?? '';
      }
      case 'getOwnerOfItem': {
        const iid = this._resolveValue(obj.entity ?? obj.item, vars) as string;
        const it = this._engine.findById(iid);
        return (it as any)?.stats?.ownerId;
      }
      case 'getPlayerSelectedUnit': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = this._engine.findById(pid);
        return (p as any)?.stats?.selectedUnitId;
      }
      case 'isPlayerLoggedIn': {
        // taro convention: a player is "logged in" when they have a username/displayName
        // attached. Single-player local players just have their typed name; we treat that
        // as logged-in so save/load gates trigger consistently.
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = this._engine.findById(pid);
        return !!((p as any)?.stats?.username ?? (p as any)?.stats?.name);
      }
      case 'playerIsControlledByHuman': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = this._engine.findById(pid);
        return (p as any)?.stats?.controlledBy === 'human';
      }
      case 'playerTypeOfPlayer': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = this._engine.findById(pid);
        return (p as any)?.stats?.playerTypeId ?? (p as any)?.stats?.playerType;
      }
      case 'playersOfPlayerType': {
        const tid = this._resolveValue(obj.playerType, vars);
        return this._engine.root.children
          .filter(e => e.category === 'player' && ((e as any).stats?.playerTypeId === tid || (e as any).stats?.playerType === tid))
          .map(e => e.id);
      }
      case 'humanPlayers':
        return this._engine.root.children.filter(e => e.category === 'player' && (e as any).stats?.controlledBy === 'human').map(e => e.id);
      case 'entityExists': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        return !!this._engine.findById(eid);
      }
      case 'getSelectedEntity':
        return vars.selectedEntity ?? vars.selectedUnit ?? vars.selectedItem;
      case 'entityFacingAngle':
      case 'unitsFacingAngle': {
        // taro rounds to 3 decimal places (ParameterComponent.js — `roundOff(value, 3)`).
        // Without rounding, scripts that compare two facing angles (e.g. AI alignment
        // checks) get spurious mismatches from floating-point noise out of the physics step.
        const eid = this._resolveValue(obj.entity ?? obj.unit, vars) as string;
        const ent = this._engine.findById(eid);
        const r = (ent as any)?.rotation;
        if (r === undefined || r === null) return 0;
        return Math.round((r as number) * 1000) / 1000;
      }
      case 'entityBounds': {
        // taro returns the AABB top-left, NOT the entity's center:
        //   {x: translate.x - width/2, y: translate.y - height/2, width, height}
        // (ParameterComponent.js, entityBounds). The previous modu impl placed
        // the box's top-left at the entity center, breaking every region-overlap
        // check that compares against entityBounds output.
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        if (!ent) return { x: 0, y: 0, width: 0, height: 0 };
        const stats = (ent as any).stats;
        const body = stats?.currentBody ?? stats?.bodies?.default;
        const w = Number(body?.width) || this.mapTilePx;
        const h = Number(body?.height) || this.mapTilePx;
        const cx = (ent as any).position.x * this.mapTilePx;
        const cy = (ent as any).position.z * this.mapTilePx;
        return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
      }
      case 'dynamicRegion': {
        return {
          x: Number(this._resolveValue(obj.x, vars)) || 0,
          y: Number(this._resolveValue(obj.y, vars)) || 0,
          width: Number(this._resolveValue(obj.width, vars)) || 0,
          height: Number(this._resolveValue(obj.height, vars)) || 0,
        };
      }
      case 'regionOverlapsWithRegion': {
        const a = this._resolveValue(obj.regionA ?? obj.a, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        const b = this._resolveValue(obj.regionB ?? obj.b, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        if (!a || !b) return false;
        const ax1 = (a.x ?? 0), ay1 = (a.y ?? 0), ax2 = ax1 + (a.width ?? 0), ay2 = ay1 + (a.height ?? 0);
        const bx1 = (b.x ?? 0), by1 = (b.y ?? 0), bx2 = bx1 + (b.width ?? 0), by2 = by1 + (b.height ?? 0);
        return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
      }
      case 'getPositionX':
        return (this._resolveValue(obj.position, vars) as any)?.x ?? 0;
      case 'getPositionY':
        return (this._resolveValue(obj.position, vars) as any)?.y ?? 0;
      case 'getPositionInFrontOfPosition': {
        const pos = this._resolveValue(obj.position, vars) as { x?: number; y?: number } | null;
        const angle = Number(this._resolveValue(obj.angle ?? obj.rotation, vars)) || 0;
        const dist = Number(this._resolveValue(obj.distance, vars)) || 0;
        if (!pos) return { x: 0, y: 0 };
        // taro subtracts π/2 here (ActionComponent.js:2093). With angleBetweenPositions
        // also offset by π/2 (above), the two cancel for the standard "spawn projectile
        // at angle from A toward B" pattern. The offset makes "angle 0 = up on screen".
        const a = angle - Math.PI / 2;
        return { x: (pos.x ?? 0) + Math.cos(a) * dist, y: (pos.y ?? 0) + Math.sin(a) * dist };
      }
      case 'getMouseCursorPosition': {
        // GameServer stores the latest cursor position on the player's selected unit
        // as `_mousePosition` in engine tile-units (x = world X, y = world Z).
        // Scripts work in taro pixel coords, so multiply by mapTilePx.
        const playerId =
          (this._resolveValue(obj.player, vars) as string) ||
          ((vars.triggeredBy as any)?.playerId as string) ||
          '';
        const player = playerId ? this._engine.findById(playerId) : null;
        const unitId = (player as any)?.stats?.selectedUnitId;
        const unit = unitId ? this._engine.findById(unitId) : null;
        const mp = (unit as any)?._mousePosition;
        if (!mp) return { x: 0, y: 0 };
        return { x: (mp.x ?? 0) * this.mapTilePx, y: (mp.y ?? 0) * this.mapTilePx };
      }
      // taro's `substringOf` is a *slice*, not a contains check:
      // `string.substring(fromIndex, toIndex)` (ParameterComponent.js:2408).
      // The previous boolean implementation broke any script using it as
      // "give me chars [from..to)". Both indices clamp into the string's range.
      case 'substringOf': {
        const s = this._resolveValue(obj.string, vars);
        if (typeof s !== 'string' || s.length === 0) return '';
        const fromRaw = Number(this._resolveValue(obj.fromIndex, vars));
        const toRaw = Number(this._resolveValue(obj.toIndex, vars));
        const fromIndex = Math.max(Math.min(Number.isFinite(fromRaw) ? fromRaw : 0, s.length - 1), 0);
        const toIndex   = Math.max(Math.min(Number.isFinite(toRaw)   ? toRaw   : s.length, s.length), 0);
        return s.substring(fromIndex, toIndex);
      }
      case 'toLowerCase':
        return String(this._resolveValue(obj.value ?? obj.string, vars) ?? '').toLowerCase();
      case 'getLengthOfString':
        return String(this._resolveValue(obj.value ?? obj.string, vars) ?? '').length;
      // taro `toFixed` (ParameterComponent.js): reads `text.value` + `text.precision`
      // and returns a *number* (`parseFloat(parseFloat(num).toFixed(precision))`).
      // The previous `obj.digits` lookup didn't match game data, and returning a
      // string broke arithmetic on the result. Accept `precision` *and* `digits`
      // so anything authored to either spec keeps working.
      case 'toFixed': {
        const num = Number(this._resolveValue(obj.value, vars) ?? 0);
        const p = Number(this._resolveValue(obj.precision ?? obj.digits, vars)) || 0;
        return parseFloat(num.toFixed(p));
      }
      // taro `getExponent` reads `text.power` (ParameterComponent.js:2486-2494). The
      // previous `obj.exponent` lookup never matched real game data, returning 0.
      case 'getExponent':
        return Math.pow(
          Number(this._resolveValue(obj.base, vars)) || 0,
          Number(this._resolveValue(obj.power ?? obj.exponent, vars)) || 0,
        );
      case 'mathFloor':
        return Math.floor(Number(this._resolveValue(obj.value, vars)) || 0);
      // taro reads `text.num1` / `text.num2` (ParameterComponent.js:2466-2484); accept
      // those plus `a/b` and `value1/value2` so older / mistyped game data still resolves.
      case 'getMin':
        return Math.min(
          Number(this._resolveValue(obj.num1 ?? obj.a ?? obj.value1, vars)) || 0,
          Number(this._resolveValue(obj.num2 ?? obj.b ?? obj.value2, vars)) || 0,
        );
      case 'getMax':
        return Math.max(
          Number(this._resolveValue(obj.num1 ?? obj.a ?? obj.value1, vars)) || 0,
          Number(this._resolveValue(obj.num2 ?? obj.b ?? obj.value2, vars)) || 0,
        );
      case 'getAttributeTypeOfAttribute':
        // Editor-authored scripts pass the attribute reference under `entity:` (the
        // generic entity-targeted shape), while ActionRunner's tests / runtime emitters
        // sometimes use `attribute:`. Reading only `obj.attribute` made every
        // `unitAttributeBecomesZero` death script fail its top-level
        // `getAttributeTypeOfAttribute(getTriggeringAttribute()) == "health"` gate
        // (resolved to undefined), so mobs reached 0 HP but never ran the destroy/loot
        // branch — they sat at 0 HP, still rendered, still colliding, looking unkillable.
        return this._resolveValue(obj.attribute ?? obj.entity, vars);
      case 'getTriggeringAttribute':
        return (vars.triggeredBy as any)?.attributeId;
      case 'getItemAtSlot':
      // Taro alias — same shape as getItemAtSlot but reads `slot` (1-indexed in some calls).
      // We accept both keys to be tolerant; slot indexing matches the underlying inventory array.
      case 'getItemInInventorySlot': {
        const uid = this._resolveValue(obj.unit ?? obj.entity, vars) as string;
        const slot = Number(this._resolveValue(obj.slotIndex ?? obj.slot, vars)) || 0;
        const unit = this._engine.findById(uid);
        const inv = ((unit as any)?.stats?.inventory ?? []) as Array<{ id?: string }>;
        return inv[slot]?.id;
      }
      // Currently-held inventory slot index (1-based to match taro: currentItemIndex + 1).
      case 'selectedInventorySlot': {
        const uid = this._resolveValue(obj.unit ?? obj.entity, vars) as string;
        const unit = this._engine.findById(uid);
        const idx = Number((unit as any)?.stats?.currentItemIndex);
        return Number.isFinite(idx) ? idx + 1 : 0;
      }
      // Sensor object handle hung off the unit. No sensor system in modu yet — return undefined
      // when absent so downstream comparisons gracefully fail.
      case 'getSensorOfUnit': {
        const uid = this._resolveValue(obj.unit, vars) as string;
        const unit = this._engine.findById(uid);
        return (unit as any)?.sensor ?? undefined;
      }
      // Radius read off unit.sensor first (live), then static unitType.ai.sensorRadius (taro fallback).
      case 'unitSensorRadius': {
        const uid = this._resolveValue(obj.unit, vars) as string;
        const unit = this._engine.findById(uid) as any;
        if (unit?.sensor?.radius != null) return Number(unit.sensor.radius);
        return Number(unit?.stats?.ai?.sensorRadius ?? 0);
      }
      // The unit a sensor belongs to. Sensor stores its owner unit id in taro.
      case 'ownerUnitOfSensor': {
        const sensor = this._resolveValue(obj.sensor, vars) as { ownerUnitId?: string } | null;
        return sensor?.ownerUnitId ?? undefined;
      }
      // Last raycast hit position cached on the entity by physics during raycast actions.
      case 'entityLastRaycastCollisionPosition': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid) as any;
        return ent?.lastRaycastCollisionPosition ?? null;
      }
      case 'playersAreHostile': {
        const a = this._resolveValue(obj.playerA, vars) as string;
        const b = this._resolveValue(obj.playerB, vars) as string;
        if (!a || !b || a === b) return false;
        // Default any two distinct players to hostile. Taro tracks per-player
        // friend / neutral / hostile lists (Player.isFriendlyTo etc.); until
        // those are wired here, returning `false` from this resolver gated off
        // the entire damage chain in PvE/arena games — `unitTouchesProjectile`
        // scripts in Karmaslayers, F0mB1BW05, celleater, etc. all read
        // `playersAreHostile(firingPlayer, targetPlayer) == true` before
        // applying damage. Treating distinct players as hostile by default
        // matches taro's effective behaviour for games that don't author a
        // friend list and only over-applies damage in the rare game that
        // explicitly relies on neutral relations between distinct players.
        return true;
      }
      case 'playerCustomInput':
        // Value from a client-submitted form; not wired in single-player yet.
        return vars.customInput ?? '';

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
        // Engine stores positions in tile units; scripts work in pixels (taro convention).
        // Use the runtime mapTilePx — tilewidth varies per game (Karmaslayers = 16, others 32 / 64).
        if (!ent) return { x: 0, y: 0 };
        // Held inventory items are hidden at origin (0,0,0) — taro's model is that a
        // carried item visually rides on its holder, so `getEntityPosition(heldItem)`
        // should report the holder's location. Without this delegation, scripts like
        // "press G to drop item" call `dropItemAtPosition(item, getEntityPosition(item))`
        // and the dropped world item lands at the map origin instead of the player's feet.
        const ownerId = (ent as any).stats?.ownerId as string | undefined;
        if (ownerId && (ent as any).stats?.isHidden) {
          const owner = this._engine.findById(ownerId);
          if (owner) return { x: owner.position.x * this.mapTilePx, y: owner.position.z * this.mapTilePx };
        }
        return { x: ent.position.x * this.mapTilePx, y: ent.position.z * this.mapTilePx };
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
        // taro adds π/2 here (ParameterComponent.js:2175). The convention is "0 = facing
        // negative-Y" so that angle 0 means up on screen — without this offset every
        // AI aim and rotateEntityToFacePosition is rotated 90° wrong.
        return Math.atan2((pB.y || 0) - (pA.y || 0), (pB.x || 0) - (pA.x || 0)) + Math.PI / 2;
      }

      // --- Trigger context ---
      case 'lastTriggeringRegion':
      case 'getTriggeringRegion': {
        // Region triggers (entityEntersRegion / entityLeavesRegion) populate
        // both `region` (the value object — same reference as the matching variable
        // so == compares correctly) and `regionId` (variable name) on triggeredBy.
        const tb = (vars.triggeredBy ?? {}) as Record<string, unknown>;
        return tb.region ?? tb.regionId;
      }
      case 'getEntityType': {
        // Per-entity form (taro convention): `getEntityType({entity: ...})` returns the
        // entity's category — `'unit'` / `'item'` / `'projectile'` / `'region'` / `'prop'`.
        // Karmaslayers' "press E to pick up item" iterates `forAllEntities(entitiesInRegion)`
        // and gates the `makeUnitPickupItem` action on `getEntityType(getSelectedEntity) == 'item'`;
        // ignoring `obj.entity` collapses every comparison to `undefined == 'item'`, so the
        // pickup action never fires. Only fall back to the trigger-context value when no
        // entity is supplied (legacy no-arg shape).
        if (obj.entity !== undefined) {
          const eid = this._resolveValue(obj.entity, vars) as string;
          const ent = this._engine.findById(eid);
          return (ent as any)?.category;
        }
        return vars.triggeredBy && (vars.triggeredBy as any).entityType;
      }

      case 'getUnitTypeOfUnit': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.type;
      }

      case 'getItemTypeOfItem': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.type;
      }

      case 'getValueOfEntityVariable': {
        // Modu emits a flat `variableName: 'foo'` field; the legacy editor still
        // produces taro's nested shape `variable: {variable: {key: 'foo'}}`
        // (Selector.tsx:44 reads `obj.variable.variable.key`). Accept either —
        // otherwise scripts authored in the legacy editor look up `undefined`
        // and silently return undefined.
        const eid = this._resolveValue(obj.entity, vars) as string;
        const name = this._resolveVariableKey(obj, vars);
        if (!eid || !name) return undefined;
        return this._variables.getEntityVar(eid, name);
      }

      case 'getValueOfPlayerVariable': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const name = this._resolveVariableKey(obj, vars);
        if (!pid || !name) return undefined;
        return this._variables.getPlayerVar(pid, name);
      }

      case 'allUnits':
        return this._engine.root.children.filter(e => e.category === 'unit').map(e => e.id);

      case 'allPlayers':
        return this._engine.root.children.filter(e => e.category === 'player').map(e => e.id);

      case 'allItems':
        return this._engine.root.children.filter(e => e.category === 'item').map(e => e.id);

      case 'getEntityName': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.name;
      }

      case 'lastPlayedTimeOfPlayer':
        return Date.now();

      case 'getMapWidth':
        // Width in PIXELS, the unit scripts expect (matches getEntityPosition output).
        return ((this.mapData?.width as number) || 0) * this.mapTilePx;

      case 'getMapHeight':
        return ((this.mapData?.height as number) || 0) * this.mapTilePx;

      // --- Player/unit relationship ---
      case 'getSelectedUnit': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const player = this._engine.findById(pid);
        return (player as any)?.stats?.selectedUnitId;
      }

      case 'getUnitsOwnedByPlayer': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const player = this._engine.findById(pid);
        return (player as any)?.stats?.unitIds ?? [];
      }

      case 'getPlayerFromUnit': {
        const uid = this._resolveValue(obj.unit, vars) as string;
        const unit = this._engine.findById(uid);
        return (unit as any)?.stats?.ownerId;
      }

      case 'getQuantityOfUnitDroppedItem': {
        // Sum quantity over all items currently in the world owned by no unit
        // (i.e. dropped items) of a specific type. Best-effort given current data.
        const tid = this._resolveValue(obj.itemType, vars);
        if (typeof tid !== 'string') return 0;
        return this._engine.root.children
          .filter(e => e.category === 'item' && (e as any).stats?.type === tid && !(e as any).stats?.ownerId)
          .reduce((acc, e) => acc + (Number((e as any).stats?.quantity) || 1), 0);
      }

      case 'getQuantityOfItemType': {
        // Total quantity across all items of this type, including those held in inventories.
        const tid = this._resolveValue(obj.itemType, vars);
        if (typeof tid !== 'string') return 0;
        let total = 0;
        for (const e of this._engine.root.children) {
          if (e.category === 'item' && (e as any).stats?.type === tid) {
            total += Number((e as any).stats?.quantity) || 1;
          }
          if (e.category === 'unit') {
            const inv = ((e as any).stats?.inventory ?? []) as Array<{ type?: string; quantity?: number }>;
            for (const it of inv) {
              if (it.type === tid) total += Number(it.quantity) || 1;
            }
          }
        }
        return total;
      }

      // --- Entity state/dimensions ---
      case 'getEntityState': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.stateId ?? 'default';
      }

      case 'entityWidth':
      case 'getEntityWidth': {
        // taro multiplies the body width by `scaleBody` (ParameterComponent.js:1324).
        // Without this factor scaled units (e.g. boss enemies) report their pre-scale
        // size, breaking range / hitbox checks built on entityWidth.
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid) as any;
        const stats = ent?.stats;
        const body = stats?.currentBody ?? stats?.bodies?.default;
        const base = Number(body?.width ?? stats?.width) || this.mapTilePx;
        const scale = Number(stats?.scaleBody);
        return base * (Number.isFinite(scale) ? scale : 1);
      }
      case 'entityHeight':
      case 'getEntityHeight': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid) as any;
        const stats = ent?.stats;
        const body = stats?.currentBody ?? stats?.bodies?.default;
        const base = Number(body?.height ?? stats?.height) || this.mapTilePx;
        const scale = Number(stats?.scaleBody);
        return base * (Number.isFinite(scale) ? scale : 1);
      }

      case 'getEntityRotation': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.rotation ?? 0;
      }

      // --- Math helpers ---
      case 'min':
        return Math.min(Number(this._resolveValue(obj.a, vars)), Number(this._resolveValue(obj.b, vars)));

      case 'max':
        return Math.max(Number(this._resolveValue(obj.a, vars)), Number(this._resolveValue(obj.b, vars)));

      // --- Array/string helpers ---
      case 'length': {
        const arr = this._resolveValue(obj.value, vars);
        return Array.isArray(arr) ? arr.length : typeof arr === 'string' ? arr.length : 0;
      }

      case 'indexOf': {
        const arr = this._resolveValue(obj.array, vars) as any[];
        const val = this._resolveValue(obj.value, vars);
        return Array.isArray(arr) ? arr.indexOf(val) : -1;
      }

      case 'true':
        return true;

      case 'false':
        return false;

      case 'null':
      case 'undefined':
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
      // --- B1. Additional string functions ---
      // taro stringContains uses `string` + `keyword`; see ParameterComponent.js:1580.
      // taro has an unconditional `returnValue = false` bug after the if; we return
      // the *intended* semantics. Note: undefined/null inputs return false (not true via
      // empty-string indexOf) so a missing variable can't accidentally match.
      case 'stringContains': {
        const s = this._resolveValue(obj.string, vars);
        if (typeof s !== 'string') return false;
        const k = this._resolveValue(obj.keyword, vars);
        if (k === undefined || k === null) return false;
        return s.indexOf(String(k)) > -1;
      }
      case 'stringStartsWith': {
        const s = this._resolveValue(obj.sourceString, vars);
        const p = this._resolveValue(obj.patternString, vars);
        return typeof s === 'string' && typeof p === 'string' && s.startsWith(p);
      }
      case 'stringEndsWith': {
        const s = this._resolveValue(obj.sourceString, vars);
        const p = this._resolveValue(obj.patternString, vars);
        return typeof s === 'string' && typeof p === 'string' && s.endsWith(p);
      }
      case 'replaceValuesInString': {
        const s = this._resolveValue(obj.sourceString, vars);
        const m = this._resolveValue(obj.matchString, vars);
        const n = this._resolveValue(obj.newString, vars);
        if (typeof s !== 'string' || typeof m !== 'string' || typeof n !== 'string') return undefined;
        // taro builds `new RegExp(matchString, 'g')` (ParameterComponent.js:2452). Match that
        // exactly — including the implicit regex semantics — so script behavior carries over.
        return s.replace(new RegExp(m, 'g'), n);
      }
      case 'filterString': {
        // taro pipes through `taro.chat.filter.cleanHacked`. We don't ship a chat
        // filter; pass the string through unchanged. Scripts that try to display
        // unfiltered text still work — they just don't get profanity censoring.
        return String(this._resolveValue(obj.string, vars) ?? '');
      }
      case 'toUpperCase':
        return String(this._resolveValue(obj.value ?? obj.string, vars) ?? '').toUpperCase();

      // String arrays — taro stores them as JSON-encoded strings, parses on each call,
      // and returns the modified result re-stringified (no mutation). See
      // ParameterComponent.js:2247–2388.
      case 'getStringArrayLength': {
        const s = this._resolveValue(obj.string, vars);
        if (typeof s !== 'string' || !s) return undefined;
        try { const a = JSON.parse(s); return Array.isArray(a) ? a.length : undefined; }
        catch { return undefined; }
      }
      case 'getStringArrayElement': {
        const s = this._resolveValue(obj.string, vars);
        const i = Number(this._resolveValue(obj.number, vars));
        if (typeof s !== 'string' || !s || !Number.isFinite(i)) return undefined;
        try { const a = JSON.parse(s); return Array.isArray(a) ? a[i] : undefined; }
        catch { return undefined; }
      }
      case 'insertStringArrayElement': {
        const s = this._resolveValue(obj.string, vars);
        const v = this._resolveValue(obj.value, vars);
        if (typeof s !== 'string' || !s || v === undefined) return undefined;
        try {
          const a = JSON.parse(s);
          if (!Array.isArray(a)) return undefined;
          a.push(v);
          return JSON.stringify(a);
        } catch { return undefined; }
      }
      case 'removeStringArrayElement': {
        const s = this._resolveValue(obj.string, vars);
        const i = Number(this._resolveValue(obj.number, vars));
        if (typeof s !== 'string' || !s || !Number.isFinite(i)) return undefined;
        try {
          const a = JSON.parse(s);
          if (!Array.isArray(a)) return undefined;
          a.splice(i, 1);
          return JSON.stringify(a);
        } catch { return undefined; }
      }

      // --- B2. Additional math functions ---
      case 'mathRound':
        return Math.round(Number(this._resolveValue(obj.value, vars)) || 0);
      case 'mathCeiling':
        return Math.ceil(Number(this._resolveValue(obj.value, vars)) || 0);
      case 'mathSign':
        return Math.sign(Number(this._resolveValue(obj.value, vars)) || 0);
      case 'log10':
        return Math.log10(Number(this._resolveValue(obj.value, vars)) || 0);
      // taro uses `obj.number` for these; ParameterComponent.js:847,855,863,869.
      case 'toRadians':
        return (Number(this._resolveValue(obj.number, vars)) || 0) * (Math.PI / 180);
      case 'toDegrees':
        return (Number(this._resolveValue(obj.number, vars)) || 0) * (180 / Math.PI);
      case 'absoluteValueOfNumber':
        return Math.abs(Number(this._resolveValue(obj.number, vars)) || 0);
      case 'arctan':
        return Math.atan(Number(this._resolveValue(obj.number, vars)) || 0);
      case 'squareRoot':
        return Math.sqrt(Number(this._resolveValue(obj.number, vars)) || 0);
      // sin/cos already exist with `obj.value`; tan matches that pattern but taro reads
      // `obj.angle` (ParameterComponent.js:896). Accept both.
      case 'tan':
        return Math.tan(Number(this._resolveValue(obj.angle ?? obj.value, vars)) || 0);
      case 'lerp': {
        const a = Number(this._resolveValue(obj.valueA, vars));
        const b = Number(this._resolveValue(obj.valueB, vars));
        const t = Number(this._resolveValue(obj.alpha, vars));
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t)) return undefined;
        return (b - a) * t + a;
      }
      case 'notValue':
        return !this._resolveValue(obj.boolean, vars);

      // --- B3. Additional region functions ---
      // Bounding-box hit-tests done in pixel coords (regions store {x,y,width,height} in pixels,
      // matching getEntityPosition's pixel output). entityBounds returns position*tilePx already.
      case 'unitIsInRegion':
      case 'itemIsInRegion': {
        // Plain AABB hit-test in pixel coords. Taro doesn't filter by category
        // (ParameterComponent.js:327, 374) — it just tests whether the given
        // entity sits inside the region — so we match that and don't reject
        // players (who extend Unit but carry category 'player').
        const region = this._resolveValue(obj.region, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        const eid = this._resolveValue(fn === 'unitIsInRegion' ? obj.unit : obj.item, vars) as string;
        if (!region || !eid) return false;
        const ent = this._engine.findById(eid) as any;
        if (!ent || !ent.position) return false;
        const px = (ent.position.x ?? 0) * this.mapTilePx;
        const py = (ent.position.z ?? 0) * this.mapTilePx;
        const x0 = region.x ?? 0, y0 = region.y ?? 0;
        return px >= x0 && px <= x0 + (region.width ?? 0) && py >= y0 && py <= y0 + (region.height ?? 0);
      }
      // Region centered on a point `distance` ahead of `entity` in its facing direction.
      // Mirrors taro ActionComponent — takes the angle/cos+sin offset by -π/2 (so that
      // entity rotation 0 means "facing up on screen") and centers a (width,height) box
      // on that point. See ParameterComponent.js:2622–2716.
      case 'regionInFrontOfEntityAtDistance':
      case 'entitiesInRegionInFrontOfEntityAtDistance': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const dist = Number(this._resolveValue(obj.distance, vars));
        const w = Number(this._resolveValue(obj.width, vars));
        const h = Number(this._resolveValue(obj.height, vars));
        const ent = this._engine.findById(eid) as any;
        if (!ent || !Number.isFinite(dist) || !Number.isFinite(w) || !Number.isFinite(h)) {
          return fn === 'regionInFrontOfEntityAtDistance' ? undefined : [];
        }
        const ex = (ent.position?.x ?? 0) * this.mapTilePx;
        const ey = (ent.position?.z ?? 0) * this.mapTilePx;
        const a = (ent.rotation ?? 0) - Math.PI / 2;
        const cx = ex + Math.cos(a) * dist;
        const cy = ey + Math.sin(a) * dist;
        const region = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
        if (fn === 'regionInFrontOfEntityAtDistance') return region;
        // Hit-test live engine children, but restrict to the categories taro
        // exposes to scripts (ActionComponent.js:8). Without this we'd surface
        // players (separate from their controlled units) and any non-script
        // bookkeeping entities that happen to sit at the origin.
        const x0 = region.x, y0 = region.y, x1 = x0 + w, y1 = y0 + h;
        return this._engine.root.children
          .filter(e => SCRIPT_ENTITY_CATEGORIES.has(e.category))
          .filter(e => {
            const p = (e as any).position; if (!p) return false;
            const px = p.x * this.mapTilePx, py = p.z * this.mapTilePx;
            return px >= x0 && px <= x1 && py >= y0 && py <= y1;
          })
          .map(e => e.id);
      }
      // Whole-map region in pixel coords. taro returns {_stats: {default: …}};
      // modu uses flat {x,y,width,height} consistently (see centerOfRegion).
      case 'getEntireMapRegion': {
        const w = ((this.mapData?.width as number) || 0) * this.mapTilePx;
        const h = ((this.mapData?.height as number) || 0) * this.mapTilePx;
        return { x: 0, y: 0, width: w, height: h };
      }
      // taro reads region._stats.default.{x,y,width,height}; modu regions are flat.
      case 'getXCoordinateOfRegion':
        return (this._resolveValue(obj.region, vars) as any)?.x ?? 0;
      case 'getYCoordinateOfRegion':
        return (this._resolveValue(obj.region, vars) as any)?.y ?? 0;
      case 'getWidthOfRegion':
        return (this._resolveValue(obj.region, vars) as any)?.width ?? 0;
      case 'getHeightOfRegion':
        return (this._resolveValue(obj.region, vars) as any)?.height ?? 0;
      // Random position in region, retried up to 20× until it is not on a wall tile.
      // Mirrors taro behavior (ParameterComponent.js:1482) but skips the entity-overlap
      // check (taro's isPositionInEntity walks every entity body — too costly without
      // a spatial index). Wall avoidance alone covers the common spawn-safety case.
      case 'getRandomPlayablePositionInRegion': {
        const region = this._resolveValue(obj.region, vars) as { x?: number; y?: number; width?: number; height?: number } | null;
        if (!region) return undefined;
        for (let i = 0; i < 20; i++) {
          const x = (region.x ?? 0) + Math.random() * (region.width ?? 0);
          const y = (region.y ?? 0) + Math.random() * (region.height ?? 0);
          if (!this._isPositionInWall(x, y)) return { x, y };
        }
        return undefined;
      }

      // --- B4. Entity introspection ---
      case 'entityName': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.name;
      }
      case 'entityOpacity': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.opacity ?? 1;
      }
      case 'entityColor': {
        // No first-class color in modu UnitStats yet; surface stats.color if a game
        // happens to set one, else empty string. Returning '' (not undefined) so
        // string-concat usage doesn't propagate an "undefined" literal.
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.color ?? '';
      }
      // taro's `getEntityFromId` returns the entity *reference*. Modu addresses entities
      // by id throughout, so return the id (string) when the entity exists, else undefined.
      // Scripts that pass this into other readers (`{function: 'getEntityName', entity: …}`)
      // work transparently because those readers expect ids.
      case 'getEntityFromId': {
        const id = this._resolveValue(obj.string, vars) as string;
        return id && this._engine.findById(id) ? id : undefined;
      }
      // taro returns `entity.id()`; modu uses ids directly so this is a passthrough
      // that also coerces an entity-shaped object to its id when given one.
      case 'getEntityId': {
        const e = this._resolveValue(obj.entity, vars);
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object' && typeof (e as any).id === 'string') return (e as any).id;
        return undefined;
      }
      // Velocity readers — bridged through the velocityProvider field that GameServer
      // populates from its private _entityBodies map. Returns 0 when no body exists
      // (matches taro's behavior on bodiless entities; ParameterComponent.js:972).
      case 'getEntityVelocityX': {
        if (!this.velocityProvider) return 0;
        const eid = this._resolveValue(obj.entity, vars) as string;
        return this.velocityProvider(eid)?.x ?? 0;
      }
      case 'getEntityVelocityY': {
        if (!this.velocityProvider) return 0;
        const eid = this._resolveValue(obj.entity, vars) as string;
        return this.velocityProvider(eid)?.y ?? 0;
      }
      case 'getEntityVelocityZ': {
        if (!this.velocityProvider) return 0;
        const eid = this._resolveValue(obj.entity, vars) as string;
        return this.velocityProvider(eid)?.z ?? 0;
      }

      // --- B5. Player functions ---
      // taro looks up `taro.game.getPlayerByUserId(userId)`; modu walks engine entities
      // and matches against `stats.userId`. Use loose equality (==) to mirror taro's
      // GameComponent.js:214, so a numeric userId in stats matches a string-typed
      // script value (and vice versa).
      case 'getPlayerByUserId': {
        const uid = this._resolveValue(obj.userId, vars);
        if (uid === undefined || uid === null || uid === '') return undefined;
        const found = this._engine.root.children.find(e =>
          // eslint-disable-next-line eqeqeq
          e.category === 'player' && (e as any).stats?.userId == uid,
        );
        return found?.id;
      }
      case 'getPlayerFromId': {
        const id = this._resolveValue(obj.string, vars) as string;
        const ent = id ? this._engine.findById(id) : null;
        return ent && ent.category === 'player' ? id : undefined;
      }
      // No relationship system yet (taro Player.isFriendlyTo / isNeutralTo). Two
      // players are "friendly" iff they're the same player, and "neutral" iff
      // they're not hostile and not friendly — without hostility data, treat all
      // distinct players as neutral. Matches the safest baseline for scripts that
      // gate damage / interaction on these checks.
      case 'playersAreFriendly': {
        const a = this._resolveValue(obj.playerA, vars);
        const b = this._resolveValue(obj.playerB, vars);
        return !!a && a === b;
      }
      case 'playersAreNeutral': {
        const a = this._resolveValue(obj.playerA, vars);
        const b = this._resolveValue(obj.playerB, vars);
        return !!a && !!b && a !== b;
      }
      case 'playerCurrentDialogue': {
        // Reads `stats.currentDialogueId`. The current `openDialogueForPlayer`
        // action only emits a `ui:openDialogue` event without writing the
        // player's stats, so this returns '' until a dialogue store is wired
        // up. The reader is shaped so that wiring is the only follow-up needed.
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = pid ? this._engine.findById(pid) : null;
        return ((p as any)?.stats?.currentDialogueId as string) ?? '';
      }
      case 'playerHasAdblockEnabled': {
        // Browser-side detection only; on server-side scripts, no detection signal
        // is available. Surface whatever the player record carries; default false.
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = pid ? this._engine.findById(pid) : null;
        return !!(p && (p as any).stats?.isAdBlockEnabled);
      }
      case 'playerIsCreator': {
        // Equivalent to taro's `player._stats.userId == taro.game.data.defaultData.owner`.
        // taro uses loose equality on purpose — userId is sometimes stored as a Mongo
        // ObjectId string, sometimes a number; strict `===` returns false across the
        // type mismatch and silently locks creator-only branches out for everyone.
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = pid ? this._engine.findById(pid) : null;
        if (!p || !this.gameOwnerUserId) return false;
        const uid = (p as any).stats?.userId ?? null;
        // eslint-disable-next-line eqeqeq
        return uid != null && uid == this.gameOwnerUserId;
      }
      case 'lastPlayerMessage': {
        const pid = this._resolveValue(obj.player, vars) as string;
        return this._lastChatByPlayer.get(pid) ?? '';
      }
      case 'botPlayers':
        return this._engine.root.children
          .filter(e => e.category === 'player' && !!(e as any).stats?.isBot)
          .map(e => e.id);
      case 'computerPlayers':
        return this._engine.root.children
          .filter(e => e.category === 'player' && (e as any).stats?.controlledBy === 'computer')
          .map(e => e.id);

      // --- B6. Camera functions ---
      // Camera state lives on the renderer (client-only). Server-side scripts return
      // safe zeros so calculations don't propagate NaN. SinglePlayer / client wires
      // up `cameraStateProvider` to surface real values.
      case 'getCameraPosition': {
        const c = this.cameraStateProvider?.();
        return c ? { x: c.x, y: c.y } : { x: 0, y: 0 };
      }
      case 'getCameraWidth':
        return this.cameraStateProvider?.()?.width ?? 0;
      case 'getCameraHeight':
        return this.cameraStateProvider?.()?.height ?? 0;
      case 'getCameraPitch':
        return this.cameraStateProvider?.()?.pitch ?? 0;
      case 'getCameraYaw':
        return this.cameraStateProvider?.()?.yaw ?? 0;

      // --- B7. Quest functions ---
      // Quest state is expected at `player.stats.quests = {active: {[gameId]: {[questId]: {progress, goal}}}, completed: {[gameId]: [questId]}}`.
      // The current modu engine forwards quest:* events without persisting state, so
      // these readers return defaults until a quest store wires it up. Scripts that
      // gate on quest progress will then start working without further changes.
      case 'getQuestObject': {
        const q = this._getQuestRecord(obj, vars);
        return q ?? undefined;
      }
      case 'getQuestProgress': {
        const q = this._getQuestRecord(obj, vars);
        return q?.progress;
      }
      case 'isQuestActive': {
        const q = this._getQuestRecord(obj, vars);
        return q !== undefined;
      }
      case 'isQuestProgressCompleted': {
        const q = this._getQuestRecord(obj, vars);
        return !!q && q.progress !== undefined && q.goal !== undefined && q.progress === q.goal;
      }
      case 'isQuestCompleted': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const questId = this._resolveValue(obj.questId, vars) as string;
        if (!pid || !questId) return false;
        const p = this._engine.findById(pid);
        const quests = (p as any)?.stats?.quests as { completed?: Record<string, string[]> } | undefined;
        const completedAll = quests?.completed;
        if (!completedAll) return false;
        // Match either flat (string[]) or per-game keyed shape — taro uses the
        // per-game form keyed by `taro.game.data.defaultData._id`. Without that id
        // exposed yet, just check every bucket.
        if (Array.isArray(completedAll)) return (completedAll as string[]).includes(questId);
        for (const ids of Object.values(completedAll)) {
          if (Array.isArray(ids) && ids.includes(questId)) return true;
        }
        return false;
      }
      case 'getAllActiveQuestObjects':
      case 'getAllActiveQuestObjectsInThisMap': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const p = pid ? this._engine.findById(pid) : null;
        const active = (p as any)?.stats?.quests?.active ?? {};
        return active;
      }

      default:
        // Unknown function — return undefined
        return undefined;
    }
  }

  /** Look up the active quest record for (player, questId). Returns a flat
   *  `{progress, goal}`-shaped object if found, else undefined.
   *  Tolerates two storage shapes: flat (`active[questId]`) and per-game-keyed
   *  (`active[gameId][questId]`, taro convention). */
  private _getQuestRecord(obj: Record<string, unknown>, vars: ActionVars): { progress?: number; goal?: number } | undefined {
    const pid = this._resolveValue(obj.player, vars) as string;
    const questId = this._resolveValue(obj.questId, vars) as string;
    if (!pid || !questId) return undefined;
    const p = this._engine.findById(pid);
    const active = (p as any)?.stats?.quests?.active as Record<string, unknown> | undefined;
    if (!active) return undefined;
    const direct = active[questId];
    if (direct && typeof direct === 'object') return direct as { progress?: number; goal?: number };
    for (const v of Object.values(active)) {
      if (v && typeof v === 'object' && questId in (v as Record<string, unknown>)) {
        const inner = (v as Record<string, unknown>)[questId];
        if (inner && typeof inner === 'object') return inner as { progress?: number; goal?: number };
      }
    }
    return undefined;
  }

  /** Resolve the target variable name for an entity/player-variable getter.
   *  Modu serializes the variable as a flat `variableName: 'foo'`, but scripts
   *  exported from the legacy editor still carry taro's nested shape
   *  `variable: {function: 'getEntityVariable', variable: {key: 'foo'}}`.
   *  We try the flat field first, then fall back to walking the nested form. */
  private _resolveVariableKey(obj: Record<string, unknown>, vars: ActionVars): string | undefined {
    const flat = obj.variableName;
    if (typeof flat === 'string' && flat.length > 0) return flat;
    const v = obj.variable as unknown;
    if (typeof v === 'string' && v.length > 0) return v;
    if (v && typeof v === 'object') {
      const inner = (v as { variable?: unknown }).variable;
      if (inner && typeof inner === 'object') {
        const key = (inner as { key?: unknown }).key;
        if (typeof key === 'string' && key.length > 0) return key;
      }
      const k = (v as { key?: unknown }).key;
      if (typeof k === 'string' && k.length > 0) return k;
    }
    return undefined;
  }

  /** Pixel-coordinate wall-tile check used by `getRandomPlayablePositionInRegion`.
   *  Mirrors the shape used in `isPositionInWall` above, but reusable from helpers
   *  that already have a {x, y} pixel pair. */
  private _isPositionInWall(x: number, y: number): boolean {
    if (!this.mapData) return false;
    const map = this.mapData;
    const tx = Math.floor(x / this.mapTilePx);
    const ty = Math.floor(y / this.mapTilePx);
    const layers = (map.layers ?? []) as Array<{ name?: string; data?: number[] }>;
    const wall = layers.find(l => l.name === 'walls');
    if (!wall?.data) return false;
    const w = (map.width as number) || 0;
    const h = (map.height as number) || 0;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
    return wall.data[ty * w + tx] !== 0;
  }
}
