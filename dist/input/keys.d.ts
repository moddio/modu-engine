/**
 * Key Normalization Utilities
 *
 * Provides consistent key name handling across input capture and command processing.
 */
/**
 * Normalize key names for consistency.
 * Special keys keep their canonical case, regular keys are lowercase.
 */
export declare function normalizeKey(key: string): string;
