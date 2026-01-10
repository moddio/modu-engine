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
import { World } from './core/world';
import { Player } from './components';
import { encode, decode } from './codec';
import { loadRandomState, saveRandomState } from './math/random';
import { INDEX_MASK } from './core/constants';
import { computePartitionAssignment, getClientPartitions, computeStateDelta, getPartition, computePartitionCount, isDeltaEmpty } from './sync';
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
        /** All connected client IDs (in join order for determinism) */
        this.connectedClients = [];
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
        /** Last snapshot info for debug UI */
        this.lastSnapshotHash = null;
        this.lastSnapshotFrame = 0;
        this.lastSnapshotSize = 0;
        this.lastSnapshotEntityCount = 0;
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
    // ==========================================
    // Network Connection
    // ==========================================
    /**
     * Connect to a multiplayer room.
     */
    async connect(roomId, callbacks, options = {}) {
        this.callbacks = callbacks;
        // Allow URL params to override (for testing)
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('room'))
                roomId = params.get('room');
            if (params.get('nodeUrl'))
                options.nodeUrl = params.get('nodeUrl');
        }
        this.connectedRoomId = roomId;
        // Get network SDK
        const network = window.moduNetwork;
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
            this.localClientIdStr = this.connection.clientId;
            // Set up state sync callbacks
            if (this.connection.onReliabilityUpdate !== undefined) {
                this.connection.onReliabilityUpdate = (scores, version) => {
                    this.handleReliabilityUpdate(scores, version);
                };
            }
            if (this.connection.onMajorityHash !== undefined) {
                this.connection.onMajorityHash = (frame, hash) => {
                    this.handleMajorityHash(frame, hash);
                };
            }
            if (this.connection.onResyncSnapshot !== undefined) {
                this.connection.onResyncSnapshot = (data, frame) => {
                    this.handleResyncSnapshot(data, frame);
                };
            }
        }
        catch (err) {
            console.warn('[ecs] Connection failed:', err?.message || err);
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
        // Compare our hash with majority to detect desync
        const localHash = this.world.getStateHash();
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
        console.log(`[state-sync] Received resync snapshot (${data.length} bytes) for frame ${serverFrame}`);
        // Decode the snapshot
        let snapshot;
        try {
            const decoded = decode(data);
            snapshot = decoded?.snapshot;
            if (!snapshot) {
                console.error(`[state-sync] Failed to decode resync snapshot - no snapshot data`);
                this.resyncPending = false;
                return;
            }
        }
        catch (e) {
            console.error(`[state-sync] Failed to decode resync snapshot:`, e);
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
        if (newLocalHash === serverHash) {
            console.log(`[state-sync] Hard recovery successful - hashes now match`);
            console.log(`  New local hash: ${newLocalHash.toString(16).padStart(8, '0')}`);
        }
        else {
            console.error(`[state-sync] Hard recovery may have issues - hash mismatch after resync!`);
            console.error(`  Expected: ${serverHash?.toString(16).padStart(8, '0')}`);
            console.error(`  Got:      ${newLocalHash.toString(16).padStart(8, '0')}`);
        }
        // Store as last good snapshot
        this.lastGoodSnapshot = {
            snapshot: JSON.parse(JSON.stringify(snapshot)),
            frame: serverFrame,
            hash: newLocalHash
        };
        console.log(`[state-sync] === END RESYNC ===`);
    }
    /**
     * Log detailed diff between local state and authority snapshot.
     * Called during resync to help diagnose what went wrong.
     */
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
                    snapshot = decode(snapshot)?.snapshot || null;
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
            if (DEBUG_NETWORK)
                console.log(`[ecs] Late join: restoring snapshot frame=${snapshot.frame}`);
            // 1. Restore snapshot
            this.currentFrame = snapshot.frame || frame;
            this.loadNetworkSnapshot(snapshot);
            // 2. Build authority chain from ALL inputs
            for (const input of inputs) {
                this.processAuthorityChainInput(input);
            }
            // 3. Call onSnapshot callback
            // CRITICAL: onSnapshot runs ONLY on late joiners, so we MUST isolate RNG.
            // Any dRandom() usage here would advance late joiner's RNG while authority's stays unchanged.
            const rngStateSnapshot = saveRandomState();
            if (this.callbacks.onSnapshot) {
                this.callbacks.onSnapshot(this.world.getAllEntities());
            }
            loadRandomState(rngStateSnapshot);
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
        }
        else {
            // === FIRST JOINER PATH ===
            if (DEBUG_NETWORK)
                console.log('[ecs] First join: creating room');
            this.currentFrame = frame;
            // First joiner is always authority
            this.authorityClientId = clientId;
            if (!this.connectedClients.includes(clientId)) {
                this.connectedClients.push(clientId);
            }
            this.callbacks.onRoomCreate?.();
            // Process all inputs (may include our own join event)
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
        if (DEBUG_NETWORK)
            console.log('[ecs] Game loop started');
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
        // 3. Call game's onTick callback
        this.callbacks.onTick?.(frame);
        // 4. Send deferred snapshot if pending
        if (this.pendingSnapshotUpload && this.checkIsAuthority()) {
            this.sendSnapshot('join');
            this.pendingSnapshotUpload = false;
        }
        // 5. Record tick time for interpolation
        this.lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // 6. Send state sync data (stateHash + partition data if assigned)
        this.sendStateSync(frame);
        // 7. Check for desync using majority hash from server
        if (majorityHash !== undefined && majorityHash !== 0) {
            this.handleMajorityHash(frame - 1, majorityHash);
        }
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
        // Partition-based delta sync: send only changed entity data for assigned partitions
        if (this.activeClients.length > 0 && this.connection.clientId && this.connection.sendPartitionData) {
            const currentSnapshot = this.world.getSparseSnapshot();
            // First tick: just store snapshot, don't send delta (nothing to compare to)
            if (!this.prevSnapshot) {
                this.prevSnapshot = currentSnapshot;
                return;
            }
            // Compute delta between previous and current state
            const delta = computeStateDelta(this.prevSnapshot, currentSnapshot);
            // Only send if there are actual changes
            if (!isDeltaEmpty(delta)) {
                const entityCount = this.world.entityCount;
                const numPartitions = computePartitionCount(entityCount, this.activeClients.length);
                const assignment = computePartitionAssignment(entityCount, this.activeClients, frame, this.reliabilityScores);
                const myPartitions = getClientPartitions(assignment, this.connection.clientId);
                for (const partitionId of myPartitions) {
                    const partitionData = getPartition(delta, partitionId, numPartitions);
                    // Only send if this partition has data (not just empty JSON)
                    if (partitionData.length > 50) { // Empty partition JSON is ~45 bytes
                        this.connection.sendPartitionData(frame, partitionId, partitionData);
                        this.deltaBytesThisSecond += 8 + partitionData.length;
                    }
                }
            }
            this.prevSnapshot = currentSnapshot;
        }
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
            // Track connected clients
            if (!this.connectedClients.includes(clientId)) {
                this.connectedClients.push(clientId);
            }
            // Update activeClients for state sync (sorted for deterministic assignment)
            if (!this.activeClients.includes(clientId)) {
                this.activeClients.push(clientId);
                this.activeClients.sort();
            }
            // First joiner becomes authority
            if (this.authorityClientId === null) {
                this.authorityClientId = clientId;
            }
            if (DEBUG_NETWORK) {
                console.log(`[ecs] Join: ${clientId.slice(0, 8)}, authority=${this.authorityClientId?.slice(0, 8)}`);
            }
            // CRITICAL: Save RNG state before conditional callback.
            // onConnect may be skipped for clients that already have entities from snapshot.
            // If the callback uses dRandom(), we must ensure the global RNG is NOT affected,
            // so that all clients maintain identical RNG state regardless of which callbacks ran.
            // The entity positions from callbacks are preserved in snapshots - only RNG sync matters.
            const rngState = saveRandomState();
            // Call callback ONLY if this client doesn't already have an entity from snapshot
            // This prevents duplicate entity creation during catchup
            if (this.clientsWithEntitiesFromSnapshot.has(clientId)) {
                if (DEBUG_NETWORK) {
                    console.log(`[ecs] Skipping onConnect for ${clientId.slice(0, 8)} - already has entity from snapshot`);
                }
            }
            else {
                this.callbacks.onConnect?.(clientId);
            }
            // Restore RNG state - callback's random usage doesn't affect global simulation RNG
            loadRandomState(rngState);
            // Mark snapshot needed
            if (this.checkIsAuthority()) {
                this.pendingSnapshotUpload = true;
            }
        }
        else if (type === 'leave' || type === 'disconnect') {
            // Remove from connected clients
            const idx = this.connectedClients.indexOf(clientId);
            if (idx !== -1) {
                this.connectedClients.splice(idx, 1);
            }
            // Remove from activeClients for state sync
            const activeIdx = this.activeClients.indexOf(clientId);
            if (activeIdx !== -1) {
                this.activeClients.splice(activeIdx, 1);
            }
            // Transfer authority if needed
            if (clientId === this.authorityClientId) {
                this.authorityClientId = this.connectedClients[0] || null;
            }
            if (DEBUG_NETWORK) {
                console.log(`[ecs] Leave: ${clientId.slice(0, 8)}, new authority=${this.authorityClientId?.slice(0, 8)}`);
            }
            // CRITICAL: Save/restore RNG around onDisconnect callback.
            // While onDisconnect typically runs on all clients, we isolate it for safety.
            // If the callback has conditional logic or error handling that uses dRandom(),
            // isolating it prevents subtle desyncs.
            const rngStateDisconnect = saveRandomState();
            this.callbacks.onDisconnect?.(clientId);
            loadRandomState(rngStateDisconnect);
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
        if (type === 'join') {
            if (!this.connectedClients.includes(clientId)) {
                this.connectedClients.push(clientId);
            }
            if (this.authorityClientId === null) {
                this.authorityClientId = clientId;
            }
        }
        else if (type === 'leave' || type === 'disconnect') {
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
    runCatchup(startFrame, endFrame, inputs) {
        const ticksToRun = endFrame - startFrame + 1;
        if (DEBUG_NETWORK) {
            console.log(`[ecs] Catchup: ${ticksToRun} ticks from ${startFrame} to ${endFrame}, ${inputs.length} inputs`);
        }
        // CRITICAL: Sort all inputs by seq to ensure correct order within frames
        // Multiple inputs can occur in a single frame - seq determines order
        const sortedInputs = [...inputs].sort((a, b) => (a.seq || 0) - (b.seq || 0));
        // Build map of frame -> inputs for that frame (sorted by seq)
        const inputsByFrame = new Map();
        for (const input of sortedInputs) {
            // Inputs without frame are assigned to startFrame (first catchup frame)
            const frame = input.frame ?? startFrame;
            if (!inputsByFrame.has(frame)) {
                inputsByFrame.set(frame, []);
            }
            inputsByFrame.get(frame).push(input);
        }
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
            // Call game's onTick
            this.callbacks.onTick?.(tickFrame);
        }
        this.currentFrame = endFrame;
        this.lastProcessedFrame = endFrame; // Prevent re-processing old frames
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
        // Compute minimal ID allocator state from entities
        let maxIndex = 0;
        const activeGenerations = {};
        for (const e of entities) {
            const eid = e[0];
            const index = eid & INDEX_MASK;
            const gen = eid >>> 20;
            if (index >= maxIndex)
                maxIndex = index + 1;
            activeGenerations[index] = gen;
        }
        return {
            frame: this.currentFrame,
            seq: this.lastInputSeq,
            postTick: true, // Snapshot is taken after tick - late joiners should NOT re-run this frame
            format: 5, // Format 5: type-indexed compact encoding
            types, // Type names array (sent once)
            schema, // Component schemas indexed by type index
            entities, // Array of [eid, typeIndex, values[]]
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
    loadNetworkSnapshot(snapshot) {
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
            this.clientIdToNum = new Map(Object.entries(snapshot.clientIdMap.toNum).map(([k, v]) => [k, v]));
            this.numToClientId = new Map(Array.from(this.clientIdToNum.entries()).map(([k, v]) => [v, k]));
            this.nextClientNum = snapshot.clientIdMap.nextNum || 1;
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
            if (snapshot.format >= 3 && typeof state.generations === 'object' && !Array.isArray(state.generations)) {
                // Minimal format - reconstruct full state
                this.world.idAllocator.reset();
                this.world.idAllocator.setNextId(state.nextIndex);
                // Set generations for active entities
                for (const [indexStr, gen] of Object.entries(state.generations)) {
                    const index = parseInt(indexStr, 10);
                    this.world.idAllocator.generations[index] = gen;
                }
                // Compute free list: indices from 0 to nextIndex that aren't in active generations
                const freeList = [];
                for (let i = 0; i < state.nextIndex; i++) {
                    if (!(i.toString() in state.generations)) {
                        freeList.push(i);
                    }
                }
                this.world.idAllocator.freeList = freeList;
            }
            else {
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
                const components = {};
                for (const comp of firstEntity.getComponents()) {
                    const data = {};
                    for (const fieldName of comp.fieldNames) {
                        data[fieldName] = firstEntity.get(comp)[fieldName];
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
     * Start the render loop.
     */
    startGameLoop() {
        if (this.gameLoop)
            return;
        const loop = () => {
            // Render
            if (this.renderer?.render) {
                this.renderer.render();
            }
            else if (this.callbacks.render) {
                this.callbacks.render();
            }
            // Note: With distributed state sync, we no longer send periodic snapshots.
            // Snapshots are only sent on-demand for late joiners (server requests from any reliable client).
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
     * Handle disconnect.
     */
    handleDisconnect() {
        if (DEBUG_NETWORK)
            console.log('[ecs] Disconnected');
        this.stopGameLoop();
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
     * Leave current room.
     */
    leaveRoom() {
        if (this.connection) {
            this.connection.leaveRoom();
            this.connection = null;
            this.stopGameLoop();
        }
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
        return this.connectedClients;
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
    return new Game();
}
