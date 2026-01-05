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
export class StringRegistry {
    private stringToId: Map<string, Map<string, number>> = new Map();
    private idToString: Map<string, Map<number, string>> = new Map();
    private nextId: Map<string, number> = new Map();

    /**
     * Intern a string, get back an integer ID.
     * If the string was already interned, returns the existing ID.
     *
     * @param namespace - Category for the string (e.g., 'color', 'sprite')
     * @param str - The string to intern
     * @returns Integer ID for the string
     */
    intern(namespace: string, str: string): number {
        let nsMap = this.stringToId.get(namespace);
        if (!nsMap) {
            nsMap = new Map();
            this.stringToId.set(namespace, nsMap);
        }

        const existing = nsMap.get(str);
        if (existing !== undefined) return existing;

        const id = this.nextId.get(namespace) ?? 1;
        this.nextId.set(namespace, id + 1);

        nsMap.set(str, id);

        let idMap = this.idToString.get(namespace);
        if (!idMap) {
            idMap = new Map();
            this.idToString.set(namespace, idMap);
        }
        idMap.set(id, str);

        return id;
    }

    /**
     * Look up string by ID.
     *
     * @param namespace - Category for the string
     * @param id - Integer ID to look up
     * @returns The original string, or null if not found
     */
    getString(namespace: string, id: number): string | null {
        return this.idToString.get(namespace)?.get(id) ?? null;
    }

    /**
     * Get state for snapshotting.
     * Returns a serializable representation of all interned strings.
     */
    getState(): StringRegistryState {
        const tables: Record<string, Record<string, number>> = {};
        const nextIds: Record<string, number> = {};

        for (const [ns, nsMap] of this.stringToId) {
            tables[ns] = Object.fromEntries(nsMap);
            nextIds[ns] = this.nextId.get(ns) ?? 1;
        }

        return { tables, nextIds };
    }

    /**
     * Restore state from snapshot.
     * Replaces all current data with the snapshot state.
     */
    setState(state: StringRegistryState): void {
        this.stringToId.clear();
        this.idToString.clear();
        this.nextId.clear();

        for (const [ns, table] of Object.entries(state.tables)) {
            const nsMap = new Map(Object.entries(table));
            this.stringToId.set(ns, nsMap);

            const idMap = new Map<number, string>();
            for (const [str, id] of nsMap) {
                idMap.set(id, str);
            }
            this.idToString.set(ns, idMap);

            this.nextId.set(ns, state.nextIds[ns] ?? 1);
        }
    }

    /**
     * Clear all data.
     */
    clear(): void {
        this.stringToId.clear();
        this.idToString.clear();
        this.nextId.clear();
    }
}
