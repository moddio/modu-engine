import { Engine } from '../core/Engine';
import { ScriptEngine } from '../core/scripting/ScriptEngine';
import { EntityTypeRegistry } from '../core/game/EntityTypeRegistry';
import { Unit } from '../core/game/Unit';
import { Player } from '../core/game/Player';
import { GameLoop } from './GameLoop';
import { MessageType, encodeTransform } from '../core/protocol/Messages';
import { buildEntityCreatePayload } from '../core/protocol/EntityStream';
import type { ServerTransport } from './transport/ServerTransport';
import type { GameMessage } from '../core/protocol/Messages';
import type { GameData, ScriptDef } from '../core/GameLoader';

export class GameServer {
  readonly engine: Engine;
  readonly scripts: ScriptEngine;
  readonly types: EntityTypeRegistry;
  private _transport: ServerTransport;
  private _loop: GameLoop;
  private _gameData: GameData | null = null;
  private _entities = new Map<string, any>();
  private _players = new Map<string, { player: Player; clientId: string; unitId: string }>();
  private _tickCount = 0;

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

  init(gameData: GameData): void {
    this._gameData = gameData;
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

  start(): void {
    this.scripts.trigger('gameStart');
    this._loop.start();
  }

  stop(): void {
    this._loop.stop();
    for (const entity of this._entities.values()) {
      if (entity.destroy) entity.destroy();
    }
    this._entities.clear();
    this._players.clear();
    this.scripts.reset();
    Engine.reset();
  }

  /** Get an entity by ID */
  getEntity(id: string): any {
    return this._entities.get(id);
  }

  // --- Tick ---

  private _tick(dt: number): void {
    this._tickCount++;
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
