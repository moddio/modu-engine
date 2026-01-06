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
import { SparseSnapshot } from './snapshot';
import { ComponentType } from './component';
import { QueryEngine, QueryIterator } from './query';
import { SystemScheduler, SystemFn, SystemOptions } from './system';
import { Entity, EntityPool, EntityDefinition } from './entity';
import { StringRegistry } from './string-registry';
/**
 * Entity definition builder.
 */
export declare class EntityBuilder {
    private world;
    private name;
    private components;
    private registered;
    private _syncFields?;
    private _onRestore?;
    constructor(world: World, name: string);
    /**
     * Add a component to this entity definition.
     */
    with<T extends Record<string, any>>(component: ComponentType<T>, defaults?: Partial<T>): EntityBuilder;
    /**
     * Set sync fields for this entity (internal - use GameEntityBuilder.syncOnly()).
     */
    _setSyncFields(fields: string[]): void;
    /**
     * Set restore callback for this entity (internal - use GameEntityBuilder.onRestore()).
     */
    _setOnRestore(callback: (entity: Entity, game: any) => void): void;
    /**
     * Finalize entity definition.
     */
    private register;
    /**
     * Force immediate registration (for sync usage).
     */
    _ensureRegistered(): void;
    /**
     * Get the entity definition (for internal use).
     */
    _getDefinition(): EntityDefinition;
}
/**
 * ECS World - main container for all ECS state.
 */
export declare class World {
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
    private entityDefs;
    /** Active entity eids */
    private activeEntities;
    /** Entity type by eid */
    private entityTypes;
    /** Entity components by eid */
    private entityComponents;
    /** Client ID by eid */
    private entityClientIds;
    /** Input registry: clientId → input data */
    private inputRegistry;
    /** Whether running on client */
    private _isClient;
    constructor();
    /**
     * Set whether running on client.
     */
    setIsClient(isClient: boolean): void;
    /**
     * Check if running on client.
     */
    get isClient(): boolean;
    /**
     * Define a new component type.
     */
    defineComponent<T extends Record<string, any>>(name: string, defaults: T): ComponentType<{
        [K in keyof T]: T[K] extends boolean ? boolean : number;
    }>;
    /**
     * Define a new entity type.
     */
    defineEntity(name: string): EntityBuilder;
    /**
     * Register an entity definition (internal).
     */
    _registerEntityDef(def: EntityDefinition): void;
    /**
     * Get entity definition by type name.
     */
    getEntityDef(typeName: string): EntityDefinition | undefined;
    /**
     * Spawn a new entity.
     */
    spawn(typeOrBuilder: string | EntityBuilder, props?: Record<string, any>): Entity;
    /**
     * Spawn an entity with a specific eid (for snapshot restore).
     * This is used when restoring entities to preserve their original IDs.
     */
    spawnWithId(typeOrBuilder: string | EntityBuilder, targetEid: number, props?: Record<string, any>): Entity;
    /**
     * Destroy an entity.
     */
    destroyEntity(entity: Entity): void;
    /**
     * Get entity by eid.
     */
    getEntity(eid: number): Entity | null;
    /**
     * Check if entity is destroyed.
     */
    isDestroyed(eid: number): boolean;
    /**
     * Get entity by clientId (O(1) lookup).
     */
    getEntityByClientId(clientId: number): Entity | null;
    /**
     * Set clientId for an entity (for snapshot restore).
     * Updates both entityClientIds map and queryEngine index.
     */
    setEntityClientId(eid: number, clientId: number): void;
    /**
     * Query entities by type or component.
     */
    query(typeOrComponent: string | ComponentType, ...moreComponents: ComponentType[]): QueryIterator<Entity>;
    /**
     * Get all active entities.
     */
    getAllEntities(): Entity[];
    /**
     * Get all active entity IDs.
     */
    getAllEntityIds(): number[];
    /**
     * Add a system.
     */
    addSystem(fn: SystemFn, options?: SystemOptions): () => void;
    /**
     * Run all systems.
     */
    runSystems(): void;
    /**
     * Intern a string, get back an integer ID.
     */
    internString(namespace: string, str: string): number;
    /**
     * Look up string by ID.
     */
    getString(namespace: string, id: number): string | null;
    /**
     * Set input data for a client.
     */
    setInput(clientId: number, data: any): void;
    /**
     * Get input data for a client.
     */
    getInput(clientId: number): any;
    /**
     * Clear all input data (call at end of tick).
     */
    clearInputs(): void;
    /**
     * Get input state for snapshot.
     * Returns a map of clientId -> input data.
     */
    getInputState(): Record<number, any>;
    /**
     * Set input state from snapshot.
     * Restores the input registry and entity input caches.
     */
    setInputState(state: Record<number, any>): void;
    /**
     * Get full world state for snapshotting.
     */
    getState(): WorldState;
    /**
     * Restore world state from snapshot.
     */
    setState(state: WorldState): void;
    /**
     * Clear all world state.
     */
    clear(): void;
    /**
     * Reset world (keeps definitions, clears entities).
     */
    reset(): void;
    /**
     * Get entity count.
     */
    get entityCount(): number;
    /** Snapshot codec */
    private snapshotCodec;
    /** Current frame number */
    frame: number;
    /** Current sequence number */
    seq: number;
    /** RNG state (for determinism) - deprecated, now uses global random state */
    rngState?: {
        s0: number;
        s1: number;
    };
    /**
     * Get sparse snapshot (efficient format).
     */
    getSparseSnapshot(): SparseSnapshot;
    /**
     * Load sparse snapshot (efficient format).
     */
    loadSparseSnapshot(snapshot: SparseSnapshot): void;
    /**
     * Sync render state with current transform positions.
     * Called after snapshot restore to prevent interpolation artifacts.
     */
    private syncRenderStateFromTransforms;
    /**
     * Clear world for snapshot restore (doesn't reset allocator).
     */
    private clearForSnapshot;
    /**
     * Create entity from snapshot data (without allocating new ID).
     */
    private createEntityFromSnapshot;
    /**
     * Serialize snapshot to binary for network transfer.
     */
    snapshotToBinary(snapshot: SparseSnapshot): ArrayBuffer;
    /**
     * Deserialize snapshot from binary.
     */
    snapshotFromBinary(buffer: ArrayBuffer): SparseSnapshot;
    /**
     * Get snapshot size estimate.
     */
    getSnapshotSize(snapshot: SparseSnapshot): number;
    /**
     * Network input format.
     */
    private inputBuffer;
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
    _isSimulating: boolean;
    tick(frame: number, inputs?: NetworkInput[]): void;
    /**
     * Apply network inputs to entities via O(1) clientId lookup.
     */
    private applyNetworkInputs;
    /**
     * Get input data for a clientId.
     */
    getInputForClient(clientId: number): Record<string, any> | undefined;
    /**
     * Check if we have input for a clientId this tick.
     */
    hasInputForClient(clientId: number): boolean;
    /**
     * Run only physics phase (for external physics integration).
     */
    runPhysics(): void;
    /**
     * Set physics step callback (called during PHYSICS phase).
     */
    setPhysicsStep(fn: () => void): () => void;
    /**
     * Save previous positions for interpolation (called in prePhysics).
     */
    saveInterpolationState(): void;
    /** Local client ID for prediction */
    localClientId: number | null;
    /** Pending predictions awaiting server confirmation */
    private predictions;
    /** Rollback buffer for state restoration */
    private rollbackBuffer;
    /** Maximum frames to keep in rollback buffer */
    rollbackBufferSize: number;
    /** Callback for when rollback occurs */
    onRollback?: (toFrame: number) => void;
    /** Input history for rollback resimulation */
    private inputHistory;
    /**
     * Handle local player input (client-side prediction).
     * Applies input immediately for responsiveness.
     */
    handleLocalInput(input: Record<string, any>): void;
    /**
     * Process server-confirmed inputs.
     * Detects mispredictions and triggers rollback if needed.
     */
    onServerTick(serverFrame: number, inputs: NetworkInput[]): boolean;
    /**
     * Save snapshot for potential rollback.
     */
    saveSnapshot(frame: number): void;
    /**
     * Restore state from snapshot at frame.
     */
    restoreSnapshot(frame: number): boolean;
    /**
     * Check if snapshot exists for frame.
     */
    hasSnapshot(frame: number): boolean;
    /**
     * Get oldest frame in rollback buffer.
     */
    getOldestSnapshotFrame(): number | undefined;
    /**
     * Resimulate from a frame forward to current frame.
     * Uses stored inputs from input history.
     *
     * NOTE: This retrieves data from InputHistory but full tick logic
     * will be implemented in Phase 2 of the rollback implementation plan.
     */
    private resimulateFrom;
    /**
     * Get deterministic hash of world state.
     * Used for comparing state between clients.
     * Excludes components with sync: false (client-only state).
     */
    getStateHash(): string;
    /**
     * Clear rollback buffer.
     */
    clearRollbackBuffer(): void;
    /**
     * Get pending prediction count.
     */
    getPendingPredictionCount(): number;
    /**
     * Check if we have pending predictions.
     */
    hasPendingPredictions(): boolean;
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
