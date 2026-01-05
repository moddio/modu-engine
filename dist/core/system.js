/**
 * System Scheduler
 *
 * Manages system registration and execution in ordered phases.
 * Systems are functions that operate on entities with specific components.
 */
import { SYSTEM_PHASES } from './constants';
/**
 * System scheduler - manages system registration and execution.
 */
export class SystemScheduler {
    constructor() {
        /** Systems organized by phase */
        this.systems = new Map();
        /** Whether we're running on client or server */
        this.isClient = true;
        /** System ID counter for ordering */
        this.nextSystemId = 0;
        // Initialize all phases
        for (const phase of SYSTEM_PHASES) {
            this.systems.set(phase, []);
        }
    }
    /**
     * Set whether this scheduler is running on client or server.
     */
    setIsClient(isClient) {
        this.isClient = isClient;
    }
    /**
     * Add a system to the scheduler.
     *
     * @param fn System function to execute
     * @param options System options (phase, client/server, order)
     * @returns Function to remove the system
     */
    add(fn, options = {}) {
        const phase = options.phase || 'update';
        const systems = this.systems.get(phase);
        if (!systems) {
            throw new Error(`Unknown system phase: ${phase}`);
        }
        const entry = {
            fn,
            options,
            order: options.order ?? this.nextSystemId++
        };
        systems.push(entry);
        // Sort by order
        systems.sort((a, b) => a.order - b.order);
        // Return removal function
        return () => this.remove(fn);
    }
    /**
     * Remove a system from the scheduler.
     */
    remove(fn) {
        for (const systems of this.systems.values()) {
            const index = systems.findIndex(s => s.fn === fn);
            if (index !== -1) {
                systems.splice(index, 1);
                return true;
            }
        }
        return false;
    }
    /**
     * Run all systems in a specific phase.
     */
    runPhase(phase) {
        const systems = this.systems.get(phase);
        if (!systems)
            return;
        for (const system of systems) {
            // Skip client-only systems on server
            if (system.options.client && !this.isClient)
                continue;
            // Skip server-only systems on client
            if (system.options.server && this.isClient)
                continue;
            // Execute system
            try {
                const result = system.fn();
                // Check for accidental async systems
                if (result && typeof result === 'object' && 'then' in result) {
                    throw new Error(`System returned a Promise. Async systems are not allowed ` +
                        `as they break determinism. Remove 'await' from your system.`);
                }
            }
            catch (error) {
                console.error(`Error in system during '${phase}' phase:`, error);
                throw error;
            }
        }
    }
    /**
     * Run all phases in order (except render if not client).
     */
    runAll() {
        for (const phase of SYSTEM_PHASES) {
            // Skip render phase on server
            if (phase === 'render' && !this.isClient)
                continue;
            this.runPhase(phase);
        }
    }
    /**
     * Get count of systems in each phase (for debugging).
     */
    getSystemCounts() {
        const counts = {};
        for (const [phase, systems] of this.systems) {
            counts[phase] = systems.length;
        }
        return counts;
    }
    /**
     * Clear all systems (for testing).
     */
    clear() {
        for (const systems of this.systems.values()) {
            systems.length = 0;
        }
        this.nextSystemId = 0;
    }
}
