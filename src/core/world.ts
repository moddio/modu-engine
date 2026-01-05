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

import { EntityIdAllocator, EntityIdAllocatorState } from './entity-id';
import { SparseSnapshot, SparseSnapshotCodec } from './snapshot';
import {
    ComponentType,
    defineComponent as defineComponentInternal,
    hasComponent,
    addComponentToEntity,
    initializeComponentDefaults,
    removeComponentFromEntity,
    clearComponentRegistry,
    getAllComponents
} from './component';
import { QueryEngine, QueryIterator } from './query';
import { SystemScheduler, SystemFn, SystemOptions } from './system';
import { Entity, EntityPool, EntityDefinition, RenderState } from './entity';
import { INDEX_MASK } from './constants';
import { toFixed } from '../math';
import { StringRegistry } from './string-registry';
import { InputHistory } from './input-history';

/**
 * Entity definition builder.
 */
export class EntityBuilder {
    private components: Array<{
        type: ComponentType;
        defaults?: Record<string, any>;
    }> = [];

    private registered: boolean = false;
    private _syncFields?: string[];
    private _onRestore?: (entity: Entity, game: any) => void;

    constructor(
        private world: World,
        private name: string
    ) {}

    /**
     * Add a component to this entity definition.
     */
    with<T extends Record<string, any>>(
        component: ComponentType<T>,
        defaults?: Partial<T>
    ): EntityBuilder {
        this.components.push({
            type: component,
            defaults: defaults as Record<string, any>
        });

        // Register immediately (idempotent - just overwrites with latest)
        this.register();

        return this;
    }

    /**
     * Set sync fields for this entity (internal - use GameEntityBuilder.sync()).
     */
    _setSyncFields(fields: string[]): void {
        this._syncFields = fields;
    }

    /**
     * Set restore callback for this entity (internal - use GameEntityBuilder.onRestore()).
     */
    _setOnRestore(callback: (entity: Entity, game: any) => void): void {
        this._onRestore = callback;
    }

    /**
     * Finalize entity definition.
     */
    private register(): void {
        this.world._registerEntityDef({
            name: this.name,
            components: this.components,
            syncFields: this._syncFields,
            onRestore: this._onRestore
        });
    }

    /**
     * Force immediate registration (for sync usage).
     */
    _ensureRegistered(): void {
        if (!this.registered) {
            this.registered = true;
        }
        this.register();
    }

    /**
     * Get the entity definition (for internal use).
     */
    _getDefinition(): EntityDefinition {
        return {
            name: this.name,
            components: this.components,
            syncFields: this._syncFields,
            onRestore: this._onRestore
        };
    }
}

/**
 * ECS World - main container for all ECS state.
 */
export class World {
    /** Entity ID allocator */
    readonly idAllocator: EntityIdAllocator;

    /** Query engine */
    readonly queryEngine: QueryEngine;

    /** System scheduler */
    readonly scheduler: SystemScheduler;

    /** Entity pool */
    readonly entityPool: EntityPool;

    /** String registry */
    readonly strings: StringRegistry;

    /** Entity definitions */
    private entityDefs: Map<string, EntityDefinition> = new Map();

    /** Active entity eids */
    private activeEntities: Set<number> = new Set();

    /** Entity type by eid */
    private entityTypes: Map<number, string> = new Map();

    /** Entity components by eid */
    private entityComponents: Map<number, ComponentType[]> = new Map();

    /** Client ID by eid */
    private entityClientIds: Map<number, number> = new Map();

    /** Input registry: clientId → input data */
    private inputRegistry: Map<number, any> = new Map();

    /** Whether running on client */
    private _isClient: boolean = true;

    constructor() {
        this.idAllocator = new EntityIdAllocator();
        this.entityPool = new EntityPool();
        this.strings = new StringRegistry();

        // Create query engine with callbacks
        this.queryEngine = new QueryEngine(
            (eid) => this.getEntity(eid),
            (eid) => this.isDestroyed(eid)
        );

        this.scheduler = new SystemScheduler();

        // Register interpolation state saving in prePhysics phase
        this.addSystem(() => this.saveInterpolationState(), { phase: 'prePhysics', order: -1000 });
    }

    /**
     * Set whether running on client.
     */
    setIsClient(isClient: boolean): void {
        this._isClient = isClient;
        this.scheduler.setIsClient(isClient);
    }

    /**
     * Check if running on client.
     */
    get isClient(): boolean {
        return this._isClient;
    }

    // ==========================================
    // Component API
    // ==========================================

    /**
     * Define a new component type.
     */
    defineComponent<T extends Record<string, any>>(
        name: string,
        defaults: T
    ): ComponentType<{ [K in keyof T]: T[K] extends boolean ? boolean : number }> {
        return defineComponentInternal(name, defaults);
    }

    // ==========================================
    // Entity Definition API
    // ==========================================

    /**
     * Define a new entity type.
     */
    defineEntity(name: string): EntityBuilder {
        const builder = new EntityBuilder(this, name);
        // Auto-register when builder methods are done
        // We need to defer this, so we'll register on first spawn or explicitly
        return builder;
    }

    /**
     * Register an entity definition (internal).
     */
    _registerEntityDef(def: EntityDefinition): void {
        this.entityDefs.set(def.name, def);
    }

    /**
     * Get entity definition by type name.
     */
    getEntityDef(typeName: string): EntityDefinition | undefined {
        return this.entityDefs.get(typeName);
    }

    // ==========================================
    // Entity Spawning/Destruction
    // ==========================================

    /**
     * Spawn a new entity.
     */
    spawn(
        typeOrBuilder: string | EntityBuilder,
        props: Record<string, any> = {}
    ): Entity {
        // Handle EntityBuilder
        let typeName: string;
        if (typeof typeOrBuilder === 'string') {
            typeName = typeOrBuilder;
        } else {
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
        const componentTypes: ComponentType[] = [];
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
                            arr[index] = toFixed(value as number);
                        } else if (fieldDef.type === 'bool') {
                            arr[index] = value ? 1 : 0;
                        } else {
                            arr[index] = value;
                        }
                    }
                }
            }
        }

        // Apply spawn props (route to components)
        let clientId: number | undefined;
        for (const [key, value] of Object.entries(props)) {
            if (key === 'clientId') {
                clientId = value as number;
                this.entityClientIds.set(eid, clientId);
            }

            // Route to first component that has this field
            for (const component of componentTypes) {
                if (key in component.storage.schema) {
                    const arr = component.storage.fields[key];
                    const fieldDef = component.storage.schema[key];
                    if (fieldDef.type === 'i32') {
                        arr[index] = toFixed(value as number);
                    } else if (fieldDef.type === 'bool') {
                        arr[index] = value ? 1 : 0;
                    } else {
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

        // Initialize render state to spawn position (prevent interpolation from 0,0)
        // Use raw props values (before fixed-point conversion) for render coordinates
        if (props.x !== undefined || props.y !== undefined) {
            const spawnX = props.x ?? 0;
            const spawnY = props.y ?? 0;
            entity.render.prevX = spawnX;
            entity.render.prevY = spawnY;
            entity.render.interpX = spawnX;
            entity.render.interpY = spawnY;
        }

        // Register in query engine
        this.queryEngine.addEntity(eid, typeName, componentTypes, clientId);

        return entity;
    }

    /**
     * Spawn an entity with a specific eid (for snapshot restore).
     * This is used when restoring entities to preserve their original IDs.
     */
    spawnWithId(typeOrBuilder: string | EntityBuilder, targetEid: number, props: Record<string, any> = {}): Entity {
        let typeName: string;
        if (typeof typeOrBuilder === 'string') {
            typeName = typeOrBuilder;
        } else {
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
        const componentTypes: ComponentType[] = [];
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
                            arr[index] = toFixed(value as number);
                        } else if (fieldDef.type === 'bool') {
                            arr[index] = value ? 1 : 0;
                        } else {
                            arr[index] = value;
                        }
                    }
                }
            }
        }

        // Apply spawn props (route to components)
        let clientId: number | undefined;
        for (const [key, value] of Object.entries(props)) {
            if (key === 'clientId') {
                clientId = value as number;
                this.entityClientIds.set(eid, clientId);
            }

            // Route to first component that has this field
            for (const compDef of def.components) {
                const arr = compDef.type.storage.fields[key];
                if (arr) {
                    const fieldDef = compDef.type.storage.schema[key];
                    if (fieldDef.type === 'i32') {
                        arr[index] = toFixed(value as number);
                    } else if (fieldDef.type === 'bool') {
                        arr[index] = value ? 1 : 0;
                    } else {
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

        // Initialize render state to spawn position (prevent interpolation from 0,0)
        // Use raw props values (before fixed-point conversion) for render coordinates
        if (props.x !== undefined || props.y !== undefined) {
            const spawnX = props.x ?? 0;
            const spawnY = props.y ?? 0;
            entity.render.prevX = spawnX;
            entity.render.prevY = spawnY;
            entity.render.interpX = spawnX;
            entity.render.interpY = spawnY;
        }

        // Register in query engine
        this.queryEngine.addEntity(eid, typeName, componentTypes, clientId);

        return entity;
    }

    /**
     * Destroy an entity.
     */
    destroyEntity(entity: Entity): void {
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
    getEntity(eid: number): Entity | null {
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
    isDestroyed(eid: number): boolean {
        return !this.activeEntities.has(eid);
    }

    /**
     * Get entity by clientId (O(1) lookup).
     */
    getEntityByClientId(clientId: number): Entity | null {
        const eid = this.queryEngine.getByClientId(clientId);
        if (eid === undefined) return null;
        return this.getEntity(eid);
    }

    /**
     * Set clientId for an entity (for snapshot restore).
     * Updates both entityClientIds map and queryEngine index.
     */
    setEntityClientId(eid: number, clientId: number): void {
        this.entityClientIds.set(eid, clientId);
        this.queryEngine.setClientId(eid, clientId);
    }

    // ==========================================
    // Query API
    // ==========================================

    /**
     * Query entities by type or component.
     */
    query(
        typeOrComponent: string | ComponentType,
        ...moreComponents: ComponentType[]
    ): QueryIterator<Entity> {
        return this.queryEngine.query(typeOrComponent, ...moreComponents);
    }

    /**
     * Get all active entities.
     */
    getAllEntities(): Entity[] {
        const result: Entity[] = [];
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
    getAllEntityIds(): number[] {
        return Array.from(this.activeEntities).sort((a, b) => a - b);
    }

    // ==========================================
    // System API
    // ==========================================

    /**
     * Add a system.
     */
    addSystem(fn: SystemFn, options?: SystemOptions): () => void {
        return this.scheduler.add(fn, options);
    }

    /**
     * Run all systems.
     */
    runSystems(): void {
        this.scheduler.runAll();
    }

    // ==========================================
    // String Interning API
    // ==========================================

    /**
     * Intern a string, get back an integer ID.
     */
    internString(namespace: string, str: string): number {
        return this.strings.intern(namespace, str);
    }

    /**
     * Look up string by ID.
     */
    getString(namespace: string, id: number): string | null {
        return this.strings.getString(namespace, id);
    }

    // ==========================================
    // Input Registry
    // ==========================================

    /**
     * Set input data for a client.
     */
    setInput(clientId: number, data: any): void {
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
    getInput(clientId: number): any {
        return this.inputRegistry.get(clientId);
    }

    /**
     * Clear all input data (call at end of tick).
     */
    clearInputs(): void {
        this.inputRegistry.clear();
    }

    /**
     * Get input state for snapshot.
     * Returns a map of clientId -> input data.
     */
    getInputState(): Record<number, any> {
        const state: Record<number, any> = {};
        for (const [clientId, data] of this.inputRegistry) {
            state[clientId] = data;
        }
        return state;
    }

    /**
     * Set input state from snapshot.
     * Restores the input registry and entity input caches.
     */
    setInputState(state: Record<number, any>): void {
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
    getState(): WorldState {
        const entities: EntityState[] = [];

        for (const eid of this.activeEntities) {
            const typeName = this.entityTypes.get(eid)!;
            const components = this.entityComponents.get(eid) || [];
            const index = eid & INDEX_MASK;

            const componentData: Record<string, Record<string, number>> = {};

            for (const component of components) {
                const data: Record<string, number> = {};
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
    setState(state: WorldState): void {
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
            const componentTypes: ComponentType[] = [];
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
    clear(): void {
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
    reset(): void {
        this.clear();
    }

    /**
     * Get entity count.
     */
    get entityCount(): number {
        return this.activeEntities.size;
    }

    // ==========================================
    // Sparse Snapshot API (Efficient)
    // ==========================================

    /** Snapshot codec */
    private snapshotCodec: SparseSnapshotCodec = new SparseSnapshotCodec();

    /** Current frame number */
    frame: number = 0;

    /** Current sequence number */
    seq: number = 0;

    /** RNG state (for determinism) */
    rngState?: { seed: number; state: number };

    /**
     * Get sparse snapshot (efficient format).
     */
    getSparseSnapshot(): SparseSnapshot {
        return this.snapshotCodec.encode(
            Array.from(this.activeEntities),
            (eid) => this.entityTypes.get(eid) || '',
            (eid) => this.entityClientIds.get(eid),
            (eid) => this.entityComponents.get(eid) || [],
            this.idAllocator.getState(),
            this.strings.getState(),
            this.frame,
            this.seq,
            this.rngState
        );
    }

    /**
     * Load sparse snapshot (efficient format).
     */
    loadSparseSnapshot(snapshot: SparseSnapshot): void {
        this.snapshotCodec.decode(
            snapshot,
            () => this.clearForSnapshot(),
            (state) => this.idAllocator.setState(state),
            (state) => this.strings.setState(state),
            (eid, type, clientId) => this.createEntityFromSnapshot(eid, type, clientId),
            (rng) => { this.rngState = rng; }
        );

        this.frame = snapshot.frame;
        this.seq = snapshot.seq;

        // Sync render state with restored transform positions
        this.syncRenderStateFromTransforms();
    }

    /**
     * Sync render state with current transform positions.
     * Called after snapshot restore to prevent interpolation artifacts.
     */
    private syncRenderStateFromTransforms(): void {
        for (const eid of this.activeEntities) {
            const entity = this.getEntity(eid);
            if (!entity) continue;

            // Find Transform2D component and read x,y values
            const components = this.entityComponents.get(eid) || [];
            const index = eid & INDEX_MASK;

            for (const component of components) {
                if (component.name === 'Transform2D') {
                    const xArr = component.storage.fields['x'];
                    const yArr = component.storage.fields['y'];
                    if (xArr && yArr) {
                        // Convert from fixed-point to float for render
                        const x = xArr[index] / 65536;
                        const y = yArr[index] / 65536;
                        entity.render.prevX = x;
                        entity.render.prevY = y;
                        entity.render.interpX = x;
                        entity.render.interpY = y;
                    }
                    break;
                }
            }
        }
    }

    /**
     * Clear world for snapshot restore (doesn't reset allocator).
     */
    private clearForSnapshot(): void {
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
    private createEntityFromSnapshot(eid: number, type: string, clientId?: number): void {
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
        const componentTypes: ComponentType[] = [];
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
    snapshotToBinary(snapshot: SparseSnapshot): ArrayBuffer {
        return this.snapshotCodec.toBinary(snapshot);
    }

    /**
     * Deserialize snapshot from binary.
     */
    snapshotFromBinary(buffer: ArrayBuffer): SparseSnapshot {
        return this.snapshotCodec.fromBinary(buffer);
    }

    /**
     * Get snapshot size estimate.
     */
    getSnapshotSize(snapshot: SparseSnapshot): number {
        return this.snapshotCodec.getSize(snapshot);
    }

    // ==========================================
    // Network Integration (Phase 3)
    // ==========================================

    /**
     * Network input format.
     */
    private inputBuffer: Map<number, Record<string, any>> = new Map();

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
    /** True while running deterministic simulation phases */
    _isSimulating: boolean = false;

    tick(frame: number, inputs: NetworkInput[] = []): void {
        this.frame = frame;

        // Apply network inputs (O(1) per input via clientIdIndex)
        this.applyNetworkInputs(inputs);

        // Run deterministic simulation phases
        this._isSimulating = true;
        try {
            this.scheduler.runPhase('input');
            this.scheduler.runPhase('update');
            this.scheduler.runPhase('prePhysics');
            this.scheduler.runPhase('physics');
            this.scheduler.runPhase('postPhysics');
        } finally {
            this._isSimulating = false;
        }

        // Render phase only runs on client (not deterministic)
        if (this._isClient) {
            this.scheduler.runPhase('render');
        }

        // Clear input buffer after tick
        this.inputBuffer.clear();
    }

    /**
     * Apply network inputs to entities via O(1) clientId lookup.
     */
    private applyNetworkInputs(inputs: NetworkInput[]): void {
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
    getInputForClient(clientId: number): Record<string, any> | undefined {
        return this.inputBuffer.get(clientId);
    }

    /**
     * Check if we have input for a clientId this tick.
     */
    hasInputForClient(clientId: number): boolean {
        return this.inputBuffer.has(clientId);
    }

    /**
     * Run only physics phase (for external physics integration).
     */
    runPhysics(): void {
        this.scheduler.runPhase('physics');
    }

    /**
     * Set physics step callback (called during PHYSICS phase).
     */
    setPhysicsStep(fn: () => void): () => void {
        return this.addSystem(fn, { phase: 'physics', order: 0 });
    }

    /**
     * Save previous positions for interpolation (called in prePhysics).
     */
    saveInterpolationState(): void {
        for (const eid of this.activeEntities) {
            const entity = this.getEntity(eid);
            if (entity) {
                entity._savePreviousState();
            }
        }
    }

    // ==========================================
    // Client-Side Prediction (Phase 4)
    // ==========================================

    /** Local client ID for prediction */
    localClientId: number | null = null;

    /** Pending predictions awaiting server confirmation */
    private predictions: PredictionEntry[] = [];

    /** Rollback buffer for state restoration */
    private rollbackBuffer: Map<number, SparseSnapshot> = new Map();

    /** Maximum frames to keep in rollback buffer */
    rollbackBufferSize: number = 60;

    /** Callback for when rollback occurs */
    onRollback?: (toFrame: number) => void;

    /** Input history for rollback resimulation */
    private inputHistory: InputHistory = new InputHistory(120);

    /**
     * Handle local player input (client-side prediction).
     * Applies input immediately for responsiveness.
     */
    handleLocalInput(input: Record<string, any>): void {
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
    onServerTick(serverFrame: number, inputs: NetworkInput[]): boolean {
        // Save current state before processing
        this.saveSnapshot(this.frame);

        // Convert NetworkInput[] to Map for input history
        const inputMap = new Map<number, Record<string, any>>();
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
        } else {
            // We didn't predict this frame, just apply normally
            this.tick(serverFrame, inputs);
            return false;
        }
    }

    /**
     * Save snapshot for potential rollback.
     */
    saveSnapshot(frame: number): void {
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
    restoreSnapshot(frame: number): boolean {
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
    hasSnapshot(frame: number): boolean {
        return this.rollbackBuffer.has(frame);
    }

    /**
     * Get oldest frame in rollback buffer.
     */
    getOldestSnapshotFrame(): number | undefined {
        let oldest: number | undefined;
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
    private resimulateFrom(fromFrame: number): void {
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
                const inputs: NetworkInput[] = [];
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
    getStateHash(): string {
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
    clearRollbackBuffer(): void {
        this.rollbackBuffer.clear();
        this.predictions = [];
    }

    /**
     * Get pending prediction count.
     */
    getPendingPredictionCount(): number {
        return this.predictions.length;
    }

    /**
     * Check if we have pending predictions.
     */
    hasPendingPredictions(): boolean {
        return this.predictions.length > 0;
    }
}

/**
 * Network input format.
 */
export interface NetworkInput {
    clientId: number;
    data: Record<string, any>;
}

/**
 * Prediction entry for tracking local predictions.
 */
export interface PredictionEntry {
    frame: number;
    input: Record<string, any>;
    hash: string;
}

/**
 * World state for snapshotting.
 */
export interface WorldState {
    entities: EntityState[];
    allocator: EntityIdAllocatorState;
    strings: {
        tables: Record<string, Record<string, number>>;
        nextIds: Record<string, number>;
    };
}

/**
 * Entity state for snapshotting.
 */
export interface EntityState {
    eid: number;
    type: string;
    components: Record<string, Record<string, number>>;
    clientId?: number;
}
