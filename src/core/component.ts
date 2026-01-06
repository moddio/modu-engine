/**
 * Component System
 *
 * Components are pure data containers. This module handles:
 * - Component type definitions with schemas
 * - Type inference from default values
 * - SoA (Structure of Arrays) storage allocation
 * - Pre-generated accessor class creation
 */

import { MAX_ENTITIES } from './constants';
import { toFixed, toFloat } from '../math';

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
export function inferFieldDef(value: any): FieldDefinition {
    // Explicit type definition
    if (typeof value === 'object' && value !== null && 'type' in value) {
        const def = value as { type: FieldType; default?: number | boolean };

        if (def.type === 'f32') {
            console.warn(
                `Component field uses f32 which is NON-DETERMINISTIC. ` +
                `Only use for render-only data, never for synced state.`
            );
        }

        return {
            type: def.type,
            default: def.default ?? (def.type === 'bool' ? false : 0)
        };
    }

    // Boolean inference
    if (typeof value === 'boolean') {
        return { type: 'bool', default: value };
    }

    // Number inference - ALL default to i32 for determinism
    if (typeof value === 'number') {
        return { type: 'i32', default: value };
    }

    // Null/undefined treated as i32 with 0 default
    if (value === null || value === undefined) {
        return { type: 'i32', default: 0 };
    }

    throw new Error(
        `Unsupported field type: ${typeof value}. ` +
        `Components can only contain numbers and booleans. ` +
        `Use game.internString() for string values.`
    );
}

/**
 * Create TypedArray for a field type.
 */
function createFieldArray(type: FieldType): Int32Array | Uint8Array | Float32Array {
    switch (type) {
        case 'i32':
            return new Int32Array(MAX_ENTITIES);
        case 'u8':
        case 'bool':
            return new Uint8Array(MAX_ENTITIES);
        case 'f32':
            return new Float32Array(MAX_ENTITIES);
        default:
            throw new Error(`Unknown field type: ${type}`);
    }
}

/**
 * Create SoA storage for a component schema.
 */
export function createComponentStorage(schema: ComponentSchema): ComponentStorage {
    const fields: Record<string, Int32Array | Uint8Array | Float32Array> = {};

    for (const [name, def] of Object.entries(schema)) {
        fields[name] = createFieldArray(def.type);
    }

    return {
        mask: new Uint32Array(Math.ceil(MAX_ENTITIES / 32)),
        fields,
        schema
    };
}

/**
 * Generate an accessor class for a component type.
 * Uses Object.defineProperty for optimal V8 performance (not Proxy).
 */
export function generateAccessorClass<T>(
    name: string,
    schema: ComponentSchema,
    storage: ComponentStorage
): new (index: number) => T {
    // Create a class dynamically
    const AccessorClass = function(this: any, index: number) {
        this._index = index;
    } as any;

    AccessorClass.prototype = {};

    // Add getter/setter for each field
    for (const [fieldName, fieldDef] of Object.entries(schema)) {
        const fieldArray = storage.fields[fieldName];
        const isFixedPoint = fieldDef.type === 'i32';
        const isBool = fieldDef.type === 'bool';

        Object.defineProperty(AccessorClass.prototype, fieldName, {
            get: function(this: { _index: number }) {
                const value = fieldArray[this._index];
                if (isBool) return value !== 0;
                if (isFixedPoint) return toFloat(value as number);
                return value;
            },
            set: function(this: { _index: number }, value: any) {
                if (isBool) {
                    fieldArray[this._index] = value ? 1 : 0;
                } else if (isFixedPoint) {
                    fieldArray[this._index] = toFixed(value);
                } else {
                    fieldArray[this._index] = value;
                }
            },
            enumerable: true,
            configurable: false
        });
    }

    // Add _index property definition
    Object.defineProperty(AccessorClass.prototype, '_index', {
        value: 0,
        writable: true,
        enumerable: false,
        configurable: false
    });

    return AccessorClass as new (index: number) => T;
}

/**
 * Component registry - stores all defined components.
 */
const componentRegistry = new Map<string, ComponentType>();

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
export function defineComponent<T extends Record<string, any>>(
    name: string,
    defaults: T,
    options?: ComponentOptions
): ComponentType<{ [K in keyof T]: T[K] extends boolean ? boolean : number }> {
    if (componentRegistry.has(name)) {
        throw new Error(`Component '${name}' is already defined`);
    }

    // Build schema from defaults
    const schema: ComponentSchema = {};
    for (const [fieldName, defaultValue] of Object.entries(defaults)) {
        schema[fieldName] = inferFieldDef(defaultValue);
    }

    // Create storage
    const storage = createComponentStorage(schema);

    // Generate accessor class
    const AccessorClass = generateAccessorClass<any>(name, schema, storage);

    const componentType: ComponentType = {
        name,
        schema,
        storage,
        AccessorClass,
        fieldNames: Object.keys(schema),
        sync: options?.sync !== false // Default to true
    };

    componentRegistry.set(name, componentType);

    return componentType as any;
}

/**
 * Get a component type by name.
 */
export function getComponentType(name: string): ComponentType | undefined {
    return componentRegistry.get(name);
}

/**
 * Check if entity has component (via bitmask).
 */
export function hasComponent(storage: ComponentStorage, index: number): boolean {
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    return (storage.mask[word] & bit) !== 0;
}

/**
 * Add component to entity (set bit in mask).
 */
export function addComponentToEntity(storage: ComponentStorage, index: number): void {
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    storage.mask[word] |= bit;
}

/**
 * Remove component from entity (clear bit in mask).
 */
export function removeComponentFromEntity(storage: ComponentStorage, index: number): void {
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    storage.mask[word] &= ~bit;
}

/**
 * Initialize component fields to defaults for an entity.
 */
export function initializeComponentDefaults(storage: ComponentStorage, index: number): void {
    for (const [fieldName, fieldDef] of Object.entries(storage.schema)) {
        const arr = storage.fields[fieldName];
        if (fieldDef.type === 'i32') {
            arr[index] = toFixed(fieldDef.default as number);
        } else if (fieldDef.type === 'bool') {
            arr[index] = fieldDef.default ? 1 : 0;
        } else {
            arr[index] = fieldDef.default as number;
        }
    }
}

/**
 * Clear all component registrations (for testing).
 */
export function clearComponentRegistry(): void {
    componentRegistry.clear();
}

/**
 * Get all registered components.
 */
export function getAllComponents(): Map<string, ComponentType> {
    return componentRegistry;
}
