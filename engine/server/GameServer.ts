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

  // Taro Rapier uses _scaleRatio=30 for ALL physics coordinates.
  // Positions, velocities, impulses, collider sizes — all in pixels/30.
  // Our world: 1 tile = 1 unit = 16 pixels.
  // To convert: tile position → physics position = tile * 16 / 30
  // To convert back: physics position → tile = physics * 30 / 16
  private static readonly SCALE_RATIO = 30;
  private static readonly TILE_PX = 16;

  private _tileToPhysics(tile: number): number {
    return tile * GameServer.TILE_PX / GameServer.SCALE_RATIO;
  }

  private _physicsToTile(phys: number): number {
    return phys * GameServer.SCALE_RATIO / GameServer.TILE_PX;
  }

  /** Create static wall bodies from the tilemap wall layer */
  private _createWallBodies(): void {
    if (!this._physics || !this._rawGameData?.map) return;
    const map = this._rawGameData.map;
    const layers = map.layers || [];
    const tileHW = (map.tilewidth || 16) / 2 / GameServer.SCALE_RATIO; // half-extent in physics

    for (const layer of layers) {
      if (layer.name !== 'walls' || !layer.data) continue;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (layer.data[y * map.width + x] === 0) continue;
          // Tile center in pixels, then / scaleRatio for physics coords
          const px = (x + 0.5) * (map.tilewidth || 16) / GameServer.SCALE_RATIO;
          const py = (y + 0.5) * (map.tileheight || 16) / GameServer.SCALE_RATIO;
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

    // Damping — exactly as taro sets it
    body.raw.setLinearDamping(bodyDef.linearDamping ?? 0);
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
  }

  // --- Tick ---

  private _tick(dt: number): void {
    this._tickCount++;

    // Process input → apply forces to physics bodies
    this._processMovement(dt);

    // Step physics with FIXED timestep (prevents jitter from variable dt)
    if (this._physics) {
      const fixedDt = 1000 / this._loop.tickRate; // e.g., 50ms for 20Hz
      this._physics.step(fixedDt);
    }

    // Sync physics positions back to entities
    this._syncPhysicsToEntities();

    // Rotate units to face camera direction (taro: rotateToFaceMouseCursor)
    for (const [, playerData] of this._players) {
      const unit = this._entities.get(playerData.unitId);
      if (unit && unit._cameraYaw !== undefined) {
        const typeDef = this.types.get('unitTypes', unit.stats?.type) as any;
        if (typeDef?.controls?.mouseBehaviour?.rotateToFaceMouseCursor) {
          unit.rotation = unit._cameraYaw;
        }
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
    this._streamTransforms();
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

      // Impulse in physics coordinates = speed / scaleRatio
      // Verified by simulation: gives ~1.4 tiles/sec for speed=40, damping=5
      // which is reasonable walking speed (cross 36-tile map in ~25s)
      const physicsImpulse = moveSpeed / GameServer.SCALE_RATIO;
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
