/**
 * Fixed-Point Math Library for Deterministic Physics
 *
 * Uses 32-bit integers with 16.16 fixed-point format:
 * - 16 bits for integer part (-32768 to 32767)
 * - 16 bits for fractional part (precision ~0.000015)
 *
 * All operations are 100% deterministic across platforms.
 */

// Fixed-point constants
export const FP_SHIFT = 16;
export const FP_ONE = 1 << FP_SHIFT;  // 65536
export const FP_HALF = FP_ONE >> 1;    // 32768
export const FP_PI = 205887;           // PI * 65536
export const FP_2PI = 411775;          // 2*PI * 65536
export const FP_HALF_PI = 102944;      // PI/2 * 65536

// Type alias for fixed-point numbers (just integers)
export type Fixed = number;

// ============================================
// Basic Fixed-Point Operations
// ============================================

/** Convert float to fixed-point */
export function toFixed(f: number): Fixed {
    return Math.round(f * FP_ONE);
}

/** Convert fixed-point to float (for rendering only) */
export function toFloat(fp: Fixed): number {
    return fp / FP_ONE;
}

/** Fixed-point multiplication */
export function fpMul(a: Fixed, b: Fixed): Fixed {
    // Use BigInt for intermediate to avoid overflow
    // NOTE: Do NOT use | 0 here - it causes 32-bit overflow for large values
    // (e.g., distance calculations on a 1400x900 canvas can overflow)
    // JavaScript numbers can safely represent integers up to 2^53
    return Number((BigInt(a) * BigInt(b)) >> BigInt(FP_SHIFT));
}

/** Fixed-point division */
export function fpDiv(a: Fixed, b: Fixed): Fixed {
    if (b === 0) return a >= 0 ? 0x7FFFFFFF : -0x7FFFFFFF;
    // NOTE: Do NOT use | 0 here - it causes 32-bit overflow for large values
    return Number((BigInt(a) << BigInt(FP_SHIFT)) / BigInt(b));
}

/** Fixed-point absolute value */
export function fpAbs(a: Fixed): Fixed {
    return a < 0 ? -a : a;
}

/** Fixed-point sign */
export function fpSign(a: Fixed): Fixed {
    return a > 0 ? FP_ONE : a < 0 ? -FP_ONE : 0;
}

/** Fixed-point min */
export function fpMin(a: Fixed, b: Fixed): Fixed {
    return a < b ? a : b;
}

/** Fixed-point max */
export function fpMax(a: Fixed, b: Fixed): Fixed {
    return a > b ? a : b;
}

/** Fixed-point clamp */
export function fpClamp(v: Fixed, min: Fixed, max: Fixed): Fixed {
    return v < min ? min : v > max ? max : v;
}

/** Fixed-point floor */
export function fpFloor(a: Fixed): Fixed {
    return a & ~(FP_ONE - 1);
}

/** Fixed-point ceil */
export function fpCeil(a: Fixed): Fixed {
    return (a + FP_ONE - 1) & ~(FP_ONE - 1);
}

// ============================================
// Square Root (using Newton-Raphson)
// ============================================

/** Fixed-point square root using Newton-Raphson iteration */
export function fpSqrt(a: Fixed): Fixed {
    if (a <= 0) return 0;

    // For 16.16 fixed-point: if a = v * 65536, we want sqrt(v) * 65536
    // sqrt(a) would give sqrt(v) * 256, which is 256x too small!
    // Solution: compute sqrt(a * 65536) = sqrt(a) * 256 = sqrt(v) * 65536
    const scaled = BigInt(a) * BigInt(FP_ONE);
    if (scaled <= 0n) return 0;

    // Better initial guess using bit length
    let bitLen = 0n;
    let temp = scaled;
    while (temp > 0n) {
        bitLen++;
        temp >>= 1n;
    }

    let x = 1n << (bitLen >> 1n);
    if (x === 0n) x = 1n;

    // Newton-Raphson with proper convergence check
    let prevX = 0n;
    for (let i = 0; i < 30; i++) {
        const xNew = (x + scaled / x) >> 1n;
        // Check for true convergence (oscillating between x and x+1)
        if (xNew === x || xNew === prevX) break;
        prevX = x;
        x = xNew;
    }

    // Final adjustment: ensure x*x <= scaled < (x+1)*(x+1)
    while (x * x > scaled) x--;
    while ((x + 1n) * (x + 1n) <= scaled) x++;

    return Number(x);
}

/**
 * Deterministic square root (float API).
 * Takes a float, returns a float, but uses fixed-point internally for determinism.
 *
 * @example
 * const dist = dSqrt(dx * dx + dy * dy);  // Deterministic!
 */
export function dSqrt(x: number): number {
    return toFloat(fpSqrt(toFixed(x)));
}

// ============================================
// Trigonometry (Lookup Tables)
// ============================================

// Sine lookup table (257 entries for 0 to PI/2, inclusive)
// PRE-COMPUTED for cross-platform determinism - DO NOT use Math.sin() at runtime!
// Math.sin() produces different results across browsers/CPUs, breaking determinism.
const SIN_TABLE_SIZE = 256;
const SIN_TABLE: Fixed[] = [
    0, 402, 804, 1206, 1608, 2010, 2412, 2814, 3216, 3617, 4019, 4420, 4821, 5222, 5623, 6023,
    6424, 6824, 7224, 7623, 8022, 8421, 8820, 9218, 9616, 10014, 10411, 10808, 11204, 11600, 11996, 12391,
    12785, 13180, 13573, 13966, 14359, 14751, 15143, 15534, 15924, 16314, 16703, 17091, 17479, 17867, 18253, 18639,
    19024, 19409, 19792, 20175, 20557, 20939, 21320, 21699, 22078, 22457, 22834, 23210, 23586, 23961, 24335, 24708,
    25080, 25451, 25821, 26190, 26558, 26925, 27291, 27656, 28020, 28383, 28745, 29106, 29466, 29824, 30182, 30538,
    30893, 31248, 31600, 31952, 32303, 32652, 33000, 33347, 33692, 34037, 34380, 34721, 35062, 35401, 35738, 36075,
    36410, 36744, 37076, 37407, 37736, 38064, 38391, 38716, 39040, 39362, 39683, 40002, 40320, 40636, 40951, 41264,
    41576, 41886, 42194, 42501, 42806, 43110, 43412, 43713, 44011, 44308, 44604, 44898, 45190, 45480, 45769, 46056,
    46341, 46624, 46906, 47186, 47464, 47741, 48015, 48288, 48559, 48828, 49095, 49361, 49624, 49886, 50146, 50404,
    50660, 50914, 51166, 51417, 51665, 51911, 52156, 52398, 52639, 52878, 53114, 53349, 53581, 53812, 54040, 54267,
    54491, 54714, 54934, 55152, 55368, 55582, 55794, 56004, 56212, 56418, 56621, 56823, 57022, 57219, 57414, 57607,
    57798, 57986, 58172, 58356, 58538, 58718, 58896, 59071, 59244, 59415, 59583, 59750, 59914, 60075, 60235, 60392,
    60547, 60700, 60851, 60999, 61145, 61288, 61429, 61568, 61705, 61839, 61971, 62101, 62228, 62353, 62476, 62596,
    62714, 62830, 62943, 63054, 63162, 63268, 63372, 63473, 63572, 63668, 63763, 63854, 63944, 64031, 64115, 64197,
    64277, 64354, 64429, 64501, 64571, 64639, 64704, 64766, 64827, 64884, 64940, 64993, 65043, 65091, 65137, 65180,
    65220, 65259, 65294, 65328, 65358, 65387, 65413, 65436, 65457, 65476, 65492, 65505, 65516, 65525, 65531, 65535,
    65536  // sin(PI/2) = 1.0 = FP_ONE
];

// Pre-computed constant: (SIN_TABLE_SIZE * 2 / PI) in fixed-point
// Used to map angles to table indices. Pre-computed to avoid Math.PI at runtime.
const FP_ANGLE_TO_INDEX = 10680707;  // = round(162.9746617261 * 65536)

/** Fixed-point sine using lookup table with linear interpolation */
export function fpSin(angle: Fixed): Fixed {
    // Normalize angle to 0 to 2PI using modulo (avoids infinite loops)
    // First handle negative angles
    if (angle < 0) {
        const periods = ((-angle / FP_2PI) | 0) + 1;
        angle += periods * FP_2PI;
    }
    // Then reduce to 0..2PI range
    if (angle >= FP_2PI) {
        angle = angle % FP_2PI;
    }

    // Determine quadrant
    let quadrant = 0;
    if (angle >= FP_PI) {
        angle -= FP_PI;
        quadrant = 2;
    }
    if (angle >= FP_HALF_PI) {
        angle = FP_PI - angle;
        quadrant += 1;
    }

    // Map angle to table index (0 to 256)
    const indexFp = fpMul(angle, FP_ANGLE_TO_INDEX);
    const index = indexFp >> FP_SHIFT;
    const frac = indexFp & (FP_ONE - 1);

    // Linear interpolation with safe bounds clamping
    const clampedIndex = index < 0 ? 0 : (index > SIN_TABLE_SIZE ? SIN_TABLE_SIZE : index);
    const nextIndex = index + 1;
    const clampedIndexNext = nextIndex < 0 ? 0 : (nextIndex > SIN_TABLE_SIZE ? SIN_TABLE_SIZE : nextIndex);
    const a = SIN_TABLE[clampedIndex] ?? 0;
    const b = SIN_TABLE[clampedIndexNext] ?? FP_ONE;
    let result = a + fpMul(b - a, frac);

    // Apply quadrant sign
    if (quadrant >= 2) result = -result;

    return result;
}

/** Fixed-point cosine */
export function fpCos(angle: Fixed): Fixed {
    return fpSin(angle + FP_HALF_PI);
}

/** Fixed-point atan2 using CORDIC-style approximation */
export function fpAtan2(y: Fixed, x: Fixed): Fixed {
    if (x === 0 && y === 0) return 0;

    const absX = fpAbs(x);
    const absY = fpAbs(y);

    // Use approximation: atan(y/x) = (PI/4) * (y/x) for |y/x| <= 1
    let angle: Fixed;
    if (absX >= absY) {
        const ratio = fpDiv(absY, absX);
        // atan approximation for small angles
        angle = fpMul(ratio, 51472); // PI/4 * 65536 = 51472
    } else {
        const ratio = fpDiv(absX, absY);
        angle = FP_HALF_PI - fpMul(ratio, 51472);
    }

    // Adjust for quadrant
    if (x < 0) angle = FP_PI - angle;
    if (y < 0) angle = -angle;

    return angle;
}
