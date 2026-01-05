/**
 * Modu Engine - Deterministic Multiplayer Sync Engine
 *
 * The engine's job:
 * - Sync entities with `.sync` properties across all clients
 * - Process ordered inputs from network
 * - Handle snapshots for late joiners
 *
 * The engine does NOT care about physics. Your game decides what physics
 * (if any) to use. The engine just syncs entity state.
 *
 * Usage:
 *   const engine = new ModuEngine();
 *   await engine.connect('room-id', gameCallbacks);
 */
import { EntityManager } from './entity/entity-manager';
import { EntityBuilder } from './entity/entity-builder';
import { World as ECSWorld, SystemPhase } from './ecs';
import { World2D } from './components/physics2d';
import { World as World3D } from './components/physics3d';
/**
 * Game callbacks for network integration.
 */
export interface GameCallbacks {
    /** Called when a new room is created (first client joins) */
    onRoomCreate(): void;
    /** Called when a client connects (create their player/entities) */
    onConnect?(clientId: string): void;
    /** Called when a client disconnects (clean up their entities) */
    onDisconnect?(clientId: string): void;
    /** Called after snapshot restore with all restored entities */
    onSnapshot?(entities: any[]): void;
    /** @deprecated Use onConnect instead */
    onJoin?(clientId: string): void;
    /** @deprecated Use onDisconnect instead */
    onLeave?(clientId: string): void;
    /** Apply player input (optional - InputComponent handles this automatically) */
    onInput?(clientId: string, input: any): void;
    /** Called each frame tick (optional if using EntityBuilder tick handlers) */
    onTick?(): void;
    /** Render the game (optional, client-side only) */
    render?(): void;
}
export interface RoomInfo {
    id: string;
    clientCount: number;
    authorityNodeId: string;
    createdAt: string;
}
export interface ListRoomsResult {
    rooms: RoomInfo[];
    total: number;
    limit: number;
    offset: number;
}
export interface RandomRoomResult {
    room: {
        id: string;
        clientCount: number;
        authorityNodeId: string;
    };
}
export interface ConnectOptions {
    /** Direct node URL (for development/testing) */
    nodeUrl?: string;
    /** Central service URL */
    centralServiceUrl?: string;
    /** JWT token for authenticated apps */
    joinToken?: string;
}
/**
 * Engine configuration options
 */
export interface ModuEngineOptions {
    /** Physics mode: '2d' or '3d', undefined for no physics */
    physics?: '2d' | '3d';
    /** Gravity (default: { x: 0, y: 0 } for 2D, { x: 0, y: -30, z: 0 } for 3D) */
    gravity?: {
        x: number;
        y: number;
        z?: number;
    };
}
/**
 * ModuEngine - Deterministic Multiplayer Sync Engine
 *
 * Syncs entities across all clients using ordered inputs from the network.
 * Physics-agnostic - your game decides what physics (if any) to use.
 */
export declare class ModuEngine {
    /** Entity manager for synced game objects */
    readonly entityManager: EntityManager;
    /** ECS World (new system) */
    readonly ecs: ECSWorld;
    /** 2D Physics world (if physics: '2d' was specified) */
    readonly world: World2D | null;
    /** 3D Physics world (if physics: '3d' was specified) */
    readonly world3D: World3D | null;
    /** Physics2D system instance */
    private _physics;
    /**
     * Physics2D system - set to enable type-based collision handlers.
     *
     * @example
     * const game = Modu.init();
     * game.physics = new Physics2D({ gravity: { x: 0, y: 0 } });
     *
     * game.physics.onCollision('cell', 'food', (cell, food) => {
     *     cell.body.setRadius(cell.sync.radius + 1);
     *     food.destroy();
     * });
     */
    get physics(): any;
    set physics(physics2d: any);
    private connection;
    private gameCallbacks;
    private localClientId;
    private connectedNodeUrl;
    private connectedAppId;
    private connectedRoomId;
    private lastSnapshotHash;
    private lastSnapshotFrame;
    private currentFrame;
    private lastInputSeq;
    private lastBytesIn;
    private lastBytesOut;
    private lastBandwidthCheck;
    private pendingSnapshotUpload;
    private uploadRate;
    private downloadRate;
    private lastTickTime;
    private tickIntervalMs;
    private gameLoop;
    private totalClients;
    private serverFps;
    private connectedClients;
    private authorityClientId;
    /** Attached renderer (auto-renders each frame) */
    private renderer;
    private lastCheckedSnapshotFrame;
    private driftStats;
    constructor(options?: ModuEngineOptions);
    private getNetworkSDK;
    private trackSent;
    private trackReceived;
    private updateBandwidthRates;
    private doSendSnapshot;
    private getSnapshot;
    private loadSnapshot;
    private updateClientCount;
    private processInput;
    private startGameLoop;
    private stopGameLoop;
    /**
     * Connect to a multiplayer room
     */
    connect(roomId: string, callbacks: GameCallbacks, options?: ConnectOptions): Promise<void>;
    /** Predicted inputs awaiting server confirmation (clientId -> Set of input hashes) */
    private predictedInputs;
    /**
     * Send input to the network (binary encoded).
     *
     * NOTE: Client-side prediction requires proper rollback netcode to work correctly.
     * Without rollback, applying input locally causes desync because inputs get applied
     * at different frames on different clients. For now, inputs are only applied when
     * received from server, ensuring all clients process inputs at the same frame.
     *
     * TODO: Implement proper rollback netcode:
     * 1. Save state before local prediction
     * 2. Apply input locally with estimated server frame
     * 3. On server confirm: if frame differs, rollback and resimulate
     */
    sendInput(input: any): void;
    /**
     * Leave the current room
     */
    leaveRoom(): void;
    /**
     * List available rooms for an app
     */
    listRooms(appId: string, options?: {
        centralServiceUrl?: string;
        limit?: number;
        offset?: number;
    }): Promise<ListRoomsResult>;
    /**
     * Get a random room for matchmaking
     */
    getRandomRoom(appId: string, options?: {
        centralServiceUrl?: string;
        minClients?: number;
        maxClients?: number;
    }): Promise<RandomRoomResult | null>;
    /** Get local client ID */
    getClientId(): string | null;
    /** Get all connected client IDs */
    getClients(): string[];
    /** Check if this client is the snapshot authority */
    isAuthority(): boolean;
    /** Check if connected */
    isConnected(): boolean;
    /** Get server tick rate (fps) */
    getServerFps(): number;
    /** Get connected app ID */
    getAppId(): string | null;
    /** Get connected room ID */
    getRoomId(): string | null;
    /** Get upload bandwidth in bytes per second */
    getUploadRate(): number;
    /** Get download bandwidth in bytes per second */
    getDownloadRate(): number;
    /** Get current frame (server-authoritative) */
    getFrame(): number;
    /**
     * Get render interpolation alpha (0-1).
     * Use this to smoothly interpolate between physics ticks for rendering.
     * Returns 0 at start of tick interval, approaches 1 just before next tick.
     */
    getRenderAlpha(): number;
    /** Get connected node URL */
    getNodeUrl(): string | null;
    /** Get last received snapshot info */
    getLastSnapshot(): {
        hash: string | null;
        frame: number;
    };
    /** Get current state hash (hex string) */
    getStateHash(): string;
    /**
     * Get the local player's entity (entity with InputComponent matching local clientId).
     * Returns null if not found.
     */
    getLocalPlayer(): any;
    /**
     * Get all entities of a specific type.
     * @param type - Entity type (e.g., 'player', 'food', 'bullet')
     * @returns Array of entities (empty if none found)
     */
    getEntitiesByType(type: string): any[];
    /**
     * Get entity by ID.
     * @param id - Entity ID
     * @returns Entity or null if not found
     */
    getEntityById(id: string): any;
    /**
     * Get player entity by client ID.
     * Finds entity with sync.clientId matching the given clientId.
     * @param clientId - Client ID
     * @returns Entity or null if not found
     */
    getPlayer(clientId: string): any;
    /**
     * Get all players.
     * @returns Array of all Player entities
     */
    getPlayers(): any[];
    /**
     * Get all entities.
     * @returns Array of all entities
     */
    getAllEntities(): any[];
    /**
     * Reset all entities (clears the world).
     * Usually called in init() callback.
     */
    reset(): void;
    /**
     * Register entity classes for snapshot restore.
     * Call this before game.connect() with all your entity classes.
     *
     * @param classes - Entity classes to register
     *
     * @example
     * class Cell extends Entity2D { ... }
     * class Food extends Entity2D { ... }
     *
     * game.register(Cell, Food);
     * game.connect('my-game', callbacks);
     */
    register(...classes: Array<new (...args: any[]) => any>): this;
    /**
     * Define an entity type using the builder pattern.
     * Returns an EntityBuilder for fluent configuration.
     *
     * @param type - Entity type name (e.g., 'cell', 'food', 'bullet')
     * @returns EntityBuilder for chaining
     *
     * @example
     * const Cell = game.defineEntity('cell')
     *     .with(Body2D, { shape: 'circle', radius: 20 })
     *     .sync({ clientId: null, color: null })
     *     .tick((entity, frame) => {
     *         const target = game.getPlayer(entity.sync.clientId)?.input?.target;
     *         if (target) entity.moveToward(target.x, target.y, 5);
     *     })
     *     .build();
     *
     * // Spawn entities
     * Cell.spawn({ x: 100, y: 200, clientId: 'abc' });
     */
    defineEntity(type: string): EntityBuilder;
    /**
     * Add a system to run every tick.
     * Systems are functions that operate on entities.
     *
     * @param fn System function
     * @param options System options (phase, client/server, order)
     * @returns Function to remove the system
     *
     * @example
     * // Movement system
     * game.addSystem(() => {
     *     for (const entity of game.query('cell')) {
     *         const target = entity.input?.target;
     *         if (target) {
     *             entity.moveToward(target.x, target.y, 5);
     *         }
     *     }
     * });
     *
     * // Render system (client only)
     * game.addSystem(() => {
     *     for (const entity of game.query('cell')) {
     *         ctx.fillStyle = entity.sync.color;
     *         ctx.beginPath();
     *         ctx.arc(entity.render.interpX, entity.render.interpY, entity.sync.radius, 0, Math.PI * 2);
     *         ctx.fill();
     *     }
     * }, { phase: 'render' });
     */
    addSystem(fn: () => void, options?: {
        phase?: SystemPhase;
        client?: boolean;
        server?: boolean;
        order?: number;
    }): () => void;
    /**
     * Query entities by type or component.
     *
     * @param typeOrComponent Entity type name or component
     * @returns Query iterator
     *
     * @example
     * // Query by type
     * for (const cell of game.query('cell')) {
     *     cell.get(Body2D).x += 1;
     * }
     *
     * // Get count
     * const foodCount = game.query('food').count();
     *
     * // Get first entity
     * const player = game.query('player').first();
     */
    query(typeOrComponent: string | any): import("./ecs").QueryIterator<import("./ecs").Entity>;
    /**
     * Spawn an entity by type name.
     *
     * @param type Entity type name
     * @param data Initial component data
     * @returns The spawned entity
     *
     * @example
     * game.spawn('cell', { x: 100, y: 200, clientId: 'abc' });
     */
    spawn(type: string, data?: Record<string, any>): import("./ecs").Entity;
    /**
     * Attach a renderer for auto-rendering each frame.
     * Called automatically by CanvasRenderer constructor.
     */
    setRenderer(renderer: any): void;
    /**
     * Get the canvas element from attached renderer.
     * Used by InputComponent for auto-binding mouse input.
     */
    getCanvas(): HTMLCanvasElement | null;
    /**
     * Check for state drift against server snapshot.
     * Compares actual field values for meaningful determinism %.
     */
    private compareWithServerSnapshot;
    /**
     * Compare two snapshot entity states field-by-field.
     */
    private compareSnapshots;
    /**
     * Compare two values for equality (handles objects/arrays).
     */
    private valuesEqual;
    /**
     * Format a value for display in drift logs.
     */
    private formatValue;
    /**
     * Get determinism percentage based on field-by-field comparison.
     */
    getDeterminismPercent(): number;
    /**
     * Get drift statistics for debug UI.
     */
    getDriftStats(): {
        totalChecks: number;
        matchingFieldCount: number;
        totalFieldCount: number;
        determinismPercent: number;
        lastCheckFrame: number;
        lastDriftedFields: string[];
    };
}
