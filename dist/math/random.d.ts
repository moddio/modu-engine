/**
 * Deterministic Random
 *
 * Simple, deterministic random function. Same seed = same sequence.
 * Automatically overrides Math.random() on import for full determinism.
 */
/**
 * Get random float between 0 (inclusive) and 1 (exclusive).
 * Works like Math.random() but deterministic.
 */
export declare function dRandom(): number;
export interface RandomState {
    s0: number;
    s1: number;
}
export declare function saveRandomState(): RandomState;
export declare function loadRandomState(state: RandomState): void;
