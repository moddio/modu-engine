/**
 * String Registry - Deterministic string interning
 *
 * Converts strings to integer IDs for efficient storage and comparison.
 * Used for entity types, colors, sprite IDs, etc.
 *
 * DETERMINISM: ID allocation order must be identical across all clients.
 * Strings are assigned IDs in order of first intern() call.
 */
export interface StringRegistryState {
    tables: Record<string, Record<string, number>>;
    nextIds: Record<string, number>;
}
/**
 * String registry for interning strings.
 *
 * Provides bidirectional mapping between strings and integer IDs,
 * organized by namespace (e.g., 'color', 'sprite', 'entityType').
 */
export declare class StringRegistry {
    private stringToId;
    private idToString;
    private nextId;
    /**
     * Intern a string, get back an integer ID.
     * If the string was already interned, returns the existing ID.
     *
     * @param namespace - Category for the string (e.g., 'color', 'sprite')
     * @param str - The string to intern
     * @returns Integer ID for the string
     */
    intern(namespace: string, str: string): number;
    /**
     * Look up string by ID.
     *
     * @param namespace - Category for the string
     * @param id - Integer ID to look up
     * @returns The original string, or null if not found
     */
    getString(namespace: string, id: number): string | null;
    /**
     * Get state for snapshotting.
     * Returns a serializable representation of all interned strings.
     */
    getState(): StringRegistryState;
    /**
     * Restore state from snapshot.
     * Replaces all current data with the snapshot state.
     */
    setState(state: StringRegistryState): void;
    /**
     * Clear all data.
     */
    clear(): void;
}
