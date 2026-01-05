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
import { EntityManager, registerClass } from './entity/entity-manager';
import { EntityBuilder } from './entity/entity-builder';
import { snapshotEntities, restoreEntities } from './entity/snapshot';
import { getEntityIdCounter } from './entity/entity';
import { World as ECSWorld } from './ecs';
import { createWorld2D, getBody2DIdCounter, setBody2DIdCounter, setEntity2DEngineRef } from './components/physics2d';
import { setCanvasRendererEngineRef } from './canvas-renderer';
import { createWorld, getBodyIdCounter, setBodyIdCounter } from './components/physics3d';
import { setJoiningClientContext, setEngineRef as setInputEngineRef } from './components/input';
import { setPlayerEngineRef } from './entity/player';
import { toFixed } from './math/fixed';
import { encode, decode } from './codec';
// Debug flag - set to true to enable verbose network logging
const DEBUG_NETWORK = true;
/**
 * ModuEngine - Deterministic Multiplayer Sync Engine
 *
 * Syncs entities across all clients using ordered inputs from the network.
 * Physics-agnostic - your game decides what physics (if any) to use.
 */
export class ModuEngine {
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
    get physics() {
        return this._physics;
    }
    set physics(physics2d) {
        this._physics = physics2d;
        if (physics2d?.world) {
            // Wire Physics2D's world to the entity manager
            this.world = physics2d.world;
            this.entityManager.setPhysicsWorld(physics2d.world);
            // Set back-reference so world can call Physics2D handlers
            physics2d.world.physics2d = physics2d;
        }
    }
    constructor(options = {}) {
        /** 2D Physics world (if physics: '2d' was specified) */
        this.world = null;
        /** 3D Physics world (if physics: '3d' was specified) */
        this.world3D = null;
        /** Physics2D system instance */
        this._physics = null;
        this.connection = null;
        this.gameCallbacks = null;
        this.localClientId = null;
        this.connectedNodeUrl = null;
        this.connectedAppId = null;
        this.connectedRoomId = null;
        this.lastSnapshotHash = null;
        this.lastSnapshotFrame = 0;
        this.currentFrame = 0;
        this.lastInputSeq = 0;
        // Bandwidth tracking (uses SDK's actual wire bytes, not JSON sizes)
        this.lastBytesIn = 0;
        this.lastBytesOut = 0;
        this.lastBandwidthCheck = 0;
        // Defer snapshot upload until after tick() completes
        this.pendingSnapshotUpload = false;
        this.uploadRate = 0;
        this.downloadRate = 0;
        // Tick timing for render interpolation
        this.lastTickTime = 0;
        this.tickIntervalMs = 50; // 20fps = 50ms
        this.gameLoop = null;
        this.totalClients = 1;
        this.serverFps = 20;
        this.connectedClients = [];
        this.authorityClientId = null;
        /** Attached renderer (auto-renders each frame) */
        this.renderer = null;
        // Drift detection - purely frame-based
        this.lastCheckedSnapshotFrame = 0; // Last snapshot frame we compared
        this.driftStats = {
            totalChecks: 0,
            matchingFieldCount: 0,
            totalFieldCount: 0,
            lastCheckFrame: 0,
            lastDriftedFields: []
        };
        /** Predicted inputs awaiting server confirmation (clientId -> Set of input hashes) */
        this.predictedInputs = new Map();
        this.entityManager = new EntityManager();
        this.ecs = new ECSWorld();
        // Set engine reference for components that need it
        setInputEngineRef(this);
        setCanvasRendererEngineRef(this);
        setEntity2DEngineRef(this);
        setPlayerEngineRef(this);
        // Create physics world if requested
        if (options.physics === '2d') {
            // dt = 1/20 for 20fps server tick rate
            const world2d = createWorld2D(1 / 20);
            const gx = options.gravity?.x ?? 0;
            const gy = options.gravity?.y ?? 0;
            world2d.gravity = { x: toFixed(gx), y: toFixed(gy) };
            this.world = world2d;
            // Set up entity manager to auto-add physics bodies to world on restore
            this.entityManager.setPhysicsWorld(world2d);
        }
        else if (options.physics === '3d') {
            const world3d = createWorld();
            const gx = options.gravity?.x ?? 0;
            const gy = options.gravity?.y ?? -30;
            const gz = options.gravity?.z ?? 0;
            world3d.gravity = { x: toFixed(gx), y: toFixed(gy), z: toFixed(gz) };
            this.world3D = world3d;
            // Set up entity manager to auto-add physics bodies to world on restore
            this.entityManager.setPhysicsWorld3D(world3d);
        }
    }
    getNetworkSDK() {
        const network = window.moduNetwork;
        if (!network) {
            throw new Error('moduNetwork not found. Include modu-network.js before calling modu functions');
        }
        return network;
    }
    // Deprecated: these used JSON.stringify which inflated sizes
    // Now using SDK's actual wire byte counts instead
    trackSent(_data) {
        // No-op: bandwidth now tracked via SDK's totalBytesOut
    }
    trackReceived(_data) {
        // No-op: bandwidth now tracked via SDK's totalBytesIn
    }
    updateBandwidthRates() {
        if (!this.connection)
            return;
        const now = Date.now();
        const elapsed = (now - this.lastBandwidthCheck) / 1000;
        if (elapsed >= 1) {
            // Use SDK's actual wire byte counts
            const currentBytesIn = this.connection.totalBytesIn;
            const currentBytesOut = this.connection.totalBytesOut;
            this.downloadRate = (currentBytesIn - this.lastBytesIn) / elapsed;
            this.uploadRate = (currentBytesOut - this.lastBytesOut) / elapsed;
            this.lastBytesIn = currentBytesIn;
            this.lastBytesOut = currentBytesOut;
            this.lastBandwidthCheck = now;
        }
    }
    doSendSnapshot(snapshot, hash, source) {
        if (this.connection) {
            if (DEBUG_NETWORK) {
                console.log(`[modu] Sending snapshot (${source || 'unknown'}):`, {
                    frame: snapshot?.frame,
                    seq: snapshot?.seq,
                    entityCount: snapshot?.entities?.entities?.length || 0,
                    idCounters: snapshot?.idCounters,
                    hash,
                    localClientId: this.localClientId?.slice(0, 8),
                    authorityClientId: this.authorityClientId?.slice(0, 8),
                    isAuthority: this.localClientId === this.authorityClientId
                });
            }
            // Binary encode snapshot
            const binary = encode({ snapshot, hash });
            // Always log snapshot uploads to track bandwidth
            console.log(`[modu] UPLOADING snapshot (${source}): ${binary.length} bytes, entities=${snapshot?.entities?.entities?.length}, frame=${snapshot?.frame}`);
            this.trackSent(binary);
            // Pass seq/frame as metadata so server can filter inputs without decoding binary
            this.connection.sendSnapshot(binary, hash, snapshot?.seq, snapshot?.frame);
        }
    }
    getSnapshot(postTick = false) {
        // Include body ID counters if physics world exists
        let getIdCounters;
        if (this.world) {
            getIdCounters = () => ({ body2d: getBody2DIdCounter() });
        }
        else if (this.world3D) {
            getIdCounters = () => ({ body3d: getBodyIdCounter() });
        }
        // CRITICAL: Sync physics state to entity.sync BEFORE taking snapshot
        // moveToward() and physics step update body.position directly, but entity.sync
        // is only updated when syncToEntity() is called. Without this, snapshots
        // contain stale positions causing late joiners to drift.
        for (const entity of this.entityManager.getAll()) {
            const physicsComp = entity.getComponent('physics2d');
            if (physicsComp && typeof physicsComp.syncToEntity === 'function') {
                physicsComp.syncToEntity();
            }
            const physics3dComp = entity.getComponent('physics3d');
            if (physics3dComp && typeof physics3dComp.syncToEntity === 'function') {
                physics3dComp.syncToEntity();
            }
        }
        const snapshot = snapshotEntities(this.currentFrame, this.entityManager, true, undefined, getIdCounters);
        // Include input sequence so server knows which inputs are already in the snapshot
        snapshot.seq = this.lastInputSeq;
        // Mark whether this snapshot was taken after tick(frame) ran
        snapshot.postTick = postTick;
        return snapshot;
    }
    loadSnapshot(snapshot) {
        if (snapshot && snapshot.entities) {
            // Restore body ID counters if physics world exists
            let setIdCounters;
            if (this.world) {
                setIdCounters = (counters) => {
                    if (counters.body2d !== undefined)
                        setBody2DIdCounter(counters.body2d);
                };
            }
            else if (this.world3D) {
                setIdCounters = (counters) => {
                    if (counters.body3d !== undefined)
                        setBodyIdCounter(counters.body3d);
                };
            }
            // Restore all entities via EntityManager (factories create components)
            const restored = restoreEntities(snapshot, this.entityManager, undefined, setIdCounters);
            if (restored) {
                // Restore input sequence to continue from where snapshot was taken
                if (snapshot.seq !== undefined) {
                    this.lastInputSeq = snapshot.seq;
                }
            }
            else {
                // Snapshot was invalid/incompatible - start fresh
                if (DEBUG_NETWORK)
                    console.warn('[modu] Snapshot restore failed, initializing fresh game state');
                this.gameCallbacks?.onRoomCreate();
            }
        }
        else {
            this.gameCallbacks?.onRoomCreate();
        }
    }
    updateClientCount() {
        this.totalClients = this.connectedClients.length;
    }
    processInput(input) {
        if (!this.gameCallbacks)
            return;
        // Check if this input was already reflected in the loaded snapshot
        const inputSeq = input.seq ?? 0;
        const alreadyInSnapshot = inputSeq > 0 && inputSeq <= this.lastInputSeq;
        // Decode binary data if needed
        let data = input.data;
        if (data instanceof Uint8Array) {
            try {
                data = decode(data);
            }
            catch (e) {
                console.warn('[modu] Failed to decode binary input:', e);
                return;
            }
        }
        const clientId = data?.clientId || input.clientId;
        const type = data?.type;
        // Track input sequence for snapshot filtering
        if (inputSeq > this.lastInputSeq) {
            this.lastInputSeq = inputSeq;
        }
        if (type === 'join') {
            // Track connected clients (maintain input order for determinism)
            if (!this.connectedClients.includes(clientId)) {
                this.connectedClients.push(clientId);
                this.updateClientCount();
            }
            // First joiner becomes the authority for sending snapshots
            // This is deterministic: all clients process inputs in the same order
            if (this.authorityClientId === null) {
                this.authorityClientId = clientId;
            }
            // Only call onConnect/onJoin if not already in snapshot
            // If player is in snapshot, onSnapshot callback handles their setup
            if (!alreadyInSnapshot) {
                // Set joining context so InputComponent can capture clientId automatically
                setJoiningClientContext(clientId);
                // Prefer onConnect, fall back to deprecated onJoin
                if (this.gameCallbacks.onConnect) {
                    this.gameCallbacks.onConnect(clientId);
                }
                else {
                    this.gameCallbacks.onJoin?.(clientId);
                }
                setJoiningClientContext(null);
            }
            // Mark that snapshot should be sent after this tick completes
            // This ensures the snapshot includes the full post-tick state
            const isAuthority = this.localClientId === this.authorityClientId;
            if (DEBUG_NETWORK)
                console.log(`[modu] Join input: clientId=${clientId?.slice(0, 8)}, alreadyInSnapshot=${alreadyInSnapshot}, isAuthority=${isAuthority}, willUpload=${!alreadyInSnapshot && this.connection && isAuthority}`);
            if (!alreadyInSnapshot && this.connection && isAuthority) {
                this.pendingSnapshotUpload = true;
            }
        }
        else if (type === 'leave' || type === 'disconnect') {
            // Update connected clients list
            const idx = this.connectedClients.indexOf(clientId);
            if (idx !== -1) {
                this.connectedClients.splice(idx, 1);
                this.updateClientCount();
            }
            // If authority leaves, assign to next client (first in list)
            if (clientId === this.authorityClientId) {
                this.authorityClientId = this.connectedClients.length > 0 ? this.connectedClients[0] : null;
            }
            // Only call onDisconnect/onLeave if not already in snapshot
            if (!alreadyInSnapshot) {
                // Prefer onDisconnect, fall back to deprecated onLeave
                if (this.gameCallbacks.onDisconnect) {
                    this.gameCallbacks.onDisconnect(clientId);
                }
                else {
                    this.gameCallbacks.onLeave?.(clientId);
                }
            }
        }
        else if (data && !type) {
            // Skip game inputs already reflected in snapshot
            if (!alreadyInSnapshot) {
                // Store in registry - InputComponent reads from here in its onUpdate()
                this.entityManager.inputRegistry.set(clientId, data);
                // Check if this input was already predicted locally
                const inputHash = JSON.stringify(data);
                const pending = this.predictedInputs.get(clientId);
                const wasPredicted = pending?.has(inputHash);
                if (wasPredicted) {
                    pending.delete(inputHash);
                    if (DEBUG_NETWORK)
                        console.log('[modu] Skipping predicted input from', clientId?.slice(0, 8));
                }
                else if (this.gameCallbacks.onInput) {
                    // Only apply if not already predicted
                    this.gameCallbacks.onInput(clientId, data);
                }
            }
            else if (DEBUG_NETWORK) {
                console.log(`[modu] Skipping game input from ${clientId?.slice(0, 8)} seq=${inputSeq} (alreadyInSnapshot, lastInputSeq=${this.lastInputSeq})`);
            }
        }
    }
    startGameLoop() {
        if (this.gameLoop)
            return;
        let lastSnapshot = 0;
        const loop = () => {
            if (!this.gameCallbacks)
                return;
            // Auto-render if renderer is attached (preferred) or use legacy callback
            if (this.renderer?.render) {
                this.renderer.render();
            }
            else if (this.gameCallbacks.render) {
                this.gameCallbacks.render();
            }
            // Send snapshot periodically for late joiners and drift detection
            // Only authority client sends snapshots to ensure consistency
            const SNAPSHOT_INTERVAL = 100; // Every 5 seconds at 20fps
            const isAuthority = this.localClientId === this.authorityClientId;
            if (this.connection && this.currentFrame - lastSnapshot >= SNAPSHOT_INTERVAL) {
                if (isAuthority) {
                    // Periodic snapshots are taken AFTER ticks run (in game loop)
                    this.doSendSnapshot(this.getSnapshot(true), this.entityManager.getStateHash(), 'loop');
                    lastSnapshot = this.currentFrame;
                }
            }
            this.updateBandwidthRates();
            this.gameLoop = requestAnimationFrame(loop);
        };
        this.gameLoop = requestAnimationFrame(loop);
    }
    stopGameLoop() {
        if (this.gameLoop) {
            cancelAnimationFrame(this.gameLoop);
            this.gameLoop = null;
        }
    }
    /**
     * Connect to a multiplayer room
     */
    async connect(roomId, callbacks, options = {}) {
        if (!callbacks) {
            throw new Error('game callbacks required');
        }
        this.gameCallbacks = callbacks;
        // Allow URL params to override for testing (room, nodeUrl)
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('room'))
                roomId = params.get('room');
            if (params.get('nodeUrl'))
                options.nodeUrl = params.get('nodeUrl');
        }
        this.connectedRoomId = roomId;
        const network = this.getNetworkSDK();
        console.log(`[modu] Connecting to room "${roomId}"...`);
        try {
            this.connection = await network.connect(roomId, {
                nodeUrl: options.nodeUrl,
                centralServiceUrl: options.centralServiceUrl,
                appId: 'dev',
                joinToken: options.joinToken,
                onConnect: (snapshot, inputs, frame, nodeUrl, fps, clientId) => {
                    // Decode binary snapshot if needed (network layer passes opaque bytes)
                    if (snapshot instanceof Uint8Array) {
                        // Empty or too small to be valid - no snapshot available
                        if (snapshot.length < 2) {
                            snapshot = null;
                        }
                        else {
                            try {
                                const decoded = decode(snapshot);
                                // Binary format wraps as { snapshot, hash }
                                snapshot = decoded?.snapshot || null;
                            }
                            catch (e) {
                                console.error('[modu] Failed to decode binary snapshot:', e);
                                snapshot = null;
                            }
                        }
                    }
                    if (DEBUG_NETWORK)
                        console.log('[modu] onConnect START', { frame, clientId, hasSnapshot: !!snapshot?.entities, inputCount: inputs.length });
                    this.trackReceived({ snapshot, inputs, frame, fps, clientId });
                    this.lastBandwidthCheck = Date.now();
                    this.localClientId = clientId;
                    this.connectedNodeUrl = nodeUrl;
                    this.serverFps = fps;
                    this.tickIntervalMs = 1000 / fps; // Update tick interval for interpolation
                    // Don't set currentFrame yet - will be set based on snapshot or server frame
                    // Store the snapshotHash (hex string) from the server
                    // SDK attaches snapshotHash to snapshot object in INITIAL_STATE
                    if (snapshot?.snapshotHash) {
                        this.lastSnapshotHash = snapshot.snapshotHash;
                        this.lastSnapshotFrame = snapshot.frame || frame;
                    }
                    else if (snapshot?.hash !== undefined) {
                        // Fallback: convert numeric hash to hex for consistency
                        this.lastSnapshotHash = typeof snapshot.hash === 'number'
                            ? snapshot.hash.toString(16).padStart(8, '0')
                            : String(snapshot.hash);
                        this.lastSnapshotFrame = snapshot.frame || frame;
                    }
                    if (DEBUG_NETWORK) {
                        console.log(`[modu] Connected as ${this.localClientId}, frame ${frame}, fps ${fps}, ${inputs.length} inputs`);
                        console.log(`[modu] Received snapshot:`, {
                            hasEntities: !!snapshot?.entities,
                            entityCount: snapshot?.entities?.entities?.length || 0,
                            frame: snapshot?.frame,
                            postTick: snapshot?.postTick,
                            hash: snapshot?.hash,
                            seq: snapshot?.seq,
                            idCounters: snapshot?.idCounters,
                            rng: snapshot?.rng ? { s0: snapshot.rng.s0, s1: snapshot.rng.s1 } : 'none'
                        });
                    }
                    const hasValidSnapshot = snapshot && Object.keys(snapshot).length > 0 && snapshot.entities;
                    if (DEBUG_NETWORK)
                        console.log('[modu] hasValidSnapshot:', hasValidSnapshot);
                    if (hasValidSnapshot) {
                        // Use snapshot's frame - we'll catch up via server ticks
                        this.currentFrame = snapshot.frame || frame;
                        if (DEBUG_NETWORK)
                            console.log('[modu] calling loadSnapshot...');
                        this.loadSnapshot(snapshot);
                        if (DEBUG_NETWORK)
                            console.log('[modu] loadSnapshot done');
                        if (DEBUG_NETWORK) {
                            console.log(`[modu] After loadSnapshot: frame=${this.currentFrame}, entities=${this.entityManager.count}, hash=${this.entityManager.getStateHash()}, entityIdCounter=${getEntityIdCounter().toString(16)}, snapshotIdCounter=${(snapshot.idCounters?.entity || 0).toString(16)}`);
                        }
                        // CRITICAL: Process ALL join/leave events (even those in snapshot) to set up authority chain
                        // This ensures connectedClients and authorityClientId are correct before catchup
                        const snapshotSeq = snapshot.seq || 0;
                        for (const input of inputs) {
                            const data = input.data;
                            const type = data?.type;
                            const clientId = data?.clientId || input.clientId;
                            if (type === 'join') {
                                if (!this.connectedClients.includes(clientId)) {
                                    this.connectedClients.push(clientId);
                                    this.updateClientCount();
                                }
                                if (this.authorityClientId === null) {
                                    this.authorityClientId = clientId;
                                }
                            }
                            else if (type === 'leave' || type === 'disconnect') {
                                const idx = this.connectedClients.indexOf(clientId);
                                if (idx !== -1) {
                                    this.connectedClients.splice(idx, 1);
                                    this.updateClientCount();
                                }
                                if (clientId === this.authorityClientId) {
                                    this.authorityClientId = this.connectedClients.length > 0 ? this.connectedClients[0] : null;
                                }
                            }
                        }
                        if (DEBUG_NETWORK) {
                            console.log(`[modu] Authority chain set up: authority=${this.authorityClientId?.slice(0, 8)}, clients=[${this.connectedClients.map(c => c.slice(0, 8)).join(',')}]`);
                        }
                        // Call onSnapshot with restored entities so game can set up non-serializable state
                        if (this.gameCallbacks?.onSnapshot) {
                            this.gameCallbacks.onSnapshot(this.entityManager.getAll());
                        }
                        // Filter out inputs already reflected in the snapshot
                        // Inputs with seq <= snapshot.seq are already included in the snapshot state
                        // CRITICAL: Sort by seq to ensure consistent order during catchup vs real-time
                        const pendingInputs = inputs.filter(i => i.seq > snapshotSeq).sort((a, b) => a.seq - b.seq);
                        if (DEBUG_NETWORK)
                            console.log(`[modu] Filtering inputs: total=${inputs.length}, snapshotSeq=${snapshotSeq}, pending=${pendingInputs.length}`);
                        // Run simulation ticks for each frame we're behind
                        // If snapshot is pre-tick (join snapshot): run tick(snapshotFrame)...tick(serverFrame)
                        // If snapshot is post-tick (periodic snapshot): run tick(snapshotFrame+1)...tick(serverFrame)
                        const snapshotFrame = this.currentFrame;
                        const isPostTick = snapshot.postTick === true;
                        const startFrame = isPostTick ? snapshotFrame + 1 : snapshotFrame;
                        const ticksToRun = frame - startFrame + 1;
                        if (DEBUG_NETWORK) {
                            console.log(`[modu] Catchup: snapshotFrame=${snapshotFrame}, serverFrame=${frame}, postTick=${isPostTick}, ticksToRun=${ticksToRun}`);
                            const inputSummary = pendingInputs.slice(0, 10).map(i => `seq=${i.seq}@f${i.frame}:${i.data?.type || 'game'}`).join(', ');
                            console.log(`[modu] Pending inputs (${pendingInputs.length}): ${inputSummary}${pendingInputs.length > 10 ? '...' : ''}`);
                        }
                        if (ticksToRun > 0 && this.gameCallbacks) {
                            if (DEBUG_NETWORK)
                                console.log(`[modu] Running tick(${startFrame}) through tick(${frame})...`);
                            // Separate inputs with frame info from those without
                            const inputsWithFrame = pendingInputs.filter(i => i.frame !== undefined);
                            const inputsWithoutFrame = pendingInputs.filter(i => i.frame === undefined);
                            // Process frameless inputs FIRST (before any ticks)
                            // This happens when inputs come from HTTP API without frame info
                            if (inputsWithoutFrame.length > 0) {
                                if (DEBUG_NETWORK) {
                                    console.log(`[modu] Processing ${inputsWithoutFrame.length} frameless inputs before catchup ticks`);
                                }
                                for (const input of inputsWithoutFrame) {
                                    this.processInput(input);
                                }
                            }
                            if (DEBUG_NETWORK) {
                                console.log(`[modu] CATCHUP: running ${ticksToRun} ticks from frame ${startFrame}, entities=${this.entityManager.count}, bodies=${this.world?.bodies?.length || 0}`);
                                console.log(`[modu] CATCHUP inputs: ${inputsWithFrame.length} with frame, ${inputsWithoutFrame.length} without frame`);
                            }
                            for (let f = 0; f < ticksToRun; f++) {
                                const tickFrame = startFrame + f;
                                // 1. Process inputs with matching frame (stores in registry)
                                for (const input of inputsWithFrame) {
                                    if (input.frame === tickFrame) {
                                        if (DEBUG_NETWORK)
                                            console.log(`[modu] CATCHUP processing input seq=${input.seq} at frame=${tickFrame}:`, input.data?.type || 'game');
                                        this.processInput(input);
                                    }
                                }
                                // 2. Update all entities, components, and step physics
                                this.entityManager.update(tickFrame);
                                // 3. Game tick (game-specific logic)
                                this.gameCallbacks.onTick?.();
                            }
                            if (DEBUG_NETWORK)
                                console.log(`[modu] CATCHUP done: entities=${this.entityManager.count}, bodies=${this.world?.bodies?.length || 0}`);
                            this.currentFrame = frame;
                            if (DEBUG_NETWORK) {
                                console.log(`[modu] Caught up to frame ${this.currentFrame}, entities: ${this.entityManager.count}, hash: ${this.entityManager.getStateHash()}, entityIdCounter: ${getEntityIdCounter().toString(16)}`);
                            }
                        }
                        else if (ticksToRun <= 0 && this.gameCallbacks) {
                            // Edge case: we're already caught up (post-tick snapshot at current frame)
                            // But we still need to process pending inputs (like disconnect events)!
                            this.currentFrame = frame;
                            if (DEBUG_NETWORK)
                                console.log(`[modu] Already caught up at frame ${this.currentFrame}, processing ${pendingInputs.length} pending inputs`);
                            for (const input of pendingInputs) {
                                this.processInput(input);
                            }
                        }
                        else {
                            // No frames to catch up - just process inputs that happened at current frame
                            if (DEBUG_NETWORK)
                                console.log(`[modu] No catchup needed, processing ${pendingInputs.length} pending inputs`);
                            for (const input of pendingInputs) {
                                this.processInput(input);
                            }
                        }
                    }
                    else {
                        if (DEBUG_NETWORK)
                            console.log('[modu] No snapshot, calling init...');
                        this.currentFrame = frame;
                        try {
                            this.gameCallbacks.onRoomCreate();
                            if (DEBUG_NETWORK)
                                console.log('[modu] init done, entities:', this.entityManager.getAll().length);
                        }
                        catch (e) {
                            console.error('[modu] ERROR in init():', e);
                            throw e;
                        }
                        // Fresh game - process all inputs
                        if (DEBUG_NETWORK)
                            console.log('[modu] Processing', inputs.length, 'inputs...');
                        for (const input of inputs) {
                            this.processInput(input);
                        }
                        if (DEBUG_NETWORK)
                            console.log('[modu] Inputs processed');
                    }
                    // Send initial snapshot if we're the authority
                    // Authority is set by processInput when handling join events
                    const isAuthority = this.localClientId === this.authorityClientId;
                    if (DEBUG_NETWORK)
                        console.log('[modu] About to send initial snapshot, isAuthority:', isAuthority);
                    if (isAuthority || this.authorityClientId === null) {
                        this.doSendSnapshot(this.getSnapshot(), this.entityManager.getStateHash(), 'init');
                    }
                    if (DEBUG_NETWORK)
                        console.log('[modu] Starting game loop...');
                    this.startGameLoop();
                    if (DEBUG_NETWORK)
                        console.log('[modu] onConnect DONE');
                },
                onTick: (frame, inputs) => {
                    this.trackReceived({ frame, inputs });
                    this.currentFrame = frame;
                    if (DEBUG_NETWORK && inputs.length > 0) {
                        const types = inputs.map(i => i.data?.type || 'game').join(',');
                        const clientIds = inputs.map(i => (i.clientId || 'unknown').slice(0, 8)).join(',');
                        console.log(`[modu] onTick frame=${frame}: ${inputs.length} inputs (types: ${types}), clients=[${clientIds}], seqs=${inputs.map(i => i.seq).join(',')}`);
                    }
                    // Save previous state for all physics entities BEFORE processing
                    // This enables smooth render interpolation between ticks
                    for (const entity of this.entityManager.getAll()) {
                        const phys = entity.getComponent('physics2d');
                        if (phys?.savePreviousState)
                            phys.savePreviousState();
                    }
                    // 1. Process inputs (stores in entityManager.inputRegistry)
                    for (const input of inputs) {
                        this.processInput(input);
                    }
                    if (this.gameCallbacks) {
                        // 2. Update all entities, components, and step physics
                        this.entityManager.update(frame);
                        // 3. Game tick (game-specific logic)
                        this.gameCallbacks.onTick?.();
                        // Send deferred snapshot after tick completes (ensures post-tick state)
                        if (this.pendingSnapshotUpload) {
                            if (DEBUG_NETWORK)
                                console.log(`[modu] Sending deferred snapshot after tick ${frame}`);
                            this.pendingSnapshotUpload = false;
                            this.doSendSnapshot(this.getSnapshot(true), this.entityManager.getStateHash(), 'join');
                        }
                    }
                    // Record tick time for interpolation alpha calculation
                    this.lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
                },
                onError: (error) => {
                    console.error('[modu] Network error:', error);
                },
                onDisconnect: () => {
                    if (DEBUG_NETWORK)
                        console.log('[modu] Disconnected');
                    this.stopGameLoop();
                },
                onBinarySnapshot: (data) => {
                    // Received server snapshot from authority - compare at same frame
                    console.log(`[modu] onBinarySnapshot: received ${data.length} bytes at frame ${this.currentFrame}`);
                    this.compareWithServerSnapshot(data);
                }
            });
            this.localClientId = this.connection.clientId;
        }
        catch (err) {
            // Graceful error handling - don't throw uncaught promise
            const message = err?.message || String(err);
            // Parse common error types for user-friendly messages
            if (message.includes('Failed to get node assignment')) {
                console.warn('[modu] Connection failed: Could not reach game server.');
                console.warn('[modu] Make sure the network services are running (npm run dev in /network)');
            }
            else if (message.includes('fetch') || message.includes('NetworkError')) {
                console.warn('[modu] Connection failed: Network error.');
                console.warn('[modu] Check your internet connection and server URL.');
            }
            else {
                console.warn('[modu] Connection failed:', message);
            }
            // Reset connection state
            this.connection = null;
            this.connectedRoomId = null;
            this.localClientId = null;
        }
    }
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
    sendInput(input) {
        if (this.connection) {
            if (DEBUG_NETWORK)
                console.log('[modu] Sending game input:', input);
            const binary = encode(input);
            this.trackSent(binary);
            this.connection.send(binary);
        }
    }
    /**
     * Leave the current room
     */
    leaveRoom() {
        if (this.connection) {
            this.connection.leaveRoom();
            this.connection = null;
            this.localClientId = null;
            this.stopGameLoop();
        }
    }
    /**
     * List available rooms for an app
     */
    async listRooms(appId, options = {}) {
        const network = this.getNetworkSDK();
        return network.listRooms(appId, options);
    }
    /**
     * Get a random room for matchmaking
     */
    async getRandomRoom(appId, options = {}) {
        const network = this.getNetworkSDK();
        return network.getRandomRoom(appId, options);
    }
    /** Get local client ID */
    getClientId() {
        return this.localClientId;
    }
    /** Get all connected client IDs */
    getClients() {
        return this.connectedClients;
    }
    /** Check if this client is the snapshot authority */
    isAuthority() {
        return this.localClientId !== null && this.localClientId === this.authorityClientId;
    }
    /** Check if connected */
    isConnected() {
        return this.connection !== null;
    }
    /** Get server tick rate (fps) */
    getServerFps() {
        return this.serverFps;
    }
    /** Get connected app ID */
    getAppId() {
        return this.connectedAppId;
    }
    /** Get connected room ID */
    getRoomId() {
        return this.connectedRoomId;
    }
    /** Get upload bandwidth in bytes per second */
    getUploadRate() {
        return this.uploadRate;
    }
    /** Get download bandwidth in bytes per second */
    getDownloadRate() {
        return this.downloadRate;
    }
    /** Get current frame (server-authoritative) */
    getFrame() {
        return this.currentFrame;
    }
    /**
     * Get render interpolation alpha (0-1).
     * Use this to smoothly interpolate between physics ticks for rendering.
     * Returns 0 at start of tick interval, approaches 1 just before next tick.
     */
    getRenderAlpha() {
        if (this.lastTickTime === 0)
            return 1; // No tick yet, show current state
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = now - this.lastTickTime;
        return Math.min(elapsed / this.tickIntervalMs, 1.0);
    }
    /** Get connected node URL */
    getNodeUrl() {
        return this.connectedNodeUrl;
    }
    /** Get last received snapshot info */
    getLastSnapshot() {
        return { hash: this.lastSnapshotHash, frame: this.lastSnapshotFrame };
    }
    /** Get current state hash (hex string) */
    getStateHash() {
        return this.entityManager.getStateHash();
    }
    /**
     * Get the local player's entity (entity with InputComponent matching local clientId).
     * Returns null if not found.
     */
    getLocalPlayer() {
        if (!this.localClientId)
            return null;
        for (const entity of this.entityManager.getAll()) {
            const input = entity.getComponent('input');
            if (input?.clientId === this.localClientId) {
                return entity;
            }
        }
        return null;
    }
    /**
     * Get all entities of a specific type.
     * @param type - Entity type (e.g., 'player', 'food', 'bullet')
     * @returns Array of entities (empty if none found)
     */
    getEntitiesByType(type) {
        return this.entityManager.byType[type] || [];
    }
    /**
     * Get entity by ID.
     * @param id - Entity ID
     * @returns Entity or null if not found
     */
    getEntityById(id) {
        return this.entityManager.entities[id] || null;
    }
    /**
     * Get player entity by client ID.
     * Finds entity with sync.clientId matching the given clientId.
     * @param clientId - Client ID
     * @returns Entity or null if not found
     */
    getPlayer(clientId) {
        return this.entityManager.getByClientId(clientId);
    }
    /**
     * Get all players.
     * @returns Array of all Player entities
     */
    getPlayers() {
        return this.entityManager.getAll().filter((e) => e.input !== undefined);
    }
    /**
     * Get all entities.
     * @returns Array of all entities
     */
    getAllEntities() {
        return this.entityManager.getAll();
    }
    /**
     * Reset all entities (clears the world).
     * Usually called in init() callback.
     */
    reset() {
        this.entityManager.reset();
    }
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
    register(...classes) {
        for (const cls of classes) {
            registerClass(cls);
        }
        return this;
    }
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
    defineEntity(type) {
        return new EntityBuilder(this, type);
    }
    // ============================================
    // New ECS API (replaces .tick(), .build())
    // ============================================
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
    addSystem(fn, options = {}) {
        return this.ecs.addSystem(fn, options);
    }
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
    query(typeOrComponent) {
        return this.ecs.query(typeOrComponent);
    }
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
    spawn(type, data = {}) {
        return this.ecs.spawn(type, data);
    }
    /**
     * Attach a renderer for auto-rendering each frame.
     * Called automatically by CanvasRenderer constructor.
     */
    setRenderer(renderer) {
        this.renderer = renderer;
    }
    /**
     * Get the canvas element from attached renderer.
     * Used by InputComponent for auto-binding mouse input.
     */
    getCanvas() {
        return this.renderer?.element ?? null;
    }
    // ============================================
    // Drift Detection
    // ============================================
    /**
     * Check for state drift against server snapshot.
     * Compares actual field values for meaningful determinism %.
     */
    compareWithServerSnapshot(serverData) {
        // Decode server snapshot to get frame number
        let serverSnapshot;
        let serverFrame;
        let serverHash;
        try {
            const decoded = decode(serverData);
            serverSnapshot = decoded?.snapshot;
            serverFrame = serverSnapshot?.frame || 0;
            serverHash = decoded?.hash || serverSnapshot?.hash?.toString(16) || '';
        }
        catch (e) {
            console.warn('[DRIFT] Failed to decode server snapshot:', e);
            return;
        }
        if (!serverSnapshot?.entities?.entities) {
            if (DEBUG_NETWORK)
                console.log('[DRIFT] Server snapshot has no entities');
            return;
        }
        // Update last received snapshot info for UI
        this.lastSnapshotHash = serverHash;
        this.lastSnapshotFrame = serverFrame;
        // Don't recheck the same snapshot frame
        if (this.lastCheckedSnapshotFrame === serverFrame)
            return;
        this.lastCheckedSnapshotFrame = serverFrame;
        this.driftStats.totalChecks++;
        // Get local snapshot for comparison (current state)
        const localSnapshot = this.getSnapshot(true);
        if (!localSnapshot?.entities?.entities) {
            console.warn('[DRIFT] Local snapshot has no entities');
            return;
        }
        // Compare field-by-field
        const result = this.compareSnapshots(localSnapshot.entities, serverSnapshot.entities);
        // Update stats
        this.driftStats.matchingFieldCount = result.matchingFields;
        this.driftStats.totalFieldCount = result.totalFields;
        this.driftStats.lastDriftedFields = result.driftedFields;
        this.driftStats.lastCheckFrame = serverFrame;
        const determinism = this.getDeterminismPercent();
        if (result.driftedFields.length > 0) {
            console.warn(`[DRIFT] Frame ${serverFrame} (local ${this.currentFrame}): ${determinism.toFixed(1)}% determinism (${result.matchingFields}/${result.totalFields} fields match)`);
            console.warn(`  Drifted: ${result.driftedFields.slice(0, 10).join(', ')}${result.driftedFields.length > 10 ? '...' : ''}`);
        }
        else {
            console.log(`[SYNC] Frame ${serverFrame}: 100% determinism (${result.totalFields} fields)`);
        }
    }
    /**
     * Compare two snapshot entity states field-by-field.
     */
    compareSnapshots(localState, serverState) {
        let matchingFields = 0;
        let totalFields = 0;
        const driftedFields = [];
        // Build lookup by entity ID for server state
        const serverEntities = new Map();
        for (const entity of serverState.entities || []) {
            serverEntities.set(entity.id, entity);
        }
        // Compare each local entity against server
        for (const localEntity of localState.entities || []) {
            const serverEntity = serverEntities.get(localEntity.id);
            if (!serverEntity) {
                // Entity exists locally but not on server
                const fieldCount = Object.keys(localEntity.sync || {}).length;
                totalFields += fieldCount;
                for (const key of Object.keys(localEntity.sync || {})) {
                    driftedFields.push(`${localEntity.type}:${localEntity.id.slice(0, 8)}.${key} (extra local)`);
                }
                continue;
            }
            // Compare sync fields
            const localSync = localEntity.sync || {};
            const serverSync = serverEntity.sync || {};
            const allKeys = new Set([...Object.keys(localSync), ...Object.keys(serverSync)]);
            for (const key of allKeys) {
                totalFields++;
                const localVal = localSync[key];
                const serverVal = serverSync[key];
                if (this.valuesEqual(localVal, serverVal)) {
                    matchingFields++;
                }
                else {
                    const localStr = this.formatValue(localVal);
                    const serverStr = this.formatValue(serverVal);
                    driftedFields.push(`${localEntity.type}:${localEntity.id.slice(0, 8)}.${key} (${localStr} vs ${serverStr})`);
                }
            }
            // Remove from server map (to find server-only entities later)
            serverEntities.delete(localEntity.id);
        }
        // Check for entities that exist on server but not locally
        for (const [id, serverEntity] of serverEntities) {
            const fieldCount = Object.keys(serverEntity.sync || {}).length;
            totalFields += fieldCount;
            for (const key of Object.keys(serverEntity.sync || {})) {
                driftedFields.push(`${serverEntity.type}:${id.slice(0, 8)}.${key} (extra server)`);
            }
        }
        return { matchingFields, totalFields, driftedFields };
    }
    /**
     * Compare two values for equality (handles objects/arrays).
     */
    valuesEqual(a, b) {
        if (a === b)
            return true;
        if (a === null || b === null)
            return false;
        if (a === undefined || b === undefined)
            return false;
        if (typeof a !== typeof b)
            return false;
        if (typeof a === 'object') {
            // Compare as JSON strings for deep equality
            return JSON.stringify(a) === JSON.stringify(b);
        }
        return false;
    }
    /**
     * Format a value for display in drift logs.
     */
    formatValue(val) {
        if (val === null)
            return 'null';
        if (val === undefined)
            return 'undefined';
        if (typeof val === 'number')
            return val.toFixed(2);
        if (typeof val === 'string')
            return `"${val.slice(0, 10)}"`;
        if (typeof val === 'object')
            return JSON.stringify(val).slice(0, 20);
        return String(val);
    }
    /**
     * Get determinism percentage based on field-by-field comparison.
     */
    getDeterminismPercent() {
        if (this.driftStats.totalFieldCount === 0)
            return 100;
        return (this.driftStats.matchingFieldCount / this.driftStats.totalFieldCount) * 100;
    }
    /**
     * Get drift statistics for debug UI.
     */
    getDriftStats() {
        return {
            ...this.driftStats,
            determinismPercent: this.getDeterminismPercent()
        };
    }
}
