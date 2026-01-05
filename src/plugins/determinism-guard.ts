/**
 * Determinism Guard
 *
 * Warns developers when non-deterministic functions are called during simulation.
 * Suggests deterministic alternatives like dRandom() and dSqrt().
 */

import type { Game } from '../game';

interface OriginalFunctions {
    mathRandom?: typeof Math.random;
    mathSqrt?: typeof Math.sqrt;
    dateNow?: typeof Date.now;
    performanceNow?: typeof performance.now;
}

const originalFunctions: OriginalFunctions = {};
let installedGame: Game | null = null;
let warnedFunctions: Set<string> = new Set();

function isSimulating(): boolean {
    return installedGame?.world?._isSimulating ?? false;
}

function warnOnce(key: string, message: string) {
    if (!warnedFunctions.has(key)) {
        warnedFunctions.add(key);
        console.warn(message);
    }
}

/**
 * Enable determinism guard for a game instance.
 * Warns when dangerous functions are called during simulation.
 *
 * @example
 * const game = createGame();
 * enableDeterminismGuard(game);
 */
export function enableDeterminismGuard(game: Game): void {
    if (installedGame) {
        console.warn('Determinism guard already installed for another game instance');
        return;
    }

    installedGame = game;
    warnedFunctions.clear();

    // Intercept Math.random
    originalFunctions.mathRandom = Math.random;
    Math.random = function(): number {
        if (isSimulating()) {
            warnOnce('Math.random',
                '⚠️ Math.random() is non-deterministic!\n' +
                '   Use dRandom() instead for deterministic random numbers.\n' +
                '   Example: const r = dRandom();'
            );
        }
        return originalFunctions.mathRandom!();
    };

    // Intercept Math.sqrt
    originalFunctions.mathSqrt = Math.sqrt;
    Math.sqrt = function(x: number): number {
        if (isSimulating()) {
            warnOnce('Math.sqrt',
                '⚠️ Math.sqrt() is non-deterministic!\n' +
                '   Use dSqrt() instead for deterministic square root.\n' +
                '   Example: const dist = dSqrt(dx * dx + dy * dy);'
            );
        }
        return originalFunctions.mathSqrt!(x);
    };

    // Intercept Date.now
    originalFunctions.dateNow = Date.now;
    Date.now = function(): number {
        if (isSimulating()) {
            warnOnce('Date.now',
                '⚠️ Date.now() is non-deterministic!\n' +
                '   Use game.time instead for deterministic timing.\n' +
                '   Example: const respawnAt = game.time + 3000;'
            );
        }
        return originalFunctions.dateNow!();
    };

    // Intercept performance.now
    if (typeof performance !== 'undefined') {
        originalFunctions.performanceNow = performance.now.bind(performance);
        performance.now = function(): number {
            if (isSimulating()) {
                warnOnce('performance.now',
                    '⚠️ performance.now() is non-deterministic!\n' +
                    '   Use game.time instead for deterministic timing.'
                );
            }
            return originalFunctions.performanceNow!();
        };
    }

    console.log('🛡️ Determinism guard enabled');
}

/**
 * Disable determinism guard and restore original functions.
 */
export function disableDeterminismGuard(): void {
    if (originalFunctions.mathRandom) {
        Math.random = originalFunctions.mathRandom;
    }
    if (originalFunctions.mathSqrt) {
        Math.sqrt = originalFunctions.mathSqrt;
    }
    if (originalFunctions.dateNow) {
        Date.now = originalFunctions.dateNow;
    }
    if (originalFunctions.performanceNow && typeof performance !== 'undefined') {
        performance.now = originalFunctions.performanceNow;
    }

    installedGame = null;
    warnedFunctions.clear();

    // Clear stored references
    Object.keys(originalFunctions).forEach(key => {
        delete (originalFunctions as any)[key];
    });
}
