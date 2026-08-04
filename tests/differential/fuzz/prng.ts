// packages/engine/tests/differential/fuzz/prng.ts

/** Deterministic 32-bit PRNG. Never use Math.random in the fuzz path —
 *  determinism is the whole point of the differential gate. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max]. */
export function randInt(r: () => number, min: number, max: number): number {
  return Math.floor(r() * (max - min + 1)) + min;
}

/** Pick one element. */
export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)];
}
