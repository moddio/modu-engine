/**
 * Determinism Guard
 *
 * Warns developers when non-deterministic functions are called during simulation.
 * Suggests deterministic alternatives like dRandom() and dSqrt().
 */
import type { Game } from '../game';
/**
 * Enable determinism guard for a game instance.
 * Warns when dangerous functions are called during simulation.
 *
 * @example
 * const game = createGame();
 * enableDeterminismGuard(game);
 */
export declare function enableDeterminismGuard(game: Game): void;
/**
 * Disable determinism guard and restore original functions.
 */
export declare function disableDeterminismGuard(): void;
