/**
 * Game - High-level wrapper for ECS World with Network Integration
 *
 * Provides the game API that examples use:
 * - game.defineEntity(name) → EntityBuilder
 * - game.spawn(type, props) → Entity
 * - game.query(type) → Iterator
 * - game.addSystem(fn, options)
 * - game.physics → Physics2D integration
 * - game.connect() → Network connection with rollback sync
 */
import { World, EntityBuilder } from './world';
import { Entity } from './entity';
import { ComponentType } from './component';
import { SystemFn, SystemOptions } from './system';
import { QueryIterator } from './query';
/** Physics system interface */
interface Physics2DLike {
    physicsWorld: any;
    onCollision(typeA: string, typeB: string, handler: (a: Entity, b: Entity) => void): this;
    setGravity(x: number, y: number): this;
    getBody(entity: Entity): any;
    clear(): void;
    wakeAllBodies(): void;
}
/** Game callbacks for lifecycle events */
export interface GameCallbacks {
    /** Called when room is first created (first client joins) */
    onRoomCreate?(): void;
    /** Called when a client connects */
    onConnect?(clientId: string): void;
    /** Called when a client disconnects */
    onDisconnect?(clientId: string): void;
    /** Called after snapshot restore with all restored entities */
    onSnapshot?(entities: Entity[]): void;
    /** Called each game tick */
    onTick?(frame: number): void;
    /** Called each render frame */
    render?(): void;
}
/** Connection options */
export interface ConnectOptions {
    /** Direct node URL (bypasses central service) */
    nodeUrl?: string;
    /** Central service URL */
    centralServiceUrl?: string;
    /** JWT token for authentication */
    joinToken?: string;
}
/**
 * Prefab - spawnable entity definition
 */
export declare class Prefab {
    private game;
    private typeName;
    private builder;
    constructor(game: Game, typeName: string, builder: EntityBuilder);
    /**
     * Spawn a new entity from this prefab.
     */
    spawn(props?: Record<string, any>): Entity;
}
/**
 * Game class - main entry point for games using the ECS.
 */
export declare class Game {
    /** ECS World instance */
    readonly world: World;
    /** Physics system (optional) */
    physics: Physics2DLike | null;
    /** WebSocket connection */
    private connection;
    /** Game callbacks */
    private callbacks;
    /** Connected room ID */
    private connectedRoomId;
    /** Local client ID (string form) */
    private localClientIdStr;
    /** All connected client IDs (in join order for determinism) */
    private connectedClients;
    /** Authority client (first joiner, sends snapshots) */
    private authorityClientId;
    /** Current server frame */
    private currentFrame;
    /** Last processed frame (for skipping old frames after catchup) */
    private lastProcessedFrame;
    /** Last processed input sequence */
    private lastInputSeq;
    /** Server tick rate */
    private serverFps;
    /** RequestAnimationFrame handle */
    private gameLoop;
    /** Deferred snapshot flag (send after tick completes) */
    private pendingSnapshotUpload;
    /** Last snapshot info for debug UI */
    private lastSnapshotHash;
    private lastSnapshotFrame;
    private lastSnapshotSize;
    private lastSnapshotEntityCount;
    /** Drift tracking stats for debug UI */
    private driftStats;
    /** Tick timing for render interpolation */
    private lastTickTime;
    private tickIntervalMs;
    /** String to ID mapping for clientIds */
    private clientIdToNum;
    private numToClientId;
    private nextClientNum;
    /** Prefab registry */
    private prefabs;
    /** Collision handlers (type:type -> handler) */
    private collisionHandlers;
    /** Clients that already have entities from snapshot (skip onConnect for them during catchup) */
    private clientsWithEntitiesFromSnapshot;
    /** Attached renderer */
    private renderer;
    /** Installed plugins */
    private plugins;
    constructor();
    /**
     * Add a plugin to the game.
     *
     * Plugins can be classes or factory functions that integrate with the game.
     * Common plugins include Physics2DSystem and AutoRenderer.
     *
     * @example
     * const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });
     * game.addPlugin(AutoRenderer, canvas);
     *
     * @param Plugin - Plugin class or factory
     * @param args - Arguments to pass to the plugin constructor
     * @returns The created plugin instance
     */
    addPlugin<T>(Plugin: new (game: Game, ...args: any[]) => T, ...args: any[]): T;
    /**
     * Get a previously added plugin by class.
     */
    getPlugin<T>(Plugin: new (...args: any[]) => T): T | undefined;
    /**
     * Current frame number.
     */
    get frame(): number;
    /**
     * Define a new entity type.
     *
     * @example
     * const Cell = game.defineEntity('cell')
     *     .with(Transform2D)
     *     .with(Body2D, { shapeType: 1, radius: 20 })
     *     .with(Player);
     */
    defineEntity(name: string): GameEntityBuilder;
    /**
     * Register a prefab (internal).
     */
    _registerPrefab(name: string, builder: EntityBuilder): Prefab;
    /**
     * Spawn an entity.
     *
     * @param type Entity type name
     * @param props Property overrides
     */
    spawn(type: string, props?: Record<string, any>): Entity;
    /**
     * Get a prefab by name.
     */
    getPrefab(name: string): Prefab | undefined;
    /**
     * Query entities by type.
     */
    query(type: string): QueryIterator<Entity>;
    /**
     * Get entities by type as array.
     */
    getEntitiesByType(type: string): Entity[];
    /**
     * Get all entities.
     */
    getAllEntities(): Entity[];
    /**
     * Get entity by client ID.
     */
    getEntityByClientId(clientId: string): Entity | null;
    /**
     * Get player by client ID (alias for getEntityByClientId).
     */
    getPlayer(clientId: string): Entity | null;
    /**
     * Get all players (entities with Player component).
     */
    getPlayers(): Entity[];
    /**
     * Add a system.
     */
    addSystem(fn: SystemFn, options?: SystemOptions): () => void;
    /**
     * Register a collision handler.
     */
    onCollision(typeA: string, typeB: string, handler: (a: Entity, b: Entity) => void): this;
    /**
     * Intern a client ID string, get back a number.
     */
    internClientId(clientId: string): number;
    /**
     * Get client ID string from number.
     */
    getClientIdString(num: number): string | undefined;
    /**
     * Intern any string in a namespace.
     */
    internString(namespace: string, str: string): number;
    /**
     * Get string by ID from namespace.
     */
    getString(namespace: string, id: number): string | null;
    /**
     * Get deterministic state hash.
     */
    getStateHash(): string;
    /**
     * Reset game state.
     */
    reset(): void;
    /**
     * Connect to a multiplayer room.
     */
    connect(roomId: string, callbacks: GameCallbacks, options?: ConnectOptions): Promise<void>;
    /**
     * Handle initial connection (first join or late join).
     */
    private handleConnect;
    /**
     * Handle server tick.
     */
    private handleTick;
    /**
     * Process a network input (join/leave/game).
     */
    private processInput;
    /**
     * Route game input to the entity's InputState component.
     */
    private routeInputToEntity;
    /**
     * Process input for authority chain only (no game logic).
     */
    private processAuthorityChainInput;
    /**
     * Run catchup simulation.
     */
    private runCatchup;
    /**
     * Convert ECS snapshot to network wire format.
     */
    private getNetworkSnapshot;
    /**
     * Load network snapshot into ECS world.
     */
    private loadNetworkSnapshot;
    /**
     * Send snapshot to network.
     */
    private sendSnapshot;
    /**
     * Handle server snapshot (for drift detection).
     */
    private handleServerSnapshot;
    /**
     * Compare server snapshot fields with local state for drift tracking.
     * Format 4: schema-based encoding where entities = [[eid, type, values[]], ...]
     */
    private compareSnapshotFields;
    /**
     * Start the render loop.
     */
    private startGameLoop;
    /**
     * Stop the render loop.
     */
    private stopGameLoop;
    /**
     * Handle disconnect.
     */
    private handleDisconnect;
    /**
     * Check if this client is the authority.
     * Handles potential length mismatch between SDK and server client IDs.
     */
    checkIsAuthority(): boolean;
    /**
     * Check if this client is the authority (public).
     */
    isAuthority(): boolean;
    /**
     * Check if connected.
     */
    isConnected(): boolean;
    /**
     * Get current frame.
     */
    getFrame(): number;
    /**
     * Get server tick rate.
     */
    getServerFps(): number;
    /**
     * Get render interpolation alpha (0-1).
     */
    getRenderAlpha(): number;
    /**
     * Send input to network.
     */
    sendInput(input: any): void;
    /**
     * Leave current room.
     */
    leaveRoom(): void;
    /**
     * Get local client ID.
     */
    get localClientId(): string | null;
    /**
     * Set local client ID.
     */
    setLocalClientId(clientId: string): void;
    /**
     * Get room ID.
     */
    getRoomId(): string | null;
    /**
     * Get last snapshot info.
     */
    getLastSnapshot(): {
        hash: string | null;
        frame: number;
        size: number;
        entityCount: number;
    };
    /**
     * Get connected clients.
     */
    getClients(): string[];
    /**
     * Get client ID (for debug UI).
     */
    getClientId(): string | null;
    /**
     * Get node URL (for debug UI).
     */
    getNodeUrl(): string | null;
    /**
     * Get upload rate in bytes/second (for debug UI).
     */
    getUploadRate(): number;
    /**
     * Get download rate in bytes/second (for debug UI).
     */
    getDownloadRate(): number;
    /**
     * Get drift stats (for debug UI).
     * Authority clients show 100% until they receive a comparison snapshot.
     */
    getDriftStats(): {
        determinismPercent: number;
        totalChecks: number;
        matchingFieldCount: number;
        totalFieldCount: number;
    };
    /**
     * Attach a renderer.
     */
    setRenderer(renderer: any): void;
    /**
     * Get canvas from attached renderer.
     */
    getCanvas(): HTMLCanvasElement | null;
}
/**
 * Game-specific entity builder with fluent API.
 */
export declare class GameEntityBuilder {
    private game;
    private name;
    private worldBuilder;
    private inputCommandsDef;
    constructor(game: Game, name: string);
    /**
     * Add a component to the entity definition.
     */
    with<T extends Record<string, any>>(component: ComponentType<T>, defaults?: Partial<T>): this;
    /**
     * Define input commands for this entity type.
     */
    commands(def: any): this;
    /**
     * Finalize and register the entity definition.
     */
    register(): Prefab;
}
/**
 * Initialize a new game instance.
 */
export declare function createGame(): Game;
export {};
