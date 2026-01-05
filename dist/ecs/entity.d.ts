/**
 * Entity Wrapper
 *
 * Provides an ergonomic API for entity access while using SoA storage internally.
 * Entity wrappers are pooled and reused to minimize allocations.
 */
import { ComponentType } from './component';
/**
 * Render-only state (client-only, never serialized).
 */
export interface RenderState {
    /** Previous tick X position (for interpolation) */
    prevX: number;
    /** Previous tick Y position */
    prevY: number;
    /** Interpolated X (computed each render) */
    interpX: number;
    /** Interpolated Y */
    interpY: number;
    /** Screen X after camera transform */
    screenX: number;
    /** Screen Y after camera transform */
    screenY: number;
    /** Whether entity is visible */
    visible: boolean;
    /** Custom render properties */
    [key: string]: any;
}
/**
 * Entity definition for spawning.
 */
export interface EntityDefinition {
    name: string;
    components: Array<{
        type: ComponentType;
        defaults?: Record<string, any>;
    }>;
}
/**
 * Entity wrapper - provides ergonomic access to SoA-stored entity data.
 */
export declare class Entity {
    /** Entity ID (includes generation) */
    eid: number;
    /** Entity type name */
    type: string;
    /** Whether entity is destroyed */
    destroyed: boolean;
    /** Render-only state (client-only, never serialized) */
    render: RenderState;
    /** Component types this entity has */
    private _components;
    /** Cached accessor instances */
    private _accessors;
    /** Reference to world for operations */
    private _world;
    /** Current frame's input data (set during tick) */
    private _inputData;
    /**
     * Get component accessor.
     * Returns typed accessor for reading/writing component data.
     */
    get<T extends Record<string, any>>(component: ComponentType<T>): T;
    /**
     * Check if entity has a component.
     */
    has(component: ComponentType): boolean;
    /**
     * Add a component to this entity at runtime.
     */
    addComponent<T extends Record<string, any>>(component: ComponentType<T>, data?: Partial<T>): T;
    /**
     * Remove a component from this entity at runtime.
     */
    removeComponent(component: ComponentType): void;
    /**
     * Destroy this entity.
     */
    destroy(): void;
    /**
     * Get all components on this entity.
     */
    getComponents(): ComponentType[];
    /**
     * Get current frame's input data.
     * Returns null if no input was received this tick.
     */
    get input(): Record<string, any> | null;
    /**
     * Set input data for this tick (called by World).
     */
    _setInputData(data: Record<string, any> | null): void;
    /**
     * Save current position to render.prev* for interpolation.
     * Should be called in prePhysics phase before physics updates position.
     */
    _savePreviousState(): void;
    /**
     * Calculate interpolated position for rendering.
     * @param alpha Interpolation factor (0-1) between previous and current state
     */
    interpolate(alpha: number): void;
    /**
     * Initialize entity (called by world).
     */
    _init(eid: number, type: string, components: ComponentType[], world: EntityWorld): void;
    /**
     * Clean up entity (called when returned to pool).
     */
    _cleanup(): void;
    /**
     * Set velocity toward a target point.
     * Uses fixed-point math internally for determinism.
     *
     * @param target Target position {x, y}
     * @param speed Speed in units per second
     */
    moveTowards(target: {
        x: number;
        y: number;
    }, speed: number): void;
    /**
     * Set velocity toward a target, but stop if within radius.
     *
     * @param target Target position {x, y}
     * @param speed Speed in units per second
     * @param stopRadius Stop moving when within this distance (default: 0)
     */
    moveTowardsWithStop(target: {
        x: number;
        y: number;
    }, speed: number, stopRadius?: number): void;
    /**
     * Stop all movement.
     */
    stop(): void;
    /**
     * Set velocity directly.
     *
     * @param vx X velocity
     * @param vy Y velocity
     */
    setVelocity(vx: number, vy: number): void;
    /**
     * Get distance to a point (deterministic).
     */
    distanceTo(target: {
        x: number;
        y: number;
    }): number;
    /**
     * Check if within distance of a point (deterministic).
     */
    isWithin(target: {
        x: number;
        y: number;
    }, distance: number): boolean;
}
/**
 * Forward declaration for EntityWorld (actual implementation in world.ts).
 */
export interface EntityWorld {
    queryEngine: {
        addComponent(eid: number, component: ComponentType): void;
        removeComponent(eid: number, component: ComponentType): void;
    };
    destroyEntity(entity: Entity): void;
}
/**
 * Entity pool for reusing entity wrappers.
 */
export declare class EntityPool {
    private pool;
    private active;
    /**
     * Get or create an entity wrapper.
     */
    acquire(eid: number): Entity;
    /**
     * Return entity wrapper to pool.
     */
    release(eid: number): void;
    /**
     * Get entity by eid if it exists.
     */
    get(eid: number): Entity | undefined;
    /**
     * Check if entity exists.
     */
    has(eid: number): boolean;
    /**
     * Clear all entities.
     */
    clear(): void;
    /**
     * Get count of active entities.
     */
    get size(): number;
}
