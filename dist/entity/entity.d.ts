/**
 * Entity System - Base Entity
 *
 * Entities are game objects with unique identifiers and components.
 * All entity operations are deterministic for network synchronization.
 */
import { Component } from './component';
export interface Entity {
    /** Unique identifier for this entity */
    readonly id: string;
    /** Entity type (e.g., 'cell', 'food', 'bullet') - set via setType() */
    type: string;
    /** Set entity type (updates manager's byType index) */
    setType(type: string): this;
    /** Human-readable label for debugging and deterministic ordering */
    label: string;
    /** Whether this entity is active in the simulation */
    active: boolean;
    /** Reference to the EntityManager that owns this entity */
    manager: any;
    /** Component storage */
    readonly components: Map<string, Component>;
    /** Synced state - serialized in snapshots */
    readonly sync: Record<string, any>;
    /** Lifecycle hooks */
    onCreate?(): void;
    onDestroy?(): void;
    /** Per-frame update (override for custom logic) */
    tick(frame: number): void;
    /** Collision callback - called when this entity collides with another */
    onCollision?(other: Entity): void;
    /** Custom draw function (set via EntityBuilder.draw() or manually) */
    draw?(ctx: any, pos: {
        x: number;
        y: number;
    }): void;
    /** Component management */
    addComponent<T extends Component>(component: T): T;
    getComponent<T extends Component>(type: string): T | null;
    hasComponent(type: string): boolean;
    removeComponent(type: string): boolean;
    /** Physics body (null if no physics component) */
    readonly body: any;
    /** Input component proxy (null if no input component) */
    readonly input: any;
    /** Destroy this entity */
    destroy(): void;
}
export interface EntityConfig {
    id?: string;
    label?: string;
    active?: boolean;
    /** Initial sync values (used when restoring from snapshot) */
    sync?: Record<string, any>;
}
export declare function resetEntityIdCounter(): void;
export declare function getEntityIdCounter(): number;
export declare function setEntityIdCounter(value: number): void;
export declare function generateEntityId(): string;
export declare function setRestoreContext(ctx: {
    id: string;
    skipRegister: boolean;
} | null): void;
export declare function getRestoreContext(): {
    id: string;
    skipRegister: boolean;
} | null;
export declare class BaseEntity implements Entity {
    readonly id: string;
    type: string;
    label: string;
    active: boolean;
    manager: any;
    readonly components: Map<string, Component>;
    /** Synced state - serialized in snapshots */
    readonly sync: Record<string, any>;
    constructor(config?: EntityConfig);
    /**
     * Set entity type. Updates manager's byType index if registered.
     * Also auto-registers this class as factory for the type (for snapshot restore).
     */
    setType(type: string): this;
    addComponent<T extends Component>(component: T): T;
    getComponent<T extends Component>(type: string): T | null;
    hasComponent(type: string): boolean;
    removeComponent(type: string): boolean;
    onCreate?(): void;
    onDestroy?(): void;
    /** Custom draw function (set via EntityBuilder.draw()) */
    draw?(ctx: any, pos: {
        x: number;
        y: number;
    }): void;
    /**
     * Per-frame update. Override for custom logic.
     * No need to call super - components are updated by EntityManager.
     */
    tick(frame: number): void;
    /** Physics2D component (null if no physics component) */
    get physics(): any;
    /** Raw physics body (null if no physics component) */
    get body(): any;
    /** Input component proxy (null if no input component) */
    get input(): any;
    /** X position (float) */
    get x(): number;
    /** Y position (float) */
    get y(): number;
    /**
     * Set position with deterministic fixed-point conversion
     */
    moveTo(x: number, y: number): void;
    /**
     * Move by offset with deterministic fixed-point conversion
     */
    moveBy(dx: number, dy: number): void;
    /**
     * Move toward target position at given speed (DETERMINISTIC).
     * All calculations use fixed-point math internally.
     * @returns true if moved, false if at/near target
     */
    moveToward(targetX: number, targetY: number, speed: number, minDistance?: number): boolean;
    /**
     * Destroy this entity and remove from EntityManager.
     */
    destroy(): void;
}
