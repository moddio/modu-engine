/**
 * System Scheduler
 *
 * Manages system registration and execution in ordered phases.
 * Systems are functions that operate on entities with specific components.
 */
import { SystemPhase } from './constants';
export interface SystemOptions {
    /** Execution phase (default: 'update') */
    phase?: SystemPhase;
    /** Only run on client (e.g., rendering) */
    client?: boolean;
    /** Only run on server */
    server?: boolean;
    /** Execution order within phase (lower = earlier) */
    order?: number;
}
export type SystemFn = () => void;
/**
 * System scheduler - manages system registration and execution.
 */
export declare class SystemScheduler {
    /** Systems organized by phase */
    private systems;
    /** Whether we're running on client or server */
    private isClient;
    /** System ID counter for ordering */
    private nextSystemId;
    constructor();
    /**
     * Set whether this scheduler is running on client or server.
     */
    setIsClient(isClient: boolean): void;
    /**
     * Add a system to the scheduler.
     *
     * @param fn System function to execute
     * @param options System options (phase, client/server, order)
     * @returns Function to remove the system
     */
    add(fn: SystemFn, options?: SystemOptions): () => void;
    /**
     * Remove a system from the scheduler.
     */
    remove(fn: SystemFn): boolean;
    /**
     * Run all systems in a specific phase.
     */
    runPhase(phase: SystemPhase): void;
    /**
     * Run all phases in order (except render if not client).
     */
    runAll(): void;
    /**
     * Get count of systems in each phase (for debugging).
     */
    getSystemCounts(): Record<SystemPhase, number>;
    /**
     * Clear all systems (for testing).
     */
    clear(): void;
}
