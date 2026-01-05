/**
 * Entity Manager
 *
 * Manages entity lifecycle: creation, updates, destruction.
 * Handles state serialization for rollback networking.
 */
import { BaseEntity, setRestoreContext } from './entity';
import { toFloat } from '../math/fixed';
import { stepWorld2D } from '../components/physics2d';
import { stepWorld } from '../components/physics3d';
/**
 * Factory for creating entities with InputComponent (Players).
 * Set this to enable automatic Player recreation from snapshots.
 */
let inputEntityFactory = null;
export function setInputEntityFactory(factory) {
    inputEntityFactory = factory;
}
// ============================================
// Global Component Factory Registry
// ============================================
const componentFactories = new Map();
/**
 * Register a component factory for snapshot deserialization.
 * Must be called for each component type before loading snapshots.
 */
export function registerComponentFactory(type, factory) {
    componentFactories.set(type, factory);
}
/**
 * Get a registered component factory.
 */
export function getComponentFactory(type) {
    return componentFactories.get(type);
}
// ============================================
// Global Entity Factory Registry
// ============================================
/** Global entity factories (used when EntityManager has no local factory) */
const globalEntityFactories = new Map();
/**
 * Register a global entity factory for snapshot deserialization.
 * Used when EntityManager doesn't have a local factory for the type.
 */
export function registerEntityFactory(type, factory) {
    globalEntityFactories.set(type, factory);
}
/**
 * Get a registered global entity factory.
 */
export function getEntityFactory(type) {
    return globalEntityFactories.get(type);
}
// ============================================
// Class Registry (for snapshot restore)
// ============================================
/** Maps constructor.name → class constructor */
const classRegistry = new Map();
/**
 * Register a class for snapshot restore.
 * Called automatically when entity is first created.
 */
export function registerClass(cls) {
    if (!classRegistry.has(cls.name)) {
        classRegistry.set(cls.name, cls);
    }
}
/**
 * Get a registered class by name.
 */
export function getClass(name) {
    return classRegistry.get(name);
}
// ============================================
// Entity Manager
// ============================================
export class EntityManager {
    constructor() {
        /** All entities by ID - direct access via entities[id] */
        this.entities = {};
        /** Entities grouped by type */
        this.byType = {};
        /** Registered entity factories (public for EntityBuilder access) */
        this.factories = new Map();
        /** Type-based tick handlers (set via EntityBuilder) */
        this.tickHandlers = new Map();
        /** 2D Physics world (exposed for components to auto-add bodies) */
        this.world = null;
        /** 3D Physics world (exposed for components to auto-add bodies) */
        this.world3D = null;
        /**
         * Input registry - stores latest input per client.
         * Components (like InputComponent) can read from this in their onUpdate().
         */
        this.inputRegistry = new Map();
        /**
         * Collision handler registry - stores handlers by entity type.
         * Used to restore onCollision callbacks after snapshot restore.
         */
        this.collisionHandlers = new Map();
        /**
         * Input commands registry - stores command configs by entity type.
         * Used to restore InputComponent.setCommands after snapshot restore.
         */
        this.inputCommands = new Map();
    }
    /**
     * Set 2D physics world for auto-adding physics bodies.
     * Called by ModuEngine when physics: '2d' is specified.
     */
    setPhysicsWorld(world) {
        this.world = world;
    }
    /**
     * Set 3D physics world for auto-adding physics bodies.
     * Called by ModuEngine when physics: '3d' is specified.
     */
    setPhysicsWorld3D(world) {
        this.world3D = world;
    }
    // ============================================
    // Factory Registration
    // ============================================
    /**
     * Register an entity factory for a type
     */
    registerFactory(type, factory) {
        this.factories.set(type, factory);
    }
    // ============================================
    // Entity Lifecycle
    // ============================================
    /**
     * Create a new entity. Use .setType() to assign a type.
     */
    create(config = {}) {
        const entity = new BaseEntity(config);
        // Set manager reference so components can access world
        entity.manager = this;
        this.entities[entity.id] = entity;
        // Call onCreate lifecycle hook
        if (entity.onCreate) {
            entity.onCreate();
        }
        return entity;
    }
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
    create2D(physics, config = {}) {
        const entity = this.create(config);
        // Dynamically import and add Physics2DComponent
        const { Physics2DComponent } = require('../components/physics2d');
        entity.addComponent(new Physics2DComponent(physics));
        return entity;
    }
    /**
     * Destroy an entity
     */
    destroy(entity) {
        if (!this.entities[entity.id])
            return;
        // Mark as inactive FIRST - prevents collision callbacks during destruction
        entity.active = false;
        // Call onDestroy lifecycle hook
        if (entity.onDestroy) {
            entity.onDestroy();
        }
        // Detach all components
        for (const component of entity.components.values()) {
            if (component.onDetach) {
                component.onDetach();
            }
        }
        entity.components.clear();
        // Remove from type array
        const arr = this.byType[entity.type];
        if (arr) {
            const idx = arr.indexOf(entity);
            if (idx !== -1)
                arr.splice(idx, 1);
        }
        // Remove from entities
        delete this.entities[entity.id];
    }
    // ============================================
    // Queries
    // ============================================
    /**
     * Get all entities
     */
    getAll() {
        return Object.values(this.entities).sort((a, b) => a.id.localeCompare(b.id));
    }
    /**
     * Get entity by ID
     */
    getById(id) {
        return this.entities[id] || null;
    }
    /**
     * Get entity by client ID (sync.clientId)
     */
    getByClientId(clientId) {
        for (const entity of Object.values(this.entities)) {
            if (entity.sync.clientId === clientId)
                return entity;
        }
        return null;
    }
    // ============================================
    // Update Loop
    // ============================================
    /**
     * Update all entities for a frame.
     * Order:
     *   1. Component updates (e.g., InputComponent applies inputs from registry)
     *   2. entity.tick(frame) for custom logic (can now read current inputs)
     *   3. Physics world step
     */
    update(frame) {
        const entities = this.getAll();
        // 1. Update all components FIRST (sorted by type for determinism)
        // This ensures InputComponent applies inputs before entity.tick() reads them
        for (const entity of entities) {
            const componentTypes = [...entity.components.keys()].sort();
            for (const type of componentTypes) {
                const component = entity.components.get(type);
                if (component.onUpdate) {
                    component.onUpdate(frame);
                }
            }
        }
        // 2. Call tick() on all entities for custom logic
        // Now entities can read current-frame inputs from their components
        for (const entity of entities) {
            // First try type-based tick handler (from EntityBuilder)
            const typeHandler = this.tickHandlers.get(entity.type);
            if (typeHandler) {
                typeHandler(entity, frame);
            }
            // Then call entity's own tick (for class-based entities)
            entity.tick(frame);
        }
        // 3. Step physics world
        if (this.world) {
            stepWorld2D(this.world);
        }
        if (this.world3D) {
            stepWorld(this.world3D);
        }
    }
    // ============================================
    // State Serialization
    // ============================================
    /**
     * Save all entity state for rollback
     */
    saveState() {
        const entities = [];
        for (const entity of this.getAll()) {
            // Serialize sync values (getters are called)
            const sync = {};
            for (const key of Object.keys(entity.sync)) {
                sync[key] = entity.sync[key];
            }
            entities.push({
                id: entity.id,
                className: entity.constructor.name,
                type: entity.type,
                sync
            });
        }
        return { entities };
    }
    /**
     * Load entity state from rollback/snapshot.
     * Creates entities using classRegistry, then applies sync values.
     * Constructor runs on first local appearance (sets up behavior).
     * Sync values from snapshot overwrite constructor defaults.
     */
    loadState(state) {
        // Build set of IDs that should exist
        const stateIds = new Set(state.entities.map(e => e.id));
        // Remove entities not in state
        for (const entity of Object.values(this.entities)) {
            if (!stateIds.has(entity.id)) {
                this.destroy(entity);
            }
        }
        // Update or create entities from state
        for (const entityState of state.entities) {
            let entity = this.entities[entityState.id];
            if (!entity) {
                // Entity doesn't exist - try to create using factory or classRegistry
                // Priority: 1) type-based factory (Prefab pattern), 2) classRegistry (class pattern)
                // First, try type-based factory (registered by Prefab.registerFactory)
                const factory = this.factories.get(entityState.type);
                if (factory) {
                    // Set restore context so factory creates entity with correct ID
                    setRestoreContext({ id: entityState.id, skipRegister: true });
                    entity = factory({ id: entityState.id, sync: entityState.sync });
                    setRestoreContext(null);
                }
                else {
                    // Fallback to class-based creation
                    let EntityClass = classRegistry.get(entityState.className);
                    // Fallback: try to find class in global scope (for classes defined in HTML scripts)
                    if (!EntityClass && typeof window !== 'undefined') {
                        EntityClass = window[entityState.className];
                        if (EntityClass) {
                            // Register it for future use
                            classRegistry.set(entityState.className, EntityClass);
                        }
                    }
                    if (!EntityClass) {
                        console.warn(`Cannot restore entity: no factory for type "${entityState.type}" and ` +
                            `class "${entityState.className}" not registered. Skipping entity ${entityState.id}.`);
                        continue;
                    }
                    // Set restore context so constructor gets id and skips registration
                    setRestoreContext({ id: entityState.id, skipRegister: true });
                    // Create entity - constructor uses restoreContext for id
                    // Pass clientId for Player class (it needs it as constructor arg)
                    if (entityState.sync?.hasInput && entityState.sync?.clientId) {
                        entity = new EntityClass(entityState.sync.clientId);
                    }
                    else {
                        entity = new EntityClass();
                    }
                    // Clear restore context
                    setRestoreContext(null);
                    // Register with manager
                    entity.manager = this;
                    this.entities[entity.id] = entity;
                    // Set type (adds to byType array)
                    if (entityState.type) {
                        entity.setType(entityState.type);
                    }
                }
            }
            // Apply sync values (overwrites constructor defaults)
            if (entityState.sync) {
                for (const [key, value] of Object.entries(entityState.sync)) {
                    if (value !== undefined) {
                        entity.sync[key] = value;
                    }
                }
                // Auto-create physics2d component if sync has physics data but entity doesn't have it
                // This happens when entity class constructor doesn't call setBody() (behavior-only pattern)
                const existingPhysics = entity.getComponent('physics2d');
                if (!existingPhysics && entityState.sync.bodyType !== undefined) {
                    const physics2dFactory = componentFactories.get('physics2d');
                    if (physics2dFactory) {
                        // Convert sync format (fixed-point) to component options
                        const sync = entityState.sync;
                        const bodyTypeMap = ['static', 'kinematic', 'dynamic'];
                        const shapeTypeMap = ['circle', 'box'];
                        const type = bodyTypeMap[sync.bodyType] || 'static';
                        const shape = shapeTypeMap[sync.shapeType] || 'circle';
                        const componentState = {
                            type,
                            shape,
                            x: toFloat(sync.x || 0),
                            y: toFloat(sync.y || 0),
                            angle: sync.angle !== undefined ? toFloat(sync.angle) : undefined,
                            vx: sync.vx !== undefined ? toFloat(sync.vx) : undefined,
                            vy: sync.vy !== undefined ? toFloat(sync.vy) : undefined,
                            radius: shape === 'circle' ? (sync.shapeRadius !== undefined ? toFloat(sync.shapeRadius) : 1) : undefined,
                            width: shape === 'box' ? (sync.shapeWidth !== undefined ? toFloat(sync.shapeWidth) : 1) : undefined,
                            height: shape === 'box' ? (sync.shapeHeight !== undefined ? toFloat(sync.shapeHeight) : 1) : undefined,
                            isSensor: sync.isSensor
                        };
                        const component = physics2dFactory(componentState);
                        entity.addComponent(component);
                    }
                }
                // General component sync - call syncFromEntity on ALL components
                for (const component of entity.components.values()) {
                    if (typeof component.syncFromEntity === 'function') {
                        component.syncFromEntity();
                    }
                }
            }
        }
    }
    /**
     * Attach registered handlers to entities after snapshot restore.
     * Called by engine after onJoin to ensure handlers are registered.
     */
    attachRestoredHandlers() {
        for (const entity of this.getAll()) {
            // Collision handlers (Entity2D/Entity3D)
            if (entity.type && !entity._onCollision) {
                const handler = this.collisionHandlers.get(entity.type);
                if (handler) {
                    entity._onCollision = handler;
                }
            }
            // Input commands (Players with InputComponent)
            const input = entity.getComponent('input');
            if (input && entity.type) {
                const commands = this.inputCommands.get(entity.type);
                if (commands && !input.processor?.hasCommands?.()) {
                    input.setCommands(commands);
                }
            }
        }
    }
    // ============================================
    // Reset
    // ============================================
    /**
     * Clear all entities
     */
    reset() {
        // Destroy all entities (this calls onDetach which removes bodies from world)
        for (const entity of Object.values(this.entities)) {
            this.destroy(entity);
        }
        // Clear all references
        for (const id in this.entities)
            delete this.entities[id];
        for (const type in this.byType)
            delete this.byType[type];
        // Also clear physics world bodies as a safety measure
        if (this.world) {
            this.world.bodies.length = 0;
        }
        if (this.world3D) {
            this.world3D.bodies.length = 0;
        }
    }
    // ============================================
    // Hash Computation
    // ============================================
    /**
     * Compute a hash of all entity states for sync verification.
     * Syncs physics state to entity.sync before computing hash.
     */
    computeHash() {
        let hash = 0;
        for (const entity of this.getAll()) {
            // Sync physics state to entity.sync before hashing
            const physicsComp = entity.getComponent('physics2d');
            if (physicsComp && typeof physicsComp.syncToEntity === 'function') {
                physicsComp.syncToEntity();
            }
            // Hash entity ID
            for (let i = 0; i < entity.id.length; i++) {
                hash = ((hash << 5) - hash + entity.id.charCodeAt(i)) >>> 0;
            }
            // Hash sync values (sorted keys for determinism)
            const sortedKeys = Object.keys(entity.sync).sort();
            for (const key of sortedKeys) {
                const value = entity.sync[key];
                if (value !== undefined) {
                    // Hash key
                    for (let i = 0; i < key.length; i++) {
                        hash = ((hash << 5) - hash + key.charCodeAt(i)) >>> 0;
                    }
                    // Hash value (convert to number)
                    hash = ((hash << 5) - hash + (typeof value === 'number' ? value : 0)) >>> 0;
                }
            }
        }
        return hash;
    }
    /**
     * Get state hash as hex string (8 characters).
     * Use this for sync verification - same state = same hash string.
     */
    getStateHash() {
        return this.computeHash().toString(16).padStart(8, '0');
    }
    /**
     * Get the number of entities.
     */
    get count() {
        return Object.keys(this.entities).length;
    }
}
