import { Engine } from './Engine';
import { ScriptEngine } from './scripting/ScriptEngine';
import { VariableStore } from './scripting/VariableStore';
import { EntityTypeRegistry } from './game/EntityTypeRegistry';
import { Unit } from './game/Unit';
import { Player } from './game/Player';
import { EventEmitter } from './events/EventEmitter';
import type { GameData, ScriptDef } from './GameLoader';

export interface LocalGameConfig {
  gameData: GameData;
  /** Callback when an entity is created (for renderer to add it) */
  onEntityCreate?: (entity: { id: string; category: string; x: number; y: number; stats: Record<string, unknown> }) => void;
  /** Callback when an entity is destroyed */
  onEntityDestroy?: (entityId: string) => void;
  /** Callback when an entity moves */
  onEntityUpdate?: (entityId: string, x: number, y: number, angle: number) => void;
}

export class LocalGameSession {
  readonly engine: Engine;
  readonly scripts: ScriptEngine;
  readonly types: EntityTypeRegistry;
  readonly events = new EventEmitter();

  private _running = false;
  private _config: LocalGameConfig;
  private _entities = new Map<string, any>();
  private _localPlayer: Player | null = null;
  private _tickInterval: ReturnType<typeof setInterval> | null = null;
  private _tickRate = 20; // Hz

  constructor(config: LocalGameConfig) {
    this._config = config;
    this.engine = Engine.instance();
    this.scripts = new ScriptEngine(this.engine);
    this.types = new EntityTypeRegistry();
  }

  get isRunning(): boolean { return this._running; }
  get localPlayer(): Player | null { return this._localPlayer; }
  get entityCount(): number { return this._entities.size; }

  /** Initialize the game from game data */
  init(): void {
    const data = this._config.gameData;

    // Load settings
    if (typeof data.settings?.frameRate === 'number') {
      this._tickRate = data.settings.frameRate as number;
    }

    // Load entity types
    this.types.load(data.entities);

    // Load variables
    if (data.variables) {
      this.scripts.loadVariables(data.variables as Record<string, { value: unknown; type: string }>);
    }

    // Load scripts
    if (data.scripts) {
      this.scripts.load(data.scripts as Record<string, ScriptDef>);
    }

    // Listen for script actions that create/destroy entities
    this.engine.events.on('scriptAction', (args: unknown) => {
      const [type, action, vars] = args as [string, Record<string, unknown>, Record<string, unknown>];
      this._handleScriptAction(type, action, vars);
    });

    // Handle setEntityAttribute events from ActionRunner
    this.engine.events.on('setEntityAttribute', (args: unknown) => {
      const [entityId, attrId, value] = args as [string, string, number];
      const entity = this._entities.get(entityId);
      if (entity?.stats) {
        const attr = entity.stats[`attr_${attrId}`];
        if (attr) {
          attr.value = Math.max(attr.min, Math.min(attr.max, value));
          if (attr.value <= attr.min) {
            this.scripts.trigger('entityAttributeBecomesZero', { entityId, attributeId: attrId });
          }
          if (attr.value >= attr.max) {
            this.scripts.trigger('entityAttributeBecomesFulll', { entityId, attributeId: attrId });
          }
        }
      }
    });

    this.events.emit('initialized');
  }

  /** Start the game loop and fire gameStart trigger */
  start(): void {
    this._running = true;

    // Fire gameStart trigger
    this.scripts.trigger('gameStart');

    // Start tick loop
    const interval = 1000 / this._tickRate;
    let lastTime = Date.now();

    this._tickInterval = setInterval(() => {
      const now = Date.now();
      const dt = now - lastTime;
      lastTime = now;

      // Regenerate attributes
      for (const [id, entity] of this._entities) {
        const stats = entity.stats;
        if (!stats) continue;
        for (const key of Object.keys(stats)) {
          if (!key.startsWith('attr_')) continue;
          const attr = stats[key];
          if (attr.regenerateSpeed && attr.value < attr.max) {
            attr.value = Math.min(attr.max, attr.value + attr.regenerateSpeed * (dt / 1000));
          }
        }
      }

      this.engine.step(dt);
      this.scripts.actions.run([], {}); // Process any pending actions
    }, interval);

    this.events.emit('started');
  }

  /** Create a local player and spawn their first unit */
  joinAsPlayer(playerName: string = 'Player'): Player {
    const player = new Player('local_player', {
      name: playerName,
      controlledBy: 'human',
      score: 0,
      level: 1,
      coins: 0,
      unitIds: [],
      selectedUnitId: '',
      cameraTrackedUnitId: '',
    });

    player.mount(this.engine.root);
    this._localPlayer = player;
    this._entities.set(player.id, player);

    // Fire playerJoinsGame trigger
    this.scripts.trigger('playerJoinsGame', { playerId: player.id });

    // Spawn a unit for the player using the first available unit type
    const unitTypes = this.types.getAll('unitTypes');
    if (unitTypes.size > 0) {
      const [firstTypeId, firstTypeDef] = unitTypes.entries().next().value;
      this.spawnUnit(firstTypeId, firstTypeDef, player.id);
    }

    this.events.emit('playerJoined', player);
    return player;
  }

  /** Spawn a unit from a type definition */
  spawnUnit(typeId: string, typeDef: Record<string, unknown>, ownerId?: string): Unit {
    const unit = new Unit(undefined, {
      name: (typeDef.name as string) || typeId,
      type: typeId,
      health: (typeDef.attributes as any)?.health?.value ?? 100,
      maxHealth: (typeDef.attributes as any)?.health?.max ?? 100,
      speed: (typeDef.speed as number) || 5,
      ownerId: ownerId || '',
      stateId: 'default',
      isHidden: false,
      opacity: 1,
      flip: 0,
      scale: (typeDef.scale as number) || 1,
    });

    // Load attributes from type definition
    const attrDefs = typeDef.attributes as Record<string, any> | undefined;
    if (attrDefs) {
      for (const [attrId, attrDef] of Object.entries(attrDefs)) {
        (unit.stats as any)[`attr_${attrId}`] = {
          value: attrDef.value ?? 0,
          min: attrDef.min ?? 0,
          max: attrDef.max ?? 100,
          regenerateSpeed: attrDef.regenerateSpeed ?? 0,
          name: attrDef.name ?? attrId,
          color: attrDef.color ?? '#ffffff',
        };
      }
    }

    unit.mount(this.engine.root);
    this._entities.set(unit.id, unit);

    // Notify renderer — include the FULL type definition so renderer has cellSheet, animations, etc.
    this._config.onEntityCreate?.({
      id: unit.id,
      category: 'unit',
      x: unit.position.x,
      y: unit.position.z,
      stats: { ...unit.stats, ...typeDef } as unknown as Record<string, unknown>,
    });

    // If owned by player, track it
    if (ownerId && this._localPlayer && this._localPlayer.id === ownerId) {
      this._localPlayer.addUnit(unit.id);
      this._localPlayer.selectUnit(unit.id);
    }

    // Fire triggers
    this.scripts.trigger('entityCreatedGlobal', { entityId: unit.id, unitId: unit.id });

    this.events.emit('unitSpawned', unit);
    return unit;
  }

  /** Get an entity by ID */
  getEntity(id: string): any {
    return this._entities.get(id);
  }

  /** Handle script actions that affect the game world */
  private _handleScriptAction(type: string, action: Record<string, unknown>, _vars: Record<string, unknown>): void {
    switch (type) {
      case 'createUnitAtPosition': {
        const typeId = action.unitType as string;
        const typeDef = this.types.get('unitTypes', typeId);
        if (typeDef) {
          this.spawnUnit(typeId, typeDef);
        }
        break;
      }
      case 'destroyEntity': {
        const entityId = action.entity as string;
        const entity = this._entities.get(entityId);
        if (entity) {
          entity.destroy();
          this._entities.delete(entityId);
          this._config.onEntityDestroy?.(entityId);
        }
        break;
      }
      // More actions will be added as the engine matures
    }
  }

  /** Stop the game */
  stop(): void {
    this._running = false;
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }

    // Clean up entities
    for (const entity of this._entities.values()) {
      entity.destroy();
    }
    this._entities.clear();
    this._localPlayer = null;

    this.scripts.reset();
    Engine.reset();

    this.events.emit('stopped');
  }
}
