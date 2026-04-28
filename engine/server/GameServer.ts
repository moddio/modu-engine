import { Engine } from '../core/Engine';
import { ScriptEngine } from '../core/scripting/ScriptEngine';
import { EntityTypeRegistry } from '../core/game/EntityTypeRegistry';
import { Unit } from '../core/game/Unit';
import { Player } from '../core/game/Player';
import { PhysicsWorld } from '../core/physics/PhysicsWorld';
import { Vec2 } from '../core/math/Vec2';
import { CollisionCategory, DefaultCollisionMask } from '../core/physics/CollisionFilter';
import { GameLoop } from './GameLoop';
import { MessageType, encodeTransform } from '../core/protocol/Messages';
import { buildEntityCreatePayload } from '../core/protocol/EntityStream';
import type { ServerTransport } from './transport/ServerTransport';
import type { GameMessage } from '../core/protocol/Messages';
import type { GameData, ScriptDef } from '../core/GameLoader';
import type { RigidBody } from '../core/physics/RigidBody';

export class GameServer {
  readonly engine: Engine;
  readonly scripts: ScriptEngine;
  readonly types: EntityTypeRegistry;
  private _transport: ServerTransport;
  private _loop: GameLoop;
  private _gameData: GameData | null = null;
  private _rawGameData: Record<string, any> | null = null;
  private _entities = new Map<string, any>();
  private _players = new Map<string, { player: Player; clientId: string; unitId: string }>();
  private _tickCount = 0;
  private _physics: PhysicsWorld | null = null;
  private _entityBodies = new Map<string, RigidBody>(); // entityId → physics body
  private _bodyToEntity = new Map<number, string>();    // rapier body handle → entityId
  private _wallBodyHandles = new Set<number>();         // rapier body handles of static wall tiles
  private _secondTickAccumMs = 0;
  /** Region-typed variables: name → {x,y,width,height} (taro pixel coords). Same
   *  object reference as the variable's value, so `getTriggeringRegion ==
   *  getVariable('foo')` compares correctly. */
  private _regionVars = new Map<string, { x: number; y: number; width: number; height: number }>();
  /** Per-(entityId, regionName) inside-state, used to fire enter/leave on transition. */
  private _regionMembership = new Map<string, Set<string>>(); // entityId → set of region names
  private _regionAccumMs = 0;
  /** Last computed facing rotation for each AI-controlled unit.  Cached so
   *  that units moving below the speed threshold hold their prior heading
   *  instead of snapping to 0 after _syncPhysicsToEntities zeroes body.angle. */
  private _aiUnitFacingRotation = new Map<string, number>();

  constructor(transport: ServerTransport) {
    this._transport = transport;
    this.engine = Engine.instance();
    this.scripts = new ScriptEngine(this.engine);
    this.types = new EntityTypeRegistry();
    this._loop = new GameLoop(20, (dt) => this._tick(dt));

    this._transport.onConnect((clientId) => this._onClientConnect(clientId));
    this._transport.onDisconnect((clientId) => this._onClientDisconnect(clientId));
  }

  get isRunning(): boolean { return this._loop.isRunning; }
  get playerCount(): number { return this._players.size; }
  get entityCount(): number { return this._entities.size; }
  get gameData(): GameData | null { return this._gameData; }

  /** Initialize with migrated game data. Optionally pass raw (pre-migration) data for initialize scripts. */
  async init(gameData: GameData, rawGameData?: Record<string, any>): Promise<void> {
    this._gameData = gameData;
    this._rawGameData = rawGameData || null;

    // Latch the tile pixel size from map data BEFORE creating any physics bodies —
    // _tileToPhysics and _createWallBodies must share the same scale or they end up
    // in disjoint coordinate spaces (wall bodies 4x further than units, no collisions).
    if (typeof (gameData.map as any)?.tilewidth === 'number') {
      this._tilePx = (gameData.map as any).tilewidth;
    }

    // Initialize Rapier physics (WASM — requires async init)
    try {
      const RAPIER = await import('@dimforge/rapier2d-compat');
      await RAPIER.init();
      const gravity = new Vec2(0, 0); // Top-down game: no gravity
      this._physics = new PhysicsWorld(gravity);

      // Create wall bodies from tilemap
      this._createWallBodies();
    } catch {
      // Physics initialization failed — continue without physics
      console.warn('[GameServer] Rapier physics not available, running without physics');
    }
    if (typeof gameData.settings?.frameRate === 'number') {
      this._loop.tickRate = gameData.settings.frameRate as number;
    }
    this.types.load(gameData.entities);
    if (gameData.variables) {
      this.scripts.loadVariables(gameData.variables as Record<string, { value: unknown; type: string }>);
    }
    if (gameData.scripts) {
      this.scripts.load(gameData.scripts as Record<string, ScriptDef>);
    }

    // Load per-entity-type scripts. Taro stores `entityTouchesWall`,
    // `entityLeavesRegion`, `itemIsUsed`, etc. under `unitTypes/itemTypes/projectileTypes/<id>.scripts`,
    // not at the top level. Without this they were never indexed and never ran.
    // Use raw game data because the migrator strips the `scripts` field when
    // shaping `entities.unitTypes`.
    // Prefer raw (pre-migration) data which has top-level unitTypes/etc, but
    // fall back to the migrated `entities.<category>` shape used by GameMigrator
    // output and tests. The per-type `.scripts` field is preserved either way.
    const rawForTypes = this._rawGameData ?? (gameData as unknown as Record<string, unknown>);
    const migratedEntities = (gameData.entities ?? {}) as Record<string, unknown>;
    const pickTypes = (key: string) =>
      (rawForTypes[key] as Record<string, unknown> | undefined) ??
      (migratedEntities[key] as Record<string, unknown> | undefined);
    this.scripts.loadEntityTypeScripts('unitTypes', pickTypes('unitTypes'));
    this.scripts.loadEntityTypeScripts('itemTypes', pickTypes('itemTypes'));
    this.scripts.loadEntityTypeScripts('projectileTypes', pickTypes('projectileTypes'));

    // Index `region`-typed variables. Pull the SAME object reference that the
    // ScriptEngine VariableStore holds so `getTriggeringRegion == getVariable('name')`
    // compares by identity. Variable shape from migrator: {value: {x,y,width,height}, type: 'region'}.
    this._regionVars.clear();
    for (const [name, entry] of Object.entries(gameData.variables ?? {})) {
      const e = entry as { value?: unknown; type?: string };
      if (e?.type !== 'region') continue;
      const v = e.value as { x?: number; y?: number; width?: number; height?: number } | null;
      if (!v) continue;
      const region = {
        x: v.x ?? 0, y: v.y ?? 0, width: v.width ?? 0, height: v.height ?? 0,
      };
      this._regionVars.set(name, region);
      // Republish so getVariable(name) returns the same object as getTriggeringRegion.
      this.scripts.variables.setGlobal(name, region, 'region');
    }

    // Handle script-emitted actions. EventEmitter spreads arrays into callback args,
    // so ActionRunner's `emit('scriptAction', [type, action, vars])` calls us with 3 args.
    this.engine.events.on('scriptAction', (type: unknown, action: unknown, vars: unknown) => {
      this._handleScriptAction(
        type as string,
        (action ?? {}) as Record<string, unknown>,
        (vars ?? {}) as Record<string, unknown>,
      );
    });

    // Handle script:run events from ActionRunner
    this.engine.events.on('script:run', (scriptId: unknown, vars: unknown) => {
      this.scripts.runScript(scriptId as string, (vars ?? {}) as Record<string, unknown>);
    });

    // Forward script-emitted UI requests to clients as UICommand messages.
    const forwardUI = (command: string) => (...callArgs: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command, args: callArgs },
      });
    };
    this.engine.events.on('ui:openDialogue', forwardUI('openDialogue'));
    this.engine.events.on('ui:closeDialogue', forwardUI('closeDialogue'));
    this.engine.events.on('ui:openShop', forwardUI('openShop'));
    this.engine.events.on('ui:closeShop', forwardUI('closeShop'));
    this.engine.events.on('ui:showText', forwardUI('showText'));
    this.engine.events.on('ui:hideText', forwardUI('hideText'));
    this.engine.events.on('ui:updateText', forwardUI('updateText'));

    // Script asks to re-target the camera (and switch which unit receives player input).
    // Karmaslayers uses this in playerJoinsGame: a temp unit is created in _onJoinGame,
    // then the script spawns the real unit and calls playerCameraTrackUnit to switch.
    this.engine.events.on('camera:trackUnit', (playerId: unknown, unitId: unknown) => {
      if (typeof playerId !== 'string' || typeof unitId !== 'string') return;
      // Find the client that owns this player
      for (const pd of this._players.values()) {
        if (pd.player.id === playerId) {
          pd.unitId = unitId;
          this._transport.send(pd.clientId, {
            type: MessageType.InitConnection,
            data: { playerId, unitId },
          });
          break;
        }
      }
    });

    // ActionRunner emits these whenever a script calls setEntityAttribute /
    // setEntityAttributeMax / setEntityAttributeMin / setEntityAttributeRegenerationRate.
    // Apply to the entity's `attr_*` slot, broadcast the change, and (for value writes)
    // fire entityAttributeBecomesZero / Full triggers — those are the gates Karmaslayers
    // uses for death, item-charge-up, and many UI effects.
    const writeAttr = (eid: string, aId: string, mutate: (a: any) => void, broadcastFields: (a: any) => Record<string, unknown>) => {
      const entity = this._entities.get(eid);
      if (!entity?.stats) return;
      const slot = `attr_${aId}`;
      const attr = entity.stats[slot];
      if (!attr) return;
      mutate(attr);
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [eid]: { [slot]: broadcastFields(attr) } },
      });
    };
    this.engine.events.on('setEntityAttribute', (eId: unknown, aId: unknown, val: unknown) => {
      const entityId = eId as string;
      const attrId = aId as string;
      const value = Number(val);
      if (!entityId || !attrId || !Number.isFinite(value)) return;
      writeAttr(entityId, attrId,
        (attr) => { attr.value = Math.max(attr.min, Math.min(attr.max, value)); },
        (attr) => ({ value: attr.value, min: attr.min, max: attr.max }),
      );
      const entity = this._entities.get(entityId);
      const attr = entity?.stats?.[`attr_${attrId}`];
      if (!attr) return;
      if (attr.value <= attr.min) {
        // Both event names: taro game data uses both spellings interchangeably and the
        // migrator preserves trigger names verbatim, so we have to fire both to match either.
        this.scripts.trigger('entityAttributeBecomesZero', { entityId, attributeId: attrId });
        this.scripts.trigger('unitAttributeBecomesZero', { entityId, attributeId: attrId });
      }
      if (attr.value >= attr.max) {
        this.scripts.trigger('entityAttributeBecomesFull', { entityId, attributeId: attrId });
        this.scripts.trigger('unitAttributeBecomesFull', { entityId, attributeId: attrId });
      }
    });
    this.engine.events.on('setEntityAttributeMax', (eId: unknown, aId: unknown, val: unknown) => {
      const v = Number(val); if (!Number.isFinite(v)) return;
      writeAttr(eId as string, aId as string,
        (attr) => {
          attr.max = v;
          if (attr.value > attr.max) attr.value = attr.max;
        },
        (attr) => ({ max: attr.max, value: attr.value }),
      );
    });
    this.engine.events.on('setEntityAttributeMin', (eId: unknown, aId: unknown, val: unknown) => {
      const v = Number(val); if (!Number.isFinite(v)) return;
      writeAttr(eId as string, aId as string,
        (attr) => {
          attr.min = v;
          if (attr.value < attr.min) attr.value = attr.min;
        },
        (attr) => ({ min: attr.min, value: attr.value }),
      );
    });
    this.engine.events.on('setEntityAttributeRegenRate', (eId: unknown, aId: unknown, val: unknown) => {
      const v = Number(val); if (!Number.isFinite(v)) return;
      writeAttr(eId as string, aId as string,
        (attr) => { attr.regenerateSpeed = v; },
        (attr) => ({ regenerateSpeed: attr.regenerateSpeed }),
      );
    });

    // Chat — bridge ActionRunner's `chat:broadcast` / `chat:toPlayer` / `chat:systemMessage`
    // events to a real ChatMessage protocol packet so the client can render them.
    const chatBroadcast = (text: unknown, fromPlayerId?: string) => {
      this._transport.broadcast({
        type: MessageType.ChatMessage,
        data: { text: String(text ?? ''), fromPlayerId: fromPlayerId ?? null, system: !fromPlayerId },
      });
    };
    this.engine.events.on('chat:broadcast', (text: unknown) => chatBroadcast(text));
    this.engine.events.on('chat:systemMessage', (text: unknown) => chatBroadcast(text));
    this.engine.events.on('chat:toPlayer', (rawPlayerId: unknown, text: unknown) => {
      const targetPlayerId = rawPlayerId as string;
      if (!targetPlayerId) return;
      // Find the client that owns this player and send only to them.
      for (const pd of this._players.values()) {
        if (pd.player.id === targetPlayerId) {
          this._transport.send(pd.clientId, {
            type: MessageType.ChatMessage,
            data: { text: String(text ?? ''), fromPlayerId: null, system: true, toPlayerId: targetPlayerId },
          });
          return;
        }
      }
    });

    // --- Phase 2 action handlers ---

    // setVelocityOfEntityXY — direct linear velocity write on the Rapier body.
    // Velocity values come through in raw "taro physics units" (pixels / SCALE_RATIO);
    // we set them as-is. Velocities outside that scale will need recalibration in the script.
    this.engine.events.on('physics:setVelocity', (rawEid: unknown, vx: unknown, vy: unknown) => {
      const eid = rawEid as string;
      if (!eid) return;
      const body = this._entityBodies.get(eid);
      if (!body) return;
      body.linearVelocity = new Vec2(Number(vx) || 0, Number(vy) || 0);
    });

    // physics:applyImpulse and physics:applyForce — translate the angular form
    // (`{impulse: scalar, angle: radians}`) and the XY form (`{impulse: {x,y}}`)
    // into Rapier impulses on the body.
    const physicsApply = (kind: 'impulse' | 'force') => (rawEid: unknown, magOrVec: unknown, angle: unknown) => {
      const eid = rawEid as string;
      const body = eid ? this._entityBodies.get(eid) : null;
      if (!body) return;
      let vx = 0, vy = 0;
      if (magOrVec && typeof magOrVec === 'object') {
        const v = magOrVec as { x?: number; y?: number };
        vx = Number(v.x) || 0; vy = Number(v.y) || 0;
      } else {
        const mag = Number(magOrVec) || 0;
        const ang = Number(angle) || 0;
        vx = Math.cos(ang) * mag;
        vy = Math.sin(ang) * mag;
      }
      // taro values are calibrated for an immediate per-tick application.
      const SCALE = 0.5;
      const v = new Vec2(vx * SCALE, vy * SCALE);
      if (kind === 'impulse') body.applyImpulse(v);
      else body.applyForce(v);
    };
    this.engine.events.on('physics:applyImpulse', physicsApply('impulse'));
    this.engine.events.on('physics:applyForce', physicsApply('force'));

    // spawnItem — free-standing item drop at a pixel-coord position.
    this.engine.events.on('item:spawn', (rawTypeId: unknown, rawPos: unknown) => {
      const typeId = rawTypeId as string;
      const pos = rawPos as { x?: number; y?: number } | null;
      if (!typeId || !pos) return;
      const typeDef = this.types.get('itemTypes', typeId) as Record<string, unknown> | null;
      if (!typeDef) return;
      const px = (pos.x ?? 0) / this._tilePx;
      const pz = (pos.y ?? 0) / this._tilePx;
      const entityId = `itm_${Math.random().toString(36).slice(2, 10)}`;
      this._transport.broadcast({
        type: MessageType.EntityCreate,
        data: buildEntityCreatePayload('item', entityId, px, pz, 0, { ...typeDef, type: typeId }),
      });
      // Track the newly-spawned item in the engine tree so ActionRunner resolvers
      // (getLastCreatedItem, getOwnerOfItem, etc.) can find it.
      const item = this.engine.spawn(entityId);
      item.category = 'item';
      item.position.x = px; item.position.z = pz;
      (item as any).stats = { ...(typeDef as Record<string, unknown>), type: typeId, quantity: 1 };
      this._entities.set(entityId, item);
      // entityCreatedGlobal carries itemId so ActionRunner's listener captures it.
      this.scripts.trigger('entityCreatedGlobal', { entityId, itemId: entityId });
      this.scripts.trigger('entityCreated', { itemId: entityId });
    });

    // setPlayerAttribute / setPlayerAttributeMax — analog of setEntityAttribute
    // but on a Player entity. Same broadcast path (clients render player HUD from stats).
    this.engine.events.on('player:setAttribute', (rawPid: unknown, rawAttr: unknown, val: unknown) => {
      const playerId = rawPid as string;
      const attrId = rawAttr as string;
      const value = Number(val);
      if (!playerId || !attrId || !Number.isFinite(value)) return;
      const player = this._entities.get(playerId);
      if (!player?.stats) return;
      const slot = `attr_${attrId}`;
      let attr = player.stats[slot];
      if (!attr) attr = player.stats[slot] = { value: 0, min: 0, max: Number.MAX_SAFE_INTEGER };
      attr.value = Math.max(attr.min ?? 0, Math.min(attr.max ?? Number.MAX_SAFE_INTEGER, value));
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [playerId]: { [slot]: { value: attr.value, min: attr.min, max: attr.max } } },
      });
    });
    this.engine.events.on('player:setAttributeMax', (rawPid: unknown, rawAttr: unknown, val: unknown) => {
      const playerId = rawPid as string;
      const attrId = rawAttr as string;
      const value = Number(val);
      if (!playerId || !attrId || !Number.isFinite(value)) return;
      const player = this._entities.get(playerId);
      if (!player?.stats) return;
      const slot = `attr_${attrId}`;
      let attr = player.stats[slot];
      if (!attr) attr = player.stats[slot] = { value: 0, min: 0, max: 0 };
      attr.max = value;
      if (attr.value > attr.max) attr.value = attr.max;
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [playerId]: { [slot]: { max: attr.max, value: attr.value } } },
      });
    });

    // AI commands — write the unit's _aiState target so _processAI uses it instead of wandering.
    this.engine.events.on('ai:moveToPosition', (rawUid: unknown, rawPos: unknown) => {
      const uid = rawUid as string;
      const pos = rawPos as { x?: number; y?: number } | null;
      if (!uid || !pos) return;
      const unit = this._entities.get(uid);
      if (!unit) return;
      // Convert pixel target → physics coords (AI target is consumed in physics units).
      const tx = (pos.x ?? 0) / GameServer.SCALE_RATIO;
      const ty = (pos.y ?? 0) / GameServer.SCALE_RATIO;
      unit._aiState = unit._aiState || { target: null, pickCooldownMs: 0 };
      unit._aiState.target = { x: tx, y: ty };
      unit._aiState.targetUnitId = null;
      unit._aiState.pickCooldownMs = 5000;
    });
    this.engine.events.on('ai:attackUnit', (rawUid: unknown, rawTargetId: unknown) => {
      const uid = rawUid as string;
      const targetId = rawTargetId as string;
      if (!uid || !targetId) return;
      const unit = this._entities.get(uid);
      const target = this._entities.get(targetId);
      if (!unit || !target) return;
      unit._aiState = unit._aiState || { target: null, pickCooldownMs: 0 };
      unit._aiState.targetUnitId = targetId;
      unit._aiState.pickCooldownMs = 10000;
    });

    // Projectile linkage — lets `getOwnerOfItem(getSourceItemOfProjectile(this))`
    // resolve correctly inside per-projectile scripts.
    this.engine.events.on('projectile:setOwner', (rawPid: unknown, rawUid: unknown) => {
      const pid = rawPid as string;
      const ent = this._entities.get(pid);
      if (!ent) return;
      ent.stats = ent.stats || {};
      ent.stats.ownerId = rawUid as string;
    });
    this.engine.events.on('projectile:setSource', (rawPid: unknown, rawIid: unknown) => {
      const pid = rawPid as string;
      const ent = this._entities.get(pid);
      if (!ent) return;
      ent.stats = ent.stats || {};
      ent.stats.sourceId = rawIid as string;
    });

    // updateUiTextForTimeForPlayer — like ui:updateText but auto-clear after `time` ms.
    // Forward as a single UICommand so the client can manage the timer.
    this.engine.events.on('ui:updateTextForTime', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'updateTextForTime', args },
      });
    });
    this.engine.events.on('ui:updateTextForEveryone', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'updateTextForEveryone', args },
      });
    });
    this.engine.events.on('ui:dismissibleInputModal', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'dismissibleInputModal', args },
      });
    });
    this.engine.events.on('ui:fadingText', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'fadingText', args },
      });
    });
    this.engine.events.on('ui:floatingText', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'floatingText', args },
      });
    });
    this.engine.events.on('camera:setZoom', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'setCameraZoom', args },
      });
    });
    this.engine.events.on('audio:playMusicForPlayer', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'playMusic', args },
      });
    });
    this.engine.events.on('audio:playSound', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'playSound', args },
      });
    });

    this.engine.events.on('item:setDescription', (rawIid: unknown, desc: unknown) => {
      const iid = rawIid as string;
      const item = this._entities.get(iid);
      if (!item) return;
      item.stats = item.stats || {};
      item.stats.description = String(desc ?? '');
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [iid]: { description: item.stats.description } },
      });
    });
    this.engine.events.on('item:setFireRate', (rawIid: unknown, rate: unknown) => {
      const iid = rawIid as string;
      const item = this._entities.get(iid);
      if (!item) return;
      item.stats = item.stats || {};
      item.stats.fireRate = Number(rate) || 0;
    });
    this.engine.events.on('item:setQuantity', (rawIid: unknown, qty: unknown) => {
      const iid = rawIid as string;
      const item = this._entities.get(iid);
      if (!item) return;
      item.stats = item.stats || {};
      item.stats.quantity = Number(qty) || 0;
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [iid]: { quantity: item.stats.quantity } },
      });
    });

    this.engine.events.on('player:sendCoins', (rawPid: unknown, coins: unknown) => {
      const pid = rawPid as string;
      const amt = Number(coins) || 0;
      const player = this._entities.get(pid);
      if (!player?.stats) return;
      player.stats.coins = (Number(player.stats.coins) || 0) + amt;
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [pid]: { coins: player.stats.coins } },
      });
    });

    this.engine.events.on('game:end', () => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'endGame', args: [] },
      });
      this._loop.stop();
    });

    // data:player save/load — no-op in single-player; in production this hits the SDK.
    this.engine.events.on('data:player', () => { /* no-op */ });

    // Inventory item grant — write a shallow record into unit.stats.inventory and broadcast.
    this.engine.events.on('inventory:giveItem', (rawUid: unknown, rawTypeId: unknown, rawQty: unknown) => {
      const uid = rawUid as string;
      const typeId = rawTypeId as string;
      const qty = Number(rawQty) || 1;
      if (!uid || !typeId) return;
      const unit = this._entities.get(uid);
      if (!unit?.stats) return;
      const inv = (unit.stats.inventory ?? (unit.stats.inventory = [])) as Array<{ id: string; type: string; quantity: number }>;
      const id = `inv_${Math.random().toString(36).slice(2, 10)}`;
      inv.push({ id, type: typeId, quantity: qty });
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [uid]: { inventory: inv } },
      });
    });

    // --- Phase 3: entity stat mutations + visual UICommand forwards ---

    // Generic helper: write a stat field and broadcast.
    const writeStat = (eid: string, patch: Record<string, unknown>) => {
      const ent = this._entities.get(eid);
      if (!ent) return;
      ent.stats = ent.stats || {};
      Object.assign(ent.stats, patch);
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [eid]: patch },
      });
    };

    this.engine.events.on('entity:setScale', (rawEid: unknown, scale: unknown) => {
      const eid = rawEid as string;
      const s = Number(scale) || 1;
      const ent = this._entities.get(eid);
      if (!ent) return;
      // Mirror to entity.scale (Vec3) so any consumer reading scale.x picks it up.
      if (ent.scale) { ent.scale.x = s; ent.scale.y = s; ent.scale.z = s; }
      writeStat(eid, { scale: s });
    });
    this.engine.events.on('entity:setVisible', (rawEid: unknown, visible: unknown) => {
      writeStat(rawEid as string, { isHidden: !visible });
    });
    this.engine.events.on('entity:setSpeed', (rawEid: unknown, speed: unknown) => {
      writeStat(rawEid as string, { speed: Number(speed) || 0 });
    });
    this.engine.events.on('entity:flip', (rawEid: unknown, flip: unknown) => {
      writeStat(rawEid as string, { flip: Number(flip) || 0 });
    });

    // entity:facePosition / entity:faceMouse — set rotation directly.
    // facePosition takes a {x,y} target in pixel coords; face the position from
    // the entity's current location.
    this.engine.events.on('entity:facePosition', (rawEid: unknown, rawPos: unknown) => {
      const eid = rawEid as string;
      const ent = this._entities.get(eid);
      const pos = rawPos as { x?: number; y?: number } | null;
      if (!ent || !pos) return;
      const ex = ent.position.x * this._tilePx;
      const ey = ent.position.z * this._tilePx;
      ent.rotation = Math.atan2(-((pos.x ?? 0) - ex), -((pos.y ?? 0) - ey));
    });
    this.engine.events.on('entity:faceMouse', (rawEid: unknown, enabled: unknown) => {
      // Enable per-tick rotateToFaceMouseCursor on the unit type's controls behaviour.
      // Matches the existing _tick logic that consults controls.mouseBehaviour.
      const ent = this._entities.get(rawEid as string);
      if (!ent) return;
      const typeDef = this.types.get('unitTypes', ent.stats?.type) as any;
      if (typeDef?.controls) {
        typeDef.controls.mouseBehaviour = typeDef.controls.mouseBehaviour || {};
        typeDef.controls.mouseBehaviour.rotateToFaceMouseCursor = !!enabled;
      }
    });

    // entity:moveTo / entity:moveToUnit — same machinery as ai:moveToPosition / attackUnit.
    // Reuse the AI state target so _processAI drives the unit toward it.
    this.engine.events.on('entity:moveTo', (rawEid: unknown, rawPos: unknown) => {
      const eid = rawEid as string;
      const pos = rawPos as { x?: number; y?: number } | null;
      const unit = this._entities.get(eid);
      if (!unit || !pos) return;
      const tx = (pos.x ?? 0) / GameServer.SCALE_RATIO;
      const ty = (pos.y ?? 0) / GameServer.SCALE_RATIO;
      unit._aiState = unit._aiState || { target: null, pickCooldownMs: 0 };
      unit._aiState.target = { x: tx, y: ty };
      unit._aiState.targetUnitId = null;
      unit._aiState.pickCooldownMs = 5000;
    });
    this.engine.events.on('entity:moveToUnit', (rawEid: unknown, rawTarget: unknown) => {
      const unit = this._entities.get(rawEid as string);
      const target = this._entities.get(rawTarget as string);
      if (!unit || !target) return;
      unit._aiState = unit._aiState || { target: null, pickCooldownMs: 0 };
      unit._aiState.targetUnitId = rawTarget as string;
      unit._aiState.pickCooldownMs = 10000;
    });

    // Visual UICommand forwards. Each one becomes a UICommand the client renderer applies.
    const forwardCmd = (command: string) => (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command, args },
      });
    };
    this.engine.events.on('entity:playAnimation', forwardCmd('playAnimation'));
    this.engine.events.on('entity:stopAnimation', forwardCmd('stopAnimation'));
    this.engine.events.on('entity:outline', forwardCmd('outline'));
    this.engine.events.on('entity:changeType', (rawEid: unknown, rawTypeId: unknown) => {
      // Apply server-side stat type then broadcast so renderer reskins.
      const eid = rawEid as string;
      const ent = this._entities.get(eid);
      if (!ent) return;
      const typeId = rawTypeId as string;
      const typeDef = this.types.get('unitTypes', typeId) as Record<string, unknown> | null;
      if (!typeDef) return;
      ent.stats = { ...ent.stats, ...typeDef, type: typeId };
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [eid]: { ...typeDef, type: typeId } },
      });
    });
    this.engine.events.on('entity:changeModel', forwardCmd('changeModel'));
    this.engine.events.on('entity:visibility', forwardCmd('entityVisibility'));
    this.engine.events.on('entity:hideNameLabel', forwardCmd('hideNameLabel'));
    this.engine.events.on('entity:showNameLabel', forwardCmd('showNameLabel'));
    this.engine.events.on('entity:reset', forwardCmd('resetEntity'));

    // Particles + UI shop/menu/etc — pure forwards, the client decides what to render.
    this.engine.events.on('particle:start', forwardCmd('startParticles'));
    this.engine.events.on('particle:stop', forwardCmd('stopParticles'));
    this.engine.events.on('ui:openSkinShop', forwardCmd('openSkinShop'));
    this.engine.events.on('ui:openBackpack', forwardCmd('openBackpack'));
    this.engine.events.on('ui:closeBackpack', forwardCmd('closeBackpack'));
    this.engine.events.on('ui:showMenu', forwardCmd('showMenu'));
    this.engine.events.on('ui:dynamicFloatingText', forwardCmd('dynamicFloatingText'));
    this.engine.events.on('ui:inputModal', forwardCmd('inputModal'));
    this.engine.events.on('ui:customModal', forwardCmd('customModal'));
    this.engine.events.on('ui:element', forwardCmd('uiElement'));
    this.engine.events.on('ui:setProperty', forwardCmd('uiSetProperty'));
    this.engine.events.on('ui:setHtml', forwardCmd('uiSetHtml'));

    // Inventory drops + selection. dropAt creates a free-standing item at a position;
    // dropSlot pulls index from inventory; dropAll drops everything.
    this.engine.events.on('inventory:selectSlot', (rawUid: unknown, rawSlot: unknown) => {
      const uid = rawUid as string;
      const unit = this._entities.get(uid);
      if (!unit?.stats) return;
      const slotIdx = Number(rawSlot) || 0;
      const inv = (unit.stats.inventory ?? []) as Array<{ id?: string }>;
      unit.stats.currentSlot = slotIdx;
      unit.stats.currentItemId = inv[slotIdx]?.id ?? null;
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [uid]: { currentSlot: unit.stats.currentSlot, currentItemId: unit.stats.currentItemId } },
      });
    });
    this.engine.events.on('inventory:dropSlot', (rawUid: unknown, rawSlot: unknown) => {
      const uid = rawUid as string;
      const unit = this._entities.get(uid);
      if (!unit?.stats) return;
      const slotIdx = Number(rawSlot) || 0;
      const inv = (unit.stats.inventory ?? []) as Array<{ id?: string; type?: string }>;
      const item = inv[slotIdx];
      if (!item?.type) return;
      inv.splice(slotIdx, 1);
      // Spawn world item at unit's position via the same path as item:spawn.
      this.engine.events.emit('item:spawn', [item.type, { x: unit.position.x * this._tilePx, y: unit.position.z * this._tilePx }]);
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [uid]: { inventory: inv } },
      });
    });
    this.engine.events.on('inventory:dropAt', (rawIid: unknown, rawPos: unknown) => {
      const iid = rawIid as string;
      const item = this._entities.get(iid);
      if (!item?.stats) return;
      const pos = rawPos as { x?: number; y?: number } | null;
      if (!pos) return;
      // Detach from owner, spawn at the position.
      const typeId = item.stats.type as string;
      this.engine.events.emit('item:spawn', [typeId, pos]);
      // Optionally also remove from owner's inventory.
      const ownerId = item.stats.ownerId as string;
      if (ownerId) {
        const owner = this._entities.get(ownerId);
        if (owner?.stats?.inventory) {
          owner.stats.inventory = (owner.stats.inventory as Array<{ id?: string }>).filter(it => it.id !== iid);
          this._transport.broadcast({
            type: MessageType.EntityStatsUpdate,
            data: { [ownerId]: { inventory: owner.stats.inventory } },
          });
        }
      }
    });
    this.engine.events.on('inventory:dropAll', (rawUid: unknown) => {
      const uid = rawUid as string;
      const unit = this._entities.get(uid);
      if (!unit?.stats) return;
      const inv = (unit.stats.inventory ?? []) as Array<{ type?: string }>;
      const px = unit.position.x * this._tilePx;
      const py = unit.position.z * this._tilePx;
      for (const it of inv) {
        if (it.type) this.engine.events.emit('item:spawn', [it.type, { x: px, y: py }]);
      }
      unit.stats.inventory = [];
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [uid]: { inventory: [] } },
      });
    });

    // script:runOnEntity — run a script with `thisEntity` bound to the given id.
    this.engine.events.on('script:runOnEntity', (rawEid: unknown, rawScriptId: unknown, vars: unknown) => {
      const eid = rawEid as string;
      const scriptId = rawScriptId as string;
      if (!scriptId) return;
      this.scripts.runScript(scriptId, { ...(vars as Record<string, unknown> ?? {}), thisEntity: eid });
    });

    // player:setName / selectUnit / sendTo / assignType / kick.
    this.engine.events.on('player:setName', (rawPid: unknown, name: unknown) => {
      writeStat(rawPid as string, { name: String(name ?? '') });
    });
    this.engine.events.on('player:selectUnit', (rawPid: unknown, rawUid: unknown) => {
      const pid = rawPid as string;
      writeStat(pid, { selectedUnitId: rawUid as string });
    });
    this.engine.events.on('player:assignType', (rawPid: unknown, rawTypeId: unknown) => {
      const pid = rawPid as string;
      writeStat(pid, { playerTypeId: rawTypeId as string, playerType: rawTypeId as string });
    });
    this.engine.events.on('player:sendTo', forwardCmd('sendPlayerTo'));
    this.engine.events.on('player:kick', (rawPid: unknown) => {
      const pid = rawPid as string;
      // Locate the client owning this player and disconnect.
      for (const [clientId, pd] of this._players) {
        if (pd.player.id === pid) {
          this._transport.send(clientId, { type: MessageType.UICommand, data: { command: 'kicked', args: [] } });
          this._onClientDisconnect(clientId);
          break;
        }
      }
    });

    // region:transform / region:setColor — mutate the region object in place so
    // every reader (variable lookup, getTriggeringRegion, allRegions) sees the change.
    this.engine.events.on('region:transform', (name: unknown, x: unknown, y: unknown, w: unknown, h: unknown) => {
      const r = this._regionVars.get(name as string);
      if (!r) return;
      r.x = Number(x) || 0; r.y = Number(y) || 0;
      r.width = Number(w) || 0; r.height = Number(h) || 0;
    });
    this.engine.events.on('region:setColor', forwardCmd('regionColor'));

    // combat: track last-attacker / last-attacked + fire entityGetsAttacked.
    this.engine.events.on('combat:setLastAttacker', (rawUid: unknown, rawAttackerId: unknown) => {
      const uid = rawUid as string;
      const ent = this._entities.get(uid);
      if (!ent) return;
      ent.stats = ent.stats || {};
      ent.stats.lastAttackingUnit = rawAttackerId as string;
      this.scripts.trigger('entityGetsAttacked', { unitId: uid, lastAttackingUnit: rawAttackerId as string });
    });
    this.engine.events.on('combat:setLastAttacked', (rawUid: unknown, rawTargetId: unknown) => {
      const ent = this._entities.get(rawUid as string);
      if (!ent) return;
      ent.stats = ent.stats || {};
      ent.stats.lastAttackedUnit = rawTargetId as string;
    });

    // ability:cast — trigger entity-attached cast scripts; forward to client for VFX.
    this.engine.events.on('ability:cast', forwardCmd('castAbility'));
    this.engine.events.on('ability:stop', forwardCmd('stopCastingAbility'));

    // buff system — minimal: write the buff onto stats and forward.
    this.engine.events.on('buff:add', forwardCmd('addBuff'));
    this.engine.events.on('buff:addPercent', forwardCmd('addPercentBuff'));
    this.engine.events.on('buff:removeAll', forwardCmd('removeAllBuffs'));

    // Map editing forwards.
    this.engine.events.on('map:layerOpacity', forwardCmd('mapLayerOpacity'));
    this.engine.events.on('map:editTile', forwardCmd('editMapTile'));
    this.engine.events.on('map:loadFromString', forwardCmd('loadMapFromString'));

    // Server controls / chat moderation / data persistence — minimal no-ops in single-player.
    this.engine.events.on('server:acceptPlayers', () => { /* no-op */ });
    this.engine.events.on('chat:addFilter', () => { /* no-op */ });
    this.engine.events.on('chat:ban', () => { /* no-op */ });
    this.engine.events.on('chat:unban', () => { /* no-op */ });
    this.engine.events.on('data:saveMap', () => { /* no-op */ });
    this.engine.events.on('data:unit', () => { /* no-op */ });

    // Network + ad + web3 — forward as UICommand for client (or platform) to handle.
    this.engine.events.on('ad:play', forwardCmd('playAd'));
    this.engine.events.on('web3:walletConnect', forwardCmd('openWalletConnect'));
    this.engine.events.on('network:postRequest', forwardCmd('networkPost'));
    this.engine.events.on('network:clientToServer', forwardCmd('networkClientToServer'));
    this.engine.events.on('network:serverToClient', forwardCmd('networkServerToClient'));

    // Camera position + audio.
    this.engine.events.on('camera:setPosition', forwardCmd('setCameraPosition'));
    this.engine.events.on('audio:playMusic', forwardCmd('playMusic'));
    this.engine.events.on('audio:stopMusic', forwardCmd('stopMusic'));

    // Trade system — forward (no built-in trade UI yet).
    this.engine.events.on('trade:initiate', forwardCmd('initiateTrade'));

    // Quest system — forward.
    this.engine.events.on('quest:add', forwardCmd('addQuest'));
    this.engine.events.on('quest:remove', forwardCmd('removeQuest'));
    this.engine.events.on('quest:complete', forwardCmd('completeQuest'));
    this.engine.events.on('quest:setProgress', forwardCmd('setQuestProgress'));

    // item:setAmmo / item:stopUse / item:changeImage — stat writes / forwards.
    this.engine.events.on('item:setAmmo', (rawIid: unknown, ammo: unknown) => {
      writeStat(rawIid as string, { ammo: Number(ammo) || 0 });
    });
    this.engine.events.on('item:stopUse', forwardCmd('stopUsingItem'));
    this.engine.events.on('item:changeImage', forwardCmd('changeItemImage'));

    // Item use → fire `itemIsUsed` (and `thisUnitUsesItem` per the unit's type scripts).
    // ActionRunner emits `item:use` for both `useItemOnce` and `startUsingItem`; the only
    // signal we have is the item entity. The unit using it is the item's owner.
    this.engine.events.on('item:use', (rawEid: unknown) => {
      const itemId = rawEid as string;
      if (!itemId) return;
      const item = this._entities.get(itemId) as { stats?: { ownerId?: string } } | undefined;
      const unitId = item?.stats?.ownerId;
      this.scripts.trigger('itemIsUsed', { itemId, unitId });
      if (unitId) this.scripts.trigger('thisUnitUsesItem', { itemId, unitId });
    });

    // Update entity name and broadcast so clients can re-render the name sprite.
    this.engine.events.on('entity:setNameLabel', (rawEid: unknown, name: unknown) => {
      // ActionRunner reads action.entity, but taro data uses action.unit —
      // if entity was unresolved, fall back to the last-created unit.
      const eid = (typeof rawEid === 'string' && rawEid) ? rawEid : this.scripts.actions.lastCreatedUnitId;
      if (!eid) return;
      const entity = this._entities.get(eid);
      if (!entity) return;
      (entity.stats as Record<string, unknown>).name = name;
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [eid]: { name } },
      });
    });

    // Propagate tile size + map layers to script runtime so pixel-coord positions
    // and isPositionInWall / getMapTileId resolve correctly.
    this.scripts.actions.mapTilePx = this._tilePx;
    this.scripts.actions.mapData = (gameData.map as Record<string, unknown>) ?? null;
    // Expose entity-type definitions to resolvers (getItemMaxQuantity, etc.).
    const entitiesMap = (gameData.entities ?? {}) as Record<string, unknown>;
    this.scripts.actions.typeRegistries = {
      unitTypes: (entitiesMap.unitTypes as Record<string, unknown>) ?? {},
      itemTypes: (entitiesMap.itemTypes as Record<string, unknown>) ?? {},
      projectileTypes: (entitiesMap.projectileTypes as Record<string, unknown>) ?? {},
      playerTypes: (entitiesMap.playerTypes as Record<string, unknown>) ?? {},
    };

    // Wall / unit / projectile collision triggers. PhysicsWorld.step emits
    // collisionStart events with rapier collider handles; resolve to body handles
    // and dispatch the matching script trigger.
    if (this._physics) {
      const resolveCollider = (colliderHandle: number): { entityId: string | null; isWall: boolean } => {
        const collider = (this._physics as any).world.getCollider(colliderHandle);
        const bodyHandle = collider?.parent()?.handle;
        if (bodyHandle == null) return { entityId: null, isWall: false };
        if (this._wallBodyHandles.has(bodyHandle)) return { entityId: null, isWall: true };
        return { entityId: this._bodyToEntity.get(bodyHandle) ?? null, isWall: false };
      };
      this._physics.events.on('collisionStart', (h1: unknown, h2: unknown) => {
        const a = resolveCollider(h1 as number);
        const b = resolveCollider(h2 as number);
        // wall ↔ entity → entityTouchesWall on the entity side
        const fireWall = (eid: string | null) => {
          if (!eid) return;
          const ent = this._entities.get(eid);
          const cat = ent?.category;
          if (cat === 'unit') this.scripts.trigger('entityTouchesWall', { unitId: eid });
          else if (cat === 'projectile') this.scripts.trigger('entityTouchesWall', { projectileId: eid });
          else if (cat === 'item') this.scripts.trigger('entityTouchesWall', { itemId: eid });
        };
        if (a.isWall) fireWall(b.entityId);
        if (b.isWall) fireWall(a.entityId);
        if (a.entityId && b.entityId) {
          const ea = this._entities.get(a.entityId);
          const eb = this._entities.get(b.entityId);
          const ca = ea?.category, cb = eb?.category;
          // unit ↔ unit
          if (ca === 'unit' && cb === 'unit') {
            this.scripts.trigger('entityTouchesUnit', { unitId: a.entityId, otherUnitId: b.entityId });
            this.scripts.trigger('entityTouchesUnit', { unitId: b.entityId, otherUnitId: a.entityId });
          }
          // unit ↔ projectile (each side gets a perspective-correct trigger)
          if (ca === 'unit' && cb === 'projectile') {
            this.scripts.trigger('unitTouchesProjectile', { unitId: a.entityId, projectileId: b.entityId });
            this.scripts.trigger('entityTouchesProjectile', { projectileId: b.entityId, unitId: a.entityId });
          } else if (ca === 'projectile' && cb === 'unit') {
            this.scripts.trigger('unitTouchesProjectile', { unitId: b.entityId, projectileId: a.entityId });
            this.scripts.trigger('entityTouchesProjectile', { projectileId: a.entityId, unitId: b.entityId });
          }
        }
      });
    }
  }

  /** Process initialize script to spawn props, NPCs, items */
  initializeEntities(): void {
    // Use raw game data for initialize scripts (pre-migration format)
    const raw = this._rawGameData;
    if (!raw) return;
    const initScript = raw.scripts?.initialize;
    if (!initScript?.actions) return;

    for (const action of initScript.actions) {
      if (action.type !== 'createEntityAtPositionWithDimensions') continue;

      const pos = action.position || {};
      const rot = action.rotation || {};
      const scl = action.scale || {};

      // Create a static entity record and broadcast it
      const entityId = `init_${action.actionId || Math.random().toString(36).slice(2)}`;
      const typeMaps: Record<string, Record<string, unknown> | undefined> = {
        propTypes: raw.propTypes || (this._gameData as any)?.entities?.propTypes,
        unitTypes: raw.unitTypes || (this._gameData as any)?.entities?.unitTypes,
        itemTypes: raw.itemTypes || (this._gameData as any)?.entities?.itemTypes,
      };
      const entityDef = typeMaps[action.entityType]?.[action.entity];
      if (!entityDef) continue;

      const classId = action.entityType === 'unitTypes' ? 'unit' : action.entityType === 'itemTypes' ? 'item' : 'prop';

      this._transport.broadcast({
        type: MessageType.EntityCreate,
        data: buildEntityCreatePayload(
          classId, entityId,
          pos.x ?? 0, pos.y ?? 0,
          ((rot.y ?? 0) * Math.PI) / 180,
          {
            ...(entityDef as Record<string, unknown>),
            _initAction: true,
            _rotation: rot,
            _scale: scl,
            _worldY: (pos.z ?? 0) - 0.501,
          },
        ),
      });
    }
  }

  start(): void {
    this.scripts.trigger('gameStart');
    this.initializeEntities();
    this._loop.start();
  }

  stop(): void {
    this._loop.stop();
    for (const entity of this._entities.values()) {
      if (entity.destroy) entity.destroy();
    }
    this._entities.clear();
    this._entityBodies.clear();
    this._players.clear();
    this._aiUnitFacingRotation.clear();
    if (this._physics) {
      this._physics.destroy();
      this._physics = null;
    }
    this.scripts.reset();
    Engine.reset();
  }

  /** Get an entity by ID */
  getEntity(id: string): any {
    return this._entities.get(id);
  }

  // Taro Rapier uses _scaleRatio=30 for ALL physics coordinates (pixels/30).
  // 1 tile = 1 world unit; the pixel size of that tile comes from `map.tilewidth` in
  // the source game data (commonly 16, 32 or 64). Every tile↔physics conversion —
  // wall bodies, unit bodies, velocity scaling — must use the same `_tilePx` or the
  // placements end up in different coordinate spaces and nothing collides.
  private static readonly SCALE_RATIO = 30;
  /** Default fallback if the source data omits tilewidth. */
  private static readonly DEFAULT_TILE_PX = 64;
  private _tilePx: number = GameServer.DEFAULT_TILE_PX;

  private _tileToPhysics(tile: number): number {
    return tile * this._tilePx / GameServer.SCALE_RATIO;
  }

  private _physicsToTile(phys: number): number {
    return phys * GameServer.SCALE_RATIO / this._tilePx;
  }

  /** Create static wall bodies from the tilemap wall layer */
  private _createWallBodies(): void {
    if (!this._physics || !this._rawGameData?.map) return;
    const map = this._rawGameData.map;
    const layers = map.layers || [];
    const tileHW = this._tilePx / 2 / GameServer.SCALE_RATIO; // half-extent in physics

    for (const layer of layers) {
      if (layer.name !== 'walls' || !layer.data) continue;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (layer.data[y * map.width + x] === 0) continue;
          // Tile center in tile units, then tile→physics via the same scale units use.
          const px = this._tileToPhysics(x + 0.5);
          const py = this._tileToPhysics(y + 0.5);
          const body = this._physics!.createBody({
            type: 'static',
            position: new Vec2(px, py),
          });
          body.addCollider({
            shape: 'box',
            width: tileHW,
            height: tileHW,
            friction: 0,
            restitution: 0,
            category: CollisionCategory.WALL,
            mask: DefaultCollisionMask[CollisionCategory.WALL],
          });
          // Track wall body handles so collision events can identify
          // which side of a UNIT↔WALL pair is the wall.
          this._wallBodyHandles.add(body.raw.handle);
        }
      }
    }
  }

  /** Create a physics body for a dynamic entity — EXACTLY matching taro Rapier2dComponent.createBody() */
  private _createEntityBody(entityId: string, x: number, z: number, typeDef: Record<string, any>): void {
    if (!this._physics) return;
    const bodyDef = typeDef.body || typeDef.bodies?.default;
    if (!bodyDef || bodyDef.type === 'none' || bodyDef.type === 'spriteOnly') return;

    // Position in physics coords = tile * 16 / 30
    const body = this._physics.createBody({
      type: (bodyDef.type === 'static' ? 'static' : bodyDef.type === 'kinematic' ? 'kinematic' : 'dynamic') as any,
      position: new Vec2(this._tileToPhysics(x), this._tileToPhysics(z)),
    });

    // Damping — taro's damping values are calibrated for a different physics scale
    // (larger world, different tick cadence). In modu they crush velocity to a crawl,
    // so attenuate them heavily for dynamic bodies.
    const damp = (bodyDef.linearDamping ?? 0) as number;
    const attenuated = bodyDef.type === 'dynamic' ? Math.min(damp * 0.1, 2) : damp;
    body.raw.setLinearDamping(attenuated);
    body.raw.setAngularDamping(bodyDef.angularDamping ?? 0);

    // Collider — exactly as taro: halfWidth / scaleRatio
    // Taro: entity._bounds2d.x / 2 / this._scaleRatio
    // entity._bounds2d.x = body.width (pixels)
    const fixture = bodyDef.fixtures?.[0] || {};
    const hw = (fixture.shape?.data?.halfWidth ?? (bodyDef.width || 40) / 2) / GameServer.SCALE_RATIO;
    const hh = (fixture.shape?.data?.halfHeight ?? (bodyDef.height || 40) / 2) / GameServer.SCALE_RATIO;

    body.addCollider({
      shape: 'box',
      width: hw,
      height: hh,
      density: fixture.density ?? 0,
      friction: fixture.friction ?? 0,
      restitution: fixture.restitution ?? 0,
      category: CollisionCategory.UNIT,
      mask: DefaultCollisionMask[CollisionCategory.UNIT],
    });

    // Lock rotation so body doesn't spin from collisions.
    // Rotation is controlled by the game logic (facing mouse direction), not physics.
    body.raw.lockRotations(true, true);

    this._entityBodies.set(entityId, body);
    // Reverse map for collision-event → entityId resolution.
    this._bodyToEntity.set(body.raw.handle, entityId);
  }

  // --- Tick ---

  private _tick(dt: number): void {
    this._tickCount++;

    // Process input → apply forces to physics bodies
    this._processMovement(dt);
    // Drive AI behaviors for NPC units (wandering, etc.)
    this._processAI(dt);

    // Step physics with FIXED timestep (prevents jitter from variable dt)
    if (this._physics) {
      const fixedDt = 1000 / this._loop.tickRate; // e.g., 50ms for 20Hz
      this._physics.step(fixedDt);
    }

    // Sync physics positions back to entities
    this._syncPhysicsToEntities();

    // Rotate units to face the mouse cursor in world space (taro: rotateToFaceMouseCursor).
    // _mousePosition holds the cursor's world XZ (engine 2D coords — .x=world X, .y=world Z).
    // At rotation 0 both sprites and GLB units face world −Z, so the angle that points the
    // unit toward the cursor is atan2(−dx, −dy).
    for (const [, playerData] of this._players) {
      const unit = this._entities.get(playerData.unitId);
      if (!unit || !unit._mousePosition) continue;
      const typeDef = this.types.get('unitTypes', unit.stats?.type) as any;
      if (!typeDef?.controls?.mouseBehaviour?.rotateToFaceMouseCursor) continue;
      const dx = unit._mousePosition.x - unit.position.x;
      const dy = unit._mousePosition.y - unit.position.z;
      unit.rotation = Math.atan2(-dx, -dy);
    }

    // Rotate AI-controlled units to face the direction they are moving. Mirrors
    // the player face-mouse loop above: the rigid body has rotation locked, so
    // body.angle stays at 0 and _syncPhysicsToEntities zeroes entity.rotation;
    // this loop overrides rotation for any unit whose type has ai.enabled === true
    // and which is not currently controlled by a connected player. The
    // atan2(-vx, -vy) convention matches the player face-mouse fix (commit 2eb0cfb):
    // at rotation 0 both sprites and GLBs face world −Z.
    const FACING_MIN_SPEED_SQ = 0.01; // physics units²; below this we keep prior rotation.
    const playerUnitIds = new Set<string>();
    for (const pd of this._players.values()) if (pd.unitId) playerUnitIds.add(pd.unitId);
    for (const [id, unit] of this._entities) {
      if (unit.category !== 'unit') continue;
      if (playerUnitIds.has(id)) continue;
      const typeDef = this.types.get('unitTypes', unit.stats?.type) as any;
      if (!typeDef?.ai?.enabled) continue;
      const body = this._entityBodies.get(id);
      if (!body) continue;
      const v = body.linearVelocity;
      if (v.x * v.x + v.y * v.y >= FACING_MIN_SPEED_SQ) {
        const r = Math.atan2(-v.x, -v.y);
        this._aiUnitFacingRotation.set(id, r);
        unit.rotation = r;
      } else {
        // Velocity below threshold: restore the cached heading so the unit
        // does not snap to 0 (which _syncPhysicsToEntities just wrote).
        const cached = this._aiUnitFacingRotation.get(id);
        if (cached !== undefined) unit.rotation = cached;
      }
    }

    this.engine.step(dt);

    // Attribute regeneration
    for (const entity of this._entities.values()) {
      if (!entity.stats) continue;
      for (const key of Object.keys(entity.stats)) {
        if (!key.startsWith('attr_')) continue;
        const attr = entity.stats[key];
        if (attr.regenerateSpeed && attr.value < attr.max) {
          attr.value = Math.min(attr.max, attr.value + attr.regenerateSpeed * (dt / 1000));
        }
      }
    }

    this.scripts.trigger('frameTick');

    // Fire `secondTick` every real-time second. Many taro games hook spawn/tick logic here.
    this._secondTickAccumMs += dt;
    while (this._secondTickAccumMs >= 1000) {
      this._secondTickAccumMs -= 1000;
      this.scripts.trigger('secondTick');
    }

    // Region enter/leave check at ~10Hz. AABB cost is O(units × regions);
    // this game has ~100 regions and a handful of units, so 10Hz is fine.
    this._regionAccumMs += dt;
    if (this._regionAccumMs >= 100) {
      this._regionAccumMs = 0;
      this._tickRegionMembership();
    }

    this._streamTransforms();
  }

  /** AABB-test every unit against every region variable; fire enter/leave on transitions.
   *  Region geometry is in taro pixel coords; unit positions are in tile units, so we
   *  convert the unit's center to pixels via mapTilePx. Trigger context carries `region`
   *  (object reference identical to the variable's value, for == matching) and `regionId`. */
  private _tickRegionMembership(): void {
    if (this._regionVars.size === 0) return;
    const px = this._tilePx;
    for (const [eid, ent] of this._entities) {
      if (ent.category !== 'unit') continue;
      const cx = (ent.position?.x ?? 0) * px;
      const cy = (ent.position?.z ?? 0) * px;
      let inside = this._regionMembership.get(eid);
      const newInside = new Set<string>();
      for (const [name, r] of this._regionVars) {
        const within = cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
        if (within) newInside.add(name);
      }
      // Fire enter for newly-entered regions
      for (const name of newInside) {
        if (!inside || !inside.has(name)) {
          this.scripts.trigger('entityEntersRegion', {
            unitId: eid,
            regionId: name,
            region: this._regionVars.get(name),
          });
        }
      }
      // Fire leave for regions no longer occupied
      if (inside) {
        for (const name of inside) {
          if (!newInside.has(name)) {
            this.scripts.trigger('entityLeavesRegion', {
              unitId: eid,
              regionId: name,
              region: this._regionVars.get(name),
            });
          }
        }
      }
      if (newInside.size === 0) this._regionMembership.delete(eid);
      else this._regionMembership.set(eid, newInside);
    }
  }

  /** Apply movement forces based on player input */
  private _processMovement(dt: number): void {
    for (const [clientId, playerData] of this._players) {
      const unit = this._entities.get(playerData.unitId);
      if (!unit || !unit._inputKeys) continue;

      const body = this._entityBodies.get(playerData.unitId);
      if (!body) continue;

      // EXACTLY matching taro Rapier2dComponent + Unit._behaviour():
      //
      // 1. Unit._behaviour() computes:
      //    direction = { x: -1/0/1, y: -1/0/1 } from WASD
      //    if diagonal: speed /= 1.414
      //    vector = { x: direction.x * speed, y: direction.y * speed }
      //
      // 2. Rapier2dComponent.update() applies:
      //    body.applyImpulse({ x: vector.x, y: vector.y }, true)
      //
      // 3. Body was created with: position = pixels / 30, halfExtents = pixels / 30
      //    linearDamping set from body def
      //
      // Since our bodies use the SAME scaleRatio=30 coordinate system,
      // we apply the SAME impulse values. No conversion needed.
      const typeDef = this.types.get('unitTypes', unit.stats?.type) as any;
      const speed = typeDef?.attributes?.speed?.value ?? 10;
      const movementMethod = typeDef?.controls?.movementMethod ?? 'velocity';

      // Raw WASD input (taro ControlComponent.keyDown → ability.move)
      const left = unit._inputKeys.has('a') || unit._inputKeys.has('arrowleft');
      const right = unit._inputKeys.has('d') || unit._inputKeys.has('arrowright');
      const up = unit._inputKeys.has('w') || unit._inputKeys.has('arrowup');
      const down = unit._inputKeys.has('s') || unit._inputKeys.has('arrowdown');

      // input.x = (right?1:0) - (left?1:0), input.y = (up?1:0) - (down?1:0)
      const inputX = (right ? 1 : 0) - (left ? 1 : 0);
      const inputY = (up ? 1 : 0) - (down ? 1 : 0);

      // Rotate input by camera yaw for wasdRelativeToUnit
      // Taro: moveRelativeToAngle(-yaw) → this.angle = -PI/2 + (-yaw)
      // Then getCurrentDirection() rotates input by this.angle
      const controlScheme = typeDef?.controls?.movementControlScheme ?? 'wasd';
      let dirX = 0, dirY = 0;

      if (controlScheme === 'wasdRelativeToUnit' && unit._cameraYaw !== undefined) {
        // Exact taro AbilityComponent.getCurrentDirection() logic:
        const angle = -Math.PI * 0.5 + (-unit._cameraYaw);
        const deg90 = Math.PI * 0.5;

        if (inputX < 0) { // left
          dirX += Math.cos(angle - deg90);
          dirY += Math.sin(angle - deg90);
        }
        if (inputX > 0) { // right
          dirX += Math.cos(angle + deg90);
          dirY += Math.sin(angle + deg90);
        }
        if (inputY > 0) { // up (forward)
          dirX += Math.cos(angle);
          dirY += Math.sin(angle);
        }
        if (inputY < 0) { // down (backward)
          dirX += Math.cos(angle + deg90 * 2);
          dirY += Math.sin(angle + deg90 * 2);
        }
      } else {
        // Plain WASD (no rotation)
        dirX = inputX;
        dirY = -inputY; // taro: direction.y = -input.y when angle=0
      }

      // Diagonal speed reduction (taro Unit.js line 2418)
      let moveSpeed = speed;
      if (inputX !== 0 && inputY !== 0) {
        moveSpeed = speed / 1.41421356237;
      }

      // Velocity tuned for a playable walking feel at common taro speed values (~10–40).
      const MOVE_SCALE = 0.5;
      const physicsImpulse = moveSpeed * MOVE_SCALE;
      const vectorX = dirX * physicsImpulse;
      const vectorY = dirY * physicsImpulse;

      if (vectorX !== 0 || vectorY !== 0) {
        switch (movementMethod) {
          case 'impulse':
            // taro: body.applyImpulse({ x: vectorX, y: vectorY }, true)
            body.applyImpulse(new Vec2(vectorX, vectorY));
            break;
          case 'force':
            body.applyForce(new Vec2(vectorX, vectorY));
            break;
          case 'velocity':
          default:
            body.linearVelocity = new Vec2(vectorX, vectorY);
            break;
        }
      }
    }
  }

  /**
   * Minimal AI loop: runs the `wander` idle behaviour for units whose type has
   * `ai.enabled === true`. Units pick a random target inside `ai.maxTravelDistance`
   * (pixels) and walk toward it, re-picking when they arrive or after a timeout.
   * Sensor / attack responses are not wired yet.
   */
  private _processAI(dt: number): void {
    // Collect the set of units currently controlled by a connected player so we skip them.
    const playerUnitIds = new Set<string>();
    for (const pd of this._players.values()) if (pd.unitId) playerUnitIds.add(pd.unitId);

    for (const [id, unit] of this._entities) {
      if (unit.category !== 'unit') continue;
      if (playerUnitIds.has(id)) continue;
      const typeDef = this.types.get('unitTypes', unit.stats?.type) as any;
      const ai = typeDef?.ai;
      if (!ai?.enabled || ai.idleBehaviour !== 'wander') continue;
      const body = this._entityBodies.get(id);
      if (!body) continue;

      if (!unit._aiState) {
        unit._aiState = { target: null as { x: number; y: number } | null, pickCooldownMs: 0 };
      }
      const state = unit._aiState;
      state.pickCooldownMs -= dt;

      // Convert pixel range → physics units (pixels / SCALE_RATIO).
      const maxTravelPhys = (Number(ai.maxTravelDistance) || 200) / GameServer.SCALE_RATIO;
      const reached =
        state.target &&
        Math.hypot(state.target.x - body.position.x, state.target.y - body.position.y) < 0.4;

      if (!state.target || reached || state.pickCooldownMs <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * maxTravelPhys;
        state.target = {
          x: body.position.x + Math.cos(angle) * dist,
          y: body.position.y + Math.sin(angle) * dist,
        };
        state.pickCooldownMs = 2000 + Math.random() * 3000; // 2–5s before next re-pick
      }

      const dx = state.target.x - body.position.x;
      const dy = state.target.y - body.position.y;
      const mag = Math.hypot(dx, dy);
      const speed = (typeDef.attributes?.speed?.value as number) || 10;
      const AI_MOVE_SCALE = 0.25;
      if (mag > 0.1) {
        const vx = (dx / mag) * speed * AI_MOVE_SCALE;
        const vy = (dy / mag) * speed * AI_MOVE_SCALE;
        body.linearVelocity = new Vec2(vx, vy);
      }
    }
  }

  /** Sync physics body positions back to entity positions (physics → tile coords) */
  private _syncPhysicsToEntities(): void {
    for (const [entityId, body] of this._entityBodies) {
      const entity = this._entities.get(entityId);
      if (!entity) continue;
      const pos = body.position;
      entity.position.x = this._physicsToTile(pos.x);
      entity.position.z = this._physicsToTile(pos.y); // Physics Y → Three.js Z
      entity.rotation = body.angle;
    }
  }

  private _streamTransforms(): void {
    const transforms: any[] = [];
    for (const [id, entity] of this._entities) {
      if (!entity.alive) continue;
      if (entity.category === 'player') continue; // Players don't have transforms
      transforms.push({
        entityId: id,
        transform: encodeTransform({
          x: entity.position.x,
          y: entity.position.z,
          rotation: entity.rotation || 0,
        }),
      });
    }
    if (transforms.length > 0) {
      this._transport.broadcast({
        type: MessageType.Snapshot,
        data: { transforms, timestamp: Date.now() },
      });
    }
  }

  // --- Client events ---

  private _onClientConnect(clientId: string): void {
    this._transport.onMessage(clientId, (msg) => this._onMessage(clientId, msg));
  }

  private _onClientDisconnect(clientId: string): void {
    const playerData = this._players.get(clientId);
    if (playerData) {
      const unit = this._entities.get(playerData.unitId);
      if (unit) {
        unit.destroy();
        this._entities.delete(playerData.unitId);
        this._aiUnitFacingRotation.delete(playerData.unitId);
        this._transport.broadcast({
          type: MessageType.EntityDestroy,
          data: { entityId: playerData.unitId, timestamp: Date.now() },
        });
      }
      playerData.player.destroy();
      this._entities.delete(playerData.player.id);
      this._players.delete(clientId);
      this.scripts.trigger('playerLeavesGame', { playerId: playerData.player.id });
    }
  }

  private _onMessage(clientId: string, msg: GameMessage): void {
    switch (msg.type) {
      case MessageType.JoinGame:
        this._onJoinGame(clientId, msg.data as any);
        break;
      case MessageType.PlayerKeyDown:
        this._onPlayerInput(clientId, msg.data as any, true);
        break;
      case MessageType.PlayerKeyUp:
        this._onPlayerInput(clientId, msg.data as any, false);
        break;
      case MessageType.PlayerMouseMoved:
        this._onPlayerMouseMoved(clientId, msg.data as any);
        break;
      case MessageType.Ping:
        this._transport.send(clientId, { type: MessageType.Pong, data: msg.data });
        break;
    }
  }

  private _onJoinGame(clientId: string, data: { playerName: string; isMobile: boolean }): void {
    const player = new Player(undefined, {
      name: data.playerName,
      controlledBy: 'human',
      score: 0, level: 1, coins: 0,
      unitIds: [], selectedUnitId: '', cameraTrackedUnitId: '',
    });
    player.mount(this.engine.root);
    this._entities.set(player.id, player);

    // Spawn unit
    const unitTypes = this.types.getAll('unitTypes');
    let unitId = '';
    if (unitTypes.size > 0) {
      const [firstTypeId, firstTypeDef] = unitTypes.entries().next().value as [string, Record<string, unknown>];
      const unit = this.spawnUnit(firstTypeId, firstTypeDef, player.id);
      unitId = unit.id;
      player.addUnit(unit.id);
      player.selectUnit(unit.id);

      // Place at map center
      if (this._gameData?.map) {
        const mapW = (this._gameData.map as any).width || 10;
        const mapH = (this._gameData.map as any).height || 10;
        unit.position.x = mapW / 2;
        unit.position.z = mapH / 2;

        // Update physics body position to match (tile coords → physics coords)
        const body = this._entityBodies.get(unitId);
        if (body) {
          body.position = new Vec2(this._tileToPhysics(mapW / 2), this._tileToPhysics(mapH / 2));
        }
      }
    }

    this._players.set(clientId, { player, clientId, unitId });

    // Tell this client which player + unit are theirs so it can lock the camera on it
    // regardless of earlier NPC spawns or later scripted unit creations.
    this._transport.send(clientId, {
      type: MessageType.InitConnection,
      data: { playerId: player.id, unitId },
    });

    // Stream ALL existing entities to new client
    for (const [id, entity] of this._entities) {
      if (entity.category === 'player') continue;
      this._transport.send(clientId, {
        type: MessageType.EntityCreate,
        data: buildEntityCreatePayload(
          entity.category || 'unit', id,
          entity.position.x, entity.position.z,
          entity.rotation || 0,
          entity.stats || {},
        ),
      });
    }

    this.scripts.trigger('playerJoinsGame', { playerId: player.id });
  }

  private _onPlayerInput(clientId: string, data: { device: string; key: string }, isDown: boolean): void {
    const playerData = this._players.get(clientId);
    if (!playerData) return;
    const unit = this._entities.get(playerData.unitId);
    if (!unit) return;

    if (!unit._inputKeys) unit._inputKeys = new Set();
    if (isDown) unit._inputKeys.add(data.key);
    else unit._inputKeys.delete(data.key);

    // Fire ability scripts. Bindings come in three shapes:
    //   { keyDown: { scriptName: 'Foo' } }                    — top-level script id
    //   { keyDown: { scriptName: 'Foo', isEntityScript: true } } — per-unit-type script
    //                                                            (lives under unitTypes.<typeId>.scripts.Foo)
    //   { keyDown: { event: 'startCasting', abilityId: 'X' } } — start casting an ability
    const typeId = unit.stats?.type as string | undefined;
    const typeDef = typeId ? (this.types.get('unitTypes', typeId) as Record<string, unknown> | null) : null;
    const abilities = (typeDef as any)?.controls?.abilities as Record<string, any> | undefined;
    const binding = abilities?.[data.key];
    const slot = isDown ? binding?.keyDown : binding?.keyUp;
    if (!slot) {
      // Fallback: number keys 1..9 select inventory slot 0..8 when the unit type
      // doesn't bind them. Karmaslayers' fighter has no number-key abilities, so
      // without this the inventory bar can't be navigated.
      if (isDown && /^[1-9]$/.test(data.key)) {
        const slotIdx = Number(data.key) - 1;
        const inv = (unit.stats?.inventory ?? []) as Array<{ id?: string }>;
        unit.stats.currentSlot = slotIdx;
        unit.stats.currentItemId = inv[slotIdx]?.id ?? null;
        this._transport.broadcast({
          type: MessageType.EntityStatsUpdate,
          data: { [playerData.unitId]: { currentSlot: unit.stats.currentSlot, currentItemId: unit.stats.currentItemId } },
        });
      }
      return;
    }
    const triggeredBy = { playerId: playerData.player.id, unitId: playerData.unitId };

    if (slot.scriptName) {
      // For per-unit-type scripts the trigger manager indexed them under
      // `unitTypes:<typeId>:<scriptName>`. Try that first when the binding flags it
      // as an entity script, then fall back to the bare id.
      const namespacedId = typeId ? `unitTypes:${typeId}:${slot.scriptName}` : null;
      const indexed = namespacedId && this.scripts.triggers.getScript(namespacedId);
      if (slot.isEntityScript && indexed) {
        this.scripts.runScript(namespacedId!, { triggeredBy: { ...triggeredBy, entityTypeId: typeId, entityTypeCategory: 'unitTypes' }, thisEntity: playerData.unitId });
      } else if (this.scripts.triggers.getScript(slot.scriptName)) {
        this.scripts.runScript(slot.scriptName, { triggeredBy });
      } else if (indexed) {
        // Even when the binding doesn't set isEntityScript, fall back to the per-type
        // index — taro game data isn't always consistent about that flag.
        this.scripts.runScript(namespacedId!, { triggeredBy: { ...triggeredBy, entityTypeId: typeId, entityTypeCategory: 'unitTypes' }, thisEntity: playerData.unitId });
      }
    }

    if (slot.event === 'startCasting' && slot.abilityId) {
      // Ability cast — same wire as ActionRunner's `castAbility`.
      this.engine.events.emit('ability:cast', [playerData.unitId, slot.abilityId]);
    }
    if (slot.event === 'stopCasting') {
      this.engine.events.emit('ability:stop', [playerData.unitId]);
    }
  }

  private _onPlayerMouseMoved(clientId: string, data: { x: number; y: number; yaw?: number; pitch?: number }): void {
    const playerData = this._players.get(clientId);
    if (!playerData) return;
    const unit = this._entities.get(playerData.unitId);
    if (unit) {
      unit._mousePosition = data;
      if (data.yaw !== undefined) unit._cameraYaw = data.yaw;
      if (data.pitch !== undefined) unit._cameraPitch = data.pitch;
    }
  }

  // --- Entity management (public so scripts/physics can use) ---

  spawnUnit(
    typeId: string,
    typeDef: Record<string, unknown>,
    ownerId?: string,
    spawn?: { x?: number; z?: number; rotation?: number },
  ): Unit {
    const unit = new Unit(undefined, {
      name: (typeDef.name as string) || typeId,
      type: typeId,
      health: (typeDef.attributes as any)?.health?.value ?? 100,
      maxHealth: (typeDef.attributes as any)?.health?.max ?? 100,
      speed: (typeDef.attributes as any)?.speed?.value ?? 10,
      ownerId: ownerId || '',
      stateId: 'default',
      isHidden: false, opacity: 1, flip: 0,
      scale: (typeDef.scale as number) || 1,
    });

    // Carry inventory metadata from the type definition (the renderer's HUD reads
    // these off EntityStatsUpdate to draw the slot bar). Default items, if the
    // type has any, get installed into a fresh inventory array.
    const invSize = Number((typeDef as any).inventorySize) || 0;
    const defaultItems = ((typeDef as any).defaultItems ?? {}) as Record<string, { itemTypeId?: string; quantity?: number }>;
    const startingInv: Array<{ id: string; type: string; quantity: number }> = [];
    for (const [, def] of Object.entries(defaultItems)) {
      if (def?.itemTypeId) {
        startingInv.push({
          id: `inv_${Math.random().toString(36).slice(2, 10)}`,
          type: def.itemTypeId,
          quantity: Number(def.quantity) || 1,
        });
      }
    }
    (unit.stats as any).inventorySize = invSize;
    (unit.stats as any).inventory = startingInv;
    (unit.stats as any).currentSlot = 0;
    (unit.stats as any).currentItemId = startingInv[0]?.id ?? null;

    const attrDefs = typeDef.attributes as Record<string, any> | undefined;
    if (attrDefs) {
      for (const [attrId, attrDef] of Object.entries(attrDefs)) {
        (unit.stats as any)[`attr_${attrId}`] = {
          value: attrDef.value ?? 0, min: attrDef.min ?? 0, max: attrDef.max ?? 100,
          regenerateSpeed: attrDef.regenerateSpeed ?? 0, name: attrDef.name ?? attrId,
          color: attrDef.color ?? '#ffffff',
        };
      }
    }

    // Apply spawn transform BEFORE broadcast so clients see it in its final position.
    if (spawn) {
      if (typeof spawn.x === 'number') unit.position.x = spawn.x;
      if (typeof spawn.z === 'number') unit.position.z = spawn.z;
      if (typeof spawn.rotation === 'number') (unit as any).rotation = spawn.rotation;
    }

    unit.mount(this.engine.root);
    this._entities.set(unit.id, unit);

    // Create physics body for the unit
    this._createEntityBody(unit.id, unit.position.x, unit.position.z, typeDef as Record<string, any>);

    this._transport.broadcast({
      type: MessageType.EntityCreate,
      data: buildEntityCreatePayload(
        'unit', unit.id, unit.position.x, unit.position.z, (unit as any).rotation || 0,
        { ...unit.stats, ...typeDef },
      ),
    });

    this.scripts.trigger('entityCreatedGlobal', { entityId: unit.id, unitId: unit.id });
    // Per-type entityCreated — only scripts attached to this unit type's `.scripts` block
    // run, dispatched by ScriptEngine.trigger via the parent filter.
    this.scripts.trigger('entityCreated', { entityId: unit.id, unitId: unit.id });
    return unit;
  }

  private _handleScriptAction(type: string, action: Record<string, unknown>, vars: Record<string, unknown>): void {
    const runner = this.scripts.actions;
    const resolve = (v: unknown): unknown => runner.resolveValue(v, vars);

    switch (type) {
      case 'createUnitAtPosition':
      case 'createProjectileAtPosition':
      case 'createItemAtPositionWithQuantity':
      case 'createEntityAtPositionWithDimensions':
      case 'createEntityAtPositionWithDimensions2d':
      case 'createEntityForPlayerAtPositionWithDimensions': {
        // Pick category from action.entityType (when present) OR from the action name itself.
        // Karmaslayers uses both `createUnitAtPosition` (implicit unitTypes) and the explicit
        // `createProjectileAtPosition` / `createItemAtPositionWithQuantity` forms (86 + 7 uses).
        const inferredCategory =
          type === 'createUnitAtPosition' ? 'unitTypes' :
          type === 'createProjectileAtPosition' ? 'projectileTypes' :
          type === 'createItemAtPositionWithQuantity' ? 'itemTypes' :
          (action.entityType as string) || 'unitTypes';
        const typeId =
          (resolve(action.unitType) as string) ||
          (resolve(action.projectileType) as string) ||
          (resolve(action.itemType) as string) ||
          (resolve(action.entity) as string) ||
          (action.entity as string);
        if (!typeId) return;

        const typeMaps: Record<string, string> = {
          unitTypes: 'unitTypes',
          itemTypes: 'itemTypes',
          propTypes: 'propTypes',
          projectileTypes: 'projectileTypes',
        };
        const typeKey = typeMaps[inferredCategory] ?? 'unitTypes';
        const typeDef = this.types.get(typeKey, typeId) as Record<string, unknown> | null;
        if (!typeDef) return;

        // Scripts work in taro pixel coords; convert to engine tile-units here.
        const rawPos = resolve(action.position) as { x?: number; y?: number } | null;
        if (!rawPos) return;
        const tilePx = runner.mapTilePx;
        const px = (rawPos.x ?? 0) / tilePx;
        const pz = (rawPos.y ?? 0) / tilePx;

        const angle = Number(resolve(action.angle)) || 0;
        const playerId = (resolve(action.player) as string) || (resolve(action.entity) as string) || '';

        if (typeKey === 'unitTypes') {
          this.spawnUnit(
            typeId,
            typeDef,
            typeof playerId === 'string' ? playerId : '',
            { x: px, z: pz, rotation: angle },
          );
        } else {
          // Generic entity (prop/item/projectile). Register it on engine.root so
          // findById, getLastCreatedItem/Projectile, getOwner*, etc. all resolve.
          const classId = typeKey === 'itemTypes' ? 'item' : typeKey === 'propTypes' ? 'prop' : 'projectile';
          const entityId = `${classId.slice(0,3)}_${Math.random().toString(36).slice(2, 10)}`;
          const ent = this.engine.spawn(entityId);
          ent.category = classId;
          ent.position.x = px; ent.position.z = pz;
          (ent as any).rotation = angle;
          (ent as any).stats = {
            ...(typeDef as Record<string, unknown>),
            type: typeId,
            quantity: Number(resolve(action.quantity)) || 1,
          };
          this._entities.set(entityId, ent);

          this._transport.broadcast({
            type: MessageType.EntityCreate,
            data: buildEntityCreatePayload(classId, entityId, px, pz, angle, { ...(typeDef as Record<string, unknown>), type: typeId }),
          });
          // Fire entityCreatedGlobal so ActionRunner's listener tracks last-created
          // for the right category, and per-type entityCreated scripts run.
          this.scripts.trigger('entityCreatedGlobal', {
            entityId,
            category: classId,
            ...(classId === 'item' ? { itemId: entityId } : {}),
            ...(classId === 'projectile' ? { projectileId: entityId } : {}),
          });
          this.scripts.trigger('entityCreated', {
            entityId,
            ...(classId === 'item' ? { itemId: entityId } : {}),
            ...(classId === 'projectile' ? { projectileId: entityId } : {}),
          });

          // Projectile motion: if the type def has a speed, give it linear velocity along `angle`.
          // Without this, projectiles spawn but never move.
          if (classId === 'projectile' && this._physics) {
            const speed = Number((typeDef as any)?.speed ?? 0);
            if (speed > 0) {
              this._createEntityBody(entityId, px, pz, typeDef as Record<string, any>);
              const body = this._entityBodies.get(entityId);
              if (body) {
                // taro convention: angle 0 = up; project forward = (sin(a), -cos(a)). Velocity in
                // physics units = pixels/SCALE_RATIO/sec.
                const v = speed / GameServer.SCALE_RATIO;
                body.linearVelocity = new Vec2(Math.sin(angle) * v, -Math.cos(angle) * v);
              }
            }
            // Despawn after lifeSpan ms (taro projectileTypes.lifeSpan).
            const life = Number((typeDef as any)?.lifeSpan ?? 0);
            if (life > 0) {
              setTimeout(() => {
                const e = this._entities.get(entityId);
                if (e) {
                  e.destroy?.();
                  this._entities.delete(entityId);
                  this._entityBodies.delete(entityId);
                  this._aiUnitFacingRotation.delete(entityId);
                  this._transport.broadcast({ type: MessageType.EntityDestroy, data: { entityId, timestamp: Date.now() } });
                }
              }, life);
            }
          }
        }
        return;
      }

      default:
        return;
    }
  }
}
