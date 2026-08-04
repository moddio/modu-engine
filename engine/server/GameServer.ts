import { Engine } from '../core/Engine';
import { ScriptEngine } from '../core/scripting/ScriptEngine';
import { EntityTypeRegistry } from '../core/game/EntityTypeRegistry';
import { Unit } from '../core/game/Unit';
import { Item } from '../core/game/Item';
import { Player } from '../core/game/Player';
import { PhysicsWorld, initPhysics } from '../core/physics/PhysicsWorld';
import { Vec2 } from '../core/math/Vec2';
import { CollisionCategory, DefaultCollisionMask, categoryForEntityType } from '../core/physics/CollisionFilter';
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
  private _players = new Map<string, { player: Player; clientId: string; unitId: string; placeholderUnitId?: string }>();
  private _tickCount = 0;
  /** Monotonic in-game elapsed time (ms), accumulated from each `_tick(dt)`.
   *  Taro's `taro.now` analog and the clock the fireRate domain runs on (the
   *  held-use loop / AI fire loop are dt-driven, not wall-clock). Used to gate
   *  per-item re-use against a persistent `lastUsed` timestamp. */
  private _gameTimeMs = 0;
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
  /** Coulomb ground-friction parameters per prop body (see `_applyGroundFriction`): the
   *  coefficient, plus the contact radius that turns it into an angular deceleration. */
  private _groundFriction = new Map<string, { mu: number; radius: number }>();
  /** Items currently held-down for continuous use (button1 / `startUsingItem`),
   *  keyed by item id → ms remaining until the next fireRate-throttled re-use.
   *  Taro equivalent: `Item._stats.isBeingUsed` driving `Item._behaviour()`.
   *  Cleared by `stopUsingItem`, weapon switch, or the unit going away. */
  private _itemsBeingUsed = new Map<string, number>();
  /** True only for the in-memory single-player server (GameClient.startSinglePlayer).
   *  Gates the built-in `/dev …` sandbox and free shop purchases. Defaults false so
   *  the multiplayer Server.ts and every engine test are unaffected. */
  private _singlePlayer = false;
  /** Per-playerId quick-teleport (`/dev qtp`) toggle state. */
  private _quickTeleport = new Set<string>();

  constructor(transport: ServerTransport, options?: { singlePlayer?: boolean }) {
    this._transport = transport;
    this._singlePlayer = !!options?.singlePlayer;
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

    // Initialize the physics backend (rapier is WASM and needs an async compile step).
    try {
      await initPhysics();
      const gravity = new Vec2(0, 0); // Top-down game: no gravity
      this._physics = new PhysicsWorld(gravity);

      // Create wall bodies from tilemap
      this._createWallBodies();
    } catch {
      // Physics initialization failed — continue without physics
      console.warn('[GameServer] physics backend not available, running without physics');
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
    // Common pattern: _onJoinGame spawns a placeholder unit at map center so the camera has
    // something to follow before scripts run. The playerJoinsGame script then creates the
    // real unit at a team spawn region and calls playerCameraTrackUnit. When that switch
    // happens, we destroy the placeholder so it doesn't leave a ghost unit standing in
    // the middle of the map (F0mB1BW05's purpleFighter at map center while the player is
    // really controlling a different unit at spawn region).
    this.engine.events.on('camera:trackUnit', (playerId: unknown, unitId: unknown) => {
      if (typeof playerId !== 'string' || typeof unitId !== 'string') return;
      for (const pd of this._players.values()) {
        if (pd.player.id !== playerId) continue;

        const placeholder = pd.placeholderUnitId;
        if (placeholder && placeholder !== unitId) {
          const ghost = this._entities.get(placeholder);
          if (ghost) {
            const body = this._entityBodies.get(placeholder);
            if (body && this._physics) {
              this._bodyToEntity.delete(body.handle);
              this._physics.destroyBody(body);
              this._entityBodies.delete(placeholder);
              this._groundFriction.delete(placeholder);
            }
            ghost.destroy?.();
            this._entities.delete(placeholder);
            this._regionMembership.delete(placeholder);
            this._aiUnitFacingRotation.delete(placeholder);
            this._transport.broadcast({
              type: MessageType.EntityDestroy,
              data: { entityId: placeholder, timestamp: Date.now() },
            });
          }
          pd.placeholderUnitId = undefined;
        }

        pd.unitId = unitId;
        this._transport.send(pd.clientId, {
          type: MessageType.InitConnection,
          data: { playerId, unitId },
        });
        break;
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
      // Build a trigger context that resolves correctly via every shape the death/full
      // scripts read: `getTriggeringUnit/Item/Projectile` look at `triggeredBy.unitId`
      // / `.itemId` / `.projectileId` (per ActionRunner), and `thisEntity` falls back
      // to whichever of those matches the entity's category. Firing only `entityId`
      // left `getTriggeringUnit()` undefined, so the global death script
      // `e6UBM4PgBF` (and Karmaslayers' loot/destroy chain hanging off it) couldn't
      // identify the dead unit — the unit reached 0 HP, the script ran, but every
      // `getTriggeringUnit` reference resolved to undefined and `destroyEntity` got
      // a no-op id. Symptom: mob stuck at 0 HP, still rendered, still colliding.
      const ent = this._entities.get(entityId);
      const cat = (ent as any)?.category as string | undefined;
      const triggerCtx: Record<string, unknown> = { entityId, attributeId: attrId };
      if (cat === 'unit') triggerCtx.unitId = entityId;
      else if (cat === 'item') triggerCtx.itemId = entityId;
      else if (cat === 'projectile') triggerCtx.projectileId = entityId;
      if (ent?.stats?.type) {
        triggerCtx.entityTypeId = ent.stats.type;
        triggerCtx.entityTypeCategory =
          cat === 'unit' ? 'unitTypes' :
          cat === 'item' ? 'itemTypes' :
          cat === 'projectile' ? 'projectileTypes' : undefined;
      }
      if (attr.value <= attr.min) {
        // Both event names: taro game data uses both spellings interchangeably and the
        // migrator preserves trigger names verbatim, so we have to fire both to match either.
        this.scripts.trigger('entityAttributeBecomesZero', triggerCtx);
        this.scripts.trigger('unitAttributeBecomesZero', triggerCtx);
      }
      if (attr.value >= attr.max) {
        this.scripts.trigger('entityAttributeBecomesFull', triggerCtx);
        this.scripts.trigger('unitAttributeBecomesFull', triggerCtx);
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

    // setEntityVariable / setPlayerVariable — ActionRunner mutates VariableStore (script
    // reads), but taro also stores these on entity._stats.variables so clients can render
    // them. Mirror to stats.variables and ship an EntityStatsUpdate diff. MERGE_KEYS in
    // EntityStream.ts already includes 'variables', so partial merges work correctly.
    this.engine.events.on('setEntityVariable', (eId: unknown, vName: unknown, value: unknown) => {
      const entityId = eId as string;
      const name = vName as string;
      if (!entityId || !name) return;
      const entity = this._entities.get(entityId);
      if (!entity) return;
      entity.stats = entity.stats || {};
      const variables = (entity.stats.variables as Record<string, unknown>) || {};
      variables[name] = value;
      entity.stats.variables = variables;
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [entityId]: { variables: { [name]: value } } },
      });
    });
    this.engine.events.on('setPlayerVariable', (pId: unknown, vName: unknown, value: unknown) => {
      const playerId = pId as string;
      const name = vName as string;
      if (!playerId || !name) return;
      const player = this._entities.get(playerId);
      if (!player) return;
      player.stats = player.stats || {};
      const variables = (player.stats.variables as Record<string, unknown>) || {};
      variables[name] = value;
      player.stats.variables = variables;
      this._transport.broadcast({
        type: MessageType.EntityStatsUpdate,
        data: { [playerId]: { variables: { [name]: value } } },
      });
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
      // Taro applies impulse/force values raw — same SCALE_RATIO=30, no extra scaling.
      const v = new Vec2(vx, vy);
      if (kind === 'impulse') body.applyImpulse(v);
      else body.applyForce(v);

      // A Z component means "up". The physics world is rapier2d — there is no vertical
      // axis for it to act on — so a 3D game's jump (`applyImpulseOnEntityXY` with
      // `{x:0, y:0, z:300}`, guarded by a ground check) silently did nothing at all.
      // Forward it as a UI command instead: the renderer owns the vertical arc, since
      // height is purely visual here. Without this, jumping is unimplemented.
      const vz = magOrVec && typeof magOrVec === 'object'
        ? Number((magOrVec as { z?: number }).z) || 0
        : 0;
      if (vz > 0) {
        this._transport.broadcast({
          type: MessageType.UICommand,
          data: { command: 'jumpEntity', args: [eid, vz] },
        });
      }
    };
    this.engine.events.on('physics:applyImpulse', physicsApply('impulse'));
    this.engine.events.on('physics:applyForce', physicsApply('force'));

    // spawnItem — free-standing item drop at a pixel-coord position.
    this.engine.events.on('item:spawn', (rawTypeId: unknown, rawPos: unknown, rawQty?: unknown) => {
      const typeId = rawTypeId as string;
      const pos = rawPos as { x?: number; y?: number } | null;
      if (!typeId || !pos) return;
      const typeDef = this.types.get('itemTypes', typeId) as Record<string, unknown> | null;
      if (!typeDef) return;
      const px = (pos.x ?? 0) / this._tilePx;
      const pz = (pos.y ?? 0) / this._tilePx;
      // Carry the stack count when supplied (drop paths pass the slot's quantity)
      // so a dropped stack of N is one world item of N — not N=1, which lost the
      // rest of the stack on every drop and let only one be picked back up.
      const quantity = Number(rawQty) || 1;
      const entityId = `itm_${Math.random().toString(36).slice(2, 10)}`;
      this._transport.broadcast({
        type: MessageType.EntityCreate,
        data: buildEntityCreatePayload('item', entityId, px, pz, 0, { ...typeDef, type: typeId, quantity }),
      });
      // Track the newly-spawned item in the engine tree so ActionRunner resolvers
      // (getLastCreatedItem, getOwnerOfItem, etc.) can find it.
      const item = this.engine.spawn(entityId);
      item.category = 'item';
      item.position.x = px; item.position.z = pz;
      (item as any).stats = { ...(typeDef as Record<string, unknown>), type: typeId, quantity };
      this._entities.set(entityId, item);
      // Seed entity-scope variables from typeDef.variables defaults — same reason
      // as the unit path in spawnUnit. Without this, scripts that gate behaviour on
      // `getValueOfEntityVariable(item, 'foo')` (e.g. the "press G to drop"
      // script's `dropPlaceAllowed == "anywhere"` check) always read undefined and
      // silently no-op.
      this._seedItemEntityVars(entityId, typeDef as Record<string, any>);
      // Build a physics body so unit sensors can detect the item entering them and the
      // engine can fire `itemEntersSensor` for cell-eats-food scripts (celleater).
      // Items live in `bodies.dropped` (units use `bodies.default`); _createEntityBody's
      // body resolution falls through to dropped automatically.
      this._createEntityBody(entityId, px, pz, typeDef as Record<string, any>, 'item');
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
    this.engine.events.on('ui:showTextForEveryone', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'showTextForEveryone', args },
      });
    });
    this.engine.events.on('ui:hideTextForEveryone', (...args: unknown[]) => {
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'hideTextForEveryone', args },
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
      const inv = (unit.stats.inventory ?? (unit.stats.inventory = [])) as Array<{ id: string; type: string; quantity: number } | null>;
      const id = `inv_${Math.random().toString(36).slice(2, 10)}`;
      // Fill the first empty slot left by a prior drop; only grow the array
      // when every existing slot is occupied, so giving an item after a drop
      // refills the original slot instead of appearing past trailing items.
      const newRec = { id, type: typeId, quantity: qty };
      const emptyIdx = inv.findIndex(it => !it);
      if (emptyIdx !== -1) inv[emptyIdx] = newRec;
      else inv.push(newRec);
      this._registerInventoryItemEntity(id, typeId, uid, qty);
      this._syncCurrentItemAndBroadcast(uid, unit);
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
      const inv = (unit.stats.inventory ?? []) as Array<{ id?: string; type?: string; quantity?: number } | null>;
      const item = inv[slotIdx];
      if (!item?.type) return;
      // Leave the slot empty (null) rather than splicing — splice would shift every
      // trailing slot one position forward, breaking the player's spatial mapping
      // of "slot 3 is my potion" the moment they drop slot 0.
      if (item.id) {
        const carried = this._entities.get(item.id);
        carried?.destroy?.();
        this._entities.delete(item.id);
      }
      inv[slotIdx] = null;
      // Spawn world item at unit's position via the same path as item:spawn,
      // preserving the slot's stack quantity.
      this.engine.events.emit('item:spawn', [item.type, { x: unit.position.x * this._tilePx, y: unit.position.z * this._tilePx }, Number(item.quantity) || 1]);
      this._syncCurrentItemAndBroadcast(uid, unit);
    });
    this.engine.events.on('inventory:dropAt', (rawIid: unknown, rawPos: unknown) => {
      const iid = rawIid as string;
      const item = this._entities.get(iid);
      if (!item?.stats) return;
      const pos = rawPos as { x?: number; y?: number } | null;
      if (!pos) return;
      // Detach from owner, spawn at the position.
      const typeId = item.stats.type as string;
      const ownerId = item.stats.ownerId as string;
      // The inventory slot *record* is the source of truth for stack count: a
      // stack-pickup bumps `record.quantity` but never the backing carried-item
      // entity's `stats.quantity`, so the entity's value is stale (still 1 for a
      // stack the player grew to N via pickups). Read the owner's slot record
      // and drop that quantity; fall back to the entity only when there's no
      // owner/slot (a free item dropped at a position).
      const owner = ownerId ? this._entities.get(ownerId) : null;
      const ownerInv = (owner?.stats?.inventory ?? null) as Array<{ id?: string; quantity?: number } | null> | null;
      const slotIdx = ownerInv ? ownerInv.findIndex(it => it?.id === iid) : -1;
      const dropQty = slotIdx !== -1
        ? Number(ownerInv![slotIdx]!.quantity) || 1
        : Number(item.stats.quantity) || 1;
      this.engine.events.emit('item:spawn', [typeId, pos, dropQty]);
      // Remove from owner's inventory and destroy the carried-item entity. Without
      // destroying it, `_entities.get(iid)` keeps resolving and a stale
      // `currentItemId` pointing at this id (the "press G to drop" script reads
      // `getItemCurrentlyHeldByUnit` which returns `currentItemId` directly) lets
      // the same id be dropped repeatedly — each press spawning a fresh world item.
      if (owner?.stats?.inventory) {
        // Null the matching slot in place rather than filtering — `filter`
        // shifts every trailing slot one position forward, which moves the
        // player's other items out from under their slot indices.
        if (slotIdx !== -1) (owner.stats.inventory as Array<unknown | null>)[slotIdx] = null;
        item.destroy?.();
        this._entities.delete(iid);
        this._syncCurrentItemAndBroadcast(ownerId, owner);
      }
    });
    this.engine.events.on('inventory:dropAll', (rawUid: unknown) => {
      const uid = rawUid as string;
      const unit = this._entities.get(uid);
      if (!unit?.stats) return;
      const inv = (unit.stats.inventory ?? []) as Array<{ type?: string; quantity?: number } | null>;
      const px = unit.position.x * this._tilePx;
      const py = unit.position.z * this._tilePx;
      for (const it of inv) {
        if (it?.type) this.engine.events.emit('item:spawn', [it.type, { x: px, y: py }, Number(it.quantity) || 1]);
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
      const typeId = rawTypeId as string;
      // Seed the player's attr_<id> slots from the playerType's `attributes` block so
      // getPlayerAttribute returns the configured starting value (and bounds) instead of
      // undefined. setPlayerAttribute writes filtered through Number.isFinite, so an
      // uninitialized slot poisons the first calc-based update with NaN and the value
      // never gets recorded — leaving every dependent stat (cell scale, sensor radius,
      // camera zoom, speed in celleater) frozen at its base.
      const ent = this._entities.get(pid);
      const ptDef = this.types.get('playerTypes', typeId) as Record<string, any> | null;
      const attrDefs = ptDef?.attributes as Record<string, any> | undefined;
      const patch: Record<string, unknown> = { playerTypeId: typeId, playerType: typeId };
      if (ent && attrDefs) {
        ent.stats = ent.stats || {};
        for (const [attrId, attrDef] of Object.entries(attrDefs)) {
          const slot = `attr_${attrId}`;
          const initialized = {
            value: attrDef.value ?? 0,
            min: attrDef.min ?? 0,
            max: attrDef.max ?? 100,
            regenerateSpeed: attrDef.regenerateSpeed ?? 0,
            name: attrDef.name ?? attrId,
            color: attrDef.color ?? '#ffffff',
          };
          (ent.stats as any)[slot] = initialized;
          patch[slot] = initialized;
        }
      }
      writeStat(pid, patch);
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

    // ability:cast — full cast pipeline:
    //   1. Look up the ability def (data.abilities[abilityId]) and merge in the
    //      casting unit's `controls.unitAbilities[abilityId]` override. Karmaslayers
    //      and many other taro games leave the top-level `eventScripts.startCasting`
    //      empty and put the real script id on the per-unit-type override — without
    //      this merge, pressing the bound key (e.g. space / E / right-click) casts
    //      the ability cosmetically but runs no script.
    //   2. Enforce per-unit cooldown — pressing the bound key during cooldown is a no-op.
    //   3. Deduct cost.unitAttributes from the unit, cost.playerAttributes from its owner.
    //   4. Run eventScripts.startCasting. NOTE: do NOT execute `def.scriptName`. In taro
    //      that field is editor metadata pointing at a related utility script; the editor
    //      uses it for navigation, not the engine for execution. Karmaslayers and many
    //      other games ship `scriptName: 'playerJoinsGame'` on unrelated abilities, so
    //      running it on cast spawns a fresh unit each time the bound key is pressed.
    //   5. Broadcast a `castAbility` UICommand for client-side VFX.
    const abilities = (gameData as any).abilities as Record<string, any> | undefined;
    // Build the effective ability def for a casting unit by layering the unit-type
    // override on top of the top-level def. Override fields with empty string fall
    // back to the top-level — taro's editor writes `""` for "use the default".
    const resolveAbilityDef = (unit: any, abilityId: string): { def: any; typeId: string | null } | null => {
      const top = abilities?.[abilityId];
      const typeId = ((unit.stats as any)?.type as string | undefined) ?? null;
      const typeDef = typeId ? (this.types.get('unitTypes', typeId) as Record<string, unknown> | null) : null;
      const override = (typeDef as any)?.controls?.unitAbilities?.[abilityId];
      if (!top && !override) return null;
      const merged: Record<string, unknown> = { ...(top ?? {}) };
      for (const [k, v] of Object.entries(override ?? {})) {
        if (v === '' || v === undefined || v === null) continue;
        merged[k] = v;
      }
      return { def: merged, typeId };
    };
    this.engine.events.on('ability:cast', (rawUid: unknown, rawAbilityId: unknown) => {
      const uid = rawUid as string;
      const abilityId = rawAbilityId as string;
      if (!uid || !abilityId) return;
      const unit = this._entities.get(uid);
      if (!unit) return;
      const resolved = resolveAbilityDef(unit, abilityId);
      if (!resolved) return;
      const def = resolved.def;
      const typeId = resolved.typeId;

      // Cooldown: per-(unitId, abilityId).
      const now = Date.now();
      unit._abilityCooldowns = unit._abilityCooldowns || ({} as Record<string, number>);
      const readyAt = unit._abilityCooldowns[abilityId] ?? 0;
      if (now < readyAt) return; // still on cooldown
      unit._abilityCooldowns[abilityId] = now + (Number(def.cooldown) || 0);

      // Cost deduction. Negative deltas — taro semantics: cost > 0 reduces the attr.
      const ownerId = (unit.stats as any)?.ownerId as string | undefined;
      for (const [attrId, amt] of Object.entries(def.cost?.unitAttributes ?? {})) {
        const v = Number(amt);
        if (!Number.isFinite(v) || v === 0) continue;
        const slot = `attr_${attrId}`;
        const attr = (unit.stats as any)?.[slot];
        if (!attr) continue;
        const next = (attr.value ?? 0) - v;
        // If the unit can't afford it, refund the cooldown and bail.
        if (next < (attr.min ?? 0)) {
          unit._abilityCooldowns[abilityId] = readyAt;
          return;
        }
        this.engine.events.emit('setEntityAttribute', [uid, attrId, next]);
      }
      if (ownerId) {
        for (const [attrId, amt] of Object.entries(def.cost?.playerAttributes ?? {})) {
          const v = Number(amt);
          if (!Number.isFinite(v) || v === 0) continue;
          const player = this._entities.get(ownerId);
          const slot = `attr_${attrId}`;
          const attr = (player?.stats as any)?.[slot];
          if (!attr) continue;
          const next = (attr.value ?? 0) - v;
          if (next < (attr.min ?? 0)) {
            unit._abilityCooldowns[abilityId] = readyAt;
            return;
          }
          this.engine.events.emit('player:setAttribute', [ownerId, attrId, next]);
        }
      }

      // Run the ability's cast script. thisEntity = the unit casting. Per-unit-type
      // scripts are indexed under `unitTypes:<typeId>:<scriptId>` (see TriggerManager
      // .loadEntityTypeScripts), so when the override points at one, the bare-id
      // lookup fails — try the namespaced id and pass entityType context so action
      // resolution treats it as an entity script.
      const triggeredBy = { unitId: uid, playerId: ownerId, abilityId };
      const startCasting = def.eventScripts?.startCasting;
      if (startCasting) {
        const namespacedId = typeId ? `unitTypes:${typeId}:${startCasting}` : null;
        if (this.scripts.triggers.getScript(startCasting)) {
          this.scripts.runScript(startCasting, { triggeredBy, thisEntity: uid });
        } else if (namespacedId && this.scripts.triggers.getScript(namespacedId)) {
          this.scripts.runScript(namespacedId, {
            triggeredBy: { ...triggeredBy, entityTypeId: typeId, entityTypeCategory: 'unitTypes' },
            thisEntity: uid,
          });
        }
      }

      // Forward to client for VFX (icon flash, animation hint, etc.).
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'castAbility', args: [uid, abilityId] },
      });
    });
    this.engine.events.on('ability:stop', (rawUid: unknown, rawAbilityId: unknown) => {
      const uid = rawUid as string;
      const abilityId = rawAbilityId as string;
      const unit = this._entities.get(uid);
      const ownerId = (unit?.stats as any)?.ownerId as string | undefined;
      const resolved = unit ? resolveAbilityDef(unit, abilityId) : null;
      const triggeredBy = { unitId: uid, playerId: ownerId, abilityId };
      const stopCasting = resolved?.def?.eventScripts?.stopCasting as string | undefined;
      const typeId = resolved?.typeId ?? null;
      if (stopCasting) {
        const namespacedId = typeId ? `unitTypes:${typeId}:${stopCasting}` : null;
        if (this.scripts.triggers.getScript(stopCasting)) {
          this.scripts.runScript(stopCasting, { triggeredBy, thisEntity: uid });
        } else if (namespacedId && this.scripts.triggers.getScript(namespacedId)) {
          this.scripts.runScript(namespacedId, {
            triggeredBy: { ...triggeredBy, entityTypeId: typeId, entityTypeCategory: 'unitTypes' },
            thisEntity: uid,
          });
        }
      }
      this._transport.broadcast({
        type: MessageType.UICommand,
        data: { command: 'stopCastingAbility', args: [uid, abilityId] },
      });
    });

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
    // Release: end the continuous-use loop started by `item:startUse`. Separate
    // listener so the existing `stopUsingItem` client forward above is untouched.
    this.engine.events.on('item:stopUse', (rawIid: unknown) => {
      const itemId = rawIid as string;
      if (itemId) this._itemsBeingUsed.delete(itemId);
    });
    this.engine.events.on('item:changeImage', forwardCmd('changeItemImage'));

    // Press-and-hold use (button1 → `startUsingItem`). Taro's `Item.startUsing()`
    // sets `isBeingUsed = true` and fires once that frame; `Item._behaviour()`
    // then calls `use()` every tick while held, self-throttled by `fireRate`.
    // Modu's analog: fire once now, then register the held item so
    // `_processItemUse` re-emits `item:use` every `fireRate` ms until
    // `item:stopUse`. `useItemOnce` keeps emitting a bare one-shot `item:use`.
    this.engine.events.on('item:startUse', (rawIid: unknown) => {
      const itemId = rawIid as string;
      if (!itemId) return;
      // Taro's `Item.startUsing()` no-ops when already being used. Without this
      // a script re-calling `startUsingItem` while held would fire every call,
      // bypassing fireRate.
      if (this._itemsBeingUsed.has(itemId)) return;
      const holder = this._resolveItemHolder(itemId);
      if (!holder) return;
      this.engine.events.emit('item:use', [itemId]);
      this._itemsBeingUsed.set(itemId, this._itemFireRateMs(holder.invEntry));
    });

    // Item use → fire `itemIsUsed` (and `thisUnitUsesItem` per the unit's type scripts),
    // plus the built-in gun behaviour when the held item type is `isGun: true`.
    // `item:use` is the single-shot signal (emitted directly by `useItemOnce`, by
    // the AI fire loop, and once per fireRate tick by the held-use loop). Held
    // items live in unit.stats.inventory as bare `{id,type,quantity}` records —
    // they aren't real entities — so we have to scan units'
    // inventories to resolve the firing unit.
    this.engine.events.on('item:use', (rawEid: unknown) => {
      const itemId = rawEid as string;
      if (!itemId) return;

      let firingUnit: any = null;
      let invEntry: { id?: string; type?: string; quantity?: number } | undefined;
      for (const ent of this._entities.values()) {
        if (ent.category !== 'unit') continue;
        // Inventory slots can be null after a consumable empties (see the
        // `if (nextQty <= 0) inv[idx] = null` branch below) — guard the find
        // so we don't deref `i.id` on a null hole.
        const inv = (ent.stats?.inventory ?? []) as Array<{ id?: string; type?: string; quantity?: number } | null>;
        const found = inv.find((i) => i?.id === itemId) ?? undefined;
        if (found) { firingUnit = ent; invEntry = found; break; }
      }
      // World-item fallback: dropped/equipped items that *are* in `_entities` carry ownerId.
      const worldItem = this._entities.get(itemId) as { stats?: { ownerId?: string; type?: string; lastUsed?: number } } | undefined;
      const unitId = firingUnit?.id ?? worldItem?.stats?.ownerId;

      const itemTypeKey = invEntry?.type ?? worldItem?.stats?.type;
      const itemType = itemTypeKey
        ? (this.types.get('itemTypes', itemTypeKey) as Record<string, any> | null)
        : null;

      // FireRate gate — taro's `Item.use()`: a shot only happens when
      // `_stats.lastUsed + fireRate < taro.now`, and `stopUsing()` never clears
      // `lastUsed`. Modu previously kept the throttle only in `_itemsBeingUsed`,
      // which `item:stopUse` deletes — so a quick LMB click (mousedown→
      // `startUsingItem`, mouseup→`stopUsingItem`) wiped the cooldown and the
      // next press fired instantly, letting players shoot as fast as they could
      // click. Persist `lastUsed` on the item's own record (the inventory
      // entry, or the world entity's stats) so it survives release and is GC'd
      // with the item — exactly taro's `_stats.lastUsed`. Bail before any side
      // effect (trigger/projectile/consume/tween) when still within fireRate.
      const fireRateRecord = (invEntry ?? worldItem?.stats) as { lastUsed?: number } | undefined;
      if (fireRateRecord) {
        const fireRate = Number(itemType?.fireRate) || 1000;
        const lastUsed = fireRateRecord.lastUsed;
        if (lastUsed !== undefined && this._gameTimeMs - lastUsed < fireRate) return;
        fireRateRecord.lastUsed = this._gameTimeMs;
      }

      this.scripts.trigger('itemIsUsed', { itemId, unitId });
      if (unitId) this.scripts.trigger('thisUnitUsesItem', { itemId, unitId });

      // Built-in gun fire — matches taro's Item.use() (moddio2/src/gameClasses/Item.js):
      // when the held item type has `isGun: true` and a `projectileType`, spawn one
      // projectile from the gun's tip in the unit's facing direction. Without this,
      // games that bind `button1` → `startUsingItem` produce no bullets unless they
      // also wire an explicit `itemIsUsed` script that calls `createProjectileAtPosition`.
      if (firingUnit && invEntry?.type) {
        if (itemType?.isGun && itemType?.projectileType) {
          this._fireGunProjectile(firingUnit, itemType, invEntry.id);
        }
      }

      // Consumable items: apply `bonus.consume` to the firing unit's attrs
      // (`unitAttribute`) and the owning player's attrs (`playerAttribute`),
      // then decrement the inventory stack by 1. Mirrors taro's `Item.use()`
      // consumable branch (moddio2/src/gameClasses/Item.js, ~line 710). Without
      // this, every inventory consumable (food, potions, scrolls, …) is a
      // silent no-op when the player clicks "use": Hunger / HP / score never
      // change and the stack never empties. The pickup-side path (line ~2765,
      // `isUsedOnPickup`) only covers items eaten on contact (celleater food),
      // not held-in-inventory consumables that the player chooses to use.
      if (firingUnit && itemType?.type === 'consumable' && itemType?.bonus?.consume) {
        const remaining = Number(invEntry?.quantity) || 0;
        if (remaining > 0) {
          const consume = itemType.bonus.consume as Record<string, any>;
          for (const [attrId, raw] of Object.entries(consume.unitAttribute ?? {})) {
            const slot = `attr_${attrId}`;
            const cur = (firingUnit.stats as any)[slot] ?? { value: 0, min: 0, max: Number.MAX_SAFE_INTEGER };
            const next = Math.max(cur.min ?? 0, Math.min(cur.max ?? Number.MAX_SAFE_INTEGER, (cur.value ?? 0) + Number(raw || 0)));
            (firingUnit.stats as any)[slot] = { ...cur, value: next };
            this._transport.broadcast({
              type: MessageType.EntityStatsUpdate,
              data: { [firingUnit.id]: { [slot]: { value: next, min: cur.min, max: cur.max } } },
            });
          }
          const ownerId = firingUnit.stats?.ownerId as string | undefined;
          const player = ownerId ? this._entities.get(ownerId) : null;
          if (player?.stats) {
            for (const [attrId, raw] of Object.entries(consume.playerAttribute ?? {})) {
              const slot = `attr_${attrId}`;
              const cur = (player.stats as any)[slot] ?? { value: 0, min: 0, max: Number.MAX_SAFE_INTEGER };
              const next = Math.max(cur.min ?? 0, Math.min(cur.max ?? Number.MAX_SAFE_INTEGER, (cur.value ?? 0) + Number(raw || 0)));
              (player.stats as any)[slot] = { ...cur, value: next };
              this._transport.broadcast({
                type: MessageType.EntityStatsUpdate,
                data: { [ownerId!]: { [slot]: { value: next, min: cur.min, max: cur.max } } },
              });
            }
          }
          // Decrement the stack. `invEntry.quantity` is the player-visible
          // count broadcast via `_syncCurrentItemAndBroadcast`; the backing
          // entity's `stats.quantity` mirrors it so `getItemQuantity` / other
          // resolvers see the same value. When the stack empties, clear the
          // slot and tear down the backing entity so the held-item sprite
          // refreshes and resolvers stop returning the corpse.
          const nextQty = remaining - 1;
          invEntry!.quantity = nextQty;
          const worldEnt = this._entities.get(itemId);
          if (worldEnt?.stats) (worldEnt.stats as any).quantity = nextQty;
          if (nextQty <= 0) {
            const inv = (firingUnit.stats?.inventory ?? []) as Array<{ id?: string } | null>;
            const idx = inv.findIndex(r => r?.id === itemId);
            if (idx !== -1) inv[idx] = null;
            // Taro fires `ThisItemsQuantityBecomesZero` before the slot is
            // gone so any cleanup script can still resolve the item.
            this.scripts.trigger('ThisItemsQuantityBecomesZero', { itemId, unitId: firingUnit.id });
            worldEnt?.destroy?.();
            this._entities.delete(itemId);
          }
          this._syncCurrentItemAndBroadcast(firingUnit.id, firingUnit);
        }
      }

      // Held-item use tween. Taro's `Item.use()` calls `playEffect('use')`,
      // which reads the item type's `effects.use.tween` and starts the named
      // tween from its TweenComponent table (taro: `gs/taro/src/gameClasses/
      // components/TweenComponent.js`). Real values: `swingCW` / `swingCCW`
      // (rotate ±π), `swing360CW` (rotate +2π), `poke` (translate +50 along
      // item-Y), `recoil` (translate −10 along item-Y); `""` and `"none"`
      // mean no tween. Broadcast the tween *name* so the renderer can pick
      // the right animation — sending `useItem: true` made every weapon play
      // the same swingCW arc (knives, guns, bows all looked like a generic
      // sword swing).
      const useTween = itemType?.effects?.use?.tween;
      const hasUseTween =
        typeof useTween === 'string' && useTween !== '' && useTween !== 'none';
      if (unitId && hasUseTween) {
        this._transport.broadcast({
          type: MessageType.EntityStatsUpdate,
          data: { [unitId]: { useItem: useTween } },
        });
      }
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
    // Bridge physics velocity into the scripting runtime so `getEntityVelocityX/Y`
    // can read live values without GameServer exposing `_entityBodies` publicly.
    this.scripts.actions.velocityProvider = (eid: string) => {
      const body = this._entityBodies.get(eid);
      if (!body) return null;
      const v = body.linearVelocity;
      return { x: v.x, y: v.y };
    };
    // Expose game-owner userId for `playerIsCreator`. Taro path: `defaultData.owner`.
    const ownerId =
      (this._rawGameData?.defaultData?.owner as string | undefined) ??
      ((gameData as unknown as Record<string, unknown>).defaultData as Record<string, unknown> | undefined)?.owner as string | undefined;
    this.scripts.actions.gameOwnerUserId = ownerId ?? null;

    // Wall / unit / projectile collision triggers. PhysicsWorld.step emits
    // collisionStart events with rapier collider handles; resolve to body handles
    // and dispatch the matching script trigger.
    if (this._physics) {
      const resolveCollider = (colliderHandle: number): { entityId: string | null; isWall: boolean; isSensor: boolean } => {
        const collider = (this._physics as any).world.getCollider(colliderHandle);
        const bodyHandle = collider?.parent()?.handle;
        const isSensor = !!collider?.isSensor?.();
        if (bodyHandle == null) return { entityId: null, isWall: false, isSensor };
        if (this._wallBodyHandles.has(bodyHandle)) return { entityId: null, isWall: true, isSensor };
        return { entityId: this._bodyToEntity.get(bodyHandle) ?? null, isWall: false, isSensor };
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
          // unit ↔ unit. When at least one side's body fixture is a sensor (e.g. celleater
          // cells), fire `unitEntersSensor` for each sensor-owning side instead of the
          // rigid `entityTouchesUnit` — taro's per-unit `unitEntersSensor` script reads
          // `getTriggeringUnit` (the entering unit) and `thisEntity` (the sensor owner).
          // Provide both via separate context keys so the resolver returns the right ones.
          if (ca === 'unit' && cb === 'unit') {
            if (a.isSensor || b.isSensor) {
              const fireSensor = (sensorOwnerId: string, enteringId: string) => {
                const owner = this._entities.get(sensorOwnerId);
                this.scripts.trigger('unitEntersSensor', {
                  unitId: enteringId,
                  thisEntity: sensorOwnerId,
                  entityTypeId: owner?.stats?.type,
                  entityTypeCategory: 'unitTypes',
                });
              };
              if (a.isSensor) fireSensor(a.entityId, b.entityId);
              if (b.isSensor) fireSensor(b.entityId, a.entityId);
            } else {
              this.scripts.trigger('entityTouchesUnit', { unitId: a.entityId, otherUnitId: b.entityId });
              this.scripts.trigger('entityTouchesUnit', { unitId: b.entityId, otherUnitId: a.entityId });
            }
          }
          // unit ↔ projectile. Three perspectives + three trigger names:
          //   - unit's per-type scripts listening for `unitTouchesProjectile` /
          //     `entityTouchesProjectile`
          //   - projectile's per-type scripts listening for `entityTouchesUnit`
          //     (this is the damage-application path; the projectile's own
          //     entityTouchesUnit handler reads getTriggeringUnit and calls
          //     setEntityAttribute(unit, health, current - damage))
          // Pass entityTypeId/Category explicitly so ScriptEngine.trigger filters
          // each trigger to the correct per-type script bucket.
          const fireUnitProjectilePair = (unitId: string, projectileId: string) => {
            const unit = this._entities.get(unitId);
            const proj = this._entities.get(projectileId);
            // Skip self-collision: the projectile spawns from `sourceUnitId` and its body
            // is wide enough (knife hitbox is 2 tiles) to overlap the firing unit at the
            // bsp offset. Without this filter the global damage script
            // (`unitTouchesProjectile` → CdoRHe0nNK) runs with `triggeringUnit = firing
            // unit`, the human-vs-AI gate `playerIsControlledByHuman(getOwner(...)) ==
            // false` evaluates true (the firer IS human), the AND fails, and damage
            // never reaches the actual target — every melee swing reads as "no damage".
            // Taro's Box2dComponent ignores body pairs whose `groupIndex` matches; the
            // equivalent here is filtering at the trigger source.
            if ((proj as any)?.stats?.sourceUnitId === unitId) return;
            // Unit's perspective.
            this.scripts.trigger('unitTouchesProjectile', {
              unitId, projectileId,
              entityTypeId: unit?.stats?.type, entityTypeCategory: 'unitTypes',
            });
            this.scripts.trigger('entityTouchesProjectile', {
              unitId, projectileId,
              entityTypeId: unit?.stats?.type, entityTypeCategory: 'unitTypes',
            });
            // Projectile's perspective — this is what runs the damage script.
            this.scripts.trigger('entityTouchesUnit', {
              unitId, projectileId, otherUnitId: unitId,
              entityTypeId: proj?.stats?.type, entityTypeCategory: 'projectileTypes',
            });
            // taro/modd projectile types carry `destroyOnContactWith.units`. When
            // true, the projectile despawns after the impact triggers run — that's
            // why a stock `bullet` disappears on hit instead of phasing through and
            // re-firing collisionStart for every overlapping tick (which in damage-
            // on-contact games drains the mob's HP to zero in one frame). The
            // damage application above already saw the contact, so destroying after
            // it is safe and matches taro's "this projectile may be destroyed before
            // inflicting damage" ordering note in Box2dComponent._triggerContactEvent.
            const projTypeId = (proj as any)?.stats?.type as string | undefined;
            const projTypeDef = projTypeId
              ? (this.types.get('projectileTypes', projTypeId) as Record<string, any> | null)
              : null;
            if (projTypeDef?.destroyOnContactWith?.units) {
              this._handleScriptAction('destroyEntity', { entity: projectileId }, {});
            }
          };
          if (ca === 'unit' && cb === 'projectile') fireUnitProjectilePair(a.entityId, b.entityId);
          else if (ca === 'projectile' && cb === 'unit') fireUnitProjectilePair(b.entityId, a.entityId);

          // unit ↔ item. Items are sensor-only colliders (taro `bodies.dropped.fixtures[0]`
          // sets `isSensor: true`), so the unit script reads it as `itemEntersSensor`.
          // The cell's pickup handler in celleater listens for this trigger to call
          // `makeUnitPickupItem` and convert food into score.
          const fireItemSensor = (unitId: string, itemId: string) => {
            const unit = this._entities.get(unitId);
            const item = this._entities.get(itemId);
            this.scripts.trigger('itemEntersSensor', {
              unitId,
              itemId,
              thisEntity: unitId,
              entityTypeId: unit?.stats?.type,
              entityTypeCategory: 'unitTypes',
            });
            // Mirror so any item-side per-type scripts can react too.
            this.scripts.trigger('entityEntersSensor', {
              unitId,
              itemId,
              thisEntity: itemId,
              entityTypeId: item?.stats?.type,
              entityTypeCategory: 'itemTypes',
            });
          };
          if (ca === 'unit' && cb === 'item') fireItemSensor(a.entityId, b.entityId);
          else if (ca === 'item' && cb === 'unit') fireItemSensor(b.entityId, a.entityId);
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
      const px = pos.x ?? 0;
      const pz = pos.y ?? 0;
      const angle = ((rot.y ?? 0) * Math.PI) / 180;

      // Register the entity for real rather than only announcing it. This used to
      // broadcast an EntityCreate and stop there, so the map's scenery existed on the
      // client and nowhere else: `_entities` never held it, so no collider was built
      // (units walked through every wall, fence and vehicle), `findById` /
      // `entitiesInRegion` / `destroyEntity` could not see it, and no entityCreated
      // script ever fired for it.
      //
      // No explicit broadcast is needed now: `_onPlayerJoin` streams every entity in
      // `_entities` to each connecting client, which is also what makes late joiners
      // work. Broadcasting here as well delivered each prop twice to anyone already
      // connected. The renderer's placement hints ride along in `stats` so that replay
      // carries them.
      const ent = this.engine.spawn(entityId);
      ent.category = classId;
      ent.position.x = px;
      ent.position.z = pz;
      (ent as any).rotation = angle;
      (ent as any).stats = {
        ...(entityDef as Record<string, unknown>),
        type: action.entity,
        _initAction: true,
        _rotation: rot,
        _scale: scl,
        _worldY: (pos.z ?? 0) - 0.501,
      };
      this._entities.set(entityId, ent);

      // Props and items get a collider from their own body definition. `_createEntityBody`
      // already accepted `category: 'prop'` and CollisionFilter already had a PROP mask —
      // nothing had ever passed it.
      if (classId !== 'unit') {
        this._createEntityBody(entityId, px, pz, entityDef as Record<string, any>, classId as 'item' | 'prop', angle);
      }

      this.scripts.trigger('entityCreatedGlobal', { entityId, category: classId });
      this.scripts.trigger('entityCreated', { entityId });
    }
  }

  start(): void {
    this.scripts.trigger('gameStart');
    this.initializeEntities();

    // Legacy taro multiplayer servers tick continuously between `gameStart` and the
    // first `playerJoinsGame` (network delay + server idle time means many seconds
    // pass before any client connects), so periodic stabilization scripts on
    // `secondTick` — e.g. `everySeconds` resetting `state` to `@statePrepare` while
    // `playerCount < 2` — have already settled the world by the time anyone joins.
    // Single-player flows synchronously send `JoinGame` on the same call stack as
    // start(), so without an explicit warmup the joining player sees whatever
    // transient state the `gameStart` cascade left behind (F0mB1BW05's `prepare` →
    // `checkWho'sAlive` → `gameOver` chain leaves `state` at `@stateGameOver`,
    // sending the joiner to `observers` instead of a team).
    this.scripts.trigger('secondTick');

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
    this._groundFriction.clear();
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
          this._wallBodyHandles.add(body.handle);
        }
      }
    }
  }

  /** Register a server-side Item entity for an inventory record so script resolvers
   *  (`getOwnerOfItem`, `getEntityAttribute`, `getItemTypeOfItem`) can find it via
   *  `engine.findById`. Inventory records on `unit.stats.inventory` are plain
   *  `{id,type,quantity}` objects — without a backing entity, the global
   *  `unitTouchesProjectile` damage script's chain
   *  `getOwnerOfItem(getSourceItemOfProjectile(p))` resolves to undefined and no
   *  damage is applied. Mirrors the type's `attributes` to `attr_<id>` slots so
   *  `getEntityAttribute(item, 'ppf17VZEo2')` (Karmaslayers' "Damage" attribute on
   *  weapons) returns the configured value. The entity is hidden and has no
   *  physics body — purely a data carrier for resolvers. */
  private _registerInventoryItemEntity(invId: string, typeId: string, ownerUnitId: string, quantity: number): void {
    if (this._entities.has(invId)) {
      // Pickup case: the world item is already in _entities. Convert it from a world
      // drop to a carried record by setting ownerId and mirroring attributes.
      const existing = this._entities.get(invId);
      if (existing?.stats) {
        existing.stats.ownerId = ownerUnitId;
        existing.stats.quantity = quantity;
        this._mirrorItemTypeAttributesToStats(existing.stats, typeId);
      }
      return;
    }
    const typeDef = this.types.get('itemTypes', typeId) as Record<string, any> | null;
    const item = new Item(invId);
    item.category = 'item';
    (item as any).stats = {
      ...(typeDef ?? {}),
      type: typeId,
      ownerId: ownerUnitId,
      quantity,
      isHidden: true,
    };
    this._mirrorItemTypeAttributesToStats((item as any).stats, typeId);
    item.mount(this.engine.root);
    this._entities.set(invId, item);
    // Same reason as item:spawn: scripts that read entity vars on inventory items
    // (e.g. drop-item bindings checking `dropPlaceAllowed == "anywhere"`) need
    // the typeDef defaults seeded in the variable store.
    if (typeDef) this._seedItemEntityVars(invId, typeDef);
  }

  /** Seed an item entity's variable-store entries from its typeDef.variables defaults.
   *  Mirrors the unit path in spawnUnit. Without this, `getValueOfEntityVariable(item, ...)`
   *  always returns undefined and any script that gates on item entity vars silently no-ops. */
  private _seedItemEntityVars(entityId: string, typeDef: Record<string, any>): void {
    const typeVars = typeDef?.variables as Record<string, any> | undefined;
    if (!typeVars) return;
    for (const [name, def] of Object.entries(typeVars)) {
      if (!def || typeof def !== 'object') continue;
      if (!('default' in def) || (def as any).default === undefined) continue;
      const val = (def as any).default;
      const dt = (def as any).dataType as string | undefined;
      this.scripts.variables.setEntityVar(entityId, name, val, dt);
    }
  }

  /** Mirror an item type's `attributes.<attrId>` defaults onto stats.`attr_<attrId>`
   *  in the same shape as Unit attributes (see spawnUnit). Idempotent — won't
   *  clobber an attribute that's already present (e.g. a script wrote a runtime
   *  override before this is called for a world item that was later picked up). */
  private _mirrorItemTypeAttributesToStats(stats: Record<string, any>, typeId: string): void {
    const typeDef = this.types.get('itemTypes', typeId) as Record<string, any> | null;
    const attrDefs = typeDef?.attributes as Record<string, any> | undefined;
    if (!attrDefs) return;
    for (const [attrId, attrDef] of Object.entries(attrDefs)) {
      if (stats[`attr_${attrId}`]) continue;
      stats[`attr_${attrId}`] = {
        value: attrDef.value ?? 0,
        min: attrDef.min ?? 0,
        max: attrDef.max ?? 100,
        regenerateSpeed: attrDef.regenerateSpeed ?? 0,
        name: attrDef.name ?? attrId,
        color: attrDef.color ?? '#ffffff',
      };
    }
  }

  /** Re-derive `currentItemId` from `inv[currentSlot]` after an inventory mutation
   *  and broadcast both `inventory` and `currentItemId` together. The cached value
   *  on `unit.stats.currentItemId` is otherwise only refreshed by spawnUnit and the
   *  digit-key / makeUnitSelectItemAtSlot paths — `inventory:giveItem` and
   *  `makeUnitPickupItem` left it stale at its spawn-time value (null for any unit
   *  whose typeDef has no `defaultItems`). That stale null then made
   *  `getItemCurrentlyHeldByUnit(unit)` return null, so `startUsingItem` actions
   *  emitted `item:use[null]` and the click was silently dropped before any item
   *  script ran or any projectile spawned. */
  private _syncCurrentItemAndBroadcast(unitId: string, unit: any): void {
    const inv = (unit.stats?.inventory ?? []) as Array<{ id?: string }>;
    const currentSlot = Number(unit.stats?.currentSlot) || 0;
    const newCurrentId = inv[currentSlot]?.id ?? null;
    const update: Record<string, unknown> = { inventory: inv };
    if (unit.stats.currentItemId !== newCurrentId) {
      unit.stats.currentItemId = newCurrentId;
      update.currentItemId = newCurrentId;
    }
    this._transport.broadcast({
      type: MessageType.EntityStatsUpdate,
      data: { [unitId]: update },
    });
    // Inventory just changed shape — re-derive item passive bonuses (armor).
    this._reconcilePassiveBonuses(unitId, unit);
  }

  /** Apply / remove item `bonus.passive` attribute modifiers as items enter and
   *  leave a unit's inventory — taro's Unit.updateStats() (moddio2
   *  engine/core/TaroEntity.js:4096). Armor (helmets, chest pieces, shields) in
   *  Karmaslayers is modelled purely as items whose `bonus.passive.unitAttribute`
   *  raises the wearer's max HP while the item is carried; without this the
   *  items sit inert in the inventory and "wearing armor" does nothing.
   *
   *  Idempotent reconcile: the set of currently-credited bonuses is recorded on
   *  `unit.stats._passiveBonusApplied` ({ [invRecId]: itemTypeId }). Every
   *  inventory mutation routes through `_syncCurrentItemAndBroadcast`, which
   *  calls this; we diff desired-vs-applied and apply/remove only the delta, so
   *  pickup, give, drop, dropAll, slot-swap and backpack moves are all covered
   *  by one path. Keying by the inventory record's stable `id` (not slot index)
   *  keeps a drag-swap from double-counting or dropping a still-held bonus. */
  private _reconcilePassiveBonuses(unitId: string, unit: any): void {
    if (!unit?.stats) return;
    const inv = (unit.stats.inventory ?? []) as Array<{ id?: string; type?: string } | null>;
    const invSize = Number(unit.stats.inventorySize) || inv.length;
    const unitTypeId = unit.stats.type as string | undefined;
    const ownerId = unit.stats.ownerId as string | undefined;
    const player = ownerId ? this._entities.get(ownerId) : null;

    // desired: invRecId -> itemTypeId for every inventory item whose passive
    // bonus is currently in force. Gate mirrors taro: a backpack slot
    // (index >= inventorySize) only counts when the bonus is NOT
    // `isDisabledInBackpack`, and the unit type must be able to use the item.
    const desired = new Map<string, string>();
    inv.forEach((rec, slotIdx) => {
      if (!rec?.id || !rec.type) return;
      const itemType = this.types.get('itemTypes', rec.type) as Record<string, any> | null;
      const passive = itemType?.bonus?.passive;
      if (!passive) return;
      if (slotIdx >= invSize && passive.isDisabledInBackpack === true) return;
      const canBeUsedBy = itemType?.canBeUsedBy as string[] | undefined;
      const canUse = !canBeUsedBy || canBeUsedBy.length === 0 ||
        (unitTypeId != null && canBeUsedBy.indexOf(unitTypeId) > -1);
      if (!canUse) return;
      desired.set(rec.id, rec.type);
    });

    const applied = (unit.stats._passiveBonusApplied ?? {}) as Record<string, string>;
    const unitChanged = new Set<string>();
    const playerChanged = new Set<string>();

    // Remove bonuses for records that left the inventory (or changed type).
    for (const [recId, typeId] of Object.entries(applied)) {
      if (desired.get(recId) === typeId) continue;
      this._applyPassiveBonus(unit, player, typeId, true, unitChanged, playerChanged);
      delete applied[recId];
    }
    // Apply bonuses for records that newly qualify.
    for (const [recId, typeId] of desired) {
      if (applied[recId] === typeId) continue;
      this._applyPassiveBonus(unit, player, typeId, false, unitChanged, playerChanged);
      applied[recId] = typeId;
    }
    unit.stats._passiveBonusApplied = applied;

    if (unitChanged.size) {
      const patch: Record<string, unknown> = {};
      for (const slot of unitChanged) patch[slot] = unit.stats[slot];
      this._transport.broadcast({ type: MessageType.EntityStatsUpdate, data: { [unitId]: patch } });
    }
    if (player && ownerId && playerChanged.size) {
      const patch: Record<string, unknown> = {};
      for (const slot of playerChanged) patch[slot] = player.stats[slot];
      this._transport.broadcast({ type: MessageType.EntityStatsUpdate, data: { [ownerId]: patch } });
    }
  }

  /** One item type's passive attribute math, applied (`remove=false`) or undone
   *  (`remove=true`). Mirrors taro Unit.updateStats exactly:
   *    percentage  apply  v*=1+p/100  max*=1+p/100      remove  v/=…  max/=…
   *    flat        apply  max+=v  v=clamp(value,min,newMax)   remove  max-=v  …
   *  taro uses `parseFloat(value) || 1` for the working value, so a downed
   *  (0-HP) wearer still scales off 1 rather than collapsing the attribute. */
  private _applyPassiveBonus(
    unit: any, player: any, itemTypeId: string, remove: boolean,
    unitChanged: Set<string>, playerChanged: Set<string>,
  ): void {
    const itemType = this.types.get('itemTypes', itemTypeId) as Record<string, any> | null;
    const passive = itemType?.bonus?.passive;
    if (!passive) return;
    const target = (entity: any, attrs: Record<string, any> | undefined, changed: Set<string>) => {
      if (!entity?.stats || !attrs) return;
      for (const [attrId, bonus] of Object.entries(attrs)) {
        const slot = `attr_${attrId}`;
        const cur = entity.stats[slot];
        if (!cur || !bonus) continue;
        const min = Number(cur.min) || 0;
        const value = parseFloat(cur.value) || 1;
        const max = parseFloat(cur.max);
        const amt = parseFloat((bonus as { value: unknown }).value as string);
        if (!Number.isFinite(amt) || !Number.isFinite(max)) continue;
        let newValue: number;
        let newMax: number;
        if ((bonus as { type?: string }).type === 'percentage') {
          const f = 1 + amt / 100;
          if (f === 0) continue;
          newValue = remove ? value / f : value * f;
          newMax = remove ? max / f : max * f;
        } else {
          newMax = remove ? max - amt : max + amt;
          newValue = Math.min(newMax, Math.max(min, value));
        }
        entity.stats[slot] = { ...cur, value: newValue, max: newMax };
        changed.add(slot);
      }
    };
    target(unit, passive.unitAttribute, unitChanged);
    target(player, passive.playerAttribute, playerChanged);
  }

  /** Spawn one projectile from a unit's currently-held gun item type. Mirrors taro's
   *  built-in `Item.use()` gun branch (moddio2/src/gameClasses/Item.js). Position is
   *  `unit + bulletStartPosition` rotated by the unit's facing angle; velocity points
   *  along that angle scaled by `projectileType.speed` (or `itemType.bulletForce` as a
   *  fallback). Despawns after `projectileType.lifeSpan` ms. */
  private _fireGunProjectile(unit: any, itemType: Record<string, any>, sourceItemId?: string): void {
    const projectileTypeId = itemType.projectileType as string;
    const projTypeDef = this.types.get('projectileTypes', projectileTypeId) as Record<string, any> | null;
    if (!projTypeDef) return;

    const tilePx = this._tilePx;
    // bulletStartPosition is in pixels post-denormalize (3D) / raw (2D); convert to tile units.
    const bsp = (itemType.bulletStartPosition as { x?: number; y?: number } | undefined) || { x: 0, y: 0 };
    const offX = (Number(bsp.x) || 0) / tilePx;
    const offY = (Number(bsp.y) || 0) / tilePx;
    // Aim direction: when the gun has `controls.mouseBehaviour.rotateToFaceMouseCursor`,
    // the gun (and its bullet) tracks the player's cursor independently of the unit's
    // own rotation — same convention as taro Item.js (`this._rotate` = mouse angle for
    // a face-mouse gun, then `applyForce(direction)`). Without this, units whose type
    // sets `rotateToFaceMouseCursor: false` (like F0mB1BW05's redFighter) always have
    // rotation 0 and every bullet fires straight north.
    const itemFacesMouse = (itemType as any)?.controls?.mouseBehaviour?.rotateToFaceMouseCursor === true;
    const mp = (unit as any)._mousePosition as { x?: number; y?: number } | undefined;
    let rot = Number(unit.rotation) || 0;
    if (itemFacesMouse && mp && typeof mp.x === 'number' && typeof mp.y === 'number') {
      const dx = (mp.x as number) - unit.position.x;
      const dy = (mp.y as number) - unit.position.z;
      // Same atan2(-dx, -dy) convention as the player face-mouse loop above (commit 2eb0cfb).
      rot = Math.atan2(-dx, -dy);
    }
    // modu's rotation convention (set by `_onPlayerMouseMoved` and the face-mouse tick
    // loop) is `atan2(-dx, -dy)`, chosen so a sprite at rot=0 has its head pointing to
    // world −Z. Under this convention, the unit's local "forward" axis maps to world
    // (−sin θ, −cos θ) and "right" maps to (cos θ, −sin θ). bsp.x is lateral offset,
    // bsp.y is forward offset, so:
    //   world_offset = bsp.x · right + bsp.y · forward
    //                = (bsp.x·cos − bsp.y·sin,  −bsp.x·sin − bsp.y·cos)
    // Using taro's pixel-space rotation here would mirror the bullet to the opposite
    // side of the unit and fire it backwards.
    const px = unit.position.x + offX * Math.cos(rot) - offY * Math.sin(rot);
    const pz = unit.position.z - offX * Math.sin(rot) - offY * Math.cos(rot);

    const entityId = `prj_${Math.random().toString(36).slice(2, 10)}`;
    const ent = this.engine.spawn(entityId);
    ent.category = 'projectile';
    ent.position.x = px;
    ent.position.z = pz;
    (ent as any).rotation = rot;
    (ent as any).stats = {
      ...projTypeDef,
      type: projectileTypeId,
      // sourceId: the firing item entity id — what `getSourceItemOfProjectile`
      //   resolves to (ActionRunner reads `proj.stats.sourceId`). Karmaslayers'
      //   global `unitTouchesProjectile` damage script chains
      //   `getOwnerOfItem(getSourceItemOfProjectile(p))` → `getEntityAttribute(p,
      //   'ppf17VZEo2')` to compute hit damage; without this set, the chain
      //   resolves to undefined and no damage applies.
      // sourceUnitId: kept for engine internals; the firing unit's id.
      sourceId: sourceItemId,
      sourceUnitId: unit.id,
      sourceItemType: (itemType as any).type ?? undefined,
    };
    this._entities.set(entityId, ent);

    this._transport.broadcast({
      type: MessageType.EntityCreate,
      data: buildEntityCreatePayload('projectile', entityId, px, pz, rot, { ...projTypeDef, type: projectileTypeId }),
    });
    this.scripts.trigger('entityCreatedGlobal', { entityId, projectileId: entityId, category: 'projectile' });
    this.scripts.trigger('entityCreated', { entityId, projectileId: entityId });

    if (this._physics) {
      // Always create the projectile's physics body so its sensor fixture can fire
      // collision events. Karmaslayer-style melee weapons (knife, mace, etc.) tag the
      // item as `isGun: true` to drive the projectile pipeline as a hitbox, but their
      // projectileType has `speed: undefined` and the item has `bulletForce: 0` — they
      // are static hitboxes that detect units in a 2×2 sensor at the spawn position
      // and rely on `lifeSpan` to despawn ~100ms later. Gating body creation behind
      // `speed > 0` (the prior behaviour) skipped that body entirely, so the hitbox
      // spawned as a phantom data entity with no collider — no `unitTouchesProjectile`
      // event ever fires, no damage applies, and the entire melee roster of HRP5883Eb
      // looks like "click does nothing". For travelling bullets (Slingshot etc.) the
      // body is needed too; speed only governs whether we apply linear velocity.
      this._createEntityBody(entityId, px, pz, projTypeDef, 'projectile');
      // Speed: projectileType.speed wins; fall back to item's bulletForce since taro guns
      // (e.g. F0mB1BW05's plasmaPistol) only set bulletForce on the item type.
      const speed = Number(projTypeDef.speed) || Number(itemType.bulletForce) || 0;
      if (speed > 0) {
        const body = this._entityBodies.get(entityId);
        if (body) {
          // Forward direction under modu's `atan2(-dx,-dy)` rotation convention is
          // (−sin θ, −cos θ) — see the position-offset comment above. bulletForce /
          // projectile.speed is in raw "taro physics units" (pixels / SCALE_RATIO),
          // which maps 1:1 to rapier's setLinearVelocity (same as how unit movement
          // velocities are passed through, see line 335 comment); dividing by
          // SCALE_RATIO again would produce a 30× too-slow bullet.
          body.linearVelocity = new Vec2(-Math.sin(rot) * speed, -Math.cos(rot) * speed);
        }
      }
      const life = Number(projTypeDef.lifeSpan) || 0;
      if (life > 0) {
        setTimeout(() => {
          const e = this._entities.get(entityId);
          if (!e) return;
          // Tear the rapier body down properly; previously this only removed the map
          // entry, leaving the body (and its `_bodyToEntity` reverse-map slot) live
          // in the physics world. Each fired projectile would leak one rapier body —
          // a slow drip for travelling bullets, but a per-click leak for melee
          // hitboxes that fire at 60Hz of click-spam, eventually grinding the
          // physics world to a crawl as broadphase has to consider hundreds of stale
          // colliders that overlap every other entity.
          const body = this._entityBodies.get(entityId);
          if (body && this._physics) {
            this._bodyToEntity.delete(body.handle);
            this._physics.destroyBody(body);
          }
          this._entityBodies.delete(entityId);
          this._groundFriction.delete(entityId);
          e.destroy?.();
          this._entities.delete(entityId);
          this._aiUnitFacingRotation.delete(entityId);
          this._transport.broadcast({ type: MessageType.EntityDestroy, data: { entityId, timestamp: Date.now() } });
        }, life);
      }
    }
  }

  /** Create a physics body for a dynamic entity — EXACTLY matching taro Rapier2dComponent.createBody().
   *  `category` selects which `CollisionCategory.*` bit the body lives in; the mask is derived from
   *  the body fixture's `collidesWith` (taro convention) and falls back to the per-category default.
   *  Passing the wrong category collapses every entity into UNIT and forces overlap-resolution between
   *  units and items — which is exactly the "dropped meat bounces off the player" bug, since item
   *  types declare `collidesWith.units: false` but the engine ignored that and made the meat body
   *  physically resolve against the unit it was spawned on top of. */
  private _createEntityBody(entityId: string, x: number, z: number, typeDef: Record<string, any>, category: 'unit' | 'item' | 'projectile' | 'prop' = 'unit', angle = 0): void {
    if (!this._physics) return;
    // taro stores itemTypes' colliders under `bodies.dropped` (since items spawn in the
    // "dropped on the ground" state) while units use `bodies.default`; the legacy 2D
    // `body` mirror is sometimes absent. Try each in order so items get a body too —
    // without one, item-vs-unit sensor events never fire and celleater cells can't
    // pick up food to grow.
    const bodyDef = typeDef.body || typeDef.bodies?.default || typeDef.bodies?.dropped;
    if (!bodyDef || bodyDef.type === 'none' || bodyDef.type === 'spriteOnly') return;

    // Position in physics coords = tile * 16 / 30
    const body = this._physics.createBody({
      type: (bodyDef.type === 'static' ? 'static' : bodyDef.type === 'kinematic' ? 'kinematic' : 'dynamic') as any,
      position: new Vec2(this._tileToPhysics(x), this._tileToPhysics(z)),
      angle,
    });

    // Damping. 3D body schema stores damping as {x,y,z} per-axis objects; legacy
    // 2D body uses a scalar. Rapier's setLinear/AngularDamping take a single
    // scalar — passing an object (or NaN derived from `object * 0.1`) silently
    // produces NaN positions and the body renders at (NaN,NaN,NaN), i.e.
    // invisible. Normalize to a scalar before applying.
    const toScalar = (v: unknown): number => {
      if (v == null) return 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      if (typeof v === 'object') {
        const o = v as { x?: number; y?: number; z?: number };
        const n = Number(o.x ?? o.y ?? o.z ?? 0);
        return Number.isFinite(n) ? n : 0;
      }
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const damp = toScalar(bodyDef.linearDamping);
    // Impulse/force-mode units take continuous WASD impulses every tick, so the
    // equilibrium velocity is `impulse / damping`. Taro's calibrated damping
    // values crush them to a crawl in modu's coordinate system, so for those
    // movement methods only we attenuate by 10× (capped at 2) to keep them
    // moving. Velocity-mode units set body.linearVelocity directly while keys
    // are held — damping doesn't bound their moving speed, it only governs
    // post-release deceleration, so attenuating it just makes them slide for
    // seconds after the player lets go ("slayer feels too slippery", HRP5883Eb).
    // Items and projectiles get one velocity push and coast on damping alone;
    // attenuating their damping makes scattered loot slide ~10× longer than the
    // data intends, so they always use the raw value too.
    const movementMethod = (typeDef?.controls?.movementMethod ?? 'velocity') as string;
    const isImpulseDriven = movementMethod === 'impulse' || movementMethod === 'force';
    const linDamp = (bodyDef.type === 'dynamic' && category === 'unit' && isImpulseDriven)
      ? Math.min(damp * 0.1, 2)
      : damp;
    body.linearDamping = linDamp;
    body.angularDamping = toScalar(bodyDef.angularDamping);

    // Collider — exactly as taro: halfWidth / scaleRatio
    // Taro: entity._bounds2d.x / 2 / this._scaleRatio
    // entity._bounds2d.x = body.width (pixels)
    const fixture = bodyDef.fixtures?.[0] || {};
    // Three schemas describe the same box, in priority order:
    //
    //  1. taro 2D — `fixture.shape.data.halfWidth/halfHeight`, already raw pixels.
    //  2. 3D editor — a unit `shape` times a per-axis `scale`, in TILE units, with Z
    //     up: the human is `shape 1×1×1` × `scale (0.67, 0.92, 1.88)` and
    //     `offset.z = 0.94`, i.e. a 0.67×0.92 tile footprint standing 1.88 tiles tall.
    //  3. `bodyDef.width/height`, raw pixels.
    //
    // (3) alone is not enough: for a 3D unit those hold the *sprite* size (1.81×0.52
    // for every Braains3D survivor), so the collider came out 1.81 tiles wide and
    // axis-aligned — wider than 23 of that map's doorways, which wedged the player in
    // place as soon as walls became solid. Props are the opposite case: they ship
    // `scale (1,1,1)` with the real footprint in width/height (Sofa 3×1.6), so the 3D
    // path is only taken when the scale is actually set to something.
    const shape3d = fixture.shape as { width?: unknown; height?: unknown } | undefined;
    const scale3d = fixture.scale as { x?: unknown; y?: unknown } | undefined;
    const sx = Number(scale3d?.x);
    const sy = Number(scale3d?.y);
    const has3dBox =
      Number.isFinite(Number(shape3d?.width)) && Number.isFinite(Number(shape3d?.height)) &&
      Number.isFinite(sx) && Number.isFinite(sy) && (sx !== 1 || sy !== 1);

    const widthPx = has3dBox
      ? Number(shape3d!.width) * sx * this._tilePx
      : (bodyDef.width || 40);
    const heightPx = has3dBox
      ? Number(shape3d!.height) * sy * this._tilePx
      : (bodyDef.height || 40);

    const hw = (fixture.shape?.data?.halfWidth ?? widthPx / 2) / GameServer.SCALE_RATIO;
    const hh = (fixture.shape?.data?.halfHeight ?? heightPx / 2) / GameServer.SCALE_RATIO;

    // Agar-style games (celleater) mark units as sensors via the 3D body schema
    // (`bodies.default.fixtures[0].isSensor`) — the legacy 2D `body.fixtures[0]`
    // copy doesn't carry the flag, so check both. Items put the same flag under
    // `bodies.dropped.fixtures[0].isSensor`. A sensor fixture skips physical
    // resolution (units pass through one another) and triggers the
    // `unitEntersSensor` / `itemEntersSensor` script via the collision-event handler.
    const sensorFix = typeDef.bodies?.default?.fixtures?.[0] ?? typeDef.bodies?.dropped?.fixtures?.[0];
    const isSensor = !!(fixture.isSensor ?? sensorFix?.isSensor);

    // Build the collision mask from the body fixture's `collidesWith` (taro convention:
    // `{ walls, units, items, projectiles }`, sometimes with singular aliases). Without
    // this an item with `collidesWith.units: false` (e.g. HRP5883Eb meat) still gets the
    // UNIT bit set in its mask, the meat body physically resolves against the unit it was
    // dropped on top of, and Rapier shoves the meat ~1 tile away — the "bounces off
    // immediately after dropped" bug. Fall back to the per-category default when the
    // field is absent so legacy bodies without `collidesWith` keep their old behaviour.
    const cat = categoryForEntityType(category);
    const cw = fixture.collidesWith as Record<string, unknown> | undefined;
    let mask = DefaultCollisionMask[cat] ?? 0xFFFF;
    if (cw && typeof cw === 'object') {
      mask = 0;
      const flag = (k: string) => Boolean(cw[k] ?? cw[k.replace(/s$/, '')]);
      if (flag('walls')) mask |= CollisionCategory.WALL;
      if (flag('units')) mask |= CollisionCategory.UNIT;
      if (flag('items')) mask |= CollisionCategory.ITEM;
      if (flag('projectiles')) mask |= CollisionCategory.PROJECTILE;
      // Props aren't represented in taro's `collidesWith` — keep the prop bit on so any
      // entity that does want unit/wall collision also collides with props by default.
      mask |= CollisionCategory.PROP;
    }

    body.addCollider({
      shape: 'box',
      width: hw,
      height: hh,
      density: fixture.density ?? 0,
      // taro's fixture schema carries an explicit mass override; the 3D editor writes
      // `overrideMass: true, mass: N` next to `density: 0`.
      mass: fixture.overrideMass ? Number(fixture.mass) || undefined : undefined,
      friction: fixture.friction ?? 0,
      restitution: fixture.restitution ?? 0,
      isSensor,
      category: cat,
      mask,
    });

    // Rotation ownership splits by category.
    //
    // Units, items and projectiles have their facing written by game logic every tick
    // (face the cursor, face the movement direction, point along the swing arc), so a
    // physics spin would just fight those writes — they stay locked, as taro does.
    //
    // Props are the opposite: they are physical scenery with no logic driving their
    // facing. Locking them meant a shoved sofa or car slid in a dead-straight line and
    // could never turn, which is both wrong and the single strongest "sliding on ice"
    // cue. They spin from off-centre contacts like any other rigid body, starting from
    // the angle the initialize script placed them at.
    body.lockRotation(category !== 'prop');

    // Coulomb ground friction coefficient (see `_applyGroundFriction`). Resolved once
    // here rather than per tick: per-body override first, then the game's global
    // setting, then the engine default.
    if (category === 'prop' && bodyDef.type !== 'static' && bodyDef.type !== 'kinematic') {
      this._groundFriction.set(entityId, {
        mu: this._resolveGroundFriction(bodyDef),
        radius: this._resolveContactRadius(bodyDef),
      });
    }

    this._entityBodies.set(entityId, body);
    // Reverse map for collision-event → entityId resolution.
    this._bodyToEntity.set(body.handle, entityId);
  }

  /**
   * Notional gravity used to turn a friction *coefficient* into a deceleration, in
   * tiles/s². A unit's collider stands `scale.z = 1.88` tiles tall and represents an
   * adult human, so one tile is very close to one metre and earth gravity is the
   * natural choice.
   */
  private static readonly GROUND_GRAVITY_TILES = 9.81;
  /**
   * Default coefficient between a prop and the map floor. 0.6 is the textbook
   * wood/fabric-on-hard-floor figure. Overridable per body (`bodyDef.groundFriction`)
   * or per game (`settings.physics.groundFriction`).
   */
  private static readonly DEFAULT_GROUND_FRICTION = 0.6;
  /**
   * Contact radius used when a body declares no footprint, in tiles.
   */
  private static readonly DEFAULT_CONTACT_RADIUS_TILES = 0.5;
  /**
   * How much of the textbook spin friction to actually apply.
   *
   * Strict Coulomb over a contact patch gives an angular deceleration of order μ·g/r,
   * which for a metre-scale prop is ~12 rad/s². That is *correct* and unplayable: a
   * body-check imparts only ~0.5 rad/s, so the spin is gone within a tick or two and
   * every shoved prop reads as rotation-locked — the exact behaviour props had when
   * their bodies were still created with rotations locked. Real furniture also gets
   * kicked far harder than a walking collision can push it, so matching the textbook
   * here buys physical fidelity nobody can see at the cost of the one behaviour the
   * feature exists for.
   *
   * 0.15 is the widest setting that still satisfies both ends of the contract: a
   * shove-strength 0.5 rad/s spin turns ~7° before settling (visible), and a hard
   * 3 rad/s spin still comes to rest in under 3s (not a spinning top). Both bounds
   * are pinned by the ground-friction cases in PhysicsConformance.
   */
  private static readonly SPIN_FRICTION_SCALE = 0.15;

  /**
   * Radius of gyration of the body's footprint, in physics units — the lever the
   * rotational half of ground friction acts through. `bodyDef.width/height` are in
   * source pixels, the same units `_createEntityBody` sizes colliders from.
   */
  private _resolveContactRadius(bodyDef: Record<string, any>): number {
    const w = Number(bodyDef?.width) / this._tilePx;
    const h = Number(bodyDef?.height) / this._tilePx;
    const tiles = w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)
      ? Math.sqrt((w * w + h * h) / 12)
      : GameServer.DEFAULT_CONTACT_RADIUS_TILES;
    return Math.max(this._tileToPhysics(tiles), 1e-6);
  }

  private _resolveGroundFriction(bodyDef: Record<string, any>): number {
    const perBody = Number(bodyDef?.groundFriction);
    if (Number.isFinite(perBody) && perBody >= 0) return perBody;
    const global = Number((this._gameData as any)?.settings?.physics?.groundFriction);
    if (Number.isFinite(global) && global >= 0) return global;
    return GameServer.DEFAULT_GROUND_FRICTION;
  }

  /**
   * Coulomb friction between a prop and the floor it is resting on.
   *
   * The physics world is rapier2d viewed from above: there is no floor and no gravity,
   * so the *only* thing slowing a shoved prop was `linearDamping` from the game data.
   * Viscous damping is the wrong model for this — it is proportional to velocity, so it
   * decays asymptotically and a body never actually comes to rest. With the shipped
   * `linearDamping: 1`, one shove sent a 30kg car 7.5 tiles over 13 seconds. That is
   * exactly what "gliding on ice" looks like, and no damping value fixes it: raising it
   * makes props feel like they are in treacle while still never stopping.
   *
   * Dry friction is the effect that was missing. It is a constant deceleration `μ·g`
   * opposing motion, independent of speed, so it brings a body to a dead stop in finite
   * time — furniture stops when you stop pushing it. `fixture.friction` is not the value
   * to use: rapier already spends that on tangential *collider-vs-collider* contact.
   * This is the separate prop-vs-ground coefficient the 2D projection dropped.
   *
   * Applied only to dynamic props. Units are velocity-driven and author
   * `linearDamping: 0` deliberately; projectiles are in flight, not on the floor; items
   * coast on damping alone so that loot scatter keeps its authored distance.
   */
  private _applyGroundFriction(dtMs: number): void {
    if (this._groundFriction.size === 0) return;
    const dt = dtMs / 1000;
    // μ·g is in tiles/s²; velocities are in physics units/s (tiles × tilePx / 30).
    const gPhysics = GameServer.GROUND_GRAVITY_TILES * this._tileToPhysics(1);
    for (const [entityId, { mu, radius }] of this._groundFriction) {
      if (!(mu > 0)) continue;
      const body = this._entityBodies.get(entityId);
      if (!body) continue;

      const v = body.linearVelocity;
      const speed = Math.hypot(v.x, v.y);
      const w = body.angularVelocity;

      // One contact patch, one friction budget. Deducting the full μ·g from the slide
      // *and* the full μ·g/r from the spin in the same tick spends it twice, and the
      // rotational half loses: μ·g/r is `r`-times larger, so a shove that skates a prop
      // two tiles had its spin zeroed on the first tick. Split the budget the way the
      // contact does, in proportion to each part's share of the slip velocity, so a
      // sliding prop keeps turning while it travels and both reach zero together.
      const slipSpin = Math.abs(w) * radius;
      const slip = speed + slipSpin;
      if (slip <= 0) continue;
      const budget = mu * gPhysics * dt;

      if (speed > 0) {
        const dv = budget * (speed / slip);
        // Clamp at zero rather than letting the subtraction overshoot — friction stops
        // a body, it never reverses it.
        if (speed <= dv) body.linearVelocity = new Vec2(0, 0);
        else {
          const k = (speed - dv) / speed;
          body.linearVelocity = new Vec2(v.x * k, v.y * k);
        }
      }

      // Rotational counterpart, so a spun prop settles instead of turning forever.
      // Divided by the body's own contact radius (not a fixed one), so a wardrobe does
      // not settle as abruptly as a stool.
      if (w !== 0) {
        const dw = (budget * (slipSpin / slip) * GameServer.SPIN_FRICTION_SCALE) / radius;
        body.angularVelocity = Math.abs(w) <= dw ? 0 : w - Math.sign(w) * dw;
      }
    }
  }

  // --- Tick ---

  private _tick(dt: number): void {
    this._tickCount++;
    this._gameTimeMs += dt;

    // Process input → apply forces to physics bodies
    this._processMovement(dt);
    // Drive AI behaviors for NPC units (wandering, etc.)
    this._processAI(dt);
    // Re-fire held items (button1 held down) at their fireRate cadence.
    this._processItemUse(dt);

    // Step physics with FIXED timestep (prevents jitter from variable dt)
    if (this._physics) {
      const fixedDt = 1000 / this._loop.tickRate; // e.g., 50ms for 20Hz
      // Dry friction against the map floor, which the 2D world has no other way to
      // model. Applied before the step so the contact solver sees the reduced velocity.
      this._applyGroundFriction(fixedDt);
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
        if (attr.regenerateSpeed) {
          // Taro semantics: regenerateSpeed is added once every 200ms (5×/sec, AttributeComponent.js:34).
          // Direction-aware bound check: positive regen pushes toward max, negative
          // regen toward min — without the min clamp a "drop spam cooldown" attribute
          // (regenerateSpeed: -0.25, min: 0) drifts negative on every tick instead of
          // settling at 0, breaking scripts that gate on `attr == 0`.
          const speed = Number(attr.regenerateSpeed);
          const min = Number(attr.min ?? 0);
          const max = Number(attr.max ?? Number.MAX_SAFE_INTEGER);
          if ((speed > 0 && attr.value < max) || (speed < 0 && attr.value > min)) {
            attr.value = Math.max(min, Math.min(max, attr.value + speed * (dt / 200)));
          }
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
      if (!unit) continue;
      // followCursor units drive themselves from the mouse position alone, so
      // _inputKeys may legitimately be empty before the player presses anything.
      // Initialize lazily here instead of bailing out, so the cursor-drive code
      // below still gets a chance to compute a velocity each tick.
      if (!unit._inputKeys) unit._inputKeys = new Set();

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

      if (controlScheme === 'followCursor') {
        // Agar.io-style: drift continuously toward the player's mouse cursor.
        // GameClient raycasts the cursor onto the ground plane and sends world
        // XZ in tile units (PlayerMouseMoved.{x,y} = world.x, world.z). Entity
        // position is in the same tile-unit space, so subtract directly. A small
        // dead-zone keeps the cell from jittering when the cursor is on top.
        const mouse = unit._mousePosition as { x?: number; y?: number } | undefined;
        if (mouse && Number.isFinite(mouse.x) && Number.isFinite(mouse.y)) {
          const dx = (mouse.x as number) - unit.position.x;
          const dy = (mouse.y as number) - unit.position.z;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.5) {
            dirX = dx / dist;
            dirY = dy / dist;
          }
        }
      } else if (controlScheme === 'wasdRelativeToUnit' && unit._cameraYaw !== undefined) {
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

      // Taro applies vector = direction * speed raw to the body — same SCALE_RATIO=30,
      // no fudge factor. Unit.js:2422-2425 → Box2dComponent.js:441 (applyImpulse).
      const vectorX = dirX * moveSpeed;
      const vectorY = dirY * moveSpeed;

      switch (movementMethod) {
        case 'impulse':
          // taro: body.applyImpulse({ x: vectorX, y: vectorY }, true)
          if (vectorX !== 0 || vectorY !== 0) body.applyImpulse(new Vec2(vectorX, vectorY));
          break;
        case 'force':
          if (vectorX !== 0 || vectorY !== 0) body.applyForce(new Vec2(vectorX, vectorY));
          break;
        case 'velocity':
        default:
          // In `velocity` mode the input *is* the velocity, so it is rewritten every
          // tick — the zero vector included. Skipping the write when there is no input
          // left the previous velocity in place and made stopping depend entirely on
          // friction or linearDamping. That is fine for a body that has damping, but
          // 3D `bodies.*` routinely carry `linearDamping: {x:0,y:0,z:0}` (Braains3D's
          // units do), and with nothing to bleed the velocity off the unit coasted for
          // as long as no key was held. `impulse`/`force` accumulate by nature and are
          // still only applied when there is input to apply.
          body.linearVelocity = new Vec2(vectorX, vectorY);
          break;
      }
    }
  }

  /**
   * AI loop. Drives wandering, sensor-based aggro, pursuit, and weapon use for any
   * unit whose type has `ai.enabled === true`. Mirrors taro AIComponent
   * (moddio2/src/gameClasses/components/unit/AIComponent.js):
   *  - Idle wander: `ai.idleBehaviour === 'wander'` picks random targets inside
   *    `ai.maxTravelDistance` (pixels).
   *  - Sensor aggro: when no target is set, scan for the nearest player unit inside
   *    `ai.sensorRadius` (tile units in modu data) and, if `ai.sensorResponse === 'fight'`,
   *    acquire it as the targetUnitId.
   *  - Pursuit: drive toward the target's live position; if it moves beyond
   *    `ai.letGoDistance` (pixels), drop pursuit.
   *  - Attack: when within `ai.maxAttackRange` (tile units in modu data) of the target,
   *    halt and emit `item:use` on the unit's `currentItemId`, throttled by the held
   *    item's `fireRate`. The item-use handler fires the projectile that actually
   *    damages the player.
   */
  /** Scan unit inventories for the bare `{id,type,quantity}` record matching
   *  `itemId` and return it with its holding unit. Held items aren't real
   *  entities, so resolution is by inventory scan (same as the `item:use`
   *  handler). Returns null if no unit holds it. */
  private _resolveItemHolder(
    itemId: string,
  ): { unit: any; invEntry: { id?: string; type?: string; quantity?: number } } | null {
    for (const ent of this._entities.values()) {
      if (ent.category !== 'unit') continue;
      const inv = (ent.stats?.inventory ?? []) as Array<{ id?: string; type?: string; quantity?: number } | null>;
      const found = inv.find((i) => i?.id === itemId) ?? undefined;
      if (found) return { unit: ent, invEntry: found };
    }
    return null;
  }

  /** ms between uses for an inventory entry's item type. Taro's `Item._stats.fireRate`;
   *  defaults to 1000 when unset — same default the AI fire loop uses. */
  private _itemFireRateMs(invEntry: { type?: string } | undefined): number {
    const itemType = invEntry?.type
      ? (this.types.get('itemTypes', invEntry.type) as Record<string, any> | null)
      : null;
    return Number(itemType?.fireRate) || 1000;
  }

  /** Continuous held-item use. For every item registered via `item:startUse`
   *  (button1 held / `startUsingItem`), count down its fireRate timer and
   *  re-emit `item:use` when it elapses — taro's `Item._behaviour()` calling
   *  `use()` each tick while `isBeingUsed`. Drops the entry (taro calls the
   *  previous item's `stopUsing`) when the holder is gone or has switched away
   *  from the item, so a holstered/dropped weapon can't keep firing. */
  private _processItemUse(dt: number): void {
    if (this._itemsBeingUsed.size === 0) return;
    for (const [itemId, cd] of this._itemsBeingUsed) {
      const holder = this._resolveItemHolder(itemId);
      if (!holder || (holder.unit.stats as any)?.currentItemId !== itemId) {
        this._itemsBeingUsed.delete(itemId);
        continue;
      }
      const next = cd - dt;
      if (next > 0) {
        this._itemsBeingUsed.set(itemId, next);
        continue;
      }
      this.engine.events.emit('item:use', [itemId]);
      this._itemsBeingUsed.set(itemId, this._itemFireRateMs(holder.invEntry));
    }
  }

  private _processAI(dt: number): void {
    // Collect the set of units currently controlled by a connected player so we skip them.
    const playerUnitIds = new Set<string>();
    for (const pd of this._players.values()) if (pd.unitId) playerUnitIds.add(pd.unitId);

    for (const [id, unit] of this._entities) {
      if (unit.category !== 'unit') continue;
      if (playerUnitIds.has(id)) continue;
      const typeDef = this.types.get('unitTypes', unit.stats?.type) as any;
      const body = this._entityBodies.get(id);
      if (!body) continue;

      if (!unit._aiState) {
        unit._aiState = {
          target: null as { x: number; y: number } | null,
          targetUnitId: null as string | null,
          pickCooldownMs: 0,
          attackCooldownMs: 0,
        };
      }
      const state = unit._aiState;
      state.pickCooldownMs -= dt;
      state.attackCooldownMs = (state.attackCooldownMs ?? 0) - dt;

      const ai = typeDef?.ai;

      // 1. Sensor aggro: with no current target, look for the nearest player unit inside
      //    `ai.sensorRadius` (tile units, modu data convention — original taro stored these
      //    in pixels but karmaslayers-class clones have them migrated to tiles, see
      //    e.g. wolf `sensorRadius: 7`). Only `sensorResponse: 'fight'` is wired here;
      //    flee/none fall through and the unit keeps wandering.
      if (ai?.enabled && !state.targetUnitId && ai.sensorResponse === 'fight') {
        const sensorRadiusTiles = Number(ai.sensorRadius) || 0;
        if (sensorRadiusTiles > 0) {
          const sensorRadiusPhys = this._tileToPhysics(sensorRadiusTiles);
          const limitSq = sensorRadiusPhys * sensorRadiusPhys;
          let bestId: string | null = null;
          let bestDistSq = limitSq;
          for (const pid of playerUnitIds) {
            const pUnit = this._entities.get(pid);
            if (!pUnit) continue;
            if ((pUnit.stats as any)?.isHidden) continue;
            if ((pUnit.stats as any)?.isUnTargetable) continue;
            const pBody = this._entityBodies.get(pid);
            if (!pBody) continue;
            const ddx = pBody.position.x - body.position.x;
            const ddy = pBody.position.y - body.position.y;
            const dSq = ddx * ddx + ddy * ddy;
            if (dSq <= bestDistSq) {
              bestDistSq = dSq;
              bestId = pid;
            }
          }
          if (bestId) {
            state.targetUnitId = bestId;
            state.pickCooldownMs = 10000;
          }
        }
      }

      // 2. Let-go: if the current target ran past `ai.letGoDistance` (pixels) or is gone,
      //    drop pursuit. Taro's parseInt-guard means a missing/NaN field disables the cap.
      if (state.targetUnitId) {
        const target = this._entities.get(state.targetUnitId);
        const tBody = target ? this._entityBodies.get(state.targetUnitId) : null;
        if (!target || !tBody) {
          state.targetUnitId = null;
          state.target = null;
        } else if (ai?.letGoDistance != null) {
          const letGoPhys = Number(ai.letGoDistance) / GameServer.SCALE_RATIO;
          if (Number.isFinite(letGoPhys) && letGoPhys > 0) {
            const ddx = tBody.position.x - body.position.x;
            const ddy = tBody.position.y - body.position.y;
            if (ddx * ddx + ddy * ddy > letGoPhys * letGoPhys) {
              state.targetUnitId = null;
              state.target = null;
            }
          }
        }
      }

      // 3. If a target unit is set (sensor aggro OR `ai:attackUnit` script), pursue its
      //    current position. The unit's position changes every tick so we re-resolve each frame.
      if (state.targetUnitId) {
        const target = this._entities.get(state.targetUnitId);
        if (target) {
          state.target = {
            x: this._tileToPhysics(target.position.x),
            y: this._tileToPhysics(target.position.z),
          };
        } else {
          state.targetUnitId = null;
          state.target = null;
        }
      }

      // 4. If no script/sensor target AND the type has wandering AI, pick a random wander target.
      const wanderEnabled = ai?.enabled && ai.idleBehaviour === 'wander';
      if (!state.target && wanderEnabled) {
        const maxTravelPhys = (Number(ai.maxTravelDistance) || 200) / GameServer.SCALE_RATIO;
        const reached =
          state.target &&
          Math.hypot((state.target as any).x - body.position.x, (state.target as any).y - body.position.y) < 0.4;
        if (!state.target || reached || state.pickCooldownMs <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * maxTravelPhys;
          state.target = {
            x: body.position.x + Math.cos(angle) * dist,
            y: body.position.y + Math.sin(angle) * dist,
          };
          state.pickCooldownMs = 2000 + Math.random() * 3000;
        }
      }

      // 5. If we still have no target, this unit is idle — clear velocity so it doesn't
      //    drift from a previous push.
      if (!state.target) {
        body.linearVelocity = new Vec2(0, 0);
        continue;
      }

      // 6. Drive toward the target. Stop within `maxAttackRange` if pursuing a unit.
      //    `maxAttackRange` is in tile units in modu data; the wander branch uses a small
      //    physics-unit threshold so the unit visibly arrives at its random destination.
      const dx = state.target.x - body.position.x;
      const dy = state.target.y - body.position.y;
      const mag = Math.hypot(dx, dy);
      const speed = (typeDef?.attributes?.speed?.value as number) || (unit.stats?.speed as number) || 10;
      const attackRangePhys = state.targetUnitId
        ? this._tileToPhysics(Number(ai?.maxAttackRange ?? ai?.attackRange ?? 0.75))
        : 0.4;
      if (mag > attackRangePhys) {
        // Same convention as the player branch: raw `direction * speed` in physics units.
        const vx = (dx / mag) * speed;
        const vy = (dy / mag) * speed;
        body.linearVelocity = new Vec2(vx, vy);
      } else {
        body.linearVelocity = new Vec2(0, 0);
        if (state.targetUnitId) {
          // In range — face the target. The post-physics facing loop drives rotation off
          // `body.linearVelocity`, which is zero now, so it would restore the cached
          // heading or snap to 0. Write into the cache so the unit stays locked onto the
          // target even while standing still.
          const r = Math.atan2(-dx, -dy);
          unit.rotation = r;
          this._aiUnitFacingRotation.set(id, r);

          // Fire the held weapon, throttled by the item type's `fireRate` (ms between
          // shots — same field the player branch reads). taro Item.use() runs on every
          // gameLoop tick while the button is held; throttling here gives the same net
          // cadence without the per-tick spam.
          if (state.attackCooldownMs <= 0) {
            const currentItemId = (unit.stats as any)?.currentItemId as string | null | undefined;
            if (currentItemId) {
              const inv = ((unit.stats as any)?.inventory ?? []) as Array<{ id?: string; type?: string }>;
              const invEntry = inv.find((i) => i?.id === currentItemId);
              const itemType = invEntry?.type
                ? (this.types.get('itemTypes', invEntry.type) as Record<string, any> | null)
                : null;
              const fireRate = Number(itemType?.fireRate) || 1000;
              this.engine.events.emit('item:use', [currentItemId]);
              state.attackCooldownMs = fireRate;
            }
          }
        } else {
          // Reached a wander/move-to target; release it so wandering picks a new one.
          state.target = null;
        }
      }
    }
  }

  /** Sync physics body positions back to entity positions (physics → tile coords).
   *  After the post-step sync, clamp unit/item/projectile positions to within the
   *  map's tile bounds when their type def has `confinedWithinMapBoundaries !== false`
   *  (default true). Mirrors taro Rapier2dComponent post-step boundary check
   *  (moddio2/engine/components/physics/rapier/Rapier2dComponent.js) — without it,
   *  units driven by held WASD keys march past the edge of the map indefinitely. */
  private _syncPhysicsToEntities(): void {
    const map = this._gameData?.map as { width?: unknown; height?: unknown } | undefined;
    const mapW = Number(map?.width) || 0;
    const mapH = Number(map?.height) || 0;
    const padding = 0.5; // half a tile, matching taro's tileWidth / 2
    const minX = padding, maxX = mapW - padding;
    const minZ = padding, maxZ = mapH - padding;
    const canClamp = mapW > 0 && mapH > 0;
    for (const [entityId, body] of this._entityBodies) {
      const entity = this._entities.get(entityId);
      if (!entity) continue;
      const pos = body.position;
      let x = this._physicsToTile(pos.x);
      let z = this._physicsToTile(pos.y); // Physics Y → Three.js Z

      if (canClamp) {
        const cat = entity.category as string | undefined;
        if (cat === 'unit' || cat === 'item' || cat === 'projectile') {
          const typeKey = cat === 'unit' ? 'unitTypes' : cat === 'item' ? 'itemTypes' : 'projectileTypes';
          const typeId = entity.stats?.type as string | undefined;
          const typeDef = typeId ? this.types.get(typeKey, typeId) : null;
          // Default true when the field is unset — matches the editor's
          // defaultGameObjects.service.ts (unit/item/projectile/prop all init to true).
          const confined = typeDef ? (typeDef as any).confinedWithinMapBoundaries !== false : true;
          if (confined) {
            const cx = Math.max(minX, Math.min(x, maxX));
            const cz = Math.max(minZ, Math.min(z, maxZ));
            if (cx !== x || cz !== z) {
              x = cx;
              z = cz;
              // Snap the rapier body to the clamped position so the next physics
              // step starts inside the map. Without this, a unit pressed against
              // the boundary would re-leave on every tick and the clamp would
              // run forever, also poisoning collision response with the wall layer.
              body.position = new Vec2(this._tileToPhysics(x), this._tileToPhysics(z));
            }
          }
        }
      }

      entity.position.x = x;
      entity.position.z = z;
      // `body.angle` is the single source of truth for every category now. Units, items
      // and projectiles keep rotation locked, so this reads back the 0 they were created
      // with and the face-the-cursor / face-movement loops overwrite it later in the same
      // tick. Props are created unlocked *and* seeded with the angle the initialize
      // script placed them at, so the same read gives their authored rotation until a
      // collision spins them.
      entity.rotation = body.angle;
    }
  }

  private _streamTransforms(): void {
    const transforms: any[] = [];
    for (const [id, entity] of this._entities) {
      if (!entity.alive) continue;
      if (entity.category === 'player') continue; // Players don't have transforms
      // Hidden items (carried inventory entities at owner-position) don't have
      // a visible representation on the client, so streaming their transform is
      // wasted bandwidth and re-pulls the client mesh back from its hide-state.
      if (entity.category === 'item' && (entity as any).stats?.isHidden) continue;
      const x = entity.position.x;
      const z = entity.position.z;
      const r = entity.rotation || 0;
      // Guard against NaN positions — Rapier dynamic bodies with very small
      // colliders + zero gravity (notably food items) can integrate to NaN over
      // many ticks; broadcasting the bad value poisons the client's interp
      // (`obj.position += (target - pos) * lerp` → NaN forever) and the mesh
      // vanishes. Skip the bad entity rather than the whole item category — a
      // blanket category skip leaves *correct* positions on the floor too,
      // which is exactly the bug the pig-loot script hit: `setVelocityOfEntityXY`
      // scattered the meat server-side, the client visual stayed at the spawn
      // point, and pressing E at the visible position missed an `entitiesInRegion`
      // check that uses the drifted server coords.
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r)) continue;
      transforms.push({
        entityId: id,
        transform: encodeTransform({ x, y: z, rotation: r }),
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
      case MessageType.PlayerSelectInventorySlot: {
        // Click-driven slot select. Bypasses ability bindings — clicking a slot always
        // selects it, even when the unit type binds digit keys to abilities.
        const playerData = this._players.get(clientId);
        if (!playerData) break;
        const unit = this._entities.get(playerData.unitId);
        if (!unit?.stats) break;
        const slotIdx = Number((msg.data as { slot?: unknown })?.slot);
        if (!Number.isFinite(slotIdx) || slotIdx < 0) break;
        const invSize = Number(unit.stats.inventorySize) || 0;
        if (slotIdx >= invSize || unit.stats.isHidden) break;
        const inv = (unit.stats.inventory ?? []) as Array<{ id?: string }>;
        unit.stats.currentSlot = slotIdx;
        unit.stats.currentItemId = inv[slotIdx]?.id ?? null;
        this._transport.broadcast({
          type: MessageType.EntityStatsUpdate,
          data: { [playerData.unitId]: { currentSlot: unit.stats.currentSlot, currentItemId: unit.stats.currentItemId } },
        });
        break;
      }
      case MessageType.PlayerSwapInventorySlot: {
        // Drag-driven slot swap. The client lets the player drop one inventory
        // slot onto another to exchange the records (or move into an empty slot).
        // Slot indices are positions in `unit.stats.inventory`; we pad with nulls
        // when `to` lies past the dense tail so the held-slot index stays stable
        // for downstream `inv[currentSlot]` resolution.
        const playerData = this._players.get(clientId);
        if (!playerData) break;
        const unit = this._entities.get(playerData.unitId);
        if (!unit?.stats || unit.stats.isHidden) break;
        const data = msg.data as { from?: unknown; to?: unknown };
        const from = Number(data?.from);
        const to = Number(data?.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) break;
        if (from < 0 || to < 0 || from === to) break;
        const invSize = Number(unit.stats.inventorySize) || 0;
        if (from >= invSize || to >= invSize) break;
        const inv = (unit.stats.inventory ?? (unit.stats.inventory = [])) as Array<{ id?: string } | null>;
        // Source slot must contain something to drag; empty drags are a no-op.
        if (!inv[from]) break;
        // Pad to the target index with nulls so swapping into a "visually empty
        // but past array length" slot doesn't leave gaps that JSON-serialize as
        // missing entries the client can't index.
        const maxIdx = Math.max(from, to);
        while (inv.length <= maxIdx) inv.push(null);
        const tmp = inv[from] ?? null;
        inv[from] = inv[to] ?? null;
        inv[to] = tmp;
        this._syncCurrentItemAndBroadcast(playerData.unitId, unit);
        break;
      }
      case MessageType.ShopBuyItem:
        this._onShopBuyItem(clientId, msg.data as { shopId?: unknown; itemTypeId?: unknown });
        break;
      case MessageType.Ping:
        this._transport.send(clientId, { type: MessageType.Pong, data: msg.data });
        break;
      case MessageType.PlayerChat: {
        // Inbound chat from a client. Echo to everyone with the sender id, and fire
        // `playerSendsChatMessage` so scripts can react (commands, filters, …).
        const data = msg.data as { text?: string };
        const text = String(data?.text ?? '').slice(0, 500);
        const playerData = this._players.get(clientId);
        if (!playerData || !text) break;
        // Single-player dev sandbox: consume `/dev …` before normal chat so it is
        // never echoed and game scripts never see it.
        const _devTrim = text.trim();
        const _devLower = _devTrim.toLowerCase();
        if (this._singlePlayer && (_devLower.startsWith('/dev') || _devLower === '/help')) {
          this._handleDevChat(_devTrim, clientId, playerData);
          break;
        }
        const playerId = playerData.player.id;
        // Update the per-player last-message store the resolver reads.
        this.scripts.actions.setLastChatForPlayer(playerId, text);
        this._transport.broadcast({
          type: MessageType.ChatMessage,
          data: { text, fromPlayerId: playerId, system: false },
        });
        this.scripts.trigger('playerSendsChatMessage', { playerId, message: text });
        break;
      }
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

    // Spawn the placeholder at map center. Compute the position BEFORE spawnUnit
    // so the EntityCreate broadcast (and the physics body created inside spawnUnit)
    // carry the final transform. Setting position after spawnUnit returns broadcasts
    // the unit at (0, 0) first — clients render it at the map's top-left tile and
    // only slide it toward center on the next snapshot, visible to players as units
    // appearing at the corner on join.
    const unitTypes = this.types.getAll('unitTypes');
    let unitId = '';
    if (unitTypes.size > 0) {
      const [firstTypeId, firstTypeDef] = unitTypes.entries().next().value as [string, Record<string, unknown>];
      const map = this._gameData?.map as { width?: number; height?: number } | undefined;
      const spawnX = map ? (map.width ?? 10) / 2 : 0;
      const spawnZ = map ? (map.height ?? 10) / 2 : 0;
      const unit = this.spawnUnit(firstTypeId, firstTypeDef, player.id, { x: spawnX, z: spawnZ });
      unitId = unit.id;
      player.addUnit(unit.id);
      player.selectUnit(unit.id);
    }

    // Tag the auto-spawn unit as a placeholder so a later playerCameraTrackUnit can clean
    // it up (see camera:trackUnit handler). Empty string when no unit type exists at all.
    this._players.set(clientId, { player, clientId, unitId, placeholderUnitId: unitId || undefined });

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
    // A binding is only "actionable" if it actually resolves to a runnable script or
    // a cast event. Many games ship `keyDown: { scriptName: '', cost: {} }` shells —
    // those are truthy objects but do nothing, and the previous `if (!slot)` check
    // treated them as bound, blocking the digit→inventory fallback below.
    const namespacedScriptId = slot?.scriptName && typeId ? `unitTypes:${typeId}:${slot.scriptName}` : null;
    const slotHasScript = !!(
      slot?.scriptName &&
      (this.scripts.triggers.getScript(slot.scriptName) ||
        (namespacedScriptId && this.scripts.triggers.getScript(namespacedScriptId)))
    );
    const slotHasCast = !!(
      slot && ((slot.event === 'startCasting' && slot.abilityId) || slot.event === 'stopCasting')
    );
    if (!slot || (!slotHasScript && !slotHasCast)) {
      // Number keys 1..9 select inventory slot 0..8 when the unit type doesn't bind
      // them to a real action.
      if (isDown && /^[1-9]$/.test(data.key)) {
        const slotIdx = Number(data.key) - 1;
        const invSize = Number(unit.stats?.inventorySize) || 0;
        if (slotIdx < invSize && !unit.stats?.isHidden) {
          const inv = (unit.stats?.inventory ?? []) as Array<{ id?: string }>;
          unit.stats.currentSlot = slotIdx;
          unit.stats.currentItemId = inv[slotIdx]?.id ?? null;
          this._transport.broadcast({
            type: MessageType.EntityStatsUpdate,
            data: { [playerData.unitId]: { currentSlot: unit.stats.currentSlot, currentItemId: unit.stats.currentItemId } },
          });
        }
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

  /** Send a single-player dev-sandbox feedback line to one client. */
  private _devReply(clientId: string, text: string): void {
    this._transport.send(clientId, {
      type: MessageType.ChatMessage,
      data: { text, fromPlayerId: '', system: true },
    });
  }

  private static readonly DEV_HELP = [
    'Dev sandbox (single-player only):',
    '/help  or  /dev help               show this list',
    '/dev set <attrId> <value>            set controlled-unit attribute',
    '/dev set player <attrId> <value>     set player attribute',
    '/dev tp <x> <y>                      teleport to tile coords',
    '/dev tp <regionName>                 teleport to region center',
    '/dev qtp                             toggle press-T-to-cursor teleport',
    '/dev shop [number]                   list shops by name / open by number (free buy)',
    '/dev spawn unit <typeId> [n]         spawn unit(s) at your position',
    '/dev spawn item <typeId> [qty]       give item to controlled unit',
    '/dev list units | /dev list items    list valid type ids',
  ].join('\n');

  /** Parse and execute a `/dev …` command. Never throws; always replies to the
   *  caller. `text` is already trimmed and starts (case-insensitively) with /dev. */
  private _handleDevChat(text: string, clientId: string, playerData: { player: Player; clientId: string; unitId: string }): void {
    const parts = text.split(/\s+/);
    const sub = (parts[1] ?? '').toLowerCase();
    try {
      switch (sub) {
        case '':
        case 'help':
          this._devReply(clientId, GameServer.DEV_HELP);
          return;
        case 'set': {
          const isPlayer = (parts[2] ?? '').toLowerCase() === 'player';
          const attrId = isPlayer ? parts[3] : parts[2];
          const rawValue = isPlayer ? parts[4] : parts[3];
          const value = Number(rawValue);
          if (!attrId || rawValue === undefined || !Number.isFinite(value)) {
            this._devReply(clientId, 'usage: /dev set <attrId> <value>  |  /dev set player <attrId> <value>');
            return;
          }
          if (isPlayer) {
            const playerId = playerData.player.id;
            this.engine.events.emit('player:setAttributeMax', [playerId, attrId, value]);
            this.engine.events.emit('player:setAttribute', [playerId, attrId, value]);
            this._devReply(clientId, `player.${attrId} = ${value}`);
            return;
          }
          const unit = this._entities.get(playerData.unitId);
          if (!unit?.stats) { this._devReply(clientId, 'No controlled unit.'); return; }
          const cur = (unit.stats as any)[`attr_${attrId}`];
          if (cur === undefined) {
            const ids = Object.keys(unit.stats).filter((s) => s.startsWith('attr_')).map((s) => s.slice(5));
            this._devReply(clientId, `Unknown unit attribute "${attrId}". Available: ${ids.join(', ') || '(none)'}`);
            return;
          }
          if (value > (Number(cur.max) || 0)) {
            this.engine.events.emit('setEntityAttributeMax', [playerData.unitId, attrId, value]);
          }
          this.engine.events.emit('setEntityAttribute', [playerData.unitId, attrId, value]);
          this._devReply(clientId, `unit.${attrId} = ${value}`);
          return;
        }
        case 'tp': {
          const unitId = playerData.unitId;
          if (!unitId) { this._devReply(clientId, 'No controlled unit.'); return; }
          const a = parts[2];
          const b = parts[3];
          if (a !== undefined && b !== undefined && Number.isFinite(Number(a)) && Number.isFinite(Number(b))) {
            const px = Number(a) * this._tilePx;
            const py = Number(b) * this._tilePx;
            this.engine.events.emit('scriptAction', ['teleportEntity', { entity: unitId, position: { x: px, y: py } }, {}]);
            this._devReply(clientId, `teleported to (${a}, ${b})`);
            return;
          }
          if (a !== undefined) {
            // Region names may contain spaces; join all remaining parts.
            const regionName = parts.slice(2).join(' ');
            const region = this._regionVars.get(regionName);
            if (region) {
              // _regionVars holds normalized fractions (0..1) of the map's tile
              // dimensions. tileCenter = (frac + size/2) * mapTiles; teleportEntity
              // divides position by _tilePx, so emit pixels = tileCenter * _tilePx.
              const map = (this._gameData?.map ?? {}) as { width?: number; height?: number };
              const mapW = Number(map.width) || 0;
              const mapH = Number(map.height) || 0;
              const cx = (region.x + region.width / 2) * mapW * this._tilePx;
              const cy = (region.y + region.height / 2) * mapH * this._tilePx;
              this.engine.events.emit('scriptAction', ['teleportEntity', { entity: unitId, position: { x: cx, y: cy } }, {}]);
              this._devReply(clientId, `teleported to region "${regionName}"`);
              return;
            }
            const names = [...this._regionVars.keys()];
            this._devReply(clientId, `Unknown region "${regionName}". Regions: ${names.join(', ') || '(none)'}`);
            return;
          }
          this._devReply(clientId, 'usage: /dev tp <x> <y>  |  /dev tp <regionName>');
          return;
        }
        case 'shop': {
          const shops = (this._rawGameData?.shops ?? {}) as Record<string, any>;
          const ids = Object.keys(shops);
          const list =
            ids.map((id, i) => `${(shops[id]?.name as string) || id}(${i + 1})`).join(', ') || '(none)';
          const arg = parts[2];
          if (!arg) {
            this._devReply(clientId, `Shops: ${list}\nUse /dev shop <number> to open (free buy in single-player)`);
            return;
          }
          let shopId: string | undefined;
          const idx = Number(arg);
          if (Number.isInteger(idx) && idx >= 1 && idx <= ids.length) {
            shopId = ids[idx - 1];
          } else if (shops[arg]) {
            shopId = arg;
          }
          if (!shopId) {
            this._devReply(clientId, `Unknown shop "${arg}". Shops: ${list}`);
            return;
          }
          this.engine.events.emit('ui:openShop', [playerData.player.id, shopId]);
          this._devReply(clientId, `opened "${(shops[shopId]?.name as string) || shopId}" (purchases are free)`);
          return;
        }
        case 'list': {
          const what = (parts[2] ?? '').toLowerCase();
          const cat = what === 'units' ? 'unitTypes' : what === 'items' ? 'itemTypes' : null;
          if (!cat) { this._devReply(clientId, 'usage: /dev list units | /dev list items'); return; }
          const ids = [...this.types.getAll(cat).keys()];
          this._devReply(clientId, `${what}: ${ids.join(', ') || '(none)'}`);
          return;
        }
        case 'spawn': {
          const what = (parts[2] ?? '').toLowerCase();
          const typeId = parts[3];
          const n = Math.max(1, Math.floor(Number(parts[4]) || 1));
          if (!typeId || (what !== 'unit' && what !== 'item')) {
            this._devReply(clientId, 'usage: /dev spawn unit <typeId> [n]  |  /dev spawn item <typeId> [qty]');
            return;
          }
          if (what === 'item') {
            if (!this.types.get('itemTypes', typeId)) {
              this._devReply(clientId, `Unknown item type "${typeId}". Try /dev list items`);
              return;
            }
            this.engine.events.emit('inventory:giveItem', [playerData.unitId, typeId, n]);
            this._devReply(clientId, `gave ${n}× item "${typeId}"`);
            return;
          }
          const typeDef = this.types.get('unitTypes', typeId);
          if (!typeDef) {
            this._devReply(clientId, `Unknown unit type "${typeId}". Try /dev list units`);
            return;
          }
          const here = this._entities.get(playerData.unitId);
          const sx = here?.position?.x ?? 0;
          const sz = here?.position?.z ?? 0;
          for (let i = 0; i < n; i++) {
            this.spawnUnit(typeId, typeDef, playerData.player.id, { x: sx, z: sz });
          }
          this._devReply(clientId, `spawned ${n}× unit "${typeId}"`);
          return;
        }
        case 'qtp': {
          const pid = playerData.player.id;
          const enabled = !this._quickTeleport.has(pid);
          if (enabled) this._quickTeleport.add(pid);
          else this._quickTeleport.delete(pid);
          this._transport.send(clientId, {
            type: MessageType.UICommand,
            data: { command: 'devQuickTeleport', args: [enabled] },
          });
          this._devReply(clientId, enabled
            ? 'Quick-teleport ON — press T to teleport to cursor'
            : 'Quick-teleport OFF');
          return;
        }
        default:
          this._devReply(clientId, `Unknown dev command "/dev ${sub}".\n${GameServer.DEV_HELP}`);
          return;
      }
    } catch (err) {
      this._devReply(clientId, `Dev command error: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  /**
   * Shop purchase: the client sends ShopBuyItem after the player clicks "Buy"
   * in the shop modal opened by an `openShopForPlayer` UICommand. The shop
   * entry lives in `rawGameData.shops[shopId].itemTypes[itemTypeId]`:
   *
   *   price.coins             — legacy taro coin cost (unused by karmaslayers-class clones)
   *   price.playerAttributes  — {attrId: amount} costs deducted from the player's `attr_<id>`
   *   price.requiredItemTypes — {itemTypeId: count} costs consumed across the unit's inventory
   *   quantity                — how many of the bought item to grant (default 1)
   *
   * Affordability is all-or-nothing: if any leg of the price can't be paid the
   * purchase is rejected before any deduction happens. Required-item consumption
   * walks the unit's inventory slots and decrements quantity per slot, freeing
   * the slot to null when it empties — mirroring how the original taro engine
   * processed `Unit.prototype.buyItem`.
   */
  private _onShopBuyItem(clientId: string, data: { shopId?: unknown; itemTypeId?: unknown }): void {
    const playerData = this._players.get(clientId);
    if (!playerData) return;
    const unit = this._entities.get(playerData.unitId);
    if (!unit?.stats) return;
    const shopId = typeof data?.shopId === 'string' ? data.shopId : null;
    const itemTypeId = typeof data?.itemTypeId === 'string' ? data.itemTypeId : null;
    if (!shopId || !itemTypeId) return;
    const shops = (this._rawGameData?.shops ?? {}) as Record<string, any>;
    const shop = shops[shopId];
    if (!shop) return;
    const entry = shop.itemTypes?.[itemTypeId];
    if (!entry || entry.isPurchasable === false) return;

    // Single-player dev sandbox: skip all affordability checks and cost
    // deductions, grant the item directly. Multiplayer path below is unchanged.
    if (this._singlePlayer) {
      const grantQty = Number(entry.quantity) || 1;
      this.engine.events.emit('inventory:giveItem', [playerData.unitId, itemTypeId, grantQty]);
      return;
    }

    const price = entry.price ?? {};
    const playerAttrCosts: Record<string, number> = price.playerAttributes ?? {};
    const requiredItems: Record<string, number> = price.requiredItemTypes ?? {};
    const coinsCost = Number(price.coins) || 0;
    const playerId = (unit.stats as any).ownerId as string | undefined;
    const player = playerId ? this._entities.get(playerId) : null;

    // Affordability check — bail before any deduction so a partial-failure doesn't
    // strip resources without delivering the item.
    for (const [attrId, rawAmt] of Object.entries(playerAttrCosts)) {
      const amt = Number(rawAmt) || 0;
      if (amt <= 0) continue;
      const attr = (player?.stats as any)?.[`attr_${attrId}`];
      const have = Number(attr?.value) || 0;
      if (have < amt) return;
    }
    if (coinsCost > 0) {
      const coins = Number((player?.stats as any)?.coins) || 0;
      if (coins < coinsCost) return;
    }
    const inv = ((unit.stats as any).inventory ?? []) as Array<{ id?: string; type?: string; quantity?: number } | null>;
    for (const [reqType, rawNeed] of Object.entries(requiredItems)) {
      const need = Number(rawNeed) || 0;
      if (need <= 0) continue;
      let have = 0;
      for (const slot of inv) {
        if (slot?.type === reqType) have += Number(slot.quantity) || 0;
        if (have >= need) break;
      }
      if (have < need) return;
    }

    // All checks passed — deduct each cost.
    for (const [attrId, rawAmt] of Object.entries(playerAttrCosts)) {
      const amt = Number(rawAmt) || 0;
      if (amt <= 0 || !playerId) continue;
      const attr = (player?.stats as any)?.[`attr_${attrId}`];
      const next = (Number(attr?.value) || 0) - amt;
      this.engine.events.emit('player:setAttribute', [playerId, attrId, next]);
    }
    if (coinsCost > 0 && playerId && player) {
      const next = (Number((player.stats as any).coins) || 0) - coinsCost;
      (player.stats as any).coins = next;
      this._transport.broadcast({ type: MessageType.EntityStatsUpdate, data: { [playerId]: { coins: next } } });
    }
    for (const [reqType, rawNeed] of Object.entries(requiredItems)) {
      let need = Number(rawNeed) || 0;
      if (need <= 0) continue;
      for (let i = 0; i < inv.length && need > 0; i++) {
        const slot = inv[i];
        if (slot?.type !== reqType) continue;
        const slotQty = Number(slot.quantity) || 0;
        const take = Math.min(slotQty, need);
        const remaining = slotQty - take;
        if (remaining > 0) inv[i] = { ...slot, quantity: remaining };
        else inv[i] = null;
        need -= take;
      }
    }
    this._syncCurrentItemAndBroadcast(playerData.unitId, unit);

    // Grant the purchased item.
    const grantQty = Number(entry.quantity) || 1;
    this.engine.events.emit('inventory:giveItem', [playerData.unitId, itemTypeId, grantQty]);
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
    // Taro's overhead name label is the *owner player's* name, and is hidden
    // entirely when a unit has no owner player (Unit.js `updateNameLabel`:
    // `playerTypeData ? playerTypeData.showNameLabel === false : true` — no
    // owner player → ternary is `true` → label hidden). `typeDef.name` is the
    // editor-facing unitType label and is NEVER a unit's in-game name in taro.
    // Seeding it here is what drew "Invisible Body - 64x64" (and every AI mob's
    // type name) above otherwise-invisible/ownerless units. Resolve the owner
    // player and use its name; ownerless units get '' so no label is drawn.
    const ownerPlayer = ownerId ? this._entities.get(ownerId) : undefined;
    const ownerName =
      ownerPlayer && ownerPlayer.category === 'player'
        ? String((ownerPlayer.stats as Record<string, unknown>)?.name ?? '')
        : '';
    const unit = new Unit(undefined, {
      name: ownerName,
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
    //
    // Taro stores `defaultItems` as an array of `{ key, name, value }` where `.key`
    // is the itemType id (see Unit.js: `taro.game.cloneAsset('itemTypes', item.key)`).
    // We accept both shapes — array-of-{key,name} (taro/canonical) and the older
    // record-of-{itemTypeId} form some legacy games may still carry.
    const invSize = Number((typeDef as any).inventorySize) || 0;
    const rawDefaults = (typeDef as any).defaultItems;
    const defaultsList: Array<{ typeId?: string; quantity?: number }> = Array.isArray(rawDefaults)
      ? (rawDefaults as Array<Record<string, unknown>>).map((d) => ({
          typeId: (d?.key as string | undefined) ?? (d?.itemTypeId as string | undefined),
          quantity: Number(d?.quantity) || 1,
        }))
      : Object.values((rawDefaults ?? {}) as Record<string, Record<string, unknown>>).map((d) => ({
          typeId: (d?.itemTypeId as string | undefined) ?? (d?.key as string | undefined),
          quantity: Number(d?.quantity) || 1,
        }));
    const startingInv: Array<{ id: string; type: string; quantity: number }> = [];
    for (const def of defaultsList) {
      if (def.typeId) {
        startingInv.push({
          id: `inv_${Math.random().toString(36).slice(2, 10)}`,
          type: def.typeId,
          quantity: def.quantity ?? 1,
        });
      }
    }
    (unit.stats as any).inventorySize = invSize;
    (unit.stats as any).inventory = startingInv;
    (unit.stats as any).currentSlot = 0;
    (unit.stats as any).currentItemId = startingInv[0]?.id ?? null;
    for (const rec of startingInv) {
      this._registerInventoryItemEntity(rec.id, rec.type, unit.id, rec.quantity);
    }

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

    // Seed entity-scope variables from `typeDef.variables` defaults so per-unit
    // gate checks (`getValueOfEntityVariable('isChatFeedbackOn')`, etc.) resolve
    // to the configured default instead of undefined. Without this, region-entry
    // scripts that gate their "Press [Space] to enter ..." chat prompt on
    // `isChatFeedbackOn == true` always evaluate the gate as `undefined == true`
    // and silently skip the prompt. Mirror onto stats.variables so the EntityCreate
    // broadcast carries them and clients can render unit-variable-driven UI.
    const typeVars = (typeDef as any).variables as Record<string, any> | undefined;
    if (typeVars) {
      const statsVars: Record<string, unknown> = {};
      for (const [name, def] of Object.entries(typeVars)) {
        if (!def || typeof def !== 'object') continue;
        if (!('default' in def) || (def as any).default === undefined) continue;
        const val = (def as any).default;
        const dt = (def as any).dataType as string | undefined;
        this.scripts.variables.setEntityVar(unit.id, name, val, dt);
        statsVars[name] = val;
      }
      if (Object.keys(statsVars).length > 0) {
        (unit.stats as any).variables = { ...((unit.stats as any).variables ?? {}), ...statsVars };
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
    this._createEntityBody(unit.id, unit.position.x, unit.position.z, typeDef as Record<string, any>, 'unit');

    this._transport.broadcast({
      type: MessageType.EntityCreate,
      data: buildEntityCreatePayload(
        'unit', unit.id, unit.position.x, unit.position.z, (unit as any).rotation || 0,
        // typeDef is spread for the client's rendering fields (cellSheet, bodies,
        // animations, …) but its `name` is the unitType's *editor* label — taro's
        // overhead label is the owner player's name, never the type name. Letting
        // typeDef.name win here is what put "Invisible Body - 64x64" over the
        // ownerless sensor bodies. The unit's runtime name (owner player's name,
        // or '' when ownerless) must take precedence.
        { ...unit.stats, ...typeDef, name: (unit.stats as Record<string, unknown>).name ?? '' },
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
      // destroyEntity — fire `initEntityDestroy` first so cleanup scripts (e.g. drop
      // loot, increment kill counter) can read the entity's stats one last time, then
      // tear down the body, drop from registries, and broadcast EntityDestroy.
      case 'destroyEntity': {
        const entityId = resolve(action.entity) as string;
        if (!entityId) return;
        const ent = this._entities.get(entityId);
        if (!ent) return;
        const cat = ent.category as string | undefined;
        const ctx: Record<string, unknown> = { entityId };
        if (cat === 'unit') ctx.unitId = entityId;
        else if (cat === 'item') ctx.itemId = entityId;
        else if (cat === 'projectile') ctx.projectileId = entityId;
        this.scripts.trigger('initEntityDestroy', ctx);

        // Physics body cleanup (also drops the body→entity reverse map entry).
        const body = this._entityBodies.get(entityId);
        if (body && this._physics) {
          this._bodyToEntity.delete(body.handle);
          this._physics.destroyBody(body);
          this._entityBodies.delete(entityId);
          this._groundFriction.delete(entityId);
        }
        // Items live in two places: the `_entities` map (their backing entity) and
        // the holding unit's `stats.inventory` slot record (`{id, type, quantity}`).
        // Tearing down only the entity leaves a dangling slot that still renders the
        // chest icon and pins `currentItemId` to a dead id — the player perceives
        // this as "I clicked use but nothing happened" because the chest icon never
        // disappeared. HRP5883Eb's `thisUnitUsesItem` chest-loot dispatch invokes
        // `destroyEntity(getTriggeringItem)` on the held chest precisely to clear the
        // slot, so the cleanup belongs here, not at the script call sites.
        if (cat === 'item') {
          const ownerId = (ent.stats as any)?.ownerId as string | undefined;
          const owner = ownerId ? this._entities.get(ownerId) : null;
          const inv = (owner as any)?.stats?.inventory as Array<{ id?: string } | null> | undefined;
          if (Array.isArray(inv)) {
            const slot = inv.findIndex(rec => rec?.id === entityId);
            if (slot !== -1) {
              inv[slot] = null;
              this._syncCurrentItemAndBroadcast(ownerId!, owner);
            }
          }
        }
        ent.destroy?.();
        this._entities.delete(entityId);
        this._regionMembership.delete(entityId);
        this._aiUnitFacingRotation.delete(entityId);
        this._transport.broadcast({
          type: MessageType.EntityDestroy,
          data: { entityId, timestamp: Date.now() },
        });
        return;
      }

      // moveEntity / teleportEntity — set the entity's position. taro pixel coords →
      // engine tile units. teleport also flags the protocol so client interpolation skips.
      case 'moveEntity':
      case 'teleportEntity': {
        const entityId = resolve(action.entity) as string;
        const pos = resolve(action.position) as { x?: number; y?: number } | null;
        if (!entityId || !pos) return;
        const ent = this._entities.get(entityId);
        if (!ent) return;
        const px = (pos.x ?? 0) / this._tilePx;
        const pz = (pos.y ?? 0) / this._tilePx;
        ent.position.x = px;
        ent.position.z = pz;
        const body = this._entityBodies.get(entityId);
        if (body) body.position = new Vec2(this._tileToPhysics(px), this._tileToPhysics(pz));
        // Streamed via _streamTransforms next tick; no need for a special broadcast.
        return;
      }

      // hideEntity / showEntity — toggle stats.isHidden + broadcast.
      case 'hideEntity':
      case 'showEntity': {
        const entityId = resolve(action.entity) as string;
        if (!entityId) return;
        const ent = this._entities.get(entityId);
        if (!ent?.stats) return;
        ent.stats.isHidden = (type === 'hideEntity');
        this._transport.broadcast({
          type: MessageType.EntityStatsUpdate,
          data: { [entityId]: { isHidden: ent.stats.isHidden } },
        });
        return;
      }

      // makeUnitPickupItem — move the item into the unit's inventory + fire the
      // pickup triggers (both unitPicksUpItem and the per-type alias thisUnitPicksUpItem).
      case 'makeUnitPickupItem': {
        const unitId = resolve(action.unit ?? action.entity) as string;
        const itemId = resolve(action.item) as string;
        if (!unitId || !itemId) return;
        const unit = this._entities.get(unitId);
        const item = this._entities.get(itemId);
        if (!unit?.stats || !item) return;
        const itemStats = item.stats as Record<string, any> | undefined;

        // Items with `isUsedOnPickup: true` (e.g. celleater food) are consumed on contact:
        // their `bonus.consume` block writes into the picking unit's owner's player attrs
        // (cell score) and/or the unit's own attrs, instead of going into the inventory.
        // Without this, food disappears but score never increases — the cell stays at the
        // starting score and can never grow large enough to eat virus.
        const usedOnPickup = !!itemStats?.isUsedOnPickup;
        if (usedOnPickup && itemStats?.bonus?.consume) {
          const consume = itemStats.bonus.consume as Record<string, any>;
          const ownerId = unit.stats.ownerId as string | undefined;
          const player = ownerId ? this._entities.get(ownerId) : null;
          for (const [attrId, raw] of Object.entries(consume.playerAttribute ?? {})) {
            if (!player?.stats) continue;
            const slot = `attr_${attrId}`;
            const cur = (player.stats as any)[slot] ?? { value: 0, min: 0, max: Number.MAX_SAFE_INTEGER };
            const next = Math.max(cur.min ?? 0, Math.min(cur.max ?? Number.MAX_SAFE_INTEGER, (cur.value ?? 0) + Number(raw || 0)));
            (player.stats as any)[slot] = { ...cur, value: next };
            this._transport.broadcast({
              type: MessageType.EntityStatsUpdate,
              data: { [ownerId!]: { [slot]: { value: next, min: cur.min, max: cur.max } } },
            });
          }
          for (const [attrId, raw] of Object.entries(consume.unitAttribute ?? {})) {
            const slot = `attr_${attrId}`;
            const cur = (unit.stats as any)[slot] ?? { value: 0, min: 0, max: Number.MAX_SAFE_INTEGER };
            const next = Math.max(cur.min ?? 0, Math.min(cur.max ?? Number.MAX_SAFE_INTEGER, (cur.value ?? 0) + Number(raw || 0)));
            (unit.stats as any)[slot] = { ...cur, value: next };
            this._transport.broadcast({
              type: MessageType.EntityStatsUpdate,
              data: { [unitId]: { [slot]: { value: next, min: cur.min, max: cur.max } } },
            });
          }
        } else {
          const inv = (unit.stats.inventory ?? (unit.stats.inventory = [])) as Array<{ id: string; type: string; quantity: number } | null>;
          // Stack with an existing slot of the same type when present, otherwise
          // fill the first empty slot (left behind by a prior drop). Empty slots
          // are `null` since drop leaves the position in place rather than
          // splicing.
          //
          // When the inventory is full of distinct types and the new item won't
          // stack, REFUSE the pickup: bail out before hiding the world entity
          // so the player can still walk back and try after dropping something.
          // Without this guard, the new record was pushed past `inventorySize`
          // into an invisible slot — the UI showed no change, but the world
          // item had already been hidden, leaving the player unable to recover
          // it from any slot.
          // Try to stack first, but respect the type's `maxQuantity` cap (taro
          // semantics: chests have maxQuantity:1, can never stack). If stacking
          // would overflow OR no slot of the same type exists, fall through to
          // placing the item in the first empty slot.
          //
          // When neither stacking nor a free slot is possible, REFUSE the
          // pickup — bail before hiding the world entity so the player can
          // walk back and try after dropping something. Without this guard the
          // record was either pushed past `inventorySize` into an invisible
          // slot, or stacked past `maxQuantity` past the type's cap, while the
          // world item was already hidden — leaving the player unable to
          // recover it from any slot.
          const incomingQty = Number(itemStats?.quantity) || 1;
          const maxQty = Number(itemStats?.maxQuantity) || Infinity;
          const stack = inv.find((it): it is { id: string; type: string; quantity: number } =>
            !!it && it.type === itemStats?.type && (Number(it.quantity) || 1) + incomingQty <= maxQty,
          );
          if (stack) {
            stack.quantity = (stack.quantity || 1) + incomingQty;
          } else {
            const invSize = Number(unit.stats.inventorySize) || inv.length;
            const emptyIdx = inv.findIndex(it => !it);
            const haveRoom = emptyIdx !== -1 || inv.length < invSize;
            if (!haveRoom) return;
            const newRec = {
              id: itemId,
              type: (itemStats?.type as string) || '',
              quantity: incomingQty,
            };
            if (emptyIdx !== -1) inv[emptyIdx] = newRec;
            else inv.push(newRec);
            // Only the new-slot path puts itemId into the inventory — stamp
            // ownerId / mirror attributes onto the world entity so resolvers
            // (`getOwnerOfItem`, attribute lookups, etc.) keep finding the
            // backing entity for this slot. The stack path reuses the kept
            // slot's existing entity, so the world entity has no role to play
            // — see the explicit teardown below.
            this._registerInventoryItemEntity(itemId, (itemStats?.type as string) || '', unitId, Number(itemStats?.quantity) || 1);
          }
          this._syncCurrentItemAndBroadcast(unitId, unit);
        }
        // Tear down the world physics body — picked-up items must not keep firing
        // itemEntersSensor against units that brush them. The entity itself stays
        // alive (hidden) so resolvers still resolve it; only the visible / collidable
        // representation is destroyed on the wire.
        const itemBody = this._entityBodies.get(itemId);
        if (itemBody && this._physics) {
          this._bodyToEntity.delete(itemBody.handle);
          this._physics.destroyBody(itemBody);
          this._entityBodies.delete(itemId);
          this._groundFriction.delete(itemId);
        }
        if (item?.stats) item.stats.isHidden = true;
        this._transport.broadcast({ type: MessageType.EntityDestroy, data: { entityId: itemId, timestamp: Date.now() } });
        this.scripts.trigger('unitPicksUpItem', { unitId, itemId });
        // Per-entity-type alias — taro game data uses both names.
        this.scripts.trigger('thisUnitPicksUpItem', { unitId, itemId });
        // Garbage-collect the world entity when no inventory slot references it.
        // Stack-pickups (`stack.quantity += incomingQty`) keep the existing slot's
        // id and never put `itemId` into the inventory — without this delete the
        // entity lingers as a hidden orphan that resolvers (`getOwnerOfItem`,
        // attribute lookups) still surface and that re-streams to late joiners as
        // a phantom item the player can never pick up. Same reason for the
        // `isUsedOnPickup` consume path: the food was fully resolved into attr
        // bonuses, the entity has no remaining role.
        const stillReferenced = ((unit.stats?.inventory ?? []) as Array<{ id?: string } | null>)
          .some(rec => rec?.id === itemId);
        if (!stillReferenced) {
          item?.destroy?.();
          this._entities.delete(itemId);
        }
        return;
      }

      // dropItem — drop the unit's currently-held item back into the world at its position.
      case 'dropItem': {
        const unitId = resolve(action.entity ?? action.unit) as string;
        if (!unitId) return;
        const unit = this._entities.get(unitId);
        if (!unit?.stats) return;
        const inv = (unit.stats.inventory ?? []) as Array<{ id?: string; type?: string; quantity?: number } | null>;
        const slotIdx = Number(unit.stats.currentSlot) || 0;
        const itemRec = inv[slotIdx];
        if (!itemRec?.type) return;
        // Leave the slot empty (null) rather than splicing — splice would shift
        // every trailing slot forward and reassign the player's other items to
        // different slot indices.
        inv[slotIdx] = null;
        // Remove the carried-item entity (registered on pickup/give). A fresh world
        // entity is spawned below — keeping the old one would leak a hidden item.
        if (itemRec.id) {
          const carried = this._entities.get(itemRec.id);
          carried?.destroy?.();
          this._entities.delete(itemRec.id);
        }
        this._syncCurrentItemAndBroadcast(unitId, unit);
        // Spawn a fresh world item at the unit's position, preserving the
        // dropped stack's quantity so picking it back up restores the full stack.
        this.engine.events.emit('item:spawn', [
          itemRec.type,
          { x: unit.position.x * this._tilePx, y: unit.position.z * this._tilePx },
          Number(itemRec.quantity) || 1,
        ]);
        this.scripts.trigger('unitDroppedAnItem', { unitId, itemId: itemRec.id });
        return;
      }

      // rotateEntityToRadians — direct rotation.
      case 'rotateEntityToRadians': {
        const entityId = resolve(action.entity) as string;
        const angle = Number(resolve(action.angle ?? action.rotation));
        if (!entityId || !Number.isFinite(angle)) return;
        const ent = this._entities.get(entityId);
        if (!ent) return;
        ent.rotation = angle;
        return;
      }

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
              this._createEntityBody(entityId, px, pz, typeDef as Record<string, any>, 'projectile');
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
                  this._groundFriction.delete(entityId);
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
