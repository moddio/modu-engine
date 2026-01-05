/**
 * Collision Layers
 *
 * Controls which bodies can collide with each other using bitmasks.
 * Layer = "what am I", Mask = "what do I collide with"
 *
 * Shared between 2D and 3D physics engines.
 */

// ============================================
// Collision Filter
// ============================================

export interface CollisionFilter {
    /** Which layer this body belongs to (single bit) */
    layer: number;
    /** Which layers this body collides with (bitmask) */
    mask: number;
}

// ============================================
// Default Layers
// ============================================

export const Layers = {
    NONE: 0,
    DEFAULT: 1 << 0,      // 1
    PLAYER: 1 << 1,       // 2
    ENEMY: 1 << 2,        // 4
    PROJECTILE: 1 << 3,   // 8
    ITEM: 1 << 4,         // 16
    TRIGGER: 1 << 5,      // 32
    WORLD: 1 << 6,        // 64
    PROP: 1 << 7,         // 128
    // Layers 8-15 reserved for game-specific use
    CUSTOM_1: 1 << 8,
    CUSTOM_2: 1 << 9,
    CUSTOM_3: 1 << 10,
    CUSTOM_4: 1 << 11,
    CUSTOM_5: 1 << 12,
    CUSTOM_6: 1 << 13,
    CUSTOM_7: 1 << 14,
    CUSTOM_8: 1 << 15,
    ALL: 0xFFFF           // All layers
} as const;

// ============================================
// Default Filter
// ============================================

/**
 * Default collision filter - collides with everything
 */
export const DEFAULT_FILTER: CollisionFilter = {
    layer: Layers.DEFAULT,
    mask: Layers.ALL
};

// ============================================
// Filter Helpers
// ============================================

/**
 * Create a collision filter
 */
export function createFilter(layer: number, mask: number = Layers.ALL): CollisionFilter {
    return { layer, mask };
}

/**
 * Check if two filters allow collision
 * Both must have the other in their mask
 */
export function shouldCollide(a: CollisionFilter, b: CollisionFilter): boolean {
    return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
}

/**
 * Create a filter that collides with specific layers
 */
export function filterCollidingWith(layer: number, ...collidesWithLayers: number[]): CollisionFilter {
    let mask = 0;
    for (const l of collidesWithLayers) {
        mask |= l;
    }
    return { layer, mask };
}

/**
 * Create a filter that collides with everything except specific layers
 */
export function filterExcluding(layer: number, ...excludeLayers: number[]): CollisionFilter {
    let mask = Layers.ALL;
    for (const l of excludeLayers) {
        mask &= ~l;
    }
    return { layer, mask };
}
