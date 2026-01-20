/**
 * Game - High-level wrapper for ECS World with Network Integration
 *
 * Provides the game API that examples use:
 * - game.defineEntity(name) → EntityBuilder
 * - game.spawn(type, props) → Entity
 * - game.query(type) → Iterator
 * - game.addSystem(fn, options)
 * - game.physics → Physics2D integration
 * - game.connect() → Network connection with distributed state sync
 */
import { World, EntityBuilder } from './core/world';
import { Entity } from './core/entity';
import { ComponentType } from './core/component';
import { SystemFn, SystemOptions } from './core/system';
import { QueryIterator } from './core/query';
/** Physics system interface */
interface Physics2DLike {
    physicsWorld: any;
    onCollision(typeA: string, typeB: string, handler: (a: Entity, b: Entity) => void): this;
    setGravity(x: number, y: number): this;
    getBody(entity: Entity): any;
    clear(): void;
    wakeAllBodies(): void;
    syncAllFromComponents(): void;
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
    /** Flag: local room was created before server connected (for local-first) */
    private localRoomCreated;
    /** Flag: game has been started (via start() or connect()) */
    private gameStarted;
    /** Last snapshot info for debug UI */
    private lastSnapshotHash;
    private lastSnapshotFrame;
    private lastSnapshotSize;
    private lastSnapshotEntityCount;
    private snapshotLoadedFrame;
    /** Drift tracking stats for debug UI */
    private driftStats;
    /** Divergence tracking */
    private lastSyncPercent;
    private firstDivergenceFrame;
    private divergenceHistory;
    private recentInputs;
    private lastServerSnapshot;
    private lastGoodSnapshot;
    private divergenceCaptured;
    private divergenceCapture;
    /** Tick timing for render interpolation */
    private lastTickTime;
    private tickIntervalMs;
    /** Current reliability scores from server (clientId -> score) */
    private reliabilityScores;
    /** Reliability scores version (for change detection) */
    private reliabilityVersion;
    /** Active client list (sorted, for deterministic partition assignment) */
    private activeClients;
    /** Previous snapshot for delta computation */
    private prevSnapshot;
    /** State sync enabled flag */
    private stateSyncEnabled;
    /** Delta bandwidth tracking */
    private deltaBytesThisSecond;
    private deltaBytesPerSecond;
    private deltaBytesSampleTime;
    /** Desync tracking for hash-based sync */
    private isDesynced;
    private desyncFrame;
    private desyncLocalHash;
    private desyncMajorityHash;
    private resyncPending;
    /** Hash comparison stats (rolling window) */
    private hashChecksPassed;
    private hashChecksFailed;
    /** State hash history for desync comparison (frame -> hash) */
    private stateHashHistory;
    private readonly HASH_HISTORY_SIZE;
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
    /** ClientIds that were in the snapshot's clientIdMap (includes clients who joined then left) */
    private clientIdsFromSnapshotMap;
    /** ClientIds that have DISCONNECT inputs during current catchup (for robust stale JOIN detection) */
    private clientsWithDisconnectInCatchup;
    /** Seq of the loaded snapshot - JOINs with seq <= this are already in snapshot */
    private loadedSnapshotSeq;
    /** True when we're running catchup simulation (only then should we filter JOINs by seq) */
    private inCatchupMode;
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
     * Deterministic time in milliseconds.
     * Use this instead of Date.now() for game logic.
     *
     * @example
     * const RESPAWN_TIME = 3000; // 3 seconds
     * deadPlayers.set(clientId, game.time + RESPAWN_TIME);
     * if (game.time >= respawnTime) spawnPlayer(clientId);
     */
    get time(): number;
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
     * Creates a new mapping if one doesn't exist.
     */
    internClientId(clientId: string): number;
    /**
     * Get the numeric ID for a client ID string WITHOUT creating a new mapping.
     * Returns undefined if the clientId hasn't been interned yet.
     * Use this in onDisconnect to avoid creating orphan mappings.
     */
    getClientIdNum(clientId: string): number | undefined;
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
     * Returns 4-byte unsigned integer (xxhash32).
     */
    getStateHash(): number;
    /**
     * Get deterministic state hash as hex string (for debugging).
     * @deprecated Use getStateHash() which returns a number.
     */
    getStateHashHex(): string;
    /**
     * Reset game state.
     */
    reset(): void;
    /**
     * Configure the game with callbacks.
     *
     * This method stores callbacks but does NOT start the game.
     * Use this when you want to configure callbacks separately from starting.
     *
     * @example
     * game.init({
     *     onRoomCreate() { spawnFood(); },
     *     onConnect(clientId) { spawnPlayer(clientId); }
     * });
     * game.start();  // Start locally
     * // Later...
     * game.connect(roomId);  // Connect to server
     *
     * @param callbacks Game lifecycle callbacks
     * @returns The game instance for chaining
     */
    init(callbacks: GameCallbacks): this;
    /**
     * Start the game locally (offline mode).
     *
     * Use this for single-player or when you want to start the game
     * before connecting to a server. The game will simulate locally
     * at the configured tick rate.
     *
     * If you later call connect(), the local state will be REPLACED
     * by the server state (clean handoff, no merge).
     *
     * @param callbacks Optional callbacks (onTick, render, etc.). If provided,
     *                  these are merged with any callbacks set via init().
     */
    start(callbacks?: GameCallbacks): void;
    /**
     * Connect to a multiplayer room.
     *
     * Can be called in several ways:
     *
     * **Mode 1: Online-only (callbacks in connect)**
     * ```js
     * game.connect(roomId, {
     *     onRoomCreate() { spawnFood(); },
     *     onConnect(clientId) { spawnPlayer(clientId); }
     * });
     * ```
     * This auto-starts locally, then connects to server.
     *
     * **Mode 2: Local-first with seamless transition**
     * ```js
     * game.init({ onRoomCreate, onConnect });
     * game.start();  // Play locally immediately
     * game.connect(roomId);  // Server state replaces local state
     * ```
     *
     * **Mode 3: Using options parameter**
     * ```js
     * game.connect(roomId, { onRoomCreate, onConnect }, { nodeUrl: '...' });
     * ```
     *
     * When called after start(), the local state is FLUSHED and REPLACED with server state.
     * This is a clean handoff - no state merging.
     *
     * @param roomId The room to connect to
     * @param callbacksOrOptions Either GameCallbacks or ConnectOptions
     * @param options ConnectOptions (only if second param is callbacks)
     */
    connect(roomId: string, callbacksOrOptions?: GameCallbacks | ConnectOptions, options?: ConnectOptions): Promise<void>;
    /**
     * Handle reliability score update from server.
     */
    private handleReliabilityUpdate;
    /**
     * Handle majority hash from server (for desync detection).
     */
    private handleMajorityHash;
    /**
     * Handle resync snapshot from authority (hard recovery after desync).
     * This compares state, logs detailed diff, then replaces local state.
     */
    private handleResyncSnapshot;
    /**
     * Log detailed diff between local state and authority snapshot.
     * Called during resync to help diagnose what went wrong.
     */
    /**
     * Dump local state for debugging when desync is detected.
     * Compare output between browser tabs to find differences.
     */
    private dumpLocalStateForDebug;
    private logDesyncDiff;
    /**
     * Handle initial connection (first join or late join).
     */
    private handleConnect;
    /**
     * Handle server tick.
     */
    private handleTick;
    /**
     * Send state synchronization data after tick.
     * Sends stateHash to server, and partition data if this client is assigned.
     */
    private sendStateSync;
    /**
     * Process a network input (join/leave/game).
     */
    private processInput;
    /**
     * Route game input to the world's input registry for systems to read.
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
     */
    private compareSnapshotFields;
    /**
     * Show divergence debug data (auto-called on first divergence).
     */
    private showDivergenceDiff;
    /**
     * Download divergence replay data as JSON.
     */
    getDivergenceReplay(): void;
    /**
     * Start the game loop (render + local simulation when offline).
     *
     * When connected to server: server TICK messages drive simulation via handleTick().
     * When offline: simulation ticks locally at tickRate.
     */
    private startGameLoop;
    /**
     * Stop the render loop.
     */
    private stopGameLoop;
    /**
     * Handle disconnect from server.
     *
     * Fires the onDisconnect callback with no clientId (network disconnect, not player leave).
     * The game loop continues running - the game can decide how to handle this:
     * - Continue playing locally (single-player mode)
     * - Show a reconnect UI
     * - Pause the game
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
     * Check if game has been started (via start() or connect()).
     */
    isStarted(): boolean;
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
     * Leave current room and stop the game.
     */
    leaveRoom(): void;
    /**
     * Stop the game loop.
     *
     * Use this to pause or end the game. The game state is preserved.
     * Call start() or connect() to resume.
     */
    stop(): void;
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
        hash: number | null;
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
     * Get hash-based sync stats (for debug UI).
     * Returns the rolling percentage of hash checks that passed.
     */
    getSyncStats(): {
        syncPercent: number;
        passed: number;
        failed: number;
        isDesynced: boolean;
        resyncPending: boolean;
    };
    /**
     * Attach a renderer.
     */
    setRenderer(renderer: any): void;
    /**
     * Get canvas from attached renderer.
     */
    getCanvas(): HTMLCanvasElement | null;
    /**
     * Get reliability scores (for debug UI).
     */
    getReliabilityScores(): Record<string, number>;
    /**
     * Get active clients list (for debug UI).
     */
    getActiveClients(): string[];
    /**
     * Get local world entity count (for debug UI).
     */
    getEntityCount(): number;
    /**
     * Get state sync delta bandwidth in bytes/second (for debug UI).
     */
    getDeltaBandwidth(): number;
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
     * Specify which fields to sync in snapshots (field-level sync).
     * Only the specified fields are included in network snapshots.
     *
     * Use this to reduce bandwidth by only syncing essential fields.
     * Non-synced fields can be reconstructed via onRestore().
     *
     * @example
     * game.defineEntity('snake-segment')
     *     .with(Transform2D)
     *     .with(Sprite)
     *     .with(SnakeSegment)
     *     .syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])
     *     .register();
     */
    syncOnly(fields: string[]): this;
    /**
     * Exclude all fields from syncing for this entity type.
     * The entity will not be included in network snapshots at all.
     *
     * Use this for purely client-local entities like cameras, UI, or effects.
     *
     * @example
     * game.defineEntity('local-camera')
     *     .with(Camera2D)
     *     .syncNone()
     *     .register();
     */
    syncNone(): this;
    /**
     * @deprecated Use syncOnly() instead for clarity
     */
    sync(fields: string[]): this;
    /**
     * Set a callback to reconstruct non-synced fields after snapshot load.
     * Called for each entity of this type after loading a snapshot.
     *
     * @example
     * game.defineEntity('snake-segment')
     *     .with(Transform2D)
     *     .with(Sprite)
     *     .with(SnakeSegment)
     *     .syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])
     *     .onRestore((entity, game) => {
     *         const owner = game.world.getEntityByClientId(entity.get(SnakeSegment).ownerId);
     *         if (owner) {
     *             entity.get(Sprite).color = owner.get(Sprite).color;
     *             entity.get(Sprite).radius = SEGMENT_RADIUS;
     *         }
     *     })
     *     .register();
     */
    onRestore(callback: (entity: Entity, game: Game) => void): this;
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
