/**
 * Collision Layers
 *
 * Controls which bodies can collide with each other using bitmasks.
 * Layer = "what am I", Mask = "what do I collide with"
 *
 * Shared between 2D and 3D physics engines.
 */
export interface CollisionFilter {
    /** Which layer this body belongs to (single bit) */
    layer: number;
    /** Which layers this body collides with (bitmask) */
    mask: number;
}
export declare const Layers: {
    readonly NONE: 0;
    readonly DEFAULT: number;
    readonly PLAYER: number;
    readonly ENEMY: number;
    readonly PROJECTILE: number;
    readonly ITEM: number;
    readonly TRIGGER: number;
    readonly WORLD: number;
    readonly PROP: number;
    readonly CUSTOM_1: number;
    readonly CUSTOM_2: number;
    readonly CUSTOM_3: number;
    readonly CUSTOM_4: number;
    readonly CUSTOM_5: number;
    readonly CUSTOM_6: number;
    readonly CUSTOM_7: number;
    readonly CUSTOM_8: number;
    readonly ALL: 65535;
};
/**
 * Default collision filter - collides with everything
 */
export declare const DEFAULT_FILTER: CollisionFilter;
/**
 * Create a collision filter
 */
export declare function createFilter(layer: number, mask?: number): CollisionFilter;
/**
 * Check if two filters allow collision
 * Both must have the other in their mask
 */
export declare function shouldCollide(a: CollisionFilter, b: CollisionFilter): boolean;
/**
 * Create a filter that collides with specific layers
 */
export declare function filterCollidingWith(layer: number, ...collidesWithLayers: number[]): CollisionFilter;
/**
 * Create a filter that collides with everything except specific layers
 */
export declare function filterExcluding(layer: number, ...excludeLayers: number[]): CollisionFilter;
