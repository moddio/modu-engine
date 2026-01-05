/**
 * ECS World
 *
 * Main entry point for the ECS system. Manages:
 * - Entity definitions and spawning
 * - Component management
 * - Query engine
 * - System scheduler
 * - String interning
 */
import { EntityIdAllocator } from './entity-id';
import { SparseSnapshotCodec } from './snapshot';
import { defineComponent as defineComponentInternal, addComponentToEntity, initializeComponentDefaults, removeComponentFromEntity } from './component';
import { QueryEngine } from './query';
import { SystemScheduler } from './system';
import { EntityPool } from './entity';
import { INDEX_MASK } from './constants';
import { toFixed } from '../math';
import { StringRegistry } from './string-registry';
import { InputHistory } from './input-history';
/**
 * Entity definition builder.
 */
export class EntityBuilder {
    constructor(world, name) {
        this.world = world;
        this.name = name;
        this.components = [];
        this.registered = false;
    }
    /**
     * Add a component to this entity definition.
     */
    with(component, defaults) {
        this.components.push({
            type: component,
            defaults: defaults
        });
        // Register immediately (idempotent - just overwrites with latest)
        this.register();
        return this;
    }
    /**
     * Finalize entity definition.
     */
    register() {
        this.world._registerEntityDef({
            name: this.name,
            components: this.components
        });
    }
    /**
     * Force immediate registration (for sync usage).
     */
    _ensureRegistered() {
        if (!this.registered) {
            this.registered = true;
        }
        this.register();
    }
    /**
     * Get the entity definition (for internal use).
     */
    _getDefinition() {
        return {
            name: this.name,
            components: this.components
        };
    }
}
/**
 * ECS World - main container for all ECS state.
 */
export class World {
    constructor() {
        /** Entity definitions */
        this.entityDefs = new Map();
        /** Active entity eids */
        this.activeEntities = new Set();
        /** Entity type by eid */
        this.entityTypes = new Map();
        /** Entity components by eid */
        this.entityComponents = new Map();
        /** Client ID by eid */
        this.entityClientIds = new Map();
        /** Input registry: clientId → input data */
        this.inputRegistry = new Map();
        /** Whether running on client */
        this._isClient = true;
        // ==========================================
        // Sparse Snapshot API (Efficient)
        // ==========================================
        /** Snapshot codec */
        this.snapshotCodec = new SparseSnapshotCodec();
        /** Current frame number */
        this.frame = 0;
        /** Current sequence number */
        this.seq = 0;
        // ==========================================
        // Network Integration (Phase 3)
        // ==========================================
        /**
         * Network input format.
         */
        this.inputBuffer = new Map();
        // ==========================================
        // Client-Side Prediction (Phase 4)
        // ==========================================
        /** Local client ID for prediction */
        this.localClientId = null;
        /** Pending predictions awaiting server confirmation */
        this.predictions = [];
        /** Rollback buffer for state restoration */
        this.rollbackBuffer = new Map();
        /** Maximum frames to keep in rollback buffer */
        this.rollbackBufferSize = 60;
        /** Input history for rollback resimulation */
        this.inputHistory = new InputHistory(120);
        this.idAllocator = new EntityIdAllocator();
        this.entityPool = new EntityPool();
        this.strings = new StringRegistry();
        // Create query engine with callbacks
        this.queryEngine = new QueryEngine((eid) => this.getEntity(eid), (eid) => this.isDestroyed(eid));
        this.scheduler = new SystemScheduler();
        // Register interpolation state saving in prePhysics phase
        this.addSystem(() => this.saveInterpolationState(), { phase: 'prePhysics', order: -1000 });
    }
    /**
     * Set whether running on client.
     */
    setIsClient(isClient) {
        this._isClient = isClient;
        this.scheduler.setIsClient(isClient);
    }
    /**
     * Check if running on client.
     */
    get isClient() {
        return this._isClient;
    }
    // ==========================================
    // Component API
    // ==========================================
    /**
     * Define a new component type.
     */
    defineComponent(name, defaults) {
        return defineComponentInternal(name, defaults);
    }
    // ==========================================
    // Entity Definition API
    // ==========================================
    /**
     * Define a new entity type.
     */
    defineEntity(name) {
        const builder = new EntityBuilder(this, name);
        // Auto-register when builder methods are done
        // We need to defer this, so we'll register on first spawn or explicitly
        return builder;
    }
    /**
     * Register an entity definition (internal).
     */
    _registerEntityDef(def) {
        this.entityDefs.set(def.name, def);
    }
    // ==========================================
    // Entity Spawning/Destruction
    // ==========================================
    /**
     * Spawn a new entity.
     */
    spawn(typeOrBuilder, props = {}) {
        // Handle EntityBuilder
        let typeName;
        if (typeof typeOrBuilder === 'string') {
            typeName = typeOrBuilder;
        }
        else {
            const def = typeOrBuilder._getDefinition();
            this._registerEntityDef(def);
            typeName = def.name;
        }
        // Get entity definition
        const def = this.entityDefs.get(typeName);
        if (!def) {
            throw new Error(`Unknown entity type: '${typeName}'`);
        }
        // Allocate entity ID
        const eid = this.idAllocator.allocate();
        const index = eid & INDEX_MASK;
        // Get entity wrapper
        const entity = this.entityPool.acquire(eid);
        // Track entity
        this.activeEntities.add(eid);
        this.entityTypes.set(eid, typeName);
        // Initialize components
        const componentTypes = [];
        for (const compDef of def.components) {
            const component = compDef.type;
            componentTypes.push(component);
            // Add to storage
            addComponentToEntity(component.storage, index);
            initializeComponentDefaults(component.storage, index);
            // Apply definition defaults
            if (compDef.defaults) {
                for (const [key, value] of Object.entries(compDef.defaults)) {
                    const arr = component.storage.fields[key];
                    if (arr) {
                        const fieldDef = component.storage.schema[key];
                        if (fieldDef.type === 'i32') {
                            arr[index] = toFixed(value);
                        }
                        else if (fieldDef.type === 'bool') {
                            arr[index] = value ? 1 : 0;
                        }
                        else {
                            arr[index] = value;
                        }
                    }
                }
            }
        }
        // Apply spawn props (route to components)
        let clientId;
        for (const [key, value] of Object.entries(props)) {
            if (key === 'clientId') {
                clientId = value;
                this.entityClientIds.set(eid, clientId);
            }
            // Route to first component that has this field
            for (const component of componentTypes) {
                if (key in component.storage.schema) {
                    const arr = component.storage.fields[key];
                    const fieldDef = component.storage.schema[key];
                    if (fieldDef.type === 'i32') {
                        arr[index] = toFixed(value);
                    }
                    else if (fieldDef.type === 'bool') {
                        arr[index] = value ? 1 : 0;
                    }
                    else {
                        arr[index] = value;
                    }
                    break; // Route to first matching component
                }
            }
        }
        // Store components
        this.entityComponents.set(eid, componentTypes);
        // Initialize entity wrapper
        entity._init(eid, typeName, componentTypes, this);
        // Register in query engine
        this.queryEngine.addEntity(eid, typeName, componentTypes, clientId);
        return entity;
    }
    /**
     * Spawn an entity with a specific eid (for snapshot restore).
     * This is used when restoring entities to preserve their original IDs.
     */
    spawnWithId(typeOrBuilder, targetEid, props = {}) {
        let typeName;
        if (typeof typeOrBuilder === 'string') {
            typeName = typeOrBuilder;
        }
        else {
            const def = typeOrBuilder._getDefinition();
            this._registerEntityDef(def);
            typeName = def.name;
        }
        // Get entity definition
        const def = this.entityDefs.get(typeName);
        if (!def) {
            throw new Error(`Unknown entity type: '${typeName}'`);
        }
        // Allocate specific entity ID
        const eid = this.idAllocator.allocateSpecific(targetEid);
        const index = eid & INDEX_MASK;
        // Get entity wrapper
        const entity = this.entityPool.acquire(eid);
        // Track entity
        this.activeEntities.add(eid);
        this.entityTypes.set(eid, typeName);
        // Initialize components
        const componentTypes = [];
        for (const compDef of def.components) {
            const component = compDef.type;
            componentTypes.push(component);
            // Add to storage
            addComponentToEntity(component.storage, index);
            initializeComponentDefaults(component.storage, index);
            // Apply definition defaults
            if (compDef.defaults) {
                for (const [key, value] of Object.entries(compDef.defaults)) {
                    const arr = component.storage.fields[key];
                    if (arr) {
                        const fieldDef = component.storage.schema[key];
                        if (fieldDef.type === 'i32') {
                            arr[index] = toFixed(value);
                        }
                        else if (fieldDef.type === 'bool') {
                            arr[index] = value ? 1 : 0;
                        }
                        else {
                            arr[index] = value;
                        }
                    }
                }
            }
        }
        // Apply spawn props (route to components)
        let clientId;
        for (const [key, value] of Object.entries(props)) {
            if (key === 'clientId') {
                clientId = value;
                this.entityClientIds.set(eid, clientId);
            }
            // Route to first component that has this field
            for (const compDef of def.components) {
                const arr = compDef.type.storage.fields[key];
                if (arr) {
                    const fieldDef = compDef.type.storage.schema[key];
                    if (fieldDef.type === 'i32') {
                        arr[index] = toFixed(value);
                    }
                    else if (fieldDef.type === 'bool') {
                        arr[index] = value ? 1 : 0;
                    }
                    else {
                        arr[index] = value;
                    }
                    break; // Route to first matching component
                }
            }
        }
        // Store components
        this.entityComponents.set(eid, componentTypes);
        // Initialize entity wrapper
        entity._init(eid, typeName, componentTypes, this);
        // Register in query engine
        this.queryEngine.addEntity(eid, typeName, componentTypes, clientId);
        return entity;
    }
    /**
     * Destroy an entity.
     */
    destroyEntity(entity) {
        const eid = entity.eid;
        if (!this.activeEntities.has(eid)) {
            return; // Already destroyed
        }
        const typeName = this.entityTypes.get(eid) || '';
        const components = this.entityComponents.get(eid) || [];
        const clientId = this.entityClientIds.get(eid);
        const index = eid & INDEX_MASK;
        // Remove from component storage
        for (const component of components) {
            removeComponentFromEntity(component.storage, index);
        }
        // Remove from query engine
        this.queryEngine.removeEntity(eid, typeName, components, clientId);
        // Clean up tracking
        this.activeEntities.delete(eid);
        this.entityTypes.delete(eid);
        this.entityComponents.delete(eid);
        this.entityClientIds.delete(eid);
        // Return entity wrapper to pool
        this.entityPool.release(eid);
        // Free entity ID
        this.idAllocator.free(eid);
    }
    /**
     * Get entity by eid.
     */
    getEntity(eid) {
        if (!this.activeEntities.has(eid)) {
            return null;
        }
        const entity = this.entityPool.get(eid);
        if (entity && !entity.destroyed) {
            return entity;
        }
        return null;
    }
    /**
     * Check if entity is destroyed.
     */
    isDestroyed(eid) {
        return !this.activeEntities.has(eid);
    }
    /**
     * Get entity by clientId (O(1) lookup).
     */
    getEntityByClientId(clientId) {
        const eid = this.queryEngine.getByClientId(clientId);
        if (eid === undefined)
            return null;
        return this.getEntity(eid);
    }
    /**
     * Set clientId for an entity (for snapshot restore).
     * Updates both entityClientIds map and queryEngine index.
     */
    setEntityClientId(eid, clientId) {
        this.entityClientIds.set(eid, clientId);
        this.queryEngine.setClientId(eid, clientId);
    }
    // ==========================================
    // Query API
    // ==========================================
    /**
     * Query entities by type or component.
     */
    query(typeOrComponent, ...moreComponents) {
        return this.queryEngine.query(typeOrComponent, ...moreComponents);
    }
    /**
     * Get all active entities.
     */
    getAllEntities() {
        const result = [];
        // Sort eids for determinism
        const sortedEids = Array.from(this.activeEntities).sort((a, b) => a - b);
        for (const eid of sortedEids) {
            const entity = this.entityPool.get(eid);
            if (entity) {
                result.push(entity);
            }
        }
        return result;
    }
    /**
     * Get all active entity IDs.
     */
    getAllEntityIds() {
        return Array.from(this.activeEntities).sort((a, b) => a - b);
    }
    // ==========================================
    // System API
    // ==========================================
    /**
     * Add a system.
     */
    addSystem(fn, options) {
        return this.scheduler.add(fn, options);
    }
    /**
     * Run all systems.
     */
    runSystems() {
        this.scheduler.runAll();
    }
    // ==========================================
    // String Interning API
    // ==========================================
    /**
     * Intern a string, get back an integer ID.
     */
    internString(namespace, str) {
        return this.strings.intern(namespace, str);
    }
    /**
     * Look up string by ID.
     */
    getString(namespace, id) {
        return this.strings.getString(namespace, id);
    }
    // ==========================================
    // Input Registry
    // ==========================================
    /**
     * Set input data for a client.
     */
    setInput(clientId, data) {
        this.inputRegistry.set(clientId, data);
        // Also set on entity if it exists
        const entity = this.getEntityByClientId(clientId);
        if (entity) {
            entity._setInputData(data);
        }
    }
    /**
     * Get input data for a client.
     */
    getInput(clientId) {
        return this.inputRegistry.get(clientId);
    }
    /**
     * Clear all input data (call at end of tick).
     */
    clearInputs() {
        this.inputRegistry.clear();
    }
    /**
     * Get input state for snapshot.
     * Returns a map of clientId -> input data.
     */
    getInputState() {
        const state = {};
        for (const [clientId, data] of this.inputRegistry) {
            state[clientId] = data;
        }
        return state;
    }
    /**
     * Set input state from snapshot.
     * Restores the input registry and entity input caches.
     */
    setInputState(state) {
        this.inputRegistry.clear();
        for (const [clientIdStr, data] of Object.entries(state)) {
            const clientId = parseInt(clientIdStr, 10);
            this.inputRegistry.set(clientId, data);
            // Also set on entity if it exists
            const entity = this.getEntityByClientId(clientId);
            if (entity) {
                entity._setInputData(data);
            }
        }
    }
    // ==========================================
    // State Management
    // ==========================================
    /**
     * Get full world state for snapshotting.
     */
    getState() {
        const entities = [];
        for (const eid of this.activeEntities) {
            const typeName = this.entityTypes.get(eid);
            const components = this.entityComponents.get(eid) || [];
            const index = eid & INDEX_MASK;
            const componentData = {};
            for (const component of components) {
                const data = {};
                for (const [fieldName, arr] of Object.entries(component.storage.fields)) {
                    data[fieldName] = arr[index];
                }
                componentData[component.name] = data;
            }
            entities.push({
                eid,
                type: typeName,
                components: componentData,
                clientId: this.entityClientIds.get(eid)
            });
        }
        return {
            entities,
            allocator: this.idAllocator.getState(),
            strings: this.strings.getState()
        };
    }
    /**
     * Restore world state from snapshot.
     */
    setState(state) {
        // Clear current state
        this.clear();
        // Restore allocator
        this.idAllocator.setState(state.allocator);
        // Restore strings
        this.strings.setState(state.strings);
        // Restore entities
        for (const entityState of state.entities) {
            const def = this.entityDefs.get(entityState.type);
            if (!def) {
                console.warn(`Unknown entity type in snapshot: ${entityState.type}`);
                continue;
            }
            const eid = entityState.eid;
            const index = eid & INDEX_MASK;
            // Get entity wrapper
            const entity = this.entityPool.acquire(eid);
            // Track entity
            this.activeEntities.add(eid);
            this.entityTypes.set(eid, entityState.type);
            if (entityState.clientId !== undefined) {
                this.entityClientIds.set(eid, entityState.clientId);
            }
            // Restore components
            const componentTypes = [];
            for (const compDef of def.components) {
                const component = compDef.type;
                componentTypes.push(component);
                addComponentToEntity(component.storage, index);
                // Restore component data
                const savedData = entityState.components[component.name];
                if (savedData) {
                    for (const [fieldName, value] of Object.entries(savedData)) {
                        const arr = component.storage.fields[fieldName];
                        if (arr) {
                            arr[index] = value;
                        }
                    }
                }
            }
            this.entityComponents.set(eid, componentTypes);
            // Initialize entity wrapper
            entity._init(eid, entityState.type, componentTypes, this);
            // Register in query engine
            this.queryEngine.addEntity(eid, entityState.type, componentTypes, entityState.clientId);
        }
    }
    /**
     * Clear all world state.
     */
    clear() {
        // Release all entities
        for (const eid of this.activeEntities) {
            const components = this.entityComponents.get(eid) || [];
            const index = eid & INDEX_MASK;
            for (const component of components) {
                removeComponentFromEntity(component.storage, index);
            }
            this.entityPool.release(eid);
        }
        // Clear tracking
        this.activeEntities.clear();
        this.entityTypes.clear();
        this.entityComponents.clear();
        this.entityClientIds.clear();
        // Clear indices
        this.queryEngine.clear();
        // Reset allocator
        this.idAllocator.reset();
        // Clear strings
        this.strings.clear();
    }
    /**
     * Reset world (keeps definitions, clears entities).
     */
    reset() {
        this.clear();
    }
    /**
     * Get entity count.
     */
    get entityCount() {
        return this.activeEntities.size;
    }
    /**
     * Get sparse snapshot (efficient format).
     */
    getSparseSnapshot() {
        return this.snapshotCodec.encode(Array.from(this.activeEntities), (eid) => this.entityTypes.get(eid) || '', (eid) => this.entityClientIds.get(eid), (eid) => this.entityComponents.get(eid) || [], this.idAllocator.getState(), this.strings.getState(), this.frame, this.seq, this.rngState);
    }
    /**
     * Load sparse snapshot (efficient format).
     */
    loadSparseSnapshot(snapshot) {
        this.snapshotCodec.decode(snapshot, () => this.clearForSnapshot(), (state) => this.idAllocator.setState(state), (state) => this.strings.setState(state), (eid, type, clientId) => this.createEntityFromSnapshot(eid, type, clientId), (rng) => { this.rngState = rng; });
        this.frame = snapshot.frame;
        this.seq = snapshot.seq;
    }
    /**
     * Clear world for snapshot restore (doesn't reset allocator).
     */
    clearForSnapshot() {
        // Release all entities
        for (const eid of this.activeEntities) {
            const components = this.entityComponents.get(eid) || [];
            const index = eid & INDEX_MASK;
            for (const component of components) {
                removeComponentFromEntity(component.storage, index);
            }
            this.entityPool.release(eid);
        }
        // Clear tracking
        this.activeEntities.clear();
        this.entityTypes.clear();
        this.entityComponents.clear();
        this.entityClientIds.clear();
        // Clear query indices
        this.queryEngine.clear();
    }
    /**
     * Create entity from snapshot data (without allocating new ID).
     */
    createEntityFromSnapshot(eid, type, clientId) {
        const def = this.entityDefs.get(type);
        if (!def) {
            console.warn(`Unknown entity type in snapshot: ${type}`);
            return;
        }
        const index = eid & INDEX_MASK;
        // Get entity wrapper
        const entity = this.entityPool.acquire(eid);
        // Track entity
        this.activeEntities.add(eid);
        this.entityTypes.set(eid, type);
        if (clientId !== undefined) {
            this.entityClientIds.set(eid, clientId);
        }
        // Setup components (data will be restored by codec)
        const componentTypes = [];
        for (const compDef of def.components) {
            const component = compDef.type;
            componentTypes.push(component);
            addComponentToEntity(component.storage, index);
        }
        this.entityComponents.set(eid, componentTypes);
        // Initialize entity wrapper
        entity._init(eid, type, componentTypes, this);
        // Register in query engine
        this.queryEngine.addEntity(eid, type, componentTypes, clientId);
    }
    /**
     * Serialize snapshot to binary for network transfer.
     */
    snapshotToBinary(snapshot) {
        return this.snapshotCodec.toBinary(snapshot);
    }
    /**
     * Deserialize snapshot from binary.
     */
    snapshotFromBinary(buffer) {
        return this.snapshotCodec.fromBinary(buffer);
    }
    /**
     * Get snapshot size estimate.
     */
    getSnapshotSize(snapshot) {
        return this.snapshotCodec.getSize(snapshot);
    }
    /**
     * Run a single game tick with network inputs.
     *
     * Executes all system phases in order:
     * 1. INPUT - Apply network inputs to entities
     * 2. UPDATE - Game logic systems
     * 3. PREPHYSICS - Save state for interpolation
     * 4. PHYSICS - Physics simulation (external hook)
     * 5. POSTPHYSICS - Post-physics cleanup
     * 6. RENDER - Rendering (client only)
     */
    tick(frame, inputs = []) {
        this.frame = frame;
        // Apply network inputs (O(1) per input via clientIdIndex)
        this.applyNetworkInputs(inputs);
        // Run all system phases in order
        this.scheduler.runPhase('input');
        this.scheduler.runPhase('update');
        this.scheduler.runPhase('prePhysics');
        this.scheduler.runPhase('physics');
        this.scheduler.runPhase('postPhysics');
        // Render phase only runs on client
        if (this._isClient) {
            this.scheduler.runPhase('render');
        }
        // Clear input buffer after tick
        this.inputBuffer.clear();
    }
    /**
     * Apply network inputs to entities via O(1) clientId lookup.
     */
    applyNetworkInputs(inputs) {
        for (const input of inputs) {
            // O(1) lookup via clientIdIndex
            const entity = this.getEntityByClientId(input.clientId);
            if (entity) {
                // Store input data for systems to read
                this.inputBuffer.set(input.clientId, input.data);
                // Apply input to entity's render state for interpolation reference
                const data = input.data;
                if (data) {
                    // Store in entity's input cache for system access
                    entity._setInputData(data);
                }
            }
            // If no entity for this clientId, silently ignore (disconnected player)
        }
    }
    /**
     * Get input data for a clientId.
     */
    getInputForClient(clientId) {
        return this.inputBuffer.get(clientId);
    }
    /**
     * Check if we have input for a clientId this tick.
     */
    hasInputForClient(clientId) {
        return this.inputBuffer.has(clientId);
    }
    /**
     * Run only physics phase (for external physics integration).
     */
    runPhysics() {
        this.scheduler.runPhase('physics');
    }
    /**
     * Set physics step callback (called during PHYSICS phase).
     */
    setPhysicsStep(fn) {
        return this.addSystem(fn, { phase: 'physics', order: 0 });
    }
    /**
     * Save previous positions for interpolation (called in prePhysics).
     */
    saveInterpolationState() {
        for (const eid of this.activeEntities) {
            const entity = this.getEntity(eid);
            if (entity) {
                entity._savePreviousState();
            }
        }
    }
    /**
     * Handle local player input (client-side prediction).
     * Applies input immediately for responsiveness.
     */
    handleLocalInput(input) {
        if (this.localClientId === null) {
            console.warn('Cannot handle local input: localClientId not set');
            return;
        }
        // Apply input immediately (prediction)
        const entity = this.getEntityByClientId(this.localClientId);
        if (entity) {
            entity._setInputData(input);
        }
        // Store input in history for potential resimulation
        this.inputHistory.setInput(this.frame, this.localClientId, input);
        // Store prediction for verification
        this.predictions.push({
            frame: this.frame,
            input,
            hash: this.getStateHash()
        });
    }
    /**
     * Process server-confirmed inputs.
     * Detects mispredictions and triggers rollback if needed.
     */
    onServerTick(serverFrame, inputs) {
        // Save current state before processing
        this.saveSnapshot(this.frame);
        // Convert NetworkInput[] to Map for input history
        const inputMap = new Map();
        for (const input of inputs) {
            inputMap.set(input.clientId, input.data);
        }
        // Store confirmed inputs in history for potential resimulation
        this.inputHistory.confirmFrame(serverFrame, inputMap);
        // Prune old input history to manage memory
        const minFrame = serverFrame - 120;
        if (minFrame > 0) {
            this.inputHistory.prune(minFrame);
        }
        // Check if we predicted this frame
        const predictionIdx = this.predictions.findIndex(p => p.frame === serverFrame);
        if (predictionIdx !== -1) {
            // We predicted this frame - verify our prediction was correct
            const prediction = this.predictions[predictionIdx];
            // Rollback to frame before this tick
            const snapshot = this.rollbackBuffer.get(serverFrame);
            if (snapshot) {
                this.loadSparseSnapshot(snapshot);
            }
            // Apply server inputs
            this.tick(serverFrame, inputs);
            // Check if state matches our prediction
            const serverHash = this.getStateHash();
            const mispredicted = serverHash !== prediction.hash;
            if (mispredicted) {
                // Notify about rollback
                this.onRollback?.(serverFrame);
                // Resimulate from this frame forward
                this.resimulateFrom(serverFrame);
            }
            // Remove verified predictions up to this frame
            this.predictions = this.predictions.filter(p => p.frame > serverFrame);
            return mispredicted;
        }
        else {
            // We didn't predict this frame, just apply normally
            this.tick(serverFrame, inputs);
            return false;
        }
    }
    /**
     * Save snapshot for potential rollback.
     */
    saveSnapshot(frame) {
        const snapshot = this.getSparseSnapshot();
        this.rollbackBuffer.set(frame, snapshot);
        // Prune old snapshots
        const minFrame = frame - this.rollbackBufferSize + 1;
        for (const f of this.rollbackBuffer.keys()) {
            if (f < minFrame) {
                this.rollbackBuffer.delete(f);
            }
        }
    }
    /**
     * Restore state from snapshot at frame.
     */
    restoreSnapshot(frame) {
        const snapshot = this.rollbackBuffer.get(frame);
        if (!snapshot) {
            return false;
        }
        this.loadSparseSnapshot(snapshot);
        return true;
    }
    /**
     * Check if snapshot exists for frame.
     */
    hasSnapshot(frame) {
        return this.rollbackBuffer.has(frame);
    }
    /**
     * Get oldest frame in rollback buffer.
     */
    getOldestSnapshotFrame() {
        let oldest;
        for (const frame of this.rollbackBuffer.keys()) {
            if (oldest === undefined || frame < oldest) {
                oldest = frame;
            }
        }
        return oldest;
    }
    /**
     * Resimulate from a frame forward to current frame.
     * Uses stored inputs from input history.
     *
     * NOTE: This retrieves data from InputHistory but full tick logic
     * will be implemented in Phase 2 of the rollback implementation plan.
     */
    resimulateFrom(fromFrame) {
        const currentFrame = this.frame;
        // Get all frames we need to resimulate (fromFrame+1 to current)
        // We already applied fromFrame, so start at next frame
        const framesToResim = this.inputHistory.getRange(fromFrame + 1, currentFrame);
        // TODO Phase 2: Actually resimulate each frame
        // For now, just log that we have the data available
        if (framesToResim.length > 0) {
            // Frames are available for resimulation
            // Full implementation will call this.tick() for each frame
            for (const frameInput of framesToResim) {
                // Convert FrameInput to NetworkInput[] format
                const inputs = [];
                for (const [clientId, data] of frameInput.getSortedInputs()) {
                    inputs.push({ clientId, data });
                }
                // Tick the world with these inputs
                this.tick(frameInput.frame, inputs);
            }
        }
        // Restore frame counter (tick may have incremented it)
        this.frame = currentFrame;
    }
    /**
     * Get deterministic hash of world state.
     * Used for comparing state between clients.
     */
    getStateHash() {
        // Get all entity data in deterministic order
        const sortedEids = Array.from(this.activeEntities).sort((a, b) => a - b);
        let hash = 0;
        for (const eid of sortedEids) {
            const index = eid & INDEX_MASK;
            const components = this.entityComponents.get(eid) || [];
            // Hash eid
            hash = (hash * 31 + eid) | 0;
            // Hash each component's fields in deterministic order
            for (const component of components) {
                const fieldNames = [...component.fieldNames].sort();
                for (const fieldName of fieldNames) {
                    const arr = component.storage.fields[fieldName];
                    const value = arr[index];
                    hash = (hash * 31 + value) | 0;
                }
            }
        }
        // Convert to hex string
        return (hash >>> 0).toString(16).padStart(8, '0');
    }
    /**
     * Clear rollback buffer.
     */
    clearRollbackBuffer() {
        this.rollbackBuffer.clear();
        this.predictions = [];
    }
    /**
     * Get pending prediction count.
     */
    getPendingPredictionCount() {
        return this.predictions.length;
    }
    /**
     * Check if we have pending predictions.
     */
    hasPendingPredictions() {
        return this.predictions.length > 0;
    }
}
