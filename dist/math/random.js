/**
 * Deterministic Random
 *
 * Simple, deterministic random function. Same seed = same sequence.
 * Automatically overrides Math.random() on import for full determinism.
 */
// ============================================
// Internal State
// ============================================
let s0 = 1;
let s1 = 2;
// ============================================
// Core Random Function
// ============================================
function next() {
    let x = s0;
    const y = s1;
    s0 = y;
    x ^= (x << 23) >>> 0;
    x ^= x >>> 17;
    x ^= y;
    x ^= y >>> 26;
    s1 = x >>> 0;
    return (s0 + s1) >>> 0;
}
// ============================================
// Public API
// ============================================
/**
 * Set the random seed (internal use).
 */
function setSeed(seed) {
    seed = seed >>> 0;
    if (seed === 0)
        seed = 1;
    // Mix the seed into two state values
    let s = seed;
    s = ((s >>> 16) ^ s) * 0x45d9f3b >>> 0;
    s = ((s >>> 16) ^ s) * 0x45d9f3b >>> 0;
    s0 = ((s >>> 16) ^ s) >>> 0;
    s = (seed * 0x9e3779b9) >>> 0;
    s = ((s >>> 16) ^ s) * 0x45d9f3b >>> 0;
    s = ((s >>> 16) ^ s) * 0x45d9f3b >>> 0;
    s1 = ((s >>> 16) ^ s) >>> 0;
    if (s0 === 0 && s1 === 0)
        s0 = 1;
}
/**
 * Get random float between 0 (inclusive) and 1 (exclusive).
 * Works like Math.random() but deterministic.
 */
export function dRandom() {
    return next() / 0x100000000;
}
export function saveRandomState() {
    return { s0, s1 };
}
export function loadRandomState(state) {
    s0 = state.s0;
    s1 = state.s1;
}
// Initialize with default seed
setSeed(1);
