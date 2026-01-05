/**
 * Entity Manager
 *
 * Manages entity lifecycle: creation, updates, destruction.
 * Handles state serialization for rollback networking.
 */
import { Entity, BaseEntity, EntityConfig } from './entity';
import { Component } from './component';
import { World2D } from '../components/physics2d';
import { World } from '../components/physics3d';
export type EntityFactory<T extends Entity = Entity> = (config: EntityConfig) => T;
export type ComponentFactory = (state: any) => Component;
export declare function setInputEntityFactory(factory: EntityFactory): void;
/**
 * Register a component factory for snapshot deserialization.
 * Must be called for each component type before loading snapshots.
 */
export declare function registerComponentFactory(type: string, factory: ComponentFactory): void;
/**
 * Get a registered component factory.
 */
export declare function getComponentFactory(type: string): ComponentFactory | undefined;
/**
 * Register a global entity factory for snapshot deserialization.
 * Used when EntityManager doesn't have a local factory for the type.
 */
export declare function registerEntityFactory(type: string, factory: EntityFactory): void;
/**
 * Get a registered global entity factory.
 */
export declare function getEntityFactory(type: string): EntityFactory | undefined;
/**
 * Register a class for snapshot restore.
 * Called automatically when entity is first created.
 */
export declare function registerClass(cls: new (...args: any[]) => Entity): void;
/**
 * Get a registered class by name.
 */
export declare function getClass(name: string): (new (...args: any[]) => Entity) | undefined;
export interface EntityManagerState {
    entities: Array<{
        id: string;
        className: string;
        type: string;
        sync: Record<string, any>;
    }>;
}
export declare class EntityManager {
    /** All entities by ID - direct access via entities[id] */
    readonly entities: Record<string, Entity>;
    /** Entities grouped by type */
    readonly byType: Record<string, Entity[]>;
    /** Registered entity factories (public for EntityBuilder access) */
    readonly factories: Map<string, EntityFactory>;
    /** Type-based tick handlers (set via EntityBuilder) */
    readonly tickHandlers: Map<string, (entity: Entity, frame: number) => void>;
    /** 2D Physics world (exposed for components to auto-add bodies) */
    world: World2D | null;
    /** 3D Physics world (exposed for components to auto-add bodies) */
    world3D: World | null;
    /**
     * Input registry - stores latest input per client.
     * Components (like InputComponent) can read from this in their onUpdate().
     */
    readonly inputRegistry: Map<string, any>;
    /**
     * Collision handler registry - stores handlers by entity type.
     * Used to restore onCollision callbacks after snapshot restore.
     */
    readonly collisionHandlers: Map<string, (self: Entity, other: Entity) => void>;
    /**
     * Input commands registry - stores command configs by entity type.
     * Used to restore InputComponent.setCommands after snapshot restore.
     */
    readonly inputCommands: Map<string, any>;
    constructor();
    /**
     * Set 2D physics world for auto-adding physics bodies.
     * Called by ModuEngine when physics: '2d' is specified.
     */
    setPhysicsWorld(world: World2D): void;
    /**
     * Set 3D physics world for auto-adding physics bodies.
     * Called by ModuEngine when physics: '3d' is specified.
     */
    setPhysicsWorld3D(world: World): void;
    /**
     * Register an entity factory for a type
     */
    registerFactory<T extends Entity>(type: string, factory: EntityFactory<T>): void;
    /**
     * Create a new entity. Use .setType() to assign a type.
     */
    create(config?: EntityConfig): BaseEntity;
    /**
     * Create a new entity with 2D physics.
     * Convenience method that creates entity + Physics2DComponent in one call.
     *
     * @param physics - Physics2DComponent options (type, shape, x, y, etc.)
     * @returns The created entity with physics already attached
     *
     * @example
     * const food = em.create2D({ type: 'static', shape: 'circle', radius: 8, x, y }).setType('food');
     */
    create2D(physics: any, config?: EntityConfig): BaseEntity;
    /**
     * Destroy an entity
     */
    destroy(entity: Entity): void;
    /**
     * Get all entities
     */
    getAll(): Entity[];
    /**
     * Get entity by ID
     */
    getById(id: string): Entity | null;
    /**
     * Get entity by client ID (sync.clientId)
     */
    getByClientId(clientId: string): Entity | null;
    /**
     * Update all entities for a frame.
     * Order:
     *   1. Component updates (e.g., InputComponent applies inputs from registry)
     *   2. entity.tick(frame) for custom logic (can now read current inputs)
     *   3. Physics world step
     */
    update(frame: number): void;
    /**
     * Save all entity state for rollback
     */
    saveState(): EntityManagerState;
    /**
     * Load entity state from rollback/snapshot.
     * Creates entities using classRegistry, then applies sync values.
     * Constructor runs on first local appearance (sets up behavior).
     * Sync values from snapshot overwrite constructor defaults.
     */
    loadState(state: EntityManagerState): void;
    /**
     * Attach registered handlers to entities after snapshot restore.
     * Called by engine after onJoin to ensure handlers are registered.
     */
    attachRestoredHandlers(): void;
    /**
     * Clear all entities
     */
    reset(): void;
    /**
     * Compute a hash of all entity states for sync verification.
     * Syncs physics state to entity.sync before computing hash.
     */
    computeHash(): number;
    /**
     * Get state hash as hex string (8 characters).
     * Use this for sync verification - same state = same hash string.
     */
    getStateHash(): string;
    /**
     * Get the number of entities.
     */
    get count(): number;
}
