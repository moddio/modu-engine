/**
 * ECS Constants
 *
 * Core constants for the Entity-Component-System architecture.
 */
/**
 * Maximum number of concurrent entities.
 *
 * This is a hard limit due to TypedArray storage. Exceeding this will
 * throw an error. For most games, 10,000 is far more than needed.
 *
 * Memory usage per component field: MAX_ENTITIES × 4 bytes = 40 KB
 * With 10 components × 5 fields average = 2 MB total
 */
export declare const MAX_ENTITIES = 10000;
/**
 * Entity ID format: [12 bits generation][20 bits index]
 * - Generation: Prevents ABA problem when IDs are recycled
 * - Index: Direct array index for O(1) component access
 */
export declare const GENERATION_BITS = 12;
export declare const INDEX_BITS = 20;
export declare const INDEX_MASK: number;
export declare const MAX_GENERATION: number;
/**
 * System execution phases (in order)
 */
export declare const SYSTEM_PHASES: readonly ["input", "update", "prePhysics", "physics", "postPhysics", "render"];
export type SystemPhase = typeof SYSTEM_PHASES[number];
