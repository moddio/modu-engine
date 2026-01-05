/**
 * Debug UI - Simple stats overlay for game instances
 *
 * Usage:
 *   Modu.enableDebugUI(game);  // Pass game instance
 *   Modu.setDebugHash(() => computeMyHash()); // Optional: show live state hash
 *
 * Also enables determinism guard to warn about non-deterministic function calls.
 */
/** Interface for objects that can be displayed in debug UI */
export interface DebugUITarget {
    getClientId(): string | null;
    getFrame(): number;
    getNodeUrl(): string | null;
    getLastSnapshot(): {
        hash: string | null;
        frame: number;
        size: number;
        entityCount: number;
    };
    getServerFps(): number;
    getRoomId(): string | null;
    getUploadRate(): number;
    getDownloadRate(): number;
    getClients(): string[];
    getStateHash(): string;
    isAuthority?(): boolean;
    getDriftStats?(): {
        determinismPercent: number;
        totalChecks: number;
        matchingFieldCount: number;
        totalFieldCount: number;
    };
}
export interface DebugUIOptions {
    /** Position: 'top-right' (default), 'top-left', 'bottom-right', 'bottom-left' */
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}
/**
 * Set a callback to compute the current state hash for debug display.
 * The hash will be shown in the debug UI and should change as bodies move.
 */
export declare function setDebugHash(callback: () => string | number): void;
/**
 * Enable debug UI overlay - shows frame, client, node, snapshot info automatically
 * @param target - Object implementing DebugUITarget interface
 * @param options - UI options
 */
export declare function enableDebugUI(target?: DebugUITarget, options?: DebugUIOptions): HTMLDivElement;
/**
 * Disable debug UI
 */
export declare function disableDebugUI(): void;
/**
 * Check if debug UI is enabled
 */
export declare function isDebugUIEnabled(): boolean;
