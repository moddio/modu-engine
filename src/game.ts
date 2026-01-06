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

import { World, EntityBuilder, NetworkInput } from './core/world';
import { Entity } from './core/entity';
import { ComponentType } from './core/component';
import { SystemFn, SystemOptions } from './core/system';
import { Transform2D, Body2D, Player } from './components';
import { SparseSnapshot } from './core/snapshot';
import { QueryIterator } from './core/query';
import { encode, decode } from './codec';
import { loadRandomState, saveRandomState } from './math/random';
import { INDEX_MASK } from './core/constants';

// ==========================================
// Types
// ==========================================

/** Physics system interface */
interface Physics2DLike {
    physicsWorld: any;
    onCollision(typeA: string, typeB: string, handler: (a: Entity, b: Entity) => void): this;
    setGravity(x: number, y: number): this;
    getBody(entity: Entity): any;
    clear(): void;
    wakeAllBodies(): void;
}

/** Network connection interface (from modu-network SDK) */
interface Connection {
    send(data: any): void;
    sendSnapshot(snapshot: any, hash: string, seq?: number, frame?: number): void;
    leaveRoom(): void;
    clientId: string | null;
    totalBytesIn: number;
    totalBytesOut: number;
    bandwidthIn: number;
    bandwidthOut: number;
}

/** Network SDK interface */
interface NetworkSDK {
    connect(roomId: string, options: any): Promise<Connection>;
}

/** Network input from server */
interface ServerInput {
    seq: number;
    clientId: string;
    data: any;
    frame?: number;
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

// Debug flag - set to false for production
const DEBUG_NETWORK = false;

// ==========================================
// Prefab Class
// ==========================================

/**
 * Prefab - spawnable entity definition
 */
export class Prefab {
    constructor(
        private game: Game,
        private typeName: string,
        private builder: EntityBuilder
    ) {}

    /**
     * Spawn a new entity from this prefab.
     */
    spawn(props: Record<string, any> = {}): Entity {
        return this.game.spawn(this.typeName, props);
    }
}

// ==========================================
// Game Class
// ==========================================

/**
 * Game class - main entry point for games using the ECS.
 */
export class Game {
    /** ECS World instance */
    readonly world: World;

    /** Physics system (optional) */
    physics: Physics2DLike | null = null;

    // ==========================================
    // Network State
    // ==========================================

    /** WebSocket connection */
    private connection: Connection | null = null;

    /** Game callbacks */
    private callbacks: GameCallbacks = {};

    /** Connected room ID */
    private connectedRoomId: string | null = null;

    /** Local client ID (string form) */
    private localClientIdStr: string | null = null;

    /** All connected client IDs (in join order for determinism) */
    private connectedClients: string[] = [];

    /** Authority client (first joiner, sends snapshots) */
    private authorityClientId: string | null = null;

    /** Current server frame */
    private currentFrame: number = 0;

    /** Last processed frame (for skipping old frames after catchup) */
    private lastProcessedFrame: number = 0;

    /** Last processed input sequence */
    private lastInputSeq: number = 0;

    /** Server tick rate */
    private serverFps: number = 20;

    /** RequestAnimationFrame handle */
    private gameLoop: number | null = null;

    /** Deferred snapshot flag (send after tick completes) */
    private pendingSnapshotUpload: boolean = false;

    /** Last snapshot info for debug UI */
    private lastSnapshotHash: string | null = null;
    private lastSnapshotFrame: number = 0;
    private lastSnapshotSize: number = 0;
    private lastSnapshotEntityCount: number = 0;

    /** Drift tracking stats for debug UI */
    private driftStats = {
        determinismPercent: 100,
        totalChecks: 0,
        matchingFieldCount: 0,
        totalFieldCount: 0
    };

    /** Divergence tracking */
    private lastSyncPercent: number = 100;
    private firstDivergenceFrame: number | null = null;
    private divergenceHistory: Array<{ frame: number; field: string; local: any; server: any; delta?: number }> = [];
    private recentInputs: Array<{ frame: number; seq: number; clientId: string; data: any }> = [];
    private lastServerSnapshot: { raw: Uint8Array | null; decoded: any; frame: number } = { raw: null, decoded: null, frame: 0 };
    private lastGoodSnapshot: { snapshot: any; frame: number; hash: string } | null = null;
    private divergenceCaptured: boolean = false;
    private divergenceCapture: {
        lastGoodSnapshot: any;
        lastGoodFrame: number;
        inputs: Array<{ frame: number; seq: number; clientId: string; data: any }>;
        localSnapshot: any;
        serverSnapshot: any;
        diffs: Array<{ entity: string; eid: number; comp: string; field: string; local: any; server: any }>;
        divergenceFrame: number;
        clientId: string | null;
        isAuthority: boolean;
    } | null = null;

    /** Tick timing for render interpolation */
    private lastTickTime: number = 0;
    private tickIntervalMs: number = 50; // 20fps default

    // ==========================================
    // String Interning
    // ==========================================

    /** String to ID mapping for clientIds */
    private clientIdToNum: Map<string, number> = new Map();
    private numToClientId: Map<number, string> = new Map();
    private nextClientNum: number = 1;

    /** Prefab registry */
    private prefabs: Map<string, Prefab> = new Map();

    /** Collision handlers (type:type -> handler) */
    private collisionHandlers: Map<string, (a: Entity, b: Entity) => void> = new Map();

    /** Clients that already have entities from snapshot (skip onConnect for them during catchup) */
    private clientsWithEntitiesFromSnapshot: Set<string> = new Set();

    /** Attached renderer */
    private renderer: any = null;

    /** Installed plugins */
    private plugins: Map<string, any> = new Map();

    constructor() {
        this.world = new World();
    }

    // ==========================================
    // Plugin API
    // ==========================================

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
    addPlugin<T>(
        Plugin: new (game: Game, ...args: any[]) => T,
        ...args: any[]
    ): T {
        const plugin = new Plugin(this, ...args);
        const name = Plugin.name || 'anonymous';
        this.plugins.set(name, plugin);
        return plugin;
    }

    /**
     * Get a previously added plugin by class.
     */
    getPlugin<T>(Plugin: new (...args: any[]) => T): T | undefined {
        return this.plugins.get(Plugin.name) as T | undefined;
    }

    /**
     * Current frame number.
     */
    get frame(): number {
        return this.currentFrame;
    }

    /**
     * Deterministic time in milliseconds.
     * Use this instead of Date.now() for game logic.
     *
     * @example
     * const RESPAWN_TIME = 3000; // 3 seconds
     * deadPlayers.set(clientId, game.time + RESPAWN_TIME);
     * if (game.time >= respawnTime) spawnPlayer(clientId);
     */
    get time(): number {
        return this.currentFrame * this.tickIntervalMs;
    }

    // ==========================================
    // Entity Definition API
    // ==========================================

    /**
     * Define a new entity type.
     *
     * @example
     * const Cell = game.defineEntity('cell')
     *     .with(Transform2D)
     *     .with(Body2D, { shapeType: 1, radius: 20 })
     *     .with(Player);
     */
    defineEntity(name: string): GameEntityBuilder {
        return new GameEntityBuilder(this, name);
    }

    /**
     * Register a prefab (internal).
     */
    _registerPrefab(name: string, builder: EntityBuilder): Prefab {
        const prefab = new Prefab(this, name, builder);
        this.prefabs.set(name, prefab);
        return prefab;
    }

    // ==========================================
    // Entity Spawning
    // ==========================================

    /**
     * Spawn an entity.
     *
     * @param type Entity type name
     * @param props Property overrides
     */
    spawn(type: string, props: Record<string, any> = {}): Entity {
        // Convert string clientId to number
        let numericProps = { ...props };
        if (props.clientId && typeof props.clientId === 'string') {
            numericProps.clientId = this.internClientId(props.clientId);
        }

        return this.world.spawn(type, numericProps);
    }

    /**
     * Get a prefab by name.
     */
    getPrefab(name: string): Prefab | undefined {
        return this.prefabs.get(name);
    }

    // ==========================================
    // Query API
    // ==========================================

    /**
     * Query entities by type.
     */
    query(type: string): QueryIterator<Entity> {
        return this.world.query(type);
    }

    /**
     * Get entities by type as array.
     */
    getEntitiesByType(type: string): Entity[] {
        return this.world.query(type).toArray();
    }

    /**
     * Get all entities.
     */
    getAllEntities(): Entity[] {
        return this.world.getAllEntities();
    }

    /**
     * Get entity by client ID.
     */
    getEntityByClientId(clientId: string): Entity | null {
        const numId = this.clientIdToNum.get(clientId);
        if (numId === undefined) return null;
        return this.world.getEntityByClientId(numId);
    }

    /**
     * Get player by client ID (alias for getEntityByClientId).
     */
    getPlayer(clientId: string): Entity | null {
        return this.getEntityByClientId(clientId);
    }

    /**
     * Get all players (entities with Player component).
     */
    getPlayers(): Entity[] {
        return this.world.query(Player).toArray();
    }

    // ==========================================
    // System API
    // ==========================================

    /**
     * Add a system.
     */
    addSystem(fn: SystemFn, options?: SystemOptions): () => void {
        return this.world.addSystem(fn, options);
    }

    // ==========================================
    // Collision API
    // ==========================================

    /**
     * Register a collision handler.
     */
    onCollision(typeA: string, typeB: string, handler: (a: Entity, b: Entity) => void): this {
        if (this.physics) {
            this.physics.onCollision(typeA, typeB, handler);
        } else {
            const key = `${typeA}:${typeB}`;
            this.collisionHandlers.set(key, handler);
        }
        return this;
    }

    // ==========================================
    // String Interning
    // ==========================================

    /**
     * Intern a client ID string, get back a number.
     */
    internClientId(clientId: string): number {
        let num = this.clientIdToNum.get(clientId);
        if (num === undefined) {
            num = this.nextClientNum++;
            this.clientIdToNum.set(clientId, num);
            this.numToClientId.set(num, clientId);
        }
        return num;
    }

    /**
     * Get client ID string from number.
     */
    getClientIdString(num: number): string | undefined {
        return this.numToClientId.get(num);
    }

    /**
     * Intern any string in a namespace.
     */
    internString(namespace: string, str: string): number {
        return this.world.internString(namespace, str);
    }

    /**
     * Get string by ID from namespace.
     */
    getString(namespace: string, id: number): string | null {
        return this.world.getString(namespace, id);
    }

    // ==========================================
    // State Management
    // ==========================================

    /**
     * Get deterministic state hash.
     */
    getStateHash(): string {
        return this.world.getStateHash();
    }

    /**
     * Reset game state.
     */
    reset(): void {
        this.world.reset();
        this.currentFrame = 0;
    }

    // ==========================================
    // Network Connection
    // ==========================================

    /**
     * Connect to a multiplayer room.
     */
    async connect(
        roomId: string,
        callbacks: GameCallbacks,
        options: ConnectOptions = {}
    ): Promise<void> {
        this.callbacks = callbacks;

        // Allow URL params to override (for testing)
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('room')) roomId = params.get('room')!;
            if (params.get('nodeUrl')) options.nodeUrl = params.get('nodeUrl')!;
        }

        this.connectedRoomId = roomId;

        // Get network SDK
        const network: NetworkSDK = (window as any).moduNetwork;
        if (!network) {
            throw new Error('moduNetwork not found. Include modu-network SDK before calling connect().');
        }

        console.log(`[ecs] Connecting to room "${roomId}"...`);

        try {
            this.connection = await network.connect(roomId, {
                nodeUrl: options.nodeUrl,
                centralServiceUrl: options.centralServiceUrl,
                appId: 'dev',
                joinToken: options.joinToken,

                onConnect: (
                    snapshot: any,
                    inputs: ServerInput[],
                    frame: number,
                    nodeUrl: string | null,
                    fps: number,
                    clientId: string
                ) => {
                    this.handleConnect(snapshot, inputs, frame, fps, clientId);
                },

                onTick: (frame: number, inputs: ServerInput[]) => {
                    this.handleTick(frame, inputs);
                },

                onDisconnect: () => {
                    this.handleDisconnect();
                },

                onBinarySnapshot: (data: Uint8Array) => {
                    this.handleServerSnapshot(data);
                },

                onError: (error: string) => {
                    console.error('[ecs] Network error:', error);
                }
            });

            this.localClientIdStr = this.connection.clientId;
        } catch (err: any) {
            console.warn('[ecs] Connection failed:', err?.message || err);
            this.connection = null;
            this.connectedRoomId = null;
        }
    }

    /**
     * Handle initial connection (first join or late join).
     */
    private handleConnect(
        snapshot: any,
        inputs: ServerInput[],
        frame: number,
        fps: number,
        clientId: string
    ): void {
        // Decode binary snapshot if needed
        let snapshotSize = 0;
        if (snapshot instanceof Uint8Array) {
            snapshotSize = snapshot.length;
            if (snapshot.length < 2) {
                snapshot = null;
            } else {
                try {
                    snapshot = decode(snapshot)?.snapshot || null;
                } catch (e) {
                    console.error('[ecs] Failed to decode snapshot:', e);
                    snapshot = null;
                }
            }
        }

        // Store connection state
        this.localClientIdStr = clientId;
        this.serverFps = fps;
        this.tickIntervalMs = 1000 / fps;
        this.currentFrame = frame;

        // Store snapshot hash for debug UI
        if (snapshot?.hash !== undefined) {
            this.lastSnapshotHash = typeof snapshot.hash === 'number'
                ? snapshot.hash.toString(16).padStart(8, '0')
                : String(snapshot.hash);
            this.lastSnapshotFrame = snapshot.frame || frame;
            this.lastSnapshotSize = snapshotSize;
            this.lastSnapshotEntityCount = snapshot.entities?.length || 0;
        }

        if (DEBUG_NETWORK) {
            console.log(`[ecs] Connected as ${clientId}, frame ${frame}, fps ${fps}`);
            console.log(`[ecs] Snapshot:`, snapshot ? { frame: snapshot.frame, entityCount: snapshot.entities?.length } : 'none');
            console.log(`[ecs] Inputs: ${inputs.length}`);
        }

        const hasValidSnapshot = snapshot?.entities && snapshot.entities.length > 0;

        if (hasValidSnapshot) {
            // === LATE JOINER PATH ===
            if (DEBUG_NETWORK) console.log(`[ecs] Late join: restoring snapshot frame=${snapshot.frame}`);

            // 1. Restore snapshot
            this.currentFrame = snapshot.frame || frame;
            this.loadNetworkSnapshot(snapshot);

            // 2. Build authority chain from ALL inputs
            for (const input of inputs) {
                this.processAuthorityChainInput(input);
            }

            // 3. Call onSnapshot callback
            if (this.callbacks.onSnapshot) {
                this.callbacks.onSnapshot(this.world.getAllEntities());
            }

            // 4. Filter inputs already in snapshot
            const snapshotSeq = snapshot.seq || 0;
            const pendingInputs = inputs
                .filter(i => i.seq > snapshotSeq)
                .sort((a, b) => a.seq - b.seq);

            // 5. Run catchup simulation
            const snapshotFrame = this.currentFrame;
            const isPostTick = snapshot.postTick === true;
            const startFrame = isPostTick ? snapshotFrame + 1 : snapshotFrame;
            const ticksToRun = frame - startFrame + 1;

            if (DEBUG_NETWORK) {
                console.log(`[ecs] Catchup: from ${startFrame} to ${frame} (${ticksToRun} ticks), ${pendingInputs.length} pending inputs`);
            }

            if (ticksToRun > 0) {
                this.runCatchup(startFrame, frame, pendingInputs);
            }

            // Store as last good snapshot - we just loaded authority's state
            this.lastGoodSnapshot = {
                snapshot: JSON.parse(JSON.stringify(snapshot)),
                frame: this.currentFrame,
                hash: this.getStateHash()
            };
        } else {
            // === FIRST JOINER PATH ===
            if (DEBUG_NETWORK) console.log('[ecs] First join: creating room');

            this.currentFrame = frame;
            this.callbacks.onRoomCreate?.();

            // Process all inputs
            for (const input of inputs) {
                this.processInput(input);
            }
        }

        // Send initial snapshot if we're authority
        if (this.checkIsAuthority()) {
            this.sendSnapshot('init');
        }

        // Start game loop
        this.startGameLoop();
        if (DEBUG_NETWORK) console.log('[ecs] Game loop started');
    }

    /**
     * Handle server tick.
     */
    private handleTick(frame: number, inputs: ServerInput[]): void {
        // Skip frames we've already processed (e.g., during catchup)
        if (frame <= this.lastProcessedFrame) {
            if (DEBUG_NETWORK) {
                console.log(`[ecs] Skipping old frame ${frame} (already at ${this.lastProcessedFrame})`);
            }
            return;
        }

        this.currentFrame = frame;
        this.lastProcessedFrame = frame;

        if (DEBUG_NETWORK && inputs.length > 0) {
            const types = inputs.map(i => i.data?.type || 'game').join(',');
            console.log(`[ecs] onTick frame=${frame}: ${inputs.length} inputs (${types})`);
        }

        // 1. Process all inputs for this frame (sorted by seq for determinism)
        // Multiple inputs can arrive in a single tick - seq determines order
        const sortedInputs = inputs.length > 1
            ? [...inputs].sort((a, b) => (a.seq || 0) - (b.seq || 0))
            : inputs;
        for (const input of sortedInputs) {
            this.processInput(input);
        }

        // 2. Run ECS world tick (systems)
        this.world.tick(frame, []);

        // 3. Call game's onTick callback
        this.callbacks.onTick?.(frame);

        // 4. Send deferred snapshot if pending
        if (this.pendingSnapshotUpload && this.checkIsAuthority()) {
            this.sendSnapshot('join');
            this.pendingSnapshotUpload = false;
        }

        // 5. Record tick time for interpolation
        this.lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    /**
     * Process a network input (join/leave/game).
     */
    private processInput(input: ServerInput): void {
        // Decode binary data if needed
        let data = input.data;
        if (data instanceof Uint8Array) {
            try {
                data = decode(data);
            } catch (e) {
                console.warn('[ecs] Failed to decode input:', e);
                return;
            }
        }

        const clientId = data?.clientId || input.clientId;
        const type = data?.type;

        // Track input for divergence debugging (keep last 500)
        this.recentInputs.push({
            frame: this.currentFrame,
            seq: input.seq,
            clientId,
            data: JSON.parse(JSON.stringify(data))
        });
        if (this.recentInputs.length > 500) {
            this.recentInputs.shift();
        }

        // Track input sequence
        if (input.seq > this.lastInputSeq) {
            this.lastInputSeq = input.seq;
        }

        if (type === 'join') {
            // Track connected clients
            if (!this.connectedClients.includes(clientId)) {
                this.connectedClients.push(clientId);
            }

            // First joiner becomes authority
            if (this.authorityClientId === null) {
                this.authorityClientId = clientId;
            }

            if (DEBUG_NETWORK) {
                console.log(`[ecs] Join: ${clientId.slice(0, 8)}, authority=${this.authorityClientId?.slice(0, 8)}`);
            }

            // Call callback ONLY if this client doesn't already have an entity from snapshot
            // This prevents duplicate entity creation during catchup
            if (this.clientsWithEntitiesFromSnapshot.has(clientId)) {
                if (DEBUG_NETWORK) {
                    console.log(`[ecs] Skipping onConnect for ${clientId.slice(0, 8)} - already has entity from snapshot`);
                }
            } else {
                this.callbacks.onConnect?.(clientId);
            }

            // Mark snapshot needed
            if (this.checkIsAuthority()) {
                this.pendingSnapshotUpload = true;
            }
        } else if (type === 'leave' || type === 'disconnect') {
            // Remove from connected clients
            const idx = this.connectedClients.indexOf(clientId);
            if (idx !== -1) {
                this.connectedClients.splice(idx, 1);
            }

            // Transfer authority if needed
            if (clientId === this.authorityClientId) {
                this.authorityClientId = this.connectedClients[0] || null;
            }

            if (DEBUG_NETWORK) {
                console.log(`[ecs] Leave: ${clientId.slice(0, 8)}, new authority=${this.authorityClientId?.slice(0, 8)}`);
            }

            // Call callback
            this.callbacks.onDisconnect?.(clientId);
        } else if (data) {
            // Game input - store in world's input registry
            this.routeInputToEntity(clientId, data);
        }
    }

    /**
     * Route game input to the world's input registry for systems to read.
     */
    private routeInputToEntity(clientId: string, data: any): void {
        const numId = this.internClientId(clientId);

        // Use O(1) clientId index lookup instead of iterating
        const entity = this.world.getEntityByClientId(numId);
        if (DEBUG_NETWORK) {
            console.log(`[ecs] routeInput: clientId=${clientId.slice(0, 8)}, numId=${numId}, entity=${entity?.eid || 'null'}, data=${JSON.stringify(data)}`);
        }
        if (entity) {
            // Store input in world's input registry for systems to read
            this.world.setInput(numId, data);
        } else if (DEBUG_NETWORK) {
            console.log(`[ecs] WARNING: No entity for clientId ${clientId.slice(0, 8)} (numId=${numId})`);
        }
    }

    /**
     * Process input for authority chain only (no game logic).
     */
    private processAuthorityChainInput(input: ServerInput): void {
        let data = input.data;
        if (data instanceof Uint8Array) {
            try { data = decode(data); } catch { return; }
        }

        const clientId = data?.clientId || input.clientId;
        const type = data?.type;

        if (type === 'join') {
            if (!this.connectedClients.includes(clientId)) {
                this.connectedClients.push(clientId);
            }
            if (this.authorityClientId === null) {
                this.authorityClientId = clientId;
            }
        } else if (type === 'leave' || type === 'disconnect') {
            const idx = this.connectedClients.indexOf(clientId);
            if (idx !== -1) {
                this.connectedClients.splice(idx, 1);
            }
            if (clientId === this.authorityClientId) {
                this.authorityClientId = this.connectedClients[0] || null;
            }
        }
    }

    /**
     * Run catchup simulation.
     */
    private runCatchup(startFrame: number, endFrame: number, inputs: ServerInput[]): void {
        const ticksToRun = endFrame - startFrame + 1;
        if (DEBUG_NETWORK) {
            console.log(`[ecs] Catchup: ${ticksToRun} ticks from ${startFrame} to ${endFrame}, ${inputs.length} inputs`);
        }

        // CRITICAL: Sort all inputs by seq to ensure correct order within frames
        // Multiple inputs can occur in a single frame - seq determines order
        const sortedInputs = [...inputs].sort((a, b) => (a.seq || 0) - (b.seq || 0));

        // Build map of frame -> inputs for that frame (sorted by seq)
        const inputsByFrame = new Map<number, ServerInput[]>();
        for (const input of sortedInputs) {
            // Inputs without frame are assigned to startFrame (first catchup frame)
            const frame = input.frame ?? startFrame;
            if (!inputsByFrame.has(frame)) {
                inputsByFrame.set(frame, []);
            }
            inputsByFrame.get(frame)!.push(input);
        }

        // Run each tick
        for (let f = 0; f < ticksToRun; f++) {
            const tickFrame = startFrame + f;

            // Process inputs for this frame (already sorted by seq)
            const frameInputs = inputsByFrame.get(tickFrame) || [];
            for (const input of frameInputs) {
                this.processInput(input);
            }

            // Run world tick
            this.world.tick(tickFrame, []);

            // Call game's onTick
            this.callbacks.onTick?.(tickFrame);
        }

        this.currentFrame = endFrame;
        this.lastProcessedFrame = endFrame;  // Prevent re-processing old frames

        // Clear the snapshot entity tracking - catchup is done
        // Future join events should trigger onConnect normally
        this.clientsWithEntitiesFromSnapshot.clear();

        if (DEBUG_NETWORK) {
            console.log(`[ecs] Catchup complete at frame ${this.currentFrame}, hash=${this.getStateHash()}`);
        }
    }

    // ==========================================
    // Snapshot Methods
    // ==========================================

    /**
     * Convert ECS snapshot to network wire format.
     */
    private getNetworkSnapshot(): any {
        // Format 5: Type-indexed encoding with optional syncFields
        // - types: ["snake-head", "snake-segment", ...] - type names array
        // - schema: [[compSchema], [compSchema], ...] - indexed by type index
        // - entities: [[eid, typeIndex, values], ...] - typeIndex instead of string
        // If entity type has syncFields, only those fields are included in schema/values

        // Build type index and schema
        const types: string[] = [];
        const typeToIndex = new Map<string, number>();
        const schema: [string, string[]][][] = [];
        const typeSyncFields = new Map<string, Set<string>>();  // Cache syncFields per type
        const entities: any[] = [];

        for (const entity of this.world.getAllEntities()) {
            const index = entity.eid & INDEX_MASK;
            const type = entity.type;

            // Assign type index if new type
            if (!typeToIndex.has(type)) {
                const typeIdx = types.length;
                types.push(type);
                typeToIndex.set(type, typeIdx);

                // Get syncFields for this type (if defined)
                const entityDef = this.world.getEntityDef(type);
                const syncFieldsSet = entityDef?.syncFields
                    ? new Set(entityDef.syncFields)
                    : null;
                typeSyncFields.set(type, syncFieldsSet!);

                // Build schema for this type (only synced fields)
                const typeSchema: [string, string[]][] = [];
                for (const comp of entity.getComponents()) {
                    const fieldsToSync = syncFieldsSet
                        ? comp.fieldNames.filter(f => syncFieldsSet.has(f))
                        : comp.fieldNames;
                    if (fieldsToSync.length > 0) {
                        typeSchema.push([comp.name, fieldsToSync]);
                    }
                }
                schema.push(typeSchema);
            }

            // Encode values as flat array matching schema order (only synced fields)
            const syncFieldsSet = typeSyncFields.get(type);
            const values: any[] = [];
            for (const comp of entity.getComponents()) {
                for (const fieldName of comp.fieldNames) {
                    // Only include if no syncFields defined OR field is in syncFields
                    if (!syncFieldsSet || syncFieldsSet.has(fieldName)) {
                        values.push(comp.storage.fields[fieldName][index]);
                    }
                }
            }

            entities.push([
                entity.eid,  // eid as number (no need for hex conversion)
                typeToIndex.get(type)!,  // type INDEX (1 byte) instead of string
                values
            ]);
        }

        // Compute minimal ID allocator state from entities
        let maxIndex = 0;
        const activeGenerations: Record<number, number> = {};
        for (const e of entities) {
            const eid = e[0];
            const index = eid & INDEX_MASK;
            const gen = eid >>> 20;
            if (index >= maxIndex) maxIndex = index + 1;
            activeGenerations[index] = gen;
        }

        return {
            frame: this.currentFrame,
            seq: this.lastInputSeq,
            format: 5, // Format 5: type-indexed compact encoding
            types,     // Type names array (sent once)
            schema,    // Component schemas indexed by type index
            entities,  // Array of [eid, typeIndex, values[]]
            idAllocatorState: {
                nextIndex: maxIndex,
                freeList: [],
                generations: activeGenerations
            },
            rng: saveRandomState(),
            strings: this.world.strings.getState(),
            clientIdMap: {
                toNum: Object.fromEntries(this.clientIdToNum),
                nextNum: this.nextClientNum
            },
            inputState: this.world.getInputState()
        };
    }

    /**
     * Load network snapshot into ECS world.
     */
    private loadNetworkSnapshot(snapshot: any): void {
        if (DEBUG_NETWORK) {
            console.log(`[ecs] Loading snapshot: ${snapshot.entities?.length} entities`);
        }

        // Reset world FIRST (clears everything including ID allocator and strings)
        this.world.reset();

        // CRITICAL: Clear physics state before recreating entities
        // Without this, old physics bodies with stale state (positions, sleeping, etc.)
        // would be reused when entities are recreated with the same eids
        if (this.physics) {
            this.physics.clear();
        }

        // Restore RNG state
        if (snapshot.rng) {
            loadRandomState(snapshot.rng);
        }

        // Restore strings AFTER reset
        if (snapshot.strings) {
            this.world.strings.setState(snapshot.strings);
        }

        // Restore clientId interning
        if (snapshot.clientIdMap) {
            this.clientIdToNum = new Map(Object.entries(snapshot.clientIdMap.toNum).map(([k, v]) => [k, v as number]));
            this.numToClientId = new Map(Array.from(this.clientIdToNum.entries()).map(([k, v]) => [v, k]));
            this.nextClientNum = snapshot.clientIdMap.nextNum || 1;
        }

        // Format 5: type-indexed encoding
        const types = snapshot.types;
        const schema = snapshot.schema;
        const entitiesData = snapshot.entities;

        // Track loaded entities by type for onRestore callbacks
        const loadedEntitiesByType = new Map<string, Entity[]>();

        for (const entityData of entitiesData) {
            const [eid, typeIndex, values] = entityData;
            const type = types[typeIndex];
            const typeSchema = schema[typeIndex];

            // Spawn entity with specific eid
            let entity;
            try {
                entity = this.world.spawnWithId(type, eid, {});
            } catch (e) {
                console.warn(`[ecs] Failed to spawn ${type} with eid ${eid}:`, e);
                continue;
            }

            // Track for onRestore callback
            if (!loadedEntitiesByType.has(type)) {
                loadedEntitiesByType.set(type, []);
            }
            loadedEntitiesByType.get(type)!.push(entity);

            // Restore values using schema
            const index = eid & INDEX_MASK;
            let valueIdx = 0;

            for (const [compName, fieldNames] of typeSchema) {
                // Find component on entity
                for (const comp of entity.getComponents()) {
                    if (comp.name === compName) {
                        for (const fieldName of fieldNames) {
                            comp.storage.fields[fieldName][index] = values[valueIdx++];
                        }
                        break;
                    }
                }
            }

            // CRITICAL: Update clientIdIndex for Player entities after component restore
            // The spawnWithId call above didn't have clientId in props, so the index wasn't set
            if (entity.has(Player)) {
                const player = entity.get(Player);
                if (player.clientId !== 0) {
                    this.world.setEntityClientId(entity.eid, player.clientId);
                }
            }
        }

        // Call onRestore callbacks for entity types that have them
        // This allows reconstructing non-synced fields from synced data
        for (const [type, entities] of loadedEntitiesByType) {
            const entityDef = this.world.getEntityDef(type);
            if (entityDef?.onRestore) {
                for (const entity of entities) {
                    entityDef.onRestore(entity, this);
                }
            }
        }

        // Restore input sequence
        this.lastInputSeq = snapshot.seq || 0;

        // Restore ID allocator state for proper future allocations
        // Format 3+: minimal format with generations as object { index: gen }
        // Format 2-: full format with generations as array
        if (snapshot.idAllocatorState) {
            const state = snapshot.idAllocatorState;
            if (snapshot.format >= 3 && typeof state.generations === 'object' && !Array.isArray(state.generations)) {
                // Minimal format - reconstruct full state
                this.world.idAllocator.reset();
                this.world.idAllocator.setNextId(state.nextIndex);
                // Set generations for active entities
                for (const [indexStr, gen] of Object.entries(state.generations)) {
                    const index = parseInt(indexStr, 10);
                    (this.world.idAllocator as any).generations[index] = gen;
                }
                // Compute free list: indices from 0 to nextIndex that aren't in active generations
                const freeList: number[] = [];
                for (let i = 0; i < state.nextIndex; i++) {
                    if (!(i.toString() in state.generations)) {
                        freeList.push(i);
                    }
                }
                (this.world.idAllocator as any).freeList = freeList;
            } else {
                // Legacy full format
                this.world.idAllocator.setState(state);
            }
        }

        // Track which clients already have entities from the snapshot
        // This prevents duplicate entity creation during catchup
        this.clientsWithEntitiesFromSnapshot.clear();
        for (const entity of this.world.query(Player)) {
            const player = entity.get(Player);
            if (player.clientId !== 0) {
                const clientIdStr = this.getClientIdString(player.clientId);
                if (clientIdStr) {
                    this.clientsWithEntitiesFromSnapshot.add(clientIdStr);
                    if (DEBUG_NETWORK) {
                        console.log(`[ecs] Snapshot has entity for client ${clientIdStr.slice(0, 8)}`);
                    }
                }
            }
        }

        // CRITICAL: Wake all physics bodies after snapshot restore
        // Without this, late joiners have awake bodies while existing clients may have
        // sleeping bodies, causing physics simulation divergence after catchup
        if (this.physics) {
            this.physics.wakeAllBodies();
        }

        // CRITICAL: Restore input state so movement systems behave identically
        // Without this, systems that check `game.world.getInput(clientId)` won't find
        // the last input, causing movement to stop on late joiners while authority continues
        if (snapshot.inputState) {
            this.world.setInputState(snapshot.inputState);
        }

        if (DEBUG_NETWORK) {
            console.log(`[ecs] Snapshot loaded: ${this.world.getAllEntities().length} entities, hash=${this.getStateHash()}`);
            // Debug: log first restored entity
            const firstEntity = this.world.getAllEntities()[0];
            if (firstEntity) {
                const components: Record<string, Record<string, any>> = {};
                for (const comp of firstEntity.getComponents()) {
                    const data: Record<string, any> = {};
                    for (const fieldName of comp.fieldNames) {
                        data[fieldName] = (firstEntity.get(comp) as any)[fieldName];
                    }
                    components[comp.name] = data;
                }
                console.log(`[ecs] Restored first entity: type=${firstEntity.type}, components=`, JSON.stringify(components));
            }
        }
    }

    /**
     * Send snapshot to network.
     */
    private sendSnapshot(source: string): void {
        if (!this.connection) return;

        // CRITICAL: Wake all physics bodies when sending snapshot
        // This ensures the authority's bodies are in the same state as the late joiner's
        // bodies will be after they restore and wake. Without this, authority has sleeping
        // bodies while late joiner has awake bodies, causing physics divergence.
        if (this.physics) {
            this.physics.wakeAllBodies();
        }

        const snapshot = this.getNetworkSnapshot();
        const hash = this.world.getStateHash();
        const binary = encode({ snapshot, hash });

        // DEBUG: Log snapshot size breakdown
        const entitiesSize = encode(snapshot.entities).length;
        const schemaSize = encode(snapshot.schema).length;
        const entityCount = snapshot.entities.length;
        console.log(`[SNAPSHOT-SIZE] Total: ${binary.length}B | entities: ${entitiesSize}B (${entityCount}) | schema: ${schemaSize}B`);

        if (DEBUG_NETWORK) {
            console.log(`[ecs] Sending snapshot (${source}): ${binary.length} bytes, ${entityCount} entities, hash=${hash}`);
        }

        this.connection.sendSnapshot(binary, hash, snapshot.seq, snapshot.frame);

        // Update debug UI tracking - show last SENT snapshot for authority
        this.lastSnapshotHash = hash;
        this.lastSnapshotFrame = snapshot.frame;
        this.lastSnapshotSize = binary.length;
        this.lastSnapshotEntityCount = entityCount;
    }

    /**
     * Handle server snapshot (for drift detection).
     */
    private handleServerSnapshot(data: Uint8Array): void {
        if (DEBUG_NETWORK) {
            console.log(`[ecs] Received server snapshot: ${data.length} bytes`);
        }

        // Decode and compare for drift detection
        try {
            const decoded = decode(data);
            const serverSnapshot = decoded?.snapshot;
            const serverHash = decoded?.hash;

            if (serverSnapshot) {
                this.lastSnapshotHash = serverHash;
                this.lastSnapshotFrame = serverSnapshot.frame;
                this.lastSnapshotSize = data.length;
                this.lastSnapshotEntityCount = serverSnapshot.entities?.length || 0;

                // Only compare if frames match - otherwise comparison is meaningless
                if (this.currentFrame === serverSnapshot.frame) {
                    // Field-by-field comparison for drift stats
                    this.compareSnapshotFields(serverSnapshot);

                    // Compare hashes
                    const localHash = this.getStateHash();
                    if (localHash !== serverHash) {
                        console.warn(`[ecs] DRIFT detected at frame ${serverSnapshot.frame}: local=${localHash}, server=${serverHash}`);
                    }
                } else {
                    // Frames don't match - skip comparison (would give false positives)
                    // Reset drift stats since we can't validate
                    this.driftStats = {
                        determinismPercent: 100,
                        totalChecks: 0,
                        matchingFieldCount: 0,
                        totalFieldCount: 0
                    };
                }
            }
        } catch (e) {
            console.warn('[ecs] Failed to decode server snapshot:', e);
        }
    }

    /**
     * Compare server snapshot fields with local state for drift tracking.
     */
    private compareSnapshotFields(serverSnapshot: any): void {
        const frame = serverSnapshot.frame;
        let matchingFields = 0;
        let totalFields = 0;
        const diffs: Array<{ entity: string; eid: number; comp: string; field: string; local: any; server: any }> = [];

        // Store server snapshot for debugging
        this.lastServerSnapshot = { raw: null, decoded: serverSnapshot, frame };

        const types = serverSnapshot.types || [];
        const serverEntities = serverSnapshot.entities || [];
        const schema = serverSnapshot.schema || [];

        // Build map of server entities by eid (numeric)
        const serverEntityMap = new Map<number, any>();
        for (const e of serverEntities) {
            serverEntityMap.set(e[0], e);
        }

        // Compare each local entity with server entity
        for (const entity of this.world.getAllEntities()) {
            const eid = entity.eid;
            const serverEntity = serverEntityMap.get(eid);
            const index = eid & INDEX_MASK;

            if (!serverEntity) {
                for (const comp of entity.getComponents()) {
                    totalFields += comp.fieldNames.length;
                    for (const fieldName of comp.fieldNames) {
                        diffs.push({ entity: entity.type, eid, comp: comp.name, field: fieldName, local: 'EXISTS', server: 'MISSING' });
                    }
                }
                continue;
            }

            const [, typeIndex, serverValues] = serverEntity;
            const typeSchema = schema[typeIndex];

            if (!typeSchema) continue;

            let valueIdx = 0;
            for (const [compName, fieldNames] of typeSchema) {
                const localComp = entity.getComponents().find(c => c.name === compName);

                for (const fieldName of fieldNames) {
                    totalFields++;
                    const serverValue = serverValues[valueIdx++];

                    if (localComp) {
                        const localValue = localComp.storage.fields[fieldName][index];
                        const fieldDef = localComp.schema[fieldName];

                        let valuesMatch = false;
                        if (fieldDef?.type === 'bool') {
                            const localBool = localValue !== 0;
                            const serverBool = serverValue !== 0 && serverValue !== false;
                            valuesMatch = localBool === serverBool;
                        } else {
                            valuesMatch = localValue === serverValue;
                        }

                        if (valuesMatch) {
                            matchingFields++;
                        } else {
                            diffs.push({ entity: entity.type, eid, comp: compName, field: fieldName, local: localValue, server: serverValue });
                        }
                    }
                }
            }
        }

        // Count server entities not in local state
        for (const [eid, serverEntity] of serverEntityMap) {
            if (this.world.getEntity(eid) === null) {
                const [, typeIndex, serverValues] = serverEntity;
                const serverType = types[typeIndex] || `type${typeIndex}`;
                totalFields += serverValues.length;
                diffs.push({ entity: serverType, eid, comp: '*', field: '*', local: 'MISSING', server: 'EXISTS' });
            }
        }

        const newPercent = totalFields > 0 ? (matchingFields / totalFields) * 100 : 100;
        const wasSync = this.lastSyncPercent === 100;
        const isSync = newPercent === 100;

        // Store good snapshot when 100% sync
        if (isSync) {
            this.lastGoodSnapshot = {
                snapshot: JSON.parse(JSON.stringify(serverSnapshot)),
                frame: frame,
                hash: this.getStateHash()
            };
        }

        // First divergence - capture debug data and auto-show
        if (wasSync && !isSync && !this.divergenceCaptured) {
            this.firstDivergenceFrame = frame;
            this.divergenceHistory = [];
            this.divergenceCaptured = true;

            const lastGoodFrame = this.lastGoodSnapshot?.frame ?? 0;
            const inputsInRange = this.recentInputs.filter(i => i.frame > lastGoodFrame && i.frame <= frame);
            const localSnapshot = this.world.getState();

            this.divergenceCapture = {
                lastGoodSnapshot: this.lastGoodSnapshot?.snapshot ?? null,
                lastGoodFrame: lastGoodFrame,
                inputs: inputsInRange,
                localSnapshot: localSnapshot,
                serverSnapshot: serverSnapshot,
                diffs: diffs,
                divergenceFrame: frame,
                clientId: this.localClientIdStr,
                isAuthority: this.checkIsAuthority()
            };

            this.showDivergenceDiff(diffs, inputsInRange, frame);
        }

        this.lastSyncPercent = newPercent;

        // Update drift stats
        this.driftStats.totalChecks++;
        this.driftStats.matchingFieldCount = matchingFields;
        this.driftStats.totalFieldCount = totalFields;
        this.driftStats.determinismPercent = newPercent;

        // Sparse ongoing divergence log (every 60 frames)
        if (diffs.length > 0 && newPercent < 100 && this.divergenceCaptured && frame % 60 === 0) {
            console.warn(`[DIVERGENCE] Frame ${frame}: still diverged (${newPercent.toFixed(1)}% sync, first at ${this.firstDivergenceFrame})`);
        }
    }

    /**
     * Show divergence debug data (auto-called on first divergence).
     */
    private showDivergenceDiff(
        diffs: Array<{ entity: string; eid: number; comp: string; field: string; local: any; server: any }>,
        inputs: Array<{ frame: number; seq: number; clientId: string; data: any }>,
        frame: number
    ): void {
        const lines: string[] = [];
        const lastGoodFrame = this.lastGoodSnapshot?.frame ?? 0;
        const myClientId = this.localClientIdStr || '';

        // Build client legend (assign P1, P2, etc.)
        const clientIds = new Set<string>();
        for (const input of inputs) {
            clientIds.add(input.clientId);
        }
        const clientList = Array.from(clientIds);
        const clientLabels = new Map<string, string>();
        clientList.forEach((cid, i) => {
            const label = cid === myClientId ? 'ME' : `P${i + 1}`;
            clientLabels.set(cid, label);
        });

        // Try to find entity owners (entities with Player component)
        const entityOwners = new Map<number, string>();
        for (const entity of this.world.getAllEntities()) {
            if (entity.has(Player)) {
                const playerData = entity.get(Player);
                const ownerClientId = this.numToClientId.get(playerData.clientId);
                if (ownerClientId) {
                    entityOwners.set(entity.eid, clientLabels.get(ownerClientId) || ownerClientId.slice(0, 8));
                }
            }
        }

        lines.push(`=== DIVERGENCE DEBUG DATA ===`);
        lines.push(`Frame: ${frame} | Last good: ${lastGoodFrame} | Authority: ${this.checkIsAuthority()}`);
        lines.push(`Clients: ${clientList.map(cid => `${clientLabels.get(cid)}=${cid.slice(0, 8)}`).join(', ')}`);
        lines.push(``);

        lines.push(`DIVERGENT FIELDS (${diffs.length}):`);
        for (const d of diffs) {
            const delta = typeof d.local === 'number' && typeof d.server === 'number'
                ? ` Δ${d.local - d.server}`
                : '';
            const owner = entityOwners.get(d.eid);
            const ownerStr = owner ? ` [${owner}]` : '';
            lines.push(`  ${d.entity}#${d.eid.toString(16)}${ownerStr}.${d.comp}.${d.field}: local=${d.local} server=${d.server}${delta}`);
        }
        lines.push(``);

        lines.push(`INPUTS (${inputs.length}):`);
        for (const input of inputs) {
            const label = clientLabels.get(input.clientId) || input.clientId.slice(0, 8);
            lines.push(`  f${input.frame} [${label}]: ${JSON.stringify(input.data)}`);
        }
        lines.push(``);

        if (this.lastGoodSnapshot) {
            const goodEnts = Object.keys(this.lastGoodSnapshot.snapshot.entities || {}).length;
            lines.push(`LAST GOOD SNAPSHOT (f${lastGoodFrame}): ${goodEnts} entities`);
        } else {
            lines.push(`LAST GOOD SNAPSHOT: none (never had 100% sync)`);
        }

        if (this.lastServerSnapshot.decoded) {
            const serverEnts = Object.keys(this.lastServerSnapshot.decoded.entities || {}).length;
            lines.push(`SERVER SNAPSHOT (f${this.lastServerSnapshot.frame}): ${serverEnts} entities`);
        }

        lines.push(`=== END DEBUG DATA ===`);
        lines.push(`To get detailed replay data: game.getDivergenceReplay()`);

        console.error(lines.join('\n'));
    }

    /**
     * Download divergence replay data as JSON.
     */
    getDivergenceReplay(): void {
        if (!this.divergenceCapture) {
            console.warn('[REPLAY] No divergence captured yet.');
            return;
        }

        const json = JSON.stringify(this.divergenceCapture, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `divergence-${this.divergenceCapture.divergenceFrame}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`[REPLAY] Downloaded (${(json.length / 1024).toFixed(1)} KB)`);
    }

    // ==========================================
    // Game Loop
    // ==========================================

    /**
     * Start the render loop.
     */
    private startGameLoop(): void {
        if (this.gameLoop) return;

        let lastSnapshotFrame = 0;
        const SNAPSHOT_INTERVAL = 100; // Every 5 seconds at 20fps

        const loop = () => {
            // Render
            if (this.renderer?.render) {
                this.renderer.render();
            } else if (this.callbacks.render) {
                this.callbacks.render();
            }

            // Periodic snapshot upload (authority only)
            if (this.checkIsAuthority() && this.currentFrame - lastSnapshotFrame >= SNAPSHOT_INTERVAL) {
                this.sendSnapshot('loop');
                lastSnapshotFrame = this.currentFrame;
            }

            this.gameLoop = requestAnimationFrame(loop);
        };

        this.gameLoop = requestAnimationFrame(loop);
    }

    /**
     * Stop the render loop.
     */
    private stopGameLoop(): void {
        if (this.gameLoop) {
            cancelAnimationFrame(this.gameLoop);
            this.gameLoop = null;
        }
    }

    /**
     * Handle disconnect.
     */
    private handleDisconnect(): void {
        if (DEBUG_NETWORK) console.log('[ecs] Disconnected');
        this.stopGameLoop();
    }

    // ==========================================
    // Utility Methods
    // ==========================================

    /**
     * Check if this client is the authority.
     * Handles potential length mismatch between SDK and server client IDs.
     */
    checkIsAuthority(): boolean {
        if (this.localClientIdStr === null || this.authorityClientId === null) {
            return false;
        }
        // Server may send shorter client IDs, compare by prefix
        const minLen = Math.min(this.localClientIdStr.length, this.authorityClientId.length);
        return this.localClientIdStr.substring(0, minLen) === this.authorityClientId.substring(0, minLen);
    }

    /**
     * Check if this client is the authority (public).
     */
    isAuthority(): boolean {
        return this.checkIsAuthority();
    }

    /**
     * Check if connected.
     */
    isConnected(): boolean {
        return this.connection !== null;
    }

    /**
     * Get current frame.
     */
    getFrame(): number {
        return this.currentFrame;
    }

    /**
     * Get server tick rate.
     */
    getServerFps(): number {
        return this.serverFps;
    }

    /**
     * Get render interpolation alpha (0-1).
     */
    getRenderAlpha(): number {
        if (this.lastTickTime === 0) return 1;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = now - this.lastTickTime;
        return Math.min(elapsed / this.tickIntervalMs, 1.0);
    }

    /**
     * Send input to network.
     */
    sendInput(input: any): void {
        if (!this.connection) return;
        const binary = encode(input);
        this.connection.send(binary);
    }

    /**
     * Leave current room.
     */
    leaveRoom(): void {
        if (this.connection) {
            this.connection.leaveRoom();
            this.connection = null;
            this.stopGameLoop();
        }
    }

    /**
     * Get local client ID.
     */
    get localClientId(): string | null {
        return this.localClientIdStr;
    }

    /**
     * Set local client ID.
     */
    setLocalClientId(clientId: string): void {
        this.localClientIdStr = clientId;
        const numId = this.internClientId(clientId);
        this.world.localClientId = numId;
    }

    /**
     * Get room ID.
     */
    getRoomId(): string | null {
        return this.connectedRoomId;
    }

    /**
     * Get last snapshot info.
     */
    getLastSnapshot(): { hash: string | null; frame: number; size: number; entityCount: number } {
        return {
            hash: this.lastSnapshotHash,
            frame: this.lastSnapshotFrame,
            size: this.lastSnapshotSize,
            entityCount: this.lastSnapshotEntityCount
        };
    }

    /**
     * Get connected clients.
     */
    getClients(): string[] {
        return this.connectedClients;
    }

    /**
     * Get client ID (for debug UI).
     */
    getClientId(): string | null {
        return this.localClientIdStr;
    }

    /**
     * Get node URL (for debug UI).
     */
    getNodeUrl(): string | null {
        // Could be tracked from connection, for now return null
        return null;
    }

    /**
     * Get upload rate in bytes/second (for debug UI).
     */
    getUploadRate(): number {
        return this.connection?.bandwidthOut || 0;
    }

    /**
     * Get download rate in bytes/second (for debug UI).
     */
    getDownloadRate(): number {
        return this.connection?.bandwidthIn || 0;
    }

    /**
     * Get drift stats (for debug UI).
     * Authority clients show 100% until they receive a comparison snapshot.
     */
    getDriftStats(): { determinismPercent: number; totalChecks: number; matchingFieldCount: number; totalFieldCount: number } {
        // If no snapshots have been compared yet, assume 100% sync
        // Authority clients are the source of truth, so they're always "in sync"
        if (this.driftStats.totalChecks === 0) {
            const entityCount = this.world.getAllEntities().length;
            // Estimate total fields from local entities if no comparison done yet
            let estimatedFields = 0;
            for (const entity of this.world.getAllEntities()) {
                for (const comp of entity.getComponents()) {
                    estimatedFields += comp.fieldNames.length;
                }
            }
            return {
                determinismPercent: 100,
                totalChecks: 0,
                matchingFieldCount: estimatedFields,
                totalFieldCount: estimatedFields
            };
        }
        return { ...this.driftStats };
    }

    /**
     * Attach a renderer.
     */
    setRenderer(renderer: any): void {
        this.renderer = renderer;
    }

    /**
     * Get canvas from attached renderer.
     */
    getCanvas(): HTMLCanvasElement | null {
        return this.renderer?.element ?? null;
    }
}

// ==========================================
// GameEntityBuilder
// ==========================================

/**
 * Game-specific entity builder with fluent API.
 */
export class GameEntityBuilder {
    private worldBuilder: EntityBuilder;
    private inputCommandsDef: any = null;

    constructor(
        private game: Game,
        private name: string
    ) {
        this.worldBuilder = game.world.defineEntity(name);
    }

    /**
     * Add a component to the entity definition.
     */
    with<T extends Record<string, any>>(
        component: ComponentType<T>,
        defaults?: Partial<T>
    ): this {
        this.worldBuilder.with(component, defaults);
        return this;
    }

    /**
     * Define input commands for this entity type.
     */
    commands(def: any): this {
        this.inputCommandsDef = def;
        return this;
    }

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
    syncOnly(fields: string[]): this {
        this.worldBuilder._setSyncFields(fields);
        return this;
    }

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
    syncNone(): this {
        this.worldBuilder._setSyncFields([]);
        return this;
    }

    /**
     * @deprecated Use syncOnly() instead for clarity
     */
    sync(fields: string[]): this {
        return this.syncOnly(fields);
    }

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
    onRestore(callback: (entity: Entity, game: Game) => void): this {
        this.worldBuilder._setOnRestore(callback);
        return this;
    }

    /**
     * Finalize and register the entity definition.
     */
    register(): Prefab {
        this.worldBuilder._ensureRegistered();
        return this.game._registerPrefab(this.name, this.worldBuilder);
    }
}

// ==========================================
// Factory Function
// ==========================================

/**
 * Initialize a new game instance.
 */
export function createGame(): Game {
    return new Game();
}
