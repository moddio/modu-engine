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
  private _secondTickAccumMs = 0;

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

    // Propagate tile size to script runtime so pixel-coord positions (from taro) convert correctly.
    this.scripts.actions.mapTilePx = this._tilePx;
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
    return unit;
  }

  private _handleScriptAction(type: string, action: Record<string, unknown>, vars: Record<string, unknown>): void {
    const runner = this.scripts.actions;
    const resolve = (v: unknown): unknown => runner.resolveValue(v, vars);

    switch (type) {
      case 'createUnitAtPosition':
      case 'createEntityForPlayerAtPositionWithDimensions': {
        // Determine which entity map to use and the type ID
        const entityCategory = (action.entityType as string) || 'unitTypes';
        const typeId =
          (resolve(action.unitType) as string) ||
          (resolve(action.entity) as string) ||
          (action.entity as string);
        if (!typeId) return;

        const typeMaps: Record<string, string> = {
          unitTypes: 'unitTypes',
          itemTypes: 'itemTypes',
          propTypes: 'propTypes',
          projectileTypes: 'projectileTypes',
        };
        const typeKey = typeMaps[entityCategory] ?? 'unitTypes';
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

        // Spawn unit via existing path (handles stats, physics, broadcast, entityCreatedGlobal)
        if (typeKey === 'unitTypes') {
          this.spawnUnit(
            typeId,
            typeDef,
            typeof playerId === 'string' ? playerId : '',
            { x: px, z: pz, rotation: angle },
          );
        } else {
          // Generic entity (prop/item/projectile) — broadcast without physics/AI for now
          const entityId = `scr_${Math.random().toString(36).slice(2, 10)}`;
          const classId = typeKey === 'itemTypes' ? 'item' : typeKey === 'propTypes' ? 'prop' : 'projectile';
          this._transport.broadcast({
            type: MessageType.EntityCreate,
            data: buildEntityCreatePayload(classId, entityId, px, pz, angle, { ...(typeDef as Record<string, unknown>) }),
          });
          if (classId === 'item') runner.setLastCreatedUnitId(entityId); // best-effort for get-last
        }
        return;
      }

      default:
        return;
    }
  }
}
