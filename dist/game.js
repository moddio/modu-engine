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
import { World, LOCAL_ENTITY_BIT } from './core/world';
import { Player } from './components';
import { encode, decode } from './codec';
import { loadRandomState, saveRandomState } from './math/random';
import { INDEX_MASK } from './core/constants';
import { computePartitionAssignment, getClientPartitions, computeStateDelta, getPartition, computePartitionCount, isDeltaEmpty, getDeltaSize } from './sync';
// Debug flag - set to false for production
const DEBUG_NETWORK = false;
// ==========================================
// Prefab Class
// ==========================================
/**
 * Prefab - spawnable entity definition
 */
export class Prefab {
    constructor(game, typeName, builder) {
        this.game = game;
        this.typeName = typeName;
        this.builder = builder;
    }
    /**
     * Spawn a new entity from this prefab.
     */
    spawn(props = {}) {
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
    constructor() {
        /** Physics system (optional) */
        this.physics = null;
        // ==========================================
        // Network State
        // ==========================================
        /** WebSocket connection */
        this.connection = null;
        /** Game callbacks */
        this.callbacks = {};
        /** Connected room ID */
        this.connectedRoomId = null;
        /** Local client ID (string form) */
        this.localClientIdStr = null;
        /** Authority client (first joiner, sends snapshots) */
        this.authorityClientId = null;
        /** Current server frame */
        this.currentFrame = 0;
        /** Last processed frame (for skipping old frames after catchup) */
        this.lastProcessedFrame = 0;
        /** Last processed input sequence */
        this.lastInputSeq = 0;
        /** Server tick rate */
        this.serverFps = 20;
        /** RequestAnimationFrame handle */
        this.gameLoop = null;
        /** Deferred snapshot flag (send after tick completes) */
        this.pendingSnapshotUpload = false;
        /** Flag: local room was created before server connected (for local-first) */
        this.localRoomCreated = false;
        /** Flag: game has been started (via start() or connect()) */
        this.gameStarted = false;
        /** Last snapshot info for debug UI */
        this.lastSnapshotHash = null;
        this.lastSnapshotFrame = 0;
        this.lastSnapshotSize = 0;
        this.lastSnapshotEntityCount = 0;
        this.snapshotLoadedFrame = 0; // Frame when snapshot was loaded (for debug timing)
        /** Drift tracking stats for debug UI */
        this.driftStats = {
            determinismPercent: 100,
            totalChecks: 0,
            matchingFieldCount: 0,
            totalFieldCount: 0
        };
        /** Divergence tracking */
        this.lastSyncPercent = 100;
        this.firstDivergenceFrame = null;
        this.divergenceHistory = [];
        this.recentInputs = [];
        this.lastServerSnapshot = { raw: null, decoded: null, frame: 0 };
        this.lastGoodSnapshot = null;
        this.divergenceCaptured = false;
        this.divergenceCapture = null;
        /** Tick timing for render interpolation */
        this.lastTickTime = 0;
        this.tickIntervalMs = 50; // 20fps default
        // ==========================================
        // State Sync
        // ==========================================
        /** Current reliability scores from server (clientId -> score) */
        this.reliabilityScores = {};
        /** Reliability scores version (for change detection) */
        this.reliabilityVersion = 0;
        /** Active client list (sorted, for deterministic partition assignment) */
        this.activeClients = [];
        /** Previous snapshot for delta computation */
        this.prevSnapshot = null;
        /** State sync enabled flag */
        this.stateSyncEnabled = true;
        /** Delta bandwidth tracking */
        this.deltaBytesThisSecond = 0;
        this.deltaBytesPerSecond = 0;
        this.deltaBytesSampleTime = 0;
        /** Desync tracking for hash-based sync */
        this.isDesynced = false;
        this.desyncFrame = 0;
        this.desyncLocalHash = 0;
        this.desyncMajorityHash = 0;
        this.resyncPending = false;
        /** Hash comparison stats (rolling window) */
        this.hashChecksPassed = 0;
        this.hashChecksFailed = 0;
        /** State hash history for desync comparison (frame -> hash) */
        this.stateHashHistory = new Map();
        this.HASH_HISTORY_SIZE = 10; // Keep last 10 frames of hashes
        // ==========================================
        // String Interning
        // ==========================================
        /** String to ID mapping for clientIds */
        this.clientIdToNum = new Map();
        this.numToClientId = new Map();
        this.nextClientNum = 1;
        /** Prefab registry */
        this.prefabs = new Map();
        /** Collision handlers (type:type -> handler) */
        this.collisionHandlers = new Map();
        /** Clients that already have entities from snapshot (skip onConnect for them during catchup) */
        this.clientsWithEntitiesFromSnapshot = new Set();
        /** ClientIds that were in the snapshot's clientIdMap (includes clients who joined then left) */
        this.clientIdsFromSnapshotMap = new Set();
        /** ClientIds that have DISCONNECT inputs during current catchup (for robust stale JOIN detection) */
        this.clientsWithDisconnectInCatchup = new Set();
        /** Seq of the loaded snapshot - JOINs with seq <= this are already in snapshot */
        this.loadedSnapshotSeq = 0;
        /** True when we're running catchup simulation (only then should we filter JOINs by seq) */
        this.inCatchupMode = false;
        /** Attached renderer */
        this.renderer = null;
        /** Installed plugins */
        this.plugins = new Map();
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
    addPlugin(Plugin, ...args) {
        const plugin = new Plugin(this, ...args);
        const name = Plugin.name || 'anonymous';
        this.plugins.set(name, plugin);
        return plugin;
    }
    /**
     * Get a previously added plugin by class.
     */
    getPlugin(Plugin) {
        return this.plugins.get(Plugin.name);
    }
    /**
     * Current frame number.
     */
    get frame() {
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
    get time() {
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
    defineEntity(name) {
        return new GameEntityBuilder(this, name);
    }
    /**
     * Register a prefab (internal).
     */
    _registerPrefab(name, builder) {
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
    spawn(type, props = {}) {
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
    getPrefab(name) {
        return this.prefabs.get(name);
    }
    // ==========================================
    // Query API
    // ==========================================
    /**
     * Query entities by type.
     */
    query(type) {
        return this.world.query(type);
    }
    /**
     * Get entities by type as array.
     */
    getEntitiesByType(type) {
        return this.world.query(type).toArray();
    }
    /**
     * Get all entities.
     */
    getAllEntities() {
        return this.world.getAllEntities();
    }
    /**
     * Get entity by client ID.
     */
    getEntityByClientId(clientId) {
        const numId = this.clientIdToNum.get(clientId);
        if (numId === undefined)
            return null;
        return this.world.getEntityByClientId(numId);
    }
    /**
     * Get player by client ID (alias for getEntityByClientId).
     */
    getPlayer(clientId) {
        return this.getEntityByClientId(clientId);
    }
    /**
     * Get all players (entities with Player component).
     */
    getPlayers() {
        return this.world.query(Player).toArray();
    }
    // ==========================================
    // System API
    // ==========================================
    /**
     * Add a system.
     */
    addSystem(fn, options) {
        return this.world.addSystem(fn, options);
    }
    // ==========================================
    // Collision API
    // ==========================================
    /**
     * Register a collision handler.
     */
    onCollision(typeA, typeB, handler) {
        if (this.physics) {
            this.physics.onCollision(typeA, typeB, handler);
        }
        else {
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
     * Creates a new mapping if one doesn't exist.
     */
    internClientId(clientId) {
        let num = this.clientIdToNum.get(clientId);
        if (num === undefined) {
            num = this.nextClientNum++;
            this.clientIdToNum.set(clientId, num);
            this.numToClientId.set(num, clientId);
        }
        return num;
    }
    /**
     * Get the numeric ID for a client ID string WITHOUT creating a new mapping.
     * Returns undefined if the clientId hasn't been interned yet.
     * Use this in onDisconnect to avoid creating orphan mappings.
     */
    getClientIdNum(clientId) {
        return this.clientIdToNum.get(clientId);
    }
    /**
     * Get client ID string from number.
     */
    getClientIdString(num) {
        return this.numToClientId.get(num);
    }
    /**
     * Intern any string in a namespace.
     */
    internString(namespace, str) {
        return this.world.internString(namespace, str);
    }
    /**
     * Get string by ID from namespace.
     */
    getString(namespace, id) {
        return this.world.getString(namespace, id);
    }
    // ==========================================
    // State Management
    // ==========================================
    /**
     * Get deterministic state hash.
     * Returns 4-byte unsigned integer (xxhash32).
     */
    getStateHash() {
        return this.world.getStateHash();
    }
    /**
     * Get deterministic state hash as hex string (for debugging).
     * @deprecated Use getStateHash() which returns a number.
     */
    getStateHashHex() {
        return this.world.getStateHashHex();
    }
    /**
     * Reset game state.
     */
    reset() {
        this.world.reset();
        this.currentFrame = 0;
    }
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
    init(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
        return this;
    }
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
    start(callbacks = {}) {
        // Merge callbacks (init() callbacks are preserved, start() callbacks override)
        this.callbacks = { ...this.callbacks, ...callbacks };
        // Generate a local client ID for offline play
        const localClientId = 'local-' + Math.random().toString(36).substring(2, 10);
        this.localClientIdStr = localClientId;
        // Call onRoomCreate for initial setup (like spawning world entities)
        if (this.callbacks.onRoomCreate) {
            this.callbacks.onRoomCreate();
        }
        this.localRoomCreated = true;
        // Call onConnect for the local player (spawns player entity)
        if (this.callbacks.onConnect) {
            this.callbacks.onConnect(localClientId);
        }
        // Start the game loop (will tick locally since no connection)
        this.startGameLoop();
        // Mark game as started
        this.gameStarted = true;
        console.log('[ecs] Started in local/offline mode with clientId:', localClientId);
    }
    // ==========================================
    // Network Connection
    // ==========================================
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
    async connect(roomId, callbacksOrOptions, options) {
        // Handle overloaded signatures:
        // connect(roomId)
        // connect(roomId, callbacks)
        // connect(roomId, options)
        // connect(roomId, callbacks, options)
        let callbacks = {};
        let connectOptions = {};
        if (callbacksOrOptions) {
            // Check if it's ConnectOptions (has nodeUrl, centralServiceUrl, or joinToken)
            const isConnectOptions = 'nodeUrl' in callbacksOrOptions ||
                'centralServiceUrl' in callbacksOrOptions ||
                'joinToken' in callbacksOrOptions;
            if (isConnectOptions) {
                // connect(roomId, options) - no callbacks
                connectOptions = callbacksOrOptions;
            }
            else {
                // connect(roomId, callbacks) or connect(roomId, callbacks, options)
                callbacks = callbacksOrOptions;
                connectOptions = options || {};
            }
        }
        // Merge callbacks (preserve existing from init()/start() if any)
        this.callbacks = { ...this.callbacks, ...callbacks };
        // Allow URL params to override (for testing)
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('room'))
                roomId = params.get('room');
            if (params.get('nodeUrl'))
                connectOptions.nodeUrl = params.get('nodeUrl');
        }
        this.connectedRoomId = roomId;
        // Track if we started locally before this connect() call
        const wasStartedLocally = this.gameStarted;
        if (wasStartedLocally) {
            // LOCAL-FIRST MODE: start() was called first
            // Game is already running locally - just connect to server in background
            // When server connects, local state will be REPLACED with server state
            console.log(`[ecs] Connecting to room "${roomId}"... (local game will be replaced with server state)`);
        }
        else {
            // ONLINE-FIRST MODE: connect() called without start()
            // Start game locally while waiting for server connection
            console.log(`[ecs] Starting game locally, connecting to room "${roomId}" in background...`);
            // Generate a temporary local clientId for offline play
            const localClientId = 'local-' + Math.random().toString(36).substring(2, 10);
            this.localClientIdStr = localClientId;
            // Call onRoomCreate immediately for local play (spawns world entities like food)
            if (this.callbacks.onRoomCreate) {
                this.callbacks.onRoomCreate();
                this.localRoomCreated = true;
            }
            // NOTE: Don't call onConnect locally in online-first mode
            // Player spawns when real server connection happens
            // This avoids duplicate players and state divergence
            // Mark game as started
            this.gameStarted = true;
        }
        // Start the game loop if not already running
        this.startGameLoop();
        // Get network SDK (only available in browser)
        const network = typeof window !== 'undefined'
            ? window.moduNetwork
            : undefined;
        if (!network) {
            console.warn('[ecs] moduNetwork not found - running in offline mode');
            return;
        }
        // Add promise timeout tracking for debugging hangs
        const connectStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        try {
            this.connection = await network.connect(roomId, {
                nodeUrl: connectOptions.nodeUrl,
                centralServiceUrl: connectOptions.centralServiceUrl,
                appId: 'dev',
                joinToken: connectOptions.joinToken,
                onConnect: (snapshot, inputs, frame, nodeUrl, fps, clientId) => {
                    this.handleConnect(snapshot, inputs, frame, fps, clientId);
                },
                onTick: (frame, inputs, _snapshotFrame, _snapshotHash, majorityHash) => {
                    this.handleTick(frame, inputs, majorityHash);
                },
                onDisconnect: () => {
                    this.handleDisconnect();
                },
                onBinarySnapshot: (data) => {
                    this.handleServerSnapshot(data);
                },
                onError: (error) => {
                    console.error('[ecs] Network error:', error);
                }
            });
            const connectDuration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - connectStartTime;
            console.log(`[ecs] Connected successfully in ${connectDuration.toFixed(0)}ms, clientId: ${this.connection.clientId}`);
            this.localClientIdStr = this.connection.clientId;
            // Set up state sync callbacks (using 'in' check since properties may be undefined)
            if ('onReliabilityUpdate' in this.connection) {
                this.connection.onReliabilityUpdate = (scores, version) => {
                    this.handleReliabilityUpdate(scores, version);
                };
            }
            if ('onMajorityHash' in this.connection) {
                this.connection.onMajorityHash = (frame, hash) => {
                    this.handleMajorityHash(frame, hash);
                };
            }
            if ('onResyncSnapshot' in this.connection) {
                this.connection.onResyncSnapshot = (data, frame) => {
                    this.handleResyncSnapshot(data, frame);
                };
            }
        }
        catch (err) {
            const connectDuration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - connectStartTime;
            console.error(`[ecs] Connection failed after ${connectDuration.toFixed(0)}ms:`, err?.message || err);
            console.error('[ecs] Make sure the server is running. Check: 1) Central service on port 9001, 2) Node server');
            this.connection = null;
            this.connectedRoomId = null;
        }
    }
    /**
     * Handle reliability score update from server.
     */
    handleReliabilityUpdate(scores, version) {
        if (version <= this.reliabilityVersion) {
            return; // Already have this or newer
        }
        this.reliabilityScores = scores;
        this.reliabilityVersion = version;
    }
    /**
     * Handle majority hash from server (for desync detection).
     */
    handleMajorityHash(frame, majorityHash) {
        // Compare our cached hash for this frame with majority
        // Server sends majorityHash for frame-1 (see input-batcher.ts)
        // We look up our cached hash for that frame from history
        const localHash = this.stateHashHistory.get(frame);
        if (localHash === undefined) {
            // Haven't computed hash for this frame yet, skip
            // This happens during initial connection or if history was pruned
            // Rate-limit warning to avoid console spam
            if (frame % 100 === 0) {
                console.warn(`[state-sync] No local hash for frame ${frame} (history has ${this.stateHashHistory.size} frames)`);
            }
            return;
        }
        if (localHash === majorityHash) {
            // Hash matches - track successful check
            this.hashChecksPassed++;
            // If we were desynced but now match, we've recovered
            if (this.isDesynced && !this.resyncPending) {
                console.log(`[state-sync] Recovered from desync at frame ${frame}`);
                this.isDesynced = false;
            }
        }
        else {
            // Hash mismatch - desync detected
            this.hashChecksFailed++;
            // Only request resync if not already pending
            if (!this.resyncPending) {
                this.isDesynced = true;
                this.desyncFrame = frame;
                this.desyncLocalHash = localHash;
                this.desyncMajorityHash = majorityHash;
                console.error(`[state-sync] DESYNC DETECTED at frame ${frame}`);
                console.error(`  Local hash:    ${localHash.toString(16).padStart(8, '0')}`);
                console.error(`  Majority hash: ${majorityHash.toString(16).padStart(8, '0')}`);
                // Dump local state for debugging - compare between browser tabs
                this.dumpLocalStateForDebug(frame);
                console.error(`  Requesting resync from authority...`);
                // Request full state from authority for recovery
                if (this.connection?.requestResync) {
                    this.resyncPending = true;
                    this.connection.requestResync();
                }
                else {
                    console.warn(`[state-sync] Cannot request resync - SDK does not support requestResync()`);
                }
            }
        }
    }
    /**
     * Handle resync snapshot from authority (hard recovery after desync).
     * This compares state, logs detailed diff, then replaces local state.
     */
    handleResyncSnapshot(data, serverFrame) {
        console.warn(`[ENGINE-RESYNC] Received resync snapshot (${data.length} bytes) for frame ${serverFrame}. currentFrame=${this.currentFrame} isDesynced=${this.isDesynced}`);
        // Decode the snapshot - try binary format first, then JSON fallback
        let snapshot;
        try {
            const decoded = decode(data);
            snapshot = decoded?.snapshot;
            // Also restore hash from binary if available
            if (snapshot && decoded?.hash !== undefined) {
                snapshot.hash = decoded.hash;
            }
        }
        catch (e) {
            // Binary decode failed, will try JSON below
        }
        // If binary decode didn't get a snapshot, try JSON format
        // (SDK may send JSON-encoded snapshot for resync)
        if (!snapshot) {
            try {
                const jsonStr = new TextDecoder().decode(data);
                const parsed = JSON.parse(jsonStr);
                // The SDK might send the snapshot in different formats:
                // 1. { snapshot: {...} } - wrapped format with actual snapshot object
                // 2. { snapshot: [binary array], snapshotHash: ... } - binary data as array
                // 3. Direct snapshot object
                let rawSnapshot = parsed?.snapshot;
                // Check if rawSnapshot is binary data encoded as array (has numeric keys like 0, 1, 2...)
                // The SDK stores binary MessagePack data which becomes a JSON object with numeric keys
                if (rawSnapshot && typeof rawSnapshot === 'object' && !rawSnapshot.types && !rawSnapshot.entities) {
                    const keys = Object.keys(rawSnapshot);
                    if (keys.length > 0 && keys[0] === '0') {
                        // It's binary data as a JSON object with numeric keys - convert and decode
                        const binaryData = new Uint8Array(Object.values(rawSnapshot));
                        try {
                            const decoded = decode(binaryData);
                            snapshot = decoded?.snapshot;
                            // Also get the hash from the decoded binary (it was encoded with the snapshot)
                            if (snapshot && decoded?.hash !== undefined) {
                                snapshot.hash = decoded.hash;
                            }
                        }
                        catch (e) {
                            // Failed to decode binary from JSON wrapper
                        }
                    }
                }
                if (!snapshot) {
                    snapshot = rawSnapshot;
                }
                if (!snapshot && parsed?.types && parsed?.entities) {
                    // Direct snapshot format (not wrapped)
                    snapshot = parsed;
                }
            }
            catch (e) {
                // JSON parse also failed
            }
        }
        if (!snapshot) {
            console.error(`[state-sync] Failed to decode resync snapshot - no snapshot data (tried binary and JSON)`);
            this.resyncPending = false;
            return;
        }
        // Log detailed comparison BEFORE replacing state
        console.error(`[state-sync] === DESYNC DIAGNOSIS ===`);
        console.error(`  Desync detected at frame: ${this.desyncFrame}`);
        console.error(`  Resync snapshot frame: ${serverFrame}`);
        console.error(`  Local hash at desync:    ${this.desyncLocalHash.toString(16).padStart(8, '0')}`);
        console.error(`  Majority hash at desync: ${this.desyncMajorityHash.toString(16).padStart(8, '0')}`);
        // Run field-by-field comparison to get detailed diff
        // This uses the same logic as compareSnapshotFields but logs immediately
        this.logDesyncDiff(snapshot, serverFrame);
        // Now perform hard recovery - replace local state with authority state
        console.log(`[state-sync] Performing hard recovery...`);
        // Store the current frame before resync
        const preResyncFrame = this.currentFrame;
        // Load the authority snapshot (this resets and rebuilds world state)
        this.loadNetworkSnapshot(snapshot);
        // Update frame to match server
        this.currentFrame = serverFrame;
        // Clear the desync state
        this.resyncPending = false;
        this.isDesynced = false;
        // Verify resync worked
        const newLocalHash = this.world.getStateHash();
        const serverHash = snapshot.hash;
        if (serverHash && newLocalHash === serverHash) {
            console.log(`[state-sync] Hard recovery successful - hash=${newLocalHash.toString(16).padStart(8, '0')}`);
        }
        else if (!serverHash) {
            // No server hash in snapshot - this is OK, we can't verify but state was loaded
            console.log(`[state-sync] Hard recovery completed - hash=${newLocalHash.toString(16).padStart(8, '0')}`);
        }
        else {
            console.error(`[state-sync] Hard recovery hash mismatch: expected=${serverHash?.toString(16).padStart(8, '0')} got=${newLocalHash.toString(16).padStart(8, '0')}`);
        }
        // CRITICAL: Set prevSnapshot so delta computation has valid baseline after resync
        this.prevSnapshot = this.world.getSparseSnapshot();
        // CRITICAL: Initialize hash history so next majorityHash comparison works
        // Clear old history and start fresh from this frame
        this.stateHashHistory.clear();
        this.stateHashHistory.set(serverFrame, newLocalHash);
        // Store as last good snapshot
        this.lastGoodSnapshot = {
            snapshot: JSON.parse(JSON.stringify(snapshot)),
            frame: serverFrame,
            hash: newLocalHash
        };
        // CRITICAL: Clear clientsWithEntitiesFromSnapshot after resync
        // loadNetworkSnapshot populates this set, but we're not doing catchup here.
        // If left populated, future join events would incorrectly skip onConnect
        // for clients whose entities are in this stale set.
        this.clientsWithEntitiesFromSnapshot.clear();
        this.clientIdsFromSnapshotMap.clear();
        this.clientsWithDisconnectInCatchup.clear();
        this.loadedSnapshotSeq = 0;
        console.log(`[state-sync] === END RESYNC ===`);
    }
    /**
     * Log detailed diff between local state and authority snapshot.
     * Called during resync to help diagnose what went wrong.
     */
    /**
     * Dump local state for debugging when desync is detected.
     * Compare output between browser tabs to find differences.
     */
    dumpLocalStateForDebug(frame) {
        console.group(`[DESYNC DEBUG] Local state at frame ${frame}`);
        console.log(`Entity count: ${this.world.getAllEntities().length}`);
        // Group entities by type
        const byType = new Map();
        for (const entity of this.world.getAllEntities()) {
            if (!byType.has(entity.type))
                byType.set(entity.type, []);
            byType.get(entity.type).push(entity);
        }
        // Log counts by type
        console.log('Entity counts by type:');
        for (const [type, entities] of byType) {
            console.log(`  ${type}: ${entities.length}`);
        }
        // Log first few entities of dynamic types with component values
        const dynamicTypes = ['furniture', 'player'];
        for (const type of dynamicTypes) {
            const entities = byType.get(type) || [];
            if (entities.length === 0)
                continue;
            console.group(`${type} entities (first 5):`);
            for (let i = 0; i < Math.min(5, entities.length); i++) {
                const e = entities[i];
                const data = { eid: e.eid };
                for (const comp of e.getComponents()) {
                    if (!comp.sync)
                        continue;
                    const index = e.eid & 0xFFFF;
                    for (const field of comp.fieldNames) {
                        const key = `${comp.name}.${field}`;
                        data[key] = comp.storage.fields[field][index];
                    }
                }
                console.log(`  [${i}]`, JSON.stringify(data));
            }
            console.groupEnd();
        }
        console.groupEnd();
    }
    logDesyncDiff(serverSnapshot, serverFrame) {
        const lines = [];
        const diffs = [];
        const types = serverSnapshot.types || [];
        const serverEntities = serverSnapshot.entities || [];
        const schema = serverSnapshot.schema || [];
        // Build map of server entities by eid
        const serverEntityMap = new Map();
        for (const e of serverEntities) {
            serverEntityMap.set(e[0], e);
        }
        let matchingFields = 0;
        let totalFields = 0;
        // Compare each local entity with server entity
        for (const entity of this.world.getAllEntities()) {
            const eid = entity.eid;
            const serverEntity = serverEntityMap.get(eid);
            const index = eid & INDEX_MASK;
            if (!serverEntity) {
                // Entity exists locally but not on server
                for (const comp of entity.getComponents()) {
                    totalFields += comp.fieldNames.length;
                    for (const fieldName of comp.fieldNames) {
                        diffs.push({
                            entity: entity.type,
                            eid,
                            comp: comp.name,
                            field: fieldName,
                            local: 'EXISTS',
                            server: 'MISSING'
                        });
                    }
                }
                continue;
            }
            const [, typeIndex, serverValues] = serverEntity;
            const typeSchema = schema[typeIndex];
            if (!typeSchema)
                continue;
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
                        }
                        else {
                            valuesMatch = localValue === serverValue;
                        }
                        if (valuesMatch) {
                            matchingFields++;
                        }
                        else {
                            diffs.push({
                                entity: entity.type,
                                eid,
                                comp: compName,
                                field: fieldName,
                                local: localValue,
                                server: serverValue
                            });
                        }
                    }
                }
            }
        }
        // Check for server entities not in local state
        for (const [eid, serverEntity] of serverEntityMap) {
            if (this.world.getEntity(eid) === null) {
                const [, typeIndex, serverValues] = serverEntity;
                const serverType = types[typeIndex] || `type${typeIndex}`;
                totalFields += serverValues.length;
                diffs.push({
                    entity: serverType,
                    eid,
                    comp: '*',
                    field: '*',
                    local: 'MISSING',
                    server: 'EXISTS'
                });
            }
        }
        // Build readable output
        const syncPercent = totalFields > 0 ? (matchingFields / totalFields) * 100 : 100;
        lines.push(`DIVERGENT FIELDS: ${diffs.length} differences found`);
        lines.push(`  Sync: ${syncPercent.toFixed(1)}% (${matchingFields}/${totalFields} fields match)`);
        lines.push(``);
        // Try to find entity owners
        const entityOwners = new Map();
        for (const entity of this.world.getAllEntities()) {
            if (entity.has(Player)) {
                const playerData = entity.get(Player);
                const ownerClientId = this.numToClientId.get(playerData.clientId);
                if (ownerClientId) {
                    entityOwners.set(entity.eid, ownerClientId.slice(0, 8));
                }
            }
        }
        // Group diffs by entity for readability
        const diffsByEntity = new Map();
        for (const d of diffs) {
            if (!diffsByEntity.has(d.eid)) {
                diffsByEntity.set(d.eid, []);
            }
            diffsByEntity.get(d.eid).push(d);
        }
        for (const [eid, entityDiffs] of diffsByEntity) {
            const first = entityDiffs[0];
            const owner = entityOwners.get(eid);
            const ownerStr = owner ? ` [owner: ${owner}]` : '';
            lines.push(`  ${first.entity}#${eid.toString(16)}${ownerStr}:`);
            for (const d of entityDiffs) {
                const delta = typeof d.local === 'number' && typeof d.server === 'number'
                    ? ` (Δ ${(d.local - d.server).toFixed(4)})`
                    : '';
                lines.push(`    ${d.comp}.${d.field}: local=${d.local} server=${d.server}${delta}`);
            }
        }
        if (diffs.length === 0) {
            lines.push(`  No field differences found (hash mismatch may be due to RNG or string state)`);
        }
        // Log recent inputs that may have caused the divergence
        const recentInputCount = Math.min(this.recentInputs.length, 20);
        if (recentInputCount > 0) {
            lines.push(``);
            lines.push(`RECENT INPUTS (last ${recentInputCount}):`);
            const recent = this.recentInputs.slice(-recentInputCount);
            for (const input of recent) {
                const shortId = input.clientId.slice(0, 8);
                lines.push(`  f${input.frame} [${shortId}]: ${JSON.stringify(input.data)}`);
            }
        }
        console.error(lines.join('\n'));
    }
    /**
     * Handle initial connection (first join or late join).
     */
    handleConnect(snapshot, inputs, frame, fps, clientId) {
        // Decode binary snapshot if needed
        let snapshotSize = 0;
        if (snapshot instanceof Uint8Array) {
            snapshotSize = snapshot.length;
            if (snapshot.length < 2) {
                snapshot = null;
            }
            else {
                try {
                    const decoded = decode(snapshot);
                    snapshot = decoded?.snapshot || null;
                    // CRITICAL: Preserve hash from binary encoding for verification
                    if (snapshot && decoded?.hash !== undefined) {
                        snapshot.hash = decoded.hash;
                    }
                }
                catch (e) {
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
                ? snapshot.hash
                : parseInt(String(snapshot.hash), 16) || 0;
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
            // 1. CRITICAL: Build clientId mappings BEFORE loading snapshot!
            // The snapshot stores numeric clientIds, but we need to map them back to strings
            // to correctly populate clientsWithEntitiesFromSnapshot.
            // ONLY process join inputs that are IN the snapshot (seq <= snapshotSeq).
            // Joins that happen AFTER the snapshot will be interned when processed normally.
            const snapshotSeq = snapshot.seq || 0;
            for (const input of inputs) {
                // Skip joins that happen AFTER the snapshot - they'll be interned during normal processing
                // Also skip if seq is undefined (shouldn't happen, but be safe)
                if (input.seq === undefined || input.seq > snapshotSeq) {
                    continue;
                }
                let data = input.data;
                if (data instanceof Uint8Array) {
                    try {
                        data = decode(data);
                    }
                    catch {
                        continue;
                    }
                }
                const inputClientId = data?.clientId || input.clientId;
                if (inputClientId && (data?.type === 'join' || data?.type === 'reconnect')) {
                    // Intern the clientId to build numToClientId mapping
                    this.internClientId(inputClientId);
                }
            }
            // 2. Restore snapshot (now numToClientId has mappings for clientsWithEntitiesFromSnapshot)
            this.currentFrame = snapshot.frame || frame;
            this.loadNetworkSnapshot(snapshot);
            // Verify loaded state hash matches expected (from authority)
            const loadedHash = this.world.getStateHash();
            const expectedHash = snapshot.hash;
            if (expectedHash !== undefined && loadedHash !== expectedHash) {
                console.error(`[SNAPSHOT] HASH MISMATCH! loaded=0x${loadedHash.toString(16)} expected=0x${expectedHash?.toString(16)}`);
            }
            // 3. Authority chain for late joiners
            // NOTE: We skip processAuthorityChainInput here because:
            // - activeClients is already populated from Player entities in loadNetworkSnapshot()
            // - Late joiner is never authority (authority is already established)
            // - DISCONNECTs are handled via processInput in the lifecycle event loop below
            // This avoids duplicate stale JOIN filtering logic.
            // 4. Call onSnapshot callback
            // CRITICAL: onSnapshot runs ONLY on late joiners, so we MUST isolate RNG.
            // Any dRandom() usage here would advance late joiner's RNG while authority's stays unchanged.
            const rngStateSnapshot = saveRandomState();
            if (this.callbacks.onSnapshot) {
                this.callbacks.onSnapshot(this.world.getAllEntities());
            }
            loadRandomState(rngStateSnapshot);
            // 5. Filter inputs already in snapshot
            // CRITICAL: Always include join/reconnect/disconnect inputs regardless of seq!
            // The server sends ALL joins for clientId mapping, but we were filtering them out
            // if seq <= snapshotSeq. This caused late joiners to miss their own join event
            // when the snapshot was taken AFTER their join was queued.
            // Note: snapshotSeq is declared earlier in this block
            // Helper to get input type, handling both object and binary data
            const getInputType = (input) => {
                let data = input.data;
                if (data instanceof Uint8Array) {
                    try {
                        data = decode(data);
                    }
                    catch {
                        return undefined;
                    }
                }
                return data?.type;
            };
            const pendingInputs = inputs
                .filter(i => {
                const inputType = getInputType(i);
                // Always process join/reconnect/disconnect for proper entity lifecycle
                if (inputType === 'join' || inputType === 'reconnect' || inputType === 'disconnect' || inputType === 'leave') {
                    return true;
                }
                // Other inputs only if after snapshot
                return i.seq > snapshotSeq;
            })
                .sort((a, b) => a.seq - b.seq);
            // 5b. Process JOIN/DISCONNECT events immediately (player lifecycle)
            // These establish player presence and must happen regardless of catchup.
            // Simulation state (movement, physics) can be corrected by resync,
            // but player existence is needed immediately to avoid "stuck respawning".
            //
            // CRITICAL: Only process JOINs that happened AFTER the snapshot (seq > snapshotSeq).
            // JOINs with seq <= snapshotSeq are "stale" - they might have been followed by
            // a DISCONNECT that's also in the snapshot. Processing them would create
            // duplicate entities.
            // DISCONNECTs are always processed to ensure cleanup.
            this.loadedSnapshotSeq = snapshotSeq;
            for (const input of pendingInputs) {
                const inputType = getInputType(input);
                if (inputType === 'disconnect' || inputType === 'leave') {
                    // Always process disconnects for cleanup
                    this.processInput(input);
                }
                else if (inputType === 'join' || inputType === 'reconnect') {
                    // Only process JOINs that happened AFTER the snapshot
                    // (stale JOINs are also filtered in processInput with warning)
                    const inputSeq = input.seq || 0;
                    if (inputSeq > snapshotSeq) {
                        this.processInput(input);
                    }
                }
            }
            // 6. Run catchup simulation
            const snapshotFrame = this.currentFrame;
            const isPostTick = snapshot.postTick === true;
            const startFrame = isPostTick ? snapshotFrame + 1 : snapshotFrame;
            const ticksToRun = frame - startFrame + 1;
            // CRITICAL: Limit catchup to prevent performance issues
            // If too many frames need to be simulated, request a fresh snapshot instead
            const MAX_CATCHUP_FRAMES = 200; // ~10 seconds at 20Hz tick rate
            if (ticksToRun > MAX_CATCHUP_FRAMES) {
                console.warn(`[CATCHUP] Too many frames to catch up (${ticksToRun} > ${MAX_CATCHUP_FRAMES}). Requesting fresh snapshot.`);
                // Request fresh snapshot from authority - don't use stale state
                if (this.connection?.requestResync) {
                    this.connection.requestResync();
                }
                // Player lifecycle events already processed above, so player exists.
                // Set up minimal state so game loop can run while waiting for resync.
                this.currentFrame = frame;
                this.lastProcessedFrame = frame;
                this.prevSnapshot = this.world.getSparseSnapshot();
                this.startGameLoop();
                return;
            }
            // Run catchup simulation
            if (ticksToRun > 0) {
                this.runCatchup(startFrame, frame, pendingInputs);
            }
            this.snapshotLoadedFrame = this.currentFrame; // Track for debug timing
            // CRITICAL: Set prevSnapshot after catchup so delta computation has a valid baseline
            // Without this, late joiner's first delta would compare against stale/null snapshot
            this.prevSnapshot = this.world.getSparseSnapshot();
            // Store as last good snapshot - we just loaded authority's state
            this.lastGoodSnapshot = {
                snapshot: JSON.parse(JSON.stringify(snapshot)),
                frame: this.currentFrame,
                hash: this.getStateHash()
            };
        }
        else {
            // === FIRST JOINER PATH ===
            if (DEBUG_NETWORK)
                console.log('[ecs] First join: creating room');
            this.currentFrame = frame;
            // First joiner is always authority
            this.authorityClientId = clientId;
            // Add to activeClients for state sync
            if (!this.activeClients.includes(clientId)) {
                this.activeClients.push(clientId);
                this.activeClients.sort();
            }
            // LOCAL-FIRST HANDOFF: If start() was called before connect(),
            // flush local state and recreate fresh with server identity.
            // This ensures entity IDs and clientId match server expectations.
            if (this.localRoomCreated) {
                console.log('[ecs] Local-first handoff: flushing local state, recreating with server identity');
                // Reset world state (clears all entities, ID allocator, etc.)
                this.world.reset();
                if (this.physics) {
                    this.physics.clear();
                }
                // Clear local state tracking
                this.clientIdToNum.clear();
                this.numToClientId.clear();
                this.nextClientNum = 1;
                this.activeClients = [clientId];
                this.stateHashHistory.clear(); // Clear old local hashes to prevent false desync
                this.localRoomCreated = false; // Reset so callbacks run fresh
                // Recreate room with fresh state
                this.callbacks.onRoomCreate?.();
                this.localRoomCreated = true;
            }
            else {
                // Normal path: connect() called without start()
                this.callbacks.onRoomCreate?.();
            }
            // Process all inputs (may include our own join event which calls onConnect)
            for (const input of inputs) {
                this.processInput(input);
            }
            // CRITICAL: Run initial tick to execute systems and compute initial hash
            // Without this, entities are created but systems never run for frame 0,
            // causing hash mismatch when server sends majorityHash for frame 0
            this.world.tick(frame, []);
            this.lastProcessedFrame = frame;
            // Record initial hash so we have it when server sends majorityHash
            const initialHash = this.world.getStateHash();
            this.stateHashHistory.set(frame, initialHash);
        }
        // Send initial snapshot if we're authority
        if (this.checkIsAuthority()) {
            this.sendSnapshot('init');
        }
        // Start game loop
        this.startGameLoop();
        console.log(`[ecs] Game loop started, waiting for server TICK messages...`);
    }
    /**
     * Handle server tick.
     */
    handleTick(frame, inputs, majorityHash) {
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
        // Record state hash for desync detection
        const hashAfter = this.world.getStateHash();
        // 3. Call game's onTick callback
        this.callbacks.onTick?.(frame);
        // 4. Send deferred snapshot if pending
        if (this.pendingSnapshotUpload && this.checkIsAuthority()) {
            this.sendSnapshot('join');
            this.pendingSnapshotUpload = false;
        }
        // 5. Record tick time for interpolation
        this.lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // 6. Check for desync using majority hash from server
        // Server sends majorityHash for frame-1 (see input-batcher.ts getMajorityHash call)
        // We compare against our cached hash for the same frame
        if (majorityHash !== undefined && majorityHash !== 0) {
            const hashFrame = frame - 1; // Must match server's offset in input-batcher.ts
            this.handleMajorityHash(hashFrame, majorityHash);
        }
        else if (this.activeClients.length > 1 && frame % 100 === 0) {
            // Log when we expect majorityHash but don't receive it (only in multiplayer)
            console.warn(`[state-sync] No majorityHash in tick ${frame} (expected with ${this.activeClients.length} clients)`);
        }
        // 7. Send state sync data (stateHash + partition data if assigned)
        // This must happen AFTER desync check so the cache is still valid
        this.sendStateSync(frame);
    }
    /**
     * Send state synchronization data after tick.
     * Sends stateHash to server, and partition data if this client is assigned.
     */
    sendStateSync(frame) {
        if (!this.stateSyncEnabled || !this.connection?.sendStateHash) {
            return;
        }
        // Update delta bandwidth sampling (every second)
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - this.deltaBytesSampleTime >= 1000) {
            this.deltaBytesPerSecond = this.deltaBytesThisSecond;
            this.deltaBytesThisSecond = 0;
            this.deltaBytesSampleTime = now;
        }
        // Compute and send state hash (9 bytes: 1 type + 4 frame + 4 hash)
        const stateHash = this.world.getStateHash();
        this.connection.sendStateHash(frame, stateHash);
        this.deltaBytesThisSecond += 9;
        // Cache hash in history for desync comparison
        // (majorityHash for this frame will arrive in a future tick)
        this.stateHashHistory.set(frame, stateHash);
        // Prune old entries to limit memory usage
        if (this.stateHashHistory.size > this.HASH_HISTORY_SIZE) {
            const oldestFrame = frame - this.HASH_HISTORY_SIZE;
            for (const f of this.stateHashHistory.keys()) {
                if (f <= oldestFrame) {
                    this.stateHashHistory.delete(f);
                }
            }
        }
        // Always update prevSnapshot for delta comparison (even when alone)
        const currentSnapshot = this.world.getSparseSnapshot();
        // Partition-based delta sync: send only changed entity data for assigned partitions
        // Skip when alone - no one else needs the delta data
        if (this.activeClients.length > 1 && this.connection.clientId && this.connection.sendPartitionData && this.prevSnapshot) {
            // Compute delta between previous and current state
            const delta = computeStateDelta(this.prevSnapshot, currentSnapshot);
            const deltaSize = getDeltaSize(delta);
            // Log delta stats (once per second) - only when there's activity
            if (frame % 60 === 0 && !isDeltaEmpty(delta)) {
                console.log(`[delta] frame=${frame} created=${delta.created.length} deleted=${delta.deleted.length} bytes=${deltaSize}`);
            }
            // Only send if there are actual changes
            if (!isDeltaEmpty(delta)) {
                const entityCount = this.world.entityCount;
                const numPartitions = computePartitionCount(entityCount, this.activeClients.length);
                const assignment = computePartitionAssignment(entityCount, this.activeClients, frame, this.reliabilityScores);
                const myPartitions = getClientPartitions(assignment, this.connection.clientId);
                for (const partitionId of myPartitions) {
                    // Check if this partition has any actual changes before serializing
                    const hasChangesInPartition = delta.created.some(e => (e.eid % numPartitions) === partitionId) ||
                        delta.deleted.some(eid => (eid % numPartitions) === partitionId);
                    if (hasChangesInPartition) {
                        const partitionData = getPartition(delta, partitionId, numPartitions);
                        this.connection.sendPartitionData(frame, partitionId, partitionData);
                        this.deltaBytesThisSecond += 8 + partitionData.length;
                    }
                }
            }
        }
        this.prevSnapshot = currentSnapshot;
    }
    /**
     * Process a network input (join/leave/game).
     */
    processInput(input) {
        // Decode binary data if needed
        let data = input.data;
        if (data instanceof Uint8Array) {
            try {
                data = decode(data);
            }
            catch (e) {
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
            // CRITICAL FIX: Check if this JOIN is already reflected in the snapshot FIRST.
            // JOINs with seq <= loadedSnapshotSeq are stale - the snapshot already contains
            // the authoritative state for that point in time (either the client has an entity,
            // or they already disconnected and shouldn't be in activeClients).
            const inputSeq = input.seq || 0;
            const isAlreadyInSnapshot = this.inCatchupMode && inputSeq > 0 && inputSeq <= this.loadedSnapshotSeq;
            // Skip ENTIRE join processing if already reflected in snapshot
            // This includes activeClients update - snapshot's Player entities are authoritative
            if (isAlreadyInSnapshot) {
                // Server shouldn't send stale events - log warning for debugging
                console.warn(`[ecs] Stale JOIN filtered (seq ${inputSeq} <= snapshotSeq ${this.loadedSnapshotSeq}): ${clientId.slice(0, 8)}`);
                return;
            }
            // Update activeClients for state sync (sorted for deterministic assignment)
            const wasActive = this.activeClients.includes(clientId);
            if (!wasActive) {
                this.activeClients.push(clientId);
                this.activeClients.sort();
            }
            // First joiner becomes authority
            if (this.authorityClientId === null) {
                this.authorityClientId = clientId;
            }
            // CRITICAL: Save RNG state before callback.
            // If the callback uses dRandom(), we must ensure the global RNG is NOT affected,
            // so that all clients maintain identical RNG state regardless of which callbacks ran.
            const rngState = saveRandomState();
            this.callbacks.onConnect?.(clientId);
            // Restore RNG state - callback's random usage doesn't affect global simulation RNG
            loadRandomState(rngState);
            // Mark snapshot needed
            if (this.checkIsAuthority()) {
                this.pendingSnapshotUpload = true;
            }
        }
        else if (type === 'resync_request') {
            // Another client is requesting resync - authority should upload fresh snapshot
            // This ensures resyncing clients get current state, not stale stored snapshot
            if (this.checkIsAuthority()) {
                this.pendingSnapshotUpload = true;
            }
        }
        else if (type === 'leave' || type === 'disconnect') {
            // Remove from activeClients
            const activeIdx = this.activeClients.indexOf(clientId);
            if (activeIdx !== -1) {
                this.activeClients.splice(activeIdx, 1);
            }
            // Transfer authority if needed
            if (clientId === this.authorityClientId) {
                this.authorityClientId = this.activeClients[0] || null;
            }
            // CRITICAL FIX: Remove from clientsWithEntitiesFromSnapshot on disconnect.
            this.clientsWithEntitiesFromSnapshot.delete(clientId);
            // CRITICAL: Save/restore RNG around onDisconnect callback.
            const rngStateDisconnect = saveRandomState();
            this.callbacks.onDisconnect?.(clientId);
            loadRandomState(rngStateDisconnect);
            // CRITICAL FIX: Upload snapshot after disconnect so late joiners get updated state.
            if (this.checkIsAuthority()) {
                this.pendingSnapshotUpload = true;
            }
        }
        else if (data) {
            // Game input - store in world's input registry
            this.routeInputToEntity(clientId, data);
        }
    }
    /**
     * Route game input to the world's input registry for systems to read.
     */
    routeInputToEntity(clientId, data) {
        const numId = this.internClientId(clientId);
        // Always store input in registry - systems query by clientId, not entity
        // This supports games where one clientId maps to multiple entities (e.g., split cells)
        this.world.setInput(numId, data);
        if (DEBUG_NETWORK) {
            const entity = this.world.getEntityByClientId(numId);
            console.log(`[ecs] routeInput: clientId=${clientId.slice(0, 8)}, numId=${numId}, entity=${entity?.eid || 'null'}, data=${JSON.stringify(data)}`);
        }
    }
    /**
     * Process input for authority chain only (no game logic).
     */
    processAuthorityChainInput(input) {
        let data = input.data;
        if (data instanceof Uint8Array) {
            try {
                data = decode(data);
            }
            catch {
                return;
            }
        }
        const clientId = data?.clientId || input.clientId;
        const type = data?.type;
        // NOTE: Stale JOIN filtering is handled in processInput().
        // For late joiners, activeClients is populated from Player entities in loadNetworkSnapshot().
        // This function only tracks authority chain for non-late-joiner flows.
        if (type === 'join') {
            // Update activeClients for state sync
            if (!this.activeClients.includes(clientId)) {
                this.activeClients.push(clientId);
                this.activeClients.sort();
            }
            if (this.authorityClientId === null) {
                this.authorityClientId = clientId;
            }
        }
        else if (type === 'leave' || type === 'disconnect') {
            // Remove from activeClients
            const activeIdx = this.activeClients.indexOf(clientId);
            if (activeIdx !== -1) {
                this.activeClients.splice(activeIdx, 1);
            }
            if (clientId === this.authorityClientId) {
                this.authorityClientId = this.activeClients[0] || null;
            }
        }
    }
    /**
     * Run catchup simulation.
     */
    runCatchup(startFrame, endFrame, inputs) {
        const ticksToRun = endFrame - startFrame + 1;
        // CRITICAL: Sort all inputs by seq to ensure correct order within frames
        // Multiple inputs can occur in a single frame - seq determines order
        const sortedInputs = [...inputs].sort((a, b) => (a.seq || 0) - (b.seq || 0));
        // NOTE: Stale JOIN detection has been REMOVED.
        // Previously we pre-scanned to skip JOINs that would be followed by DISCONNECTs.
        // But skipping JOINs causes allocator divergence (entity IDs not allocated, so
        // generations don't increment when DISCONNECT frees them).
        // Now we process ALL JOINs and let DISCONNECTs handle cleanup naturally.
        // Build map of frame -> inputs for that frame (sorted by seq)
        const inputsByFrame = new Map();
        for (const input of sortedInputs) {
            // CRITICAL: Inputs MUST have explicit frames for deterministic catchup.
            // If input.frame is undefined, different clients would assign different frames
            // (based on their local endFrame), causing desync.
            // Skip frameless inputs during catchup - they'll be processed in normal ticks.
            if (input.frame === undefined || input.frame === null) {
                continue;
            }
            const rawFrame = input.frame;
            // CRITICAL: Don't process inputs that are AFTER the catchup range
            // These should be processed during normal ticks, not catchup
            if (rawFrame > endFrame) {
                continue; // Skip this input - it will come in future ticks
            }
            const frame = Math.max(rawFrame, startFrame);
            if (!inputsByFrame.has(frame)) {
                inputsByFrame.set(frame, []);
            }
            inputsByFrame.get(frame).push(input);
        }
        // CRITICAL: Clear old hash history before catchup
        // We'll record hash for each catchup frame so majorityHash comparison works
        this.stateHashHistory.clear();
        // Set catchup mode so processInput knows to filter JOINs by seq
        this.inCatchupMode = true;
        // Run each tick
        for (let f = 0; f < ticksToRun; f++) {
            const tickFrame = startFrame + f;
            this.currentFrame = tickFrame; // Update so processInput records correct frame
            // Process inputs for this frame (already sorted by seq)
            const frameInputs = inputsByFrame.get(tickFrame) || [];
            for (const input of frameInputs) {
                this.processInput(input);
            }
            // Run world tick
            this.world.tick(tickFrame, []);
            const hashAfterTick = this.world.getStateHash();
            // Call game's onTick
            this.callbacks.onTick?.(tickFrame);
            // CRITICAL: Record state hash for each catchup frame
            this.stateHashHistory.set(tickFrame, hashAfterTick);
        }
        this.currentFrame = endFrame;
        this.lastProcessedFrame = endFrame; // Prevent re-processing old frames
        // Clear the snapshot entity tracking - catchup is done
        // Future join events should trigger onConnect normally
        this.clientsWithEntitiesFromSnapshot.clear();
        this.clientIdsFromSnapshotMap.clear();
        this.clientsWithDisconnectInCatchup.clear();
        this.loadedSnapshotSeq = 0; // Reset so normal JOINs aren't filtered
        this.inCatchupMode = false; // Exit catchup mode
    }
    // ==========================================
    // Snapshot Methods
    // ==========================================
    /**
     * Convert ECS snapshot to network wire format.
     */
    getNetworkSnapshot() {
        // Format 5: Type-indexed encoding with optional syncFields
        // - types: ["snake-head", "snake-segment", ...] - type names array
        // - schema: [[compSchema], [compSchema], ...] - indexed by type index
        // - entities: [[eid, typeIndex, values], ...] - typeIndex instead of string
        // If entity type has syncFields, only those fields are included in schema/values
        // Build type index and schema
        const types = [];
        const typeToIndex = new Map();
        const schema = [];
        const typeSyncFields = new Map(); // Cache syncFields per type
        const entities = [];
        for (const entity of this.world.getAllEntities()) {
            const index = entity.eid & INDEX_MASK;
            const type = entity.type;
            // Get syncFields for this type (check if syncNone)
            const entityDef = this.world.getEntityDef(type);
            // CRITICAL: Skip syncNone entities entirely (syncFields = empty array)
            // These are client-only entities that should NOT be in snapshots
            if (entityDef?.syncFields && entityDef.syncFields.length === 0) {
                continue; // Skip this entity
            }
            // Assign type index if new type
            if (!typeToIndex.has(type)) {
                const typeIdx = types.length;
                types.push(type);
                typeToIndex.set(type, typeIdx);
                // Get syncFields for this type (if defined)
                const syncFieldsSet = entityDef?.syncFields
                    ? new Set(entityDef.syncFields)
                    : null;
                typeSyncFields.set(type, syncFieldsSet);
                // Build schema for this type (only synced fields)
                const typeSchema = [];
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
            const values = [];
            for (const comp of entity.getComponents()) {
                for (const fieldName of comp.fieldNames) {
                    // Only include if no syncFields defined OR field is in syncFields
                    if (!syncFieldsSet || syncFieldsSet.has(fieldName)) {
                        values.push(comp.storage.fields[fieldName][index]);
                    }
                }
            }
            entities.push([
                entity.eid, // eid as number (no need for hex conversion)
                typeToIndex.get(type), // type INDEX (1 byte) instead of string
                values
            ]);
        }
        // CRITICAL: Get the FULL allocator state, not just active entity generations.
        // The previous "minimal" approach lost generation info for destroyed entity slots,
        // causing entity ID collisions after refresh:
        // - Authority had generation=N for a slot, late joiner had generation=0
        // - When both allocated from the slot, they got different entity IDs
        // - This caused permanent desync with identical entity counts but different hashes
        const allocatorState = this.world.idAllocator.getState();
        return {
            frame: this.currentFrame,
            seq: this.lastInputSeq,
            postTick: true, // Snapshot is taken after tick - late joiners should NOT re-run this frame
            format: 5, // Format 5: type-indexed compact encoding
            types, // Type names array (sent once)
            schema, // Component schemas indexed by type index
            entities, // Array of [eid, typeIndex, values[]]
            idAllocatorState: allocatorState,
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
    loadNetworkSnapshot(snapshot) {
        if (DEBUG_NETWORK) {
            console.log(`[ecs] Loading snapshot: ${snapshot.entities?.length} entities`);
        }
        // CRITICAL: Track snapshot seq for filtering JOINs during catchup
        // JOINs with seq <= this are already reflected in the snapshot state
        this.loadedSnapshotSeq = snapshot.seq || 0;
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
        // Restore clientId interning - MERGE with existing mappings!
        // CRITICAL: handleConnect may have already interned clientIds from join inputs
        // that occurred AFTER the snapshot was taken. We must preserve those.
        if (snapshot.clientIdMap) {
            const snapshotMappings = Object.entries(snapshot.clientIdMap.toNum);
            // Track ALL clientIds from snapshot (including those who joined then left)
            // This is used to detect "stale" JOINs during catchup
            this.clientIdsFromSnapshotMap.clear();
            for (const [clientId] of snapshotMappings) {
                this.clientIdsFromSnapshotMap.add(clientId);
            }
            // Save any NEW clientIds that were interned from join inputs (not in snapshot)
            const newMappings = [];
            for (const [clientId, num] of this.clientIdToNum.entries()) {
                const snapshotHas = snapshotMappings.some(([sid]) => sid === clientId);
                if (!snapshotHas) {
                    newMappings.push([clientId, num]);
                }
            }
            // Restore snapshot's mappings (authoritative for entities in snapshot)
            this.clientIdToNum = new Map(snapshotMappings.map(([k, v]) => [k, v]));
            this.numToClientId = new Map(snapshotMappings.map(([k, v]) => [v, k]));
            this.nextClientNum = snapshot.clientIdMap.nextNum || 1;
            // Re-add NEW clientIds with fresh numbers (clients that joined after snapshot)
            for (const [clientId] of newMappings) {
                const newNum = this.nextClientNum++;
                this.clientIdToNum.set(clientId, newNum);
                this.numToClientId.set(newNum, clientId);
            }
        }
        // Format 5: type-indexed encoding
        const types = snapshot.types;
        const schema = snapshot.schema;
        const entitiesData = snapshot.entities;
        // Track loaded entities by type for onRestore callbacks
        const loadedEntitiesByType = new Map();
        for (const entityData of entitiesData) {
            const [eid, typeIndex, values] = entityData;
            const type = types[typeIndex];
            const typeSchema = schema[typeIndex];
            // Spawn entity with specific eid
            let entity;
            try {
                entity = this.world.spawnWithId(type, eid, {});
            }
            catch (e) {
                console.warn(`[ecs] Failed to spawn ${type} with eid ${eid}:`, e);
                continue;
            }
            // Track for onRestore callback
            if (!loadedEntitiesByType.has(type)) {
                loadedEntitiesByType.set(type, []);
            }
            loadedEntitiesByType.get(type).push(entity);
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
            // First restore the basic allocator state
            this.world.idAllocator.reset();
            this.world.idAllocator.setNextId(state.nextIndex);
            // Restore generations - handle both array and object formats
            if (Array.isArray(state.generations)) {
                for (let i = 0; i < state.generations.length; i++) {
                    this.world.idAllocator.generations[i] = state.generations[i];
                }
            }
            else if (typeof state.generations === 'object') {
                for (const [indexStr, gen] of Object.entries(state.generations)) {
                    const index = parseInt(indexStr, 10);
                    this.world.idAllocator.generations[index] = gen;
                }
            }
            // NOTE: syncNone entities now use a separate localIdAllocator, so they don't
            // affect the main idAllocator state. The snapshot's allocator state should be
            // correct for synced entities. We verify by checking loaded entities match.
            // Skip local entities (those with LOCAL_ENTITY_BIT set).
            const loadedIndices = new Set();
            for (const entity of this.world.getAllEntities()) {
                // Skip local entities - they use a different allocator
                if (entity.eid & LOCAL_ENTITY_BIT)
                    continue;
                loadedIndices.add(entity.eid & INDEX_MASK);
            }
            const freeList = [];
            for (let i = 0; i < state.nextIndex; i++) {
                if (!loadedIndices.has(i)) {
                    freeList.push(i);
                }
            }
            this.world.idAllocator.freeList = freeList;
        }
        // Track which clients already have entities from the snapshot
        // This prevents duplicate entity creation during catchup
        // ALSO populate activeClients for correct partition assignment
        this.clientsWithEntitiesFromSnapshot.clear();
        // CRITICAL: Clear activeClients before populating from snapshot
        // Without this, stale clients remain after resync (e.g., client left but snapshot doesn't include them)
        this.activeClients.length = 0;
        // Get network SDK for registering clientIds (needed for TICK decoding)
        const network = typeof window !== 'undefined' ? window.moduNetwork : undefined;
        for (const entity of this.world.query(Player)) {
            const player = entity.get(Player);
            if (player.clientId === 0) {
                // ERROR: clientId=0 should never happen in networked games
                console.error(`[ecs] Player entity ${entity.eid} has clientId=0 (invalid)`);
                continue;
            }
            const clientIdStr = this.getClientIdString(player.clientId);
            if (clientIdStr) {
                this.clientsWithEntitiesFromSnapshot.add(clientIdStr);
                // CRITICAL: Add to activeClients for partition assignment
                // Without this, partition assignment differs between authority and late joiner
                if (!this.activeClients.includes(clientIdStr)) {
                    this.activeClients.push(clientIdStr);
                }
                // CRITICAL FIX: Register clientId with network SDK for TICK decoding
                // Without this, late joiners can't decode inputs from clients
                // whose JOIN event was already included in the snapshot.
                // The SDK uses a hash-to-clientId map for binary TICK decoding.
                if (network?.registerClientId) {
                    network.registerClientId(clientIdStr);
                    if (DEBUG_NETWORK) {
                        console.log(`[ecs] Registered clientId ${clientIdStr.slice(0, 8)} from snapshot entity`);
                    }
                }
                if (DEBUG_NETWORK) {
                    console.log(`[ecs] Snapshot has entity for client ${clientIdStr.slice(0, 8)}`);
                }
            }
        }
        // Sort activeClients for deterministic partition assignment
        this.activeClients.sort();
        // NOTE: Do NOT set authorityClientId here from activeClients[0]
        // Authority is determined by join order, not alphabetical order
        // processAuthorityChainInput() will set it correctly from the first join event
        // CRITICAL: Sync ALL physics bodies from restored ECS components
        // This is the ROOT CAUSE of desync on late joiners:
        // 1. ECS components (Transform2D, Body2D) are restored with correct positions/velocities
        // 2. But physics world's internal RigidBody2D objects still have OLD positions/velocities
        // 3. On next physics step, the old values are used, causing immediate divergence
        //
        // syncAllFromComponents() copies position/velocity from ECS components to physics bodies
        // for ALL body types (including dynamic bodies which normal sync skips)
        // Sync physics bodies from ECS components
        if (this.physics) {
            this.physics.syncAllFromComponents();
        }
        // Restore input state so movement systems behave identically
        if (snapshot.inputState) {
            this.world.setInputState(snapshot.inputState);
            // Verify immediately after setting
            const verifyState = this.world.getInputState();
            const snapshotKeys = Object.keys(snapshot.inputState).sort().join(',');
            const loadedKeys = Object.keys(verifyState).sort().join(',');
            if (snapshotKeys !== loadedKeys) {
                console.error(`[INPUT-STATE] KEYS DIFFER! snapshot=[${snapshotKeys}] loaded=[${loadedKeys}]`);
            }
        }
    }
    /**
     * Send snapshot to network.
     */
    sendSnapshot(source) {
        if (!this.connection)
            return;
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
        const entityCount = snapshot.entities.length;
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
    handleServerSnapshot(data) {
        if (DEBUG_NETWORK) {
            console.log(`[ecs] Received server snapshot: ${data.length} bytes`);
        }
        // Decode and compare for drift detection
        try {
            const decoded = decode(data);
            const serverSnapshot = decoded?.snapshot;
            const serverHash = decoded?.hash;
            if (serverSnapshot) {
                // Ensure hash is stored as number
                this.lastSnapshotHash = typeof serverHash === 'number'
                    ? serverHash
                    : (serverHash ? parseInt(String(serverHash), 16) : null) || null;
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
                }
                else {
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
        }
        catch (e) {
            console.warn('[ecs] Failed to decode server snapshot:', e);
        }
    }
    /**
     * Compare server snapshot fields with local state for drift tracking.
     */
    compareSnapshotFields(serverSnapshot) {
        const frame = serverSnapshot.frame;
        let matchingFields = 0;
        let totalFields = 0;
        const diffs = [];
        // Store server snapshot for debugging
        this.lastServerSnapshot = { raw: null, decoded: serverSnapshot, frame };
        const types = serverSnapshot.types || [];
        const serverEntities = serverSnapshot.entities || [];
        const schema = serverSnapshot.schema || [];
        // Build map of server entities by eid (numeric)
        const serverEntityMap = new Map();
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
            if (!typeSchema)
                continue;
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
                        }
                        else {
                            valuesMatch = localValue === serverValue;
                        }
                        if (valuesMatch) {
                            matchingFields++;
                        }
                        else {
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
    showDivergenceDiff(diffs, inputs, frame) {
        const lines = [];
        const lastGoodFrame = this.lastGoodSnapshot?.frame ?? 0;
        const myClientId = this.localClientIdStr || '';
        // Build client legend (assign P1, P2, etc.)
        const clientIds = new Set();
        for (const input of inputs) {
            clientIds.add(input.clientId);
        }
        const clientList = Array.from(clientIds);
        const clientLabels = new Map();
        clientList.forEach((cid, i) => {
            const label = cid === myClientId ? 'ME' : `P${i + 1}`;
            clientLabels.set(cid, label);
        });
        // Try to find entity owners (entities with Player component)
        const entityOwners = new Map();
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
        }
        else {
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
    getDivergenceReplay() {
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
     * Start the game loop (render + local simulation when offline).
     *
     * When connected to server: server TICK messages drive simulation via handleTick().
     * When offline: simulation ticks locally at tickRate.
     */
    startGameLoop() {
        if (this.gameLoop)
            return;
        let lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const loop = () => {
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            // Local simulation when not connected to server
            // When connected, server TICK messages drive simulation via handleTick()
            if (!this.connection) {
                // Fixed timestep accumulator for deterministic simulation
                while (now - lastTickTime >= this.tickIntervalMs) {
                    this.currentFrame++;
                    // Run ECS world tick (systems)
                    this.world.tick(this.currentFrame, []);
                    // Call game's onTick callback
                    this.callbacks.onTick?.(this.currentFrame);
                    lastTickTime += this.tickIntervalMs;
                }
            }
            // Render
            if (this.renderer?.render) {
                this.renderer.render();
            }
            else if (this.callbacks.render) {
                this.callbacks.render();
            }
            this.gameLoop = requestAnimationFrame(loop);
        };
        this.gameLoop = requestAnimationFrame(loop);
    }
    /**
     * Stop the render loop.
     */
    stopGameLoop() {
        if (this.gameLoop) {
            cancelAnimationFrame(this.gameLoop);
            this.gameLoop = null;
        }
    }
    /**
     * Handle disconnect from server.
     *
     * Fires the onDisconnect callback with no clientId (network disconnect, not player leave).
     * The game loop continues running - the game can decide how to handle this:
     * - Continue playing locally (single-player mode)
     * - Show a reconnect UI
     * - Pause the game
     */
    handleDisconnect() {
        console.log('[ecs] Disconnected from server');
        // Clear connection state
        const wasConnected = this.connection !== null;
        this.connection = null;
        // Fire onDisconnect callback with undefined clientId to indicate network disconnect
        // (as opposed to a specific player leaving, which passes their clientId)
        if (wasConnected && this.callbacks.onDisconnect) {
            // Pass undefined to indicate this is a network disconnect, not a player leave
            this.callbacks.onDisconnect(undefined);
        }
        // NOTE: We do NOT stop the game loop.
        // The game continues running locally - the callback can decide what to do.
        // If the game wants to stop, it can call game.stop() or game.leaveRoom().
    }
    // ==========================================
    // Utility Methods
    // ==========================================
    /**
     * Check if this client is the authority.
     * Handles potential length mismatch between SDK and server client IDs.
     */
    checkIsAuthority() {
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
    isAuthority() {
        return this.checkIsAuthority();
    }
    /**
     * Check if connected.
     */
    isConnected() {
        return this.connection !== null;
    }
    /**
     * Check if game has been started (via start() or connect()).
     */
    isStarted() {
        return this.gameStarted;
    }
    /**
     * Get current frame.
     */
    getFrame() {
        return this.currentFrame;
    }
    /**
     * Get server tick rate.
     */
    getServerFps() {
        return this.serverFps;
    }
    /**
     * Get render interpolation alpha (0-1).
     */
    getRenderAlpha() {
        if (this.lastTickTime === 0)
            return 1;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = now - this.lastTickTime;
        return Math.min(elapsed / this.tickIntervalMs, 1.0);
    }
    /**
     * Send input to network.
     */
    sendInput(input) {
        if (!this.connection)
            return;
        const binary = encode(input);
        this.connection.send(binary);
    }
    /**
     * Leave current room and stop the game.
     */
    leaveRoom() {
        if (this.connection) {
            this.connection.leaveRoom();
            this.connection = null;
        }
        this.stopGameLoop();
    }
    /**
     * Stop the game loop.
     *
     * Use this to pause or end the game. The game state is preserved.
     * Call start() or connect() to resume.
     */
    stop() {
        this.stopGameLoop();
        console.log('[ecs] Game stopped');
    }
    /**
     * Get local client ID.
     */
    get localClientId() {
        return this.localClientIdStr;
    }
    /**
     * Set local client ID.
     */
    setLocalClientId(clientId) {
        this.localClientIdStr = clientId;
        const numId = this.internClientId(clientId);
        this.world.localClientId = numId;
    }
    /**
     * Get room ID.
     */
    getRoomId() {
        return this.connectedRoomId;
    }
    /**
     * Get last snapshot info.
     */
    getLastSnapshot() {
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
    getClients() {
        return this.activeClients;
    }
    /**
     * Get client ID (for debug UI).
     */
    getClientId() {
        return this.localClientIdStr;
    }
    /**
     * Get node URL (for debug UI).
     */
    getNodeUrl() {
        // Could be tracked from connection, for now return null
        return null;
    }
    /**
     * Get upload rate in bytes/second (for debug UI).
     */
    getUploadRate() {
        return this.connection?.bandwidthOut || 0;
    }
    /**
     * Get download rate in bytes/second (for debug UI).
     */
    getDownloadRate() {
        return this.connection?.bandwidthIn || 0;
    }
    /**
     * Get drift stats (for debug UI).
     * Authority clients show 100% until they receive a comparison snapshot.
     */
    getDriftStats() {
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
     * Get hash-based sync stats (for debug UI).
     * Returns the rolling percentage of hash checks that passed.
     */
    getSyncStats() {
        const total = this.hashChecksPassed + this.hashChecksFailed;
        const syncPercent = total > 0 ? (this.hashChecksPassed / total) * 100 : 100;
        return {
            syncPercent,
            passed: this.hashChecksPassed,
            failed: this.hashChecksFailed,
            isDesynced: this.isDesynced,
            resyncPending: this.resyncPending
        };
    }
    /**
     * Attach a renderer.
     */
    setRenderer(renderer) {
        this.renderer = renderer;
    }
    /**
     * Get canvas from attached renderer.
     */
    getCanvas() {
        return this.renderer?.element ?? null;
    }
    /**
     * Get reliability scores (for debug UI).
     */
    getReliabilityScores() {
        return { ...this.reliabilityScores };
    }
    /**
     * Get active clients list (for debug UI).
     */
    getActiveClients() {
        return [...this.activeClients];
    }
    /**
     * Get local world entity count (for debug UI).
     */
    getEntityCount() {
        return this.world.entityCount;
    }
    /**
     * Get state sync delta bandwidth in bytes/second (for debug UI).
     */
    getDeltaBandwidth() {
        return this.deltaBytesPerSecond;
    }
}
// ==========================================
// GameEntityBuilder
// ==========================================
/**
 * Game-specific entity builder with fluent API.
 */
export class GameEntityBuilder {
    constructor(game, name) {
        this.game = game;
        this.name = name;
        this.inputCommandsDef = null;
        this.worldBuilder = game.world.defineEntity(name);
    }
    /**
     * Add a component to the entity definition.
     */
    with(component, defaults) {
        this.worldBuilder.with(component, defaults);
        return this;
    }
    /**
     * Define input commands for this entity type.
     */
    commands(def) {
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
    syncOnly(fields) {
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
    syncNone() {
        this.worldBuilder._setSyncFields([]);
        return this;
    }
    /**
     * @deprecated Use syncOnly() instead for clarity
     */
    sync(fields) {
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
    onRestore(callback) {
        this.worldBuilder._setOnRestore(callback);
        return this;
    }
    /**
     * Finalize and register the entity definition.
     */
    register() {
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
export function createGame() {
    console.log('[MODU] Engine version: BUILD_50');
    return new Game();
}
