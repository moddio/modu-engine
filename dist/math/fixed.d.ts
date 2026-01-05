/**
 * Fixed-Point Math Library for Deterministic Physics
 *
 * Uses 32-bit integers with 16.16 fixed-point format:
 * - 16 bits for integer part (-32768 to 32767)
 * - 16 bits for fractional part (precision ~0.000015)
 *
 * All operations are 100% deterministic across platforms.
 */
export declare const FP_SHIFT = 16;
export declare const FP_ONE: number;
export declare const FP_HALF: number;
export declare const FP_PI = 205887;
export declare const FP_2PI = 411775;
export declare const FP_HALF_PI = 102944;
export type Fixed = number;
/** Convert float to fixed-point */
export declare function toFixed(f: number): Fixed;
/** Convert fixed-point to float (for rendering only) */
export declare function toFloat(fp: Fixed): number;
/** Fixed-point multiplication */
export declare function fpMul(a: Fixed, b: Fixed): Fixed;
/** Fixed-point division */
export declare function fpDiv(a: Fixed, b: Fixed): Fixed;
/** Fixed-point absolute value */
export declare function fpAbs(a: Fixed): Fixed;
/** Fixed-point sign */
export declare function fpSign(a: Fixed): Fixed;
/** Fixed-point min */
export declare function fpMin(a: Fixed, b: Fixed): Fixed;
/** Fixed-point max */
export declare function fpMax(a: Fixed, b: Fixed): Fixed;
/** Fixed-point clamp */
export declare function fpClamp(v: Fixed, min: Fixed, max: Fixed): Fixed;
/** Fixed-point floor */
export declare function fpFloor(a: Fixed): Fixed;
/** Fixed-point ceil */
export declare function fpCeil(a: Fixed): Fixed;
/** Fixed-point square root using Newton-Raphson iteration */
export declare function fpSqrt(a: Fixed): Fixed;
/**
 * Deterministic square root (float API).
 * Takes a float, returns a float, but uses fixed-point internally for determinism.
 *
 * @example
 * const dist = dSqrt(dx * dx + dy * dy);  // Deterministic!
 */
export declare function dSqrt(x: number): number;
/** Fixed-point sine using lookup table with linear interpolation */
export declare function fpSin(angle: Fixed): Fixed;
/** Fixed-point cosine */
export declare function fpCos(angle: Fixed): Fixed;
/** Fixed-point atan2 using CORDIC-style approximation */
export declare function fpAtan2(y: Fixed, x: Fixed): Fixed;
