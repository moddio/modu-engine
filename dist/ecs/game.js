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
import { World } from './world';
import { Player } from './components';
import { encode, decode } from '../codec';
import { loadRandomState, saveRandomState } from '../math/random';
import { INDEX_MASK } from './constants';
// Debug flag - set to false for production
const DEBUG_NETWORK = true;
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
        /** Tick timing for render interpolation */
        this.lastTickTime = 0;
        this.tickIntervalMs = 50; // 20fps default
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
     */
    getStateHash() {
        return this.world.getStateHash();
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
                onTick: (frame, inputs) => {
                    this.handleTick(frame, inputs);
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
        }
        catch (err) {
            console.warn('[ecs] Connection failed:', err?.message || err);
            this.connection = null;
            this.connectedRoomId = null;
        }
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
        }
        else {
            // === FIRST JOINER PATH ===
            if (DEBUG_NETWORK)
                console.log('[ecs] First join: creating room');
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
        if (DEBUG_NETWORK)
            console.log('[ecs] Game loop started');
    }
    /**
     * Handle server tick.
     */
    handleTick(frame, inputs) {
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
            }
            else {
                this.callbacks.onConnect?.(clientId);
            }
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
            // Transfer authority if needed
            if (clientId === this.authorityClientId) {
                this.authorityClientId = this.connectedClients[0] || null;
            }
            if (DEBUG_NETWORK) {
                console.log(`[ecs] Leave: ${clientId.slice(0, 8)}, new authority=${this.authorityClientId?.slice(0, 8)}`);
            }
            // Call callback
            this.callbacks.onDisconnect?.(clientId);
        }
        else if (data) {
            // Game input - route to entity's InputState component
            this.routeInputToEntity(clientId, data);
        }
    }
    /**
     * Route game input to the entity's InputState component.
     */
    routeInputToEntity(clientId, data) {
        const numId = this.internClientId(clientId);
        // Use O(1) clientId index lookup instead of iterating
        const entity = this.world.getEntityByClientId(numId);
        if (DEBUG_NETWORK) {
            console.log(`[ecs] routeInput: clientId=${clientId.slice(0, 8)}, numId=${numId}, entity=${entity?.eid || 'null'}, data=${JSON.stringify(data)}`);
        }
        if (entity) {
            // Store input in world's input registry for systems to read
            this.world.setInput(numId, data);
        }
        else if (DEBUG_NETWORK) {
            console.log(`[ecs] WARNING: No entity for clientId ${clientId.slice(0, 8)} (numId=${numId})`);
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
        // Schema-based encoding: send field names once, then just values per entity
        // This reduces snapshot size by ~80% for large entity counts
        // Build schema: { entityType: [[compName, [field1, field2, ...]], ...] }
        const schema = {};
        const entities = [];
        for (const entity of this.world.getAllEntities()) {
            const index = entity.eid & INDEX_MASK;
            const type = entity.type;
            // Build schema for this entity type if not exists
            if (!schema[type]) {
                schema[type] = [];
                for (const comp of entity.getComponents()) {
                    schema[type].push([comp.name, comp.fieldNames]);
                }
            }
            // Encode values as flat array matching schema order
            const values = [];
            for (const comp of entity.getComponents()) {
                for (const fieldName of comp.fieldNames) {
                    values.push(comp.storage.fields[fieldName][index]);
                }
            }
            entities.push([
                parseInt(entity.eid.toString(16), 16), // eid as number
                type,
                values
            ]);
        }
        // Compute minimal ID allocator state from entities
        let maxIndex = 0;
        const activeGenerations = {};
        for (const e of entities) {
            const eid = e[0]; // eid is first element
            const index = eid & INDEX_MASK;
            const gen = eid >>> 20;
            if (index >= maxIndex)
                maxIndex = index + 1;
            activeGenerations[index] = gen;
        }
        return {
            frame: this.currentFrame,
            seq: this.lastInputSeq,
            format: 4, // Format 4: schema-based compact encoding
            schema, // Component/field names sent once
            entities, // Array of [eid, type, values[]]
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
        // Format 4: schema-based compact encoding
        // entities = [[eid, type, [values...]], ...]
        // schema = { type: [[compName, [field1, field2, ...]], ...] }
        const schema = snapshot.schema;
        const entitiesData = snapshot.entities;
        for (const entityData of entitiesData) {
            const [eid, type, values] = entityData;
            // Spawn entity with specific eid
            let entity;
            try {
                entity = this.world.spawnWithId(type, eid, {});
            }
            catch (e) {
                console.warn(`[ecs] Failed to spawn ${type} with eid ${eid}:`, e);
                continue;
            }
            // Restore values using schema
            const typeSchema = schema[type];
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
     * Format 4: schema-based encoding where entities = [[eid, type, values[]], ...]
     */
    compareSnapshotFields(serverSnapshot) {
        let matchingFields = 0;
        let totalFields = 0;
        const diffs = [];
        // Format 4: entities = [[eid, type, values[]], ...]
        // schema = { entityType: [[compName, [field1, field2, ...]], ...] }
        const serverEntities = serverSnapshot.entities || [];
        const schema = serverSnapshot.schema || {};
        // Build map of server entities by eid (numeric)
        const serverEntityMap = new Map();
        for (const e of serverEntities) {
            serverEntityMap.set(e[0], e); // e[0] is eid (numeric)
        }
        // Compare each local entity with server entity
        for (const entity of this.world.getAllEntities()) {
            const eid = entity.eid;
            const serverEntity = serverEntityMap.get(eid);
            const index = eid & INDEX_MASK;
            if (!serverEntity) {
                // Entity exists locally but not on server - count all fields as mismatched
                for (const comp of entity.getComponents()) {
                    totalFields += comp.fieldNames.length;
                }
                if (diffs.length < 10) {
                    diffs.push(`Entity ${eid.toString(16)} (${entity.type}) exists locally but not on server`);
                }
                continue;
            }
            // Format 4: serverEntity = [eid, type, values[]]
            const [, serverType, serverValues] = serverEntity;
            const typeSchema = schema[serverType];
            if (!typeSchema) {
                // No schema for this type - can't compare
                continue;
            }
            // Build index into serverValues based on schema
            let valueIdx = 0;
            for (const [compName, fieldNames] of typeSchema) {
                // Find matching local component
                const localComp = entity.getComponents().find(c => c.name === compName);
                for (const fieldName of fieldNames) {
                    totalFields++;
                    const serverValue = serverValues[valueIdx++];
                    if (localComp) {
                        const localValue = localComp.storage.fields[fieldName][index];
                        const fieldDef = localComp.schema[fieldName];
                        let valuesMatch = false;
                        if (fieldDef?.type === 'bool') {
                            // Booleans: local is 0/1, server is true/false or 0/1
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
                        else if (diffs.length < 10) {
                            diffs.push(`${entity.type}.${compName}.${fieldName}: local=${localValue}, server=${serverValue}`);
                        }
                    }
                }
            }
        }
        // Count server entities not in local state
        for (const [eid, serverEntity] of serverEntityMap) {
            if (this.world.getEntity(eid) === null) {
                const [, serverType, serverValues] = serverEntity;
                totalFields += serverValues.length;
                if (diffs.length < 10) {
                    diffs.push(`Entity ${eid.toString(16)} (${serverType}) exists on server but not locally`);
                }
            }
        }
        // Update drift stats
        this.driftStats.totalChecks++;
        this.driftStats.matchingFieldCount = matchingFields;
        this.driftStats.totalFieldCount = totalFields;
        this.driftStats.determinismPercent = totalFields > 0
            ? (matchingFields / totalFields) * 100
            : 100;
        // Log diffs if sync is not 100%
        if (diffs.length > 0 && this.driftStats.determinismPercent < 100) {
            console.warn(`[ecs] Sync ${matchingFields}/${totalFields} (${this.driftStats.determinismPercent.toFixed(1)}%):`);
            for (const diff of diffs) {
                console.warn(`  - ${diff}`);
            }
        }
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
        let lastSnapshotFrame = 0;
        const SNAPSHOT_INTERVAL = 100; // Every 5 seconds at 20fps
        const loop = () => {
            // Render
            if (this.renderer?.render) {
                this.renderer.render();
            }
            else if (this.callbacks.render) {
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
