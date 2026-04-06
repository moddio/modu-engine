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
        this._engine.events.emit('item:use', [
          this._resolveValue(action.entity, vars),
        ]);
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

      case 'sendCoinsToPlayer': {
        this._engine.events.emit('coins:send', [
          this._resolveValue(action.player, vars),
          Number(this._resolveValue(action.coins, vars)),
        ]);
        return undefined;
      }

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

      case 'setUnitNameLabel': {
        this._engine.events.emit('entity:setNameLabel', [
          this._resolveValue(action.entity, vars),
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

      case 'makePlayerSelectUnit': {
        this._engine.events.emit('player:selectUnit', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.unit, vars),
        ]);
        return undefined;
      }

      case 'assignPlayerType': {
        this._engine.events.emit('player:assignType', [
          this._resolveValue(action.player, vars),
          this._resolveValue(action.playerType, vars),
        ]);
        return undefined;
      }

      case 'kickPlayer': {
        this._engine.events.emit('player:kick', [this._resolveValue(action.player, vars)]);
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
        return this._variables.getEntityVar(
          this._resolveValue(obj.entity, vars) as string,
          obj.variableName as string,
        );
      }

      case 'getValueOfPlayerVariable': {
        return this._variables.getPlayerVar(
          this._resolveValue(obj.player, vars) as string,
          obj.variableName as string,
        );
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

      case 'getPlayerName': {
        const pid = this._resolveValue(obj.player, vars) as string;
        const player = this._engine.findById(pid);
        return (player as any)?.stats?.name;
      }

      case 'lastPlayedTimeOfPlayer':
        return Date.now();

      case 'getMapWidth':
        return this._engine.root.children.length; // placeholder

      case 'getMapHeight':
        return this._engine.root.children.length; // placeholder

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
        return 1; // placeholder
      }

      case 'getQuantityOfItemType': {
        return 1; // placeholder
      }

      // --- Entity state/dimensions ---
      case 'getEntityState': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.stateId ?? 'default';
      }

      case 'getEntityWidth':
      case 'getEntityHeight': {
        const eid = this._resolveValue(obj.entity, vars) as string;
        const ent = this._engine.findById(eid);
        return (ent as any)?.stats?.width ?? 32;
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
      default:
        // Unknown function — return undefined
        return undefined;
    }
  }
}
