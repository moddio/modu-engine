/**
 * Component System
 *
 * Components are pure data containers. This module handles:
 * - Component type definitions with schemas
 * - Type inference from default values
 * - SoA (Structure of Arrays) storage allocation
 * - Pre-generated accessor class creation
 */
/**
 * Supported field types for components.
 * - i32: 32-bit integer (default for numbers, uses fixed-point for physics)
 * - u8: 8-bit unsigned (for flags, enums)
 * - bool: boolean (stored as u8)
 * - f32: 32-bit float (ONLY for render-only data, NON-DETERMINISTIC)
 */
export type FieldType = 'i32' | 'u8' | 'bool' | 'f32';
export interface FieldDefinition {
    type: FieldType;
    default: number | boolean;
}
export interface ComponentSchema {
    [fieldName: string]: FieldDefinition;
}
/**
 * Component storage using Structure of Arrays (SoA) pattern.
 * Each field is stored in a separate TypedArray for cache efficiency.
 */
export interface ComponentStorage {
    /** Bitmask tracking which entities have this component */
    mask: Uint32Array;
    /** Field arrays indexed by entity index */
    fields: Record<string, Int32Array | Uint8Array | Float32Array>;
    /** Schema defining field types */
    schema: ComponentSchema;
}
/**
 * Options for defining a component.
 */
export interface ComponentOptions {
    /**
     * Whether this component should be synchronized across the network.
     * When false, the component is excluded from:
     * - Network snapshots (not sent to other clients)
     * - State hash computation (doesn't affect determinism checks)
     * - Rollback state (not saved/restored during rollback)
     *
     * Use sync: false for client-only state like cameras, UI, local effects.
     * @default true
     */
    sync?: boolean;
}
/**
 * Component type definition.
 */
export interface ComponentType<T extends Record<string, any> = any> {
    readonly name: string;
    readonly schema: ComponentSchema;
    readonly storage: ComponentStorage;
    readonly AccessorClass: new (index: number) => T;
    readonly fieldNames: string[];
    /** Whether this component is synchronized across network. Default: true */
    readonly sync: boolean;
}
/**
 * Infer field definition from a default value.
 * ALL numbers default to i32 for determinism.
 * f32 requires explicit declaration and logs a warning.
 */
export declare function inferFieldDef(value: any): FieldDefinition;
/**
 * Create SoA storage for a component schema.
 */
export declare function createComponentStorage(schema: ComponentSchema): ComponentStorage;
/**
 * Generate an accessor class for a component type.
 * Uses Object.defineProperty for optimal V8 performance (not Proxy).
 */
export declare function generateAccessorClass<T>(name: string, schema: ComponentSchema, storage: ComponentStorage): new (index: number) => T;
/**
 * Define a new component type.
 *
 * @param name Unique component name
 * @param defaults Default values (type inferred from values)
 * @param options Optional configuration (sync, etc.)
 * @returns ComponentType for use in entity definitions
 *
 * @example
 * const Health = defineComponent('health', { current: 100, max: 100 });
 * const Position = defineComponent('position', { x: 0, y: 0 });
 *
 * // Client-only component (not synced)
 * const Camera2D = defineComponent('camera2d', { zoom: 1, targetZoom: 1 }, { sync: false });
 */
export declare function defineComponent<T extends Record<string, any>>(name: string, defaults: T, options?: ComponentOptions): ComponentType<{
    [K in keyof T]: T[K] extends boolean ? boolean : number;
}>;
/**
 * Get a component type by name.
 */
export declare function getComponentType(name: string): ComponentType | undefined;
/**
 * Check if entity has component (via bitmask).
 */
export declare function hasComponent(storage: ComponentStorage, index: number): boolean;
/**
 * Add component to entity (set bit in mask).
 */
export declare function addComponentToEntity(storage: ComponentStorage, index: number): void;
/**
 * Remove component from entity (clear bit in mask).
 */
export declare function removeComponentFromEntity(storage: ComponentStorage, index: number): void;
/**
 * Initialize component fields to defaults for an entity.
 */
export declare function initializeComponentDefaults(storage: ComponentStorage, index: number): void;
/**
 * Clear all component registrations (for testing).
 */
export declare function clearComponentRegistry(): void;
/**
 * Get all registered components.
 */
export declare function getAllComponents(): Map<string, ComponentType>;
