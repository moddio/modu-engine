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

    // Handle script-emitted actions
    this.engine.events.on('scriptAction', (args: unknown) => {
      const [type, action, vars] = args as [string, Record<string, unknown>, Record<string, unknown>];
      this._handleScriptAction(type, action, vars);
    });

    // Handle script:run events from ActionRunner
    this.engine.events.on('script:run', (args: unknown) => {
      const [scriptId, vars] = args as [string, Record<string, unknown>];
      this.scripts.runScript(scriptId, vars);
    });
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

  /** Create static wall bodies from the tilemap wall layer */
  private _createWallBodies(): void {
    if (!this._physics || !this._rawGameData?.map) return;
    const map = this._rawGameData.map;
    const layers = map.layers || [];

    for (const layer of layers) {
      if (layer.name !== 'walls' || !layer.data) continue;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (layer.data[y * map.width + x] === 0) continue;
          // Each tile = 1 world unit, centered at (x+0.5, y+0.5)
          const body = this._physics!.createBody({
            type: 'static',
            position: new Vec2(x + 0.5, y + 0.5),
          });
          body.addCollider({
            shape: 'box',
            width: 0.5,  // half-extent (1 tile = 1 unit)
            height: 0.5,
            friction: 0.01,     // Low friction so units slide along walls
            restitution: 0.01,  // Slight bounce to prevent sticking
            category: CollisionCategory.WALL,
            mask: DefaultCollisionMask[CollisionCategory.WALL],
          });
        }
      }
    }
  }

  /** Create a physics body for a dynamic entity */
  private _createEntityBody(entityId: string, x: number, z: number, typeDef: Record<string, any>): void {
    if (!this._physics) return;
    const bodyDef = typeDef.body || typeDef.bodies?.default;
    if (!bodyDef || bodyDef.type === 'none' || bodyDef.type === 'spriteOnly') return;

    const body = this._physics.createBody({
      type: (bodyDef.type === 'static' ? 'static' : bodyDef.type === 'kinematic' ? 'kinematic' : 'dynamic') as any,
      position: new Vec2(x, z),
    });

    // Set damping
    if (bodyDef.linearDamping) {
      body.raw.setLinearDamping(bodyDef.linearDamping);
    }

    // Taro uses scaleRatio=30 to convert pixel dimensions to physics units.
    // Our world: 1 tile = 1 unit. Taro: 1 tile = 16px. Physics: 16px / 30 = 0.533 units per tile.
    // To match: body pixels / 30 gives physics size, then / (16/30) = * 30/16 gives world units.
    // Simplified: bodyPixels / 16 = world units for the body dimension.
    // Half-extent = bodyPixels / 16 / 2
    const TILE_PX = 16;
    const hw = ((bodyDef.width || 40) / TILE_PX) / 2;
    const hh = ((bodyDef.height || 40) / TILE_PX) / 2;

    // Use fixture settings from game data
    const fixture = bodyDef.fixtures?.[0] || {};
    body.addCollider({
      shape: 'box',
      width: hw,
      height: hh,
      density: fixture.density ?? 3,
      friction: fixture.friction ?? 0.01,
      restitution: fixture.restitution ?? 0.01,
      category: CollisionCategory.UNIT,
      mask: DefaultCollisionMask[CollisionCategory.UNIT],
    });

    // Fixed rotation prevents spinning on wall contact
    if (bodyDef.fixedRotation !== false) {
      body.raw.setEnabledRotations(false, true);
    }

    this._entityBodies.set(entityId, body);
  }

  // --- Tick ---

  private _tick(dt: number): void {
    this._tickCount++;

    // Process input → apply forces to physics bodies
    this._processMovement(dt);

    // Step physics
    if (this._physics) {
      this._physics.step(dt);
    }

    // Sync physics positions back to entities
    this._syncPhysicsToEntities();

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
    this._streamTransforms();
  }

  /** Apply movement forces based on player input */
  private _processMovement(dt: number): void {
    for (const [clientId, playerData] of this._players) {
      const unit = this._entities.get(playerData.unitId);
      if (!unit || !unit._inputKeys) continue;

      const body = this._entityBodies.get(playerData.unitId);
      if (!body) continue;

      const typeDef = this.types.get('unitTypes', unit.stats?.type) as any;
      const speedAttr = typeDef?.attributes?.speed?.value ?? 10;
      const movementMethod = typeDef?.controls?.movementMethod ?? 'velocity';

      // Taro speed attribute is in pixels/tick. Convert to world units.
      // In taro: speed is applied as velocity in pixels, then scaleRatio=30 converts to physics.
      // Our world: 1 tile = 1 unit = 16px. Speed 40 px/tick → 40/16 = 2.5 tiles/tick.
      // At 20 ticks/sec, that's 2.5 * 20 = 50 tiles/sec. Too fast.
      // Taro applies speed/scaleRatio = 40/30 = 1.33 physics units per tick.
      // In our world: 1.33 * (16/30) tiles = 0.71 tiles/tick, at 20Hz = 14.2 tiles/sec.
      // Simplified: speed / 30 gives the physics impulse magnitude.
      const physicsSpeed = speedAttr / 30;

      // Calculate input direction
      let inputX = 0, inputY = 0;
      if (unit._inputKeys.has('w') || unit._inputKeys.has('arrowup')) inputY -= 1;
      if (unit._inputKeys.has('s') || unit._inputKeys.has('arrowdown')) inputY += 1;
      if (unit._inputKeys.has('a') || unit._inputKeys.has('arrowleft')) inputX -= 1;
      if (unit._inputKeys.has('d') || unit._inputKeys.has('arrowright')) inputX += 1;

      // Normalize
      const len = Math.sqrt(inputX * inputX + inputY * inputY);
      if (len > 0) {
        inputX /= len;
        inputY /= len;
      }

      // In taro Box2D: impulse applied = speed / scaleRatio per tick
      // With density=3 and damping=5, we need a stronger push.
      // Taro applies: body.applyImpulse(vel.x, vel.y) where vel = direction * speed / scaleRatio
      // The scaleRatio=30, speed=40 → impulse = 40/30 = 1.33 per tick
      if (movementMethod === 'impulse') {
        if (len > 0) {
          body.applyImpulse(new Vec2(inputX * physicsSpeed, inputY * physicsSpeed));
        }
      } else if (movementMethod === 'force') {
        if (len > 0) {
          body.applyForce(new Vec2(inputX * physicsSpeed * 50, inputY * physicsSpeed * 50));
        }
      } else {
        // velocity — direct set
        body.linearVelocity = new Vec2(inputX * physicsSpeed * 3, inputY * physicsSpeed * 3);
      }
    }
  }

  /** Sync physics body positions back to entity positions */
  private _syncPhysicsToEntities(): void {
    for (const [entityId, body] of this._entityBodies) {
      const entity = this._entities.get(entityId);
      if (!entity) continue;
      const pos = body.position;
      entity.position.x = pos.x;
      entity.position.z = pos.y; // Physics Y → Three.js Z
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

        // Update physics body position to match
        const body = this._entityBodies.get(unitId);
        if (body) {
          body.position = new Vec2(mapW / 2, mapH / 2);
        }
      }
    }

    this._players.set(clientId, { player, clientId, unitId });

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

    // Fire ability scripts
    const typeDef = this.types.get('unitTypes', unit.stats?.type);
    const abilities = (typeDef as any)?.controls?.abilities;
    const binding = abilities?.[data.key];
    const scriptName = isDown ? binding?.keyDown?.scriptName : binding?.keyUp?.scriptName;
    if (scriptName) {
      this.scripts.runScript(scriptName, {
        triggeredBy: { playerId: playerData.player.id, unitId: playerData.unitId },
      });
    }
  }

  private _onPlayerMouseMoved(clientId: string, data: { x: number; y: number }): void {
    const playerData = this._players.get(clientId);
    if (!playerData) return;
    const unit = this._entities.get(playerData.unitId);
    if (unit) unit._mousePosition = data;
  }

  // --- Entity management (public so scripts/physics can use) ---

  spawnUnit(typeId: string, typeDef: Record<string, unknown>, ownerId?: string): Unit {
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

    unit.mount(this.engine.root);
    this._entities.set(unit.id, unit);

    // Create physics body for the unit
    this._createEntityBody(unit.id, unit.position.x, unit.position.z, typeDef as Record<string, any>);

    this._transport.broadcast({
      type: MessageType.EntityCreate,
      data: buildEntityCreatePayload(
        'unit', unit.id, unit.position.x, unit.position.z, 0,
        { ...unit.stats, ...typeDef },
      ),
    });

    this.scripts.trigger('entityCreatedGlobal', { entityId: unit.id, unitId: unit.id });
    return unit;
  }

  private _handleScriptAction(type: string, _action: Record<string, unknown>, _vars: Record<string, unknown>): void {
    // Will be expanded as more actions are wired
    // For now, log unhandled actions for debugging
  }
}
