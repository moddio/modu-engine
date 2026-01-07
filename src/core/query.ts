/**
 * Query Engine
 *
 * Efficient entity queries with caching and iterator support.
 * Queries return iterators with snapshot semantics for safe mutation.
 */

import { ComponentType, hasComponent } from './component';
import { INDEX_MASK } from './constants';

/**
 * Entity-like interface for query results.
 * Actual Entity class will implement this.
 */
export interface QueryableEntity {
    readonly eid: number;
    readonly type: string;
    readonly destroyed: boolean;
}

/**
 * Function to get entity wrapper by eid.
 */
export type EntityGetter = (eid: number) => QueryableEntity | null;

/**
 * Function to check if entity is destroyed.
 */
export type DestroyedChecker = (eid: number) => boolean;

/**
 * Query iterator with snapshot semantics.
 * Captures eid list at creation time for safe iteration during mutation.
 */
export class QueryIterator<T extends QueryableEntity> implements Iterable<T> {
    private eids: number[];
    private index: number = 0;
    private getEntity: EntityGetter;
    private isDestroyed: DestroyedChecker;

    constructor(
        matchingEids: number[],
        getEntity: EntityGetter,
        isDestroyed: DestroyedChecker
    ) {
        // Copy eids at creation time - safe from mutation
        this.eids = matchingEids.slice();
        this.getEntity = getEntity;
        this.isDestroyed = isDestroyed;
    }

    [Symbol.iterator](): Iterator<T> {
        this.index = 0;
        return {
            next: (): IteratorResult<T> => {
                while (this.index < this.eids.length) {
                    const eid = this.eids[this.index++];

                    // Skip destroyed entities
                    if (this.isDestroyed(eid)) continue;

                    const entity = this.getEntity(eid);
                    if (entity) {
                        return { done: false, value: entity as T };
                    }
                }
                return { done: true, value: undefined as any };
            }
        };
    }

    /**
     * Convert to array (allocates).
     */
    toArray(): T[] {
        const result: T[] = [];
        for (const entity of this) {
            result.push(entity);
        }
        return result;
    }

    /**
     * Get first matching entity.
     */
    first(): T | null {
        for (const entity of this) {
            return entity;
        }
        return null;
    }

    /**
     * Find entity matching predicate.
     */
    find(predicate: (entity: T) => boolean): T | null {
        for (const entity of this) {
            if (predicate(entity)) {
                return entity;
            }
        }
        return null;
    }

    /**
     * Count entities without allocating array.
     */
    count(): number {
        let count = 0;
        for (const _ of this) {
            count++;
        }
        return count;
    }
}

/**
 * Query engine - manages entity indices and cached queries.
 */
export class QueryEngine {
    /** Type index: entity type -> set of eids */
    private typeIndex: Map<string, Set<number>> = new Map();

    /** Component index: component -> set of eids */
    private componentIndex: Map<ComponentType, Set<number>> = new Map();

    /** Client ID index: clientId -> eid (O(1) lookup) */
    private clientIdIndex: Map<number, number> = new Map();

    /** Entity getter function */
    private getEntity: EntityGetter;

    /** Destroyed checker function */
    private isDestroyed: DestroyedChecker;

    constructor(getEntity: EntityGetter, isDestroyed: DestroyedChecker) {
        this.getEntity = getEntity;
        this.isDestroyed = isDestroyed;
    }

    /**
     * Register an entity in the indices.
     */
    addEntity(eid: number, type: string, components: ComponentType[], clientId?: number): void {
        // Add to type index
        let typeSet = this.typeIndex.get(type);
        if (!typeSet) {
            typeSet = new Set();
            this.typeIndex.set(type, typeSet);
        }
        typeSet.add(eid);

        // Add to component indices
        for (const component of components) {
            let compSet = this.componentIndex.get(component);
            if (!compSet) {
                compSet = new Set();
                this.componentIndex.set(component, compSet);
            }
            compSet.add(eid);
        }

        // Add to clientId index if provided
        if (clientId !== undefined) {
            this.clientIdIndex.set(clientId, eid);
        }
    }

    /**
     * Remove an entity from all indices.
     */
    removeEntity(eid: number, type: string, components: ComponentType[], clientId?: number): void {
        // Remove from type index
        this.typeIndex.get(type)?.delete(eid);

        // Remove from component indices
        for (const component of components) {
            this.componentIndex.get(component)?.delete(eid);
        }

        // Remove from clientId index
        if (clientId !== undefined) {
            const indexedEid = this.clientIdIndex.get(clientId);
            if (indexedEid === eid) {
                this.clientIdIndex.delete(clientId);
            }
        }
    }

    /**
     * Add component to an existing entity.
     */
    addComponent(eid: number, component: ComponentType): void {
        let compSet = this.componentIndex.get(component);
        if (!compSet) {
            compSet = new Set();
            this.componentIndex.set(component, compSet);
        }
        compSet.add(eid);
    }

    /**
     * Remove component from an existing entity.
     */
    removeComponent(eid: number, component: ComponentType): void {
        this.componentIndex.get(component)?.delete(eid);
    }

    /**
     * Update clientId mapping for an entity.
     */
    setClientId(eid: number, clientId: number): void {
        this.clientIdIndex.set(clientId, eid);
    }

    /**
     * Remove clientId mapping.
     */
    removeClientId(clientId: number): void {
        this.clientIdIndex.delete(clientId);
    }

    /**
     * Query by entity type.
     */
    byType<T extends QueryableEntity>(type: string): QueryIterator<T> {
        const typeSet = this.typeIndex.get(type);
        const eids = typeSet ? this.sortedEids(typeSet) : [];
        return new QueryIterator<T>(eids, this.getEntity, this.isDestroyed);
    }

    /**
     * Query by component(s) - entities must have ALL specified components.
     */
    byComponents<T extends QueryableEntity>(...components: ComponentType[]): QueryIterator<T> {
        if (components.length === 0) {
            return new QueryIterator<T>([], this.getEntity, this.isDestroyed);
        }

        // Start with the smallest set for efficiency
        let smallestSet: Set<number> | undefined;
        let smallestSize = Infinity;

        for (const component of components) {
            const compSet = this.componentIndex.get(component);
            if (!compSet || compSet.size === 0) {
                // One component has no entities, result is empty
                return new QueryIterator<T>([], this.getEntity, this.isDestroyed);
            }
            if (compSet.size < smallestSize) {
                smallestSize = compSet.size;
                smallestSet = compSet;
            }
        }

        if (!smallestSet) {
            return new QueryIterator<T>([], this.getEntity, this.isDestroyed);
        }

        // Filter to entities that have ALL components
        const result: number[] = [];
        for (const eid of smallestSet) {
            let hasAll = true;
            for (const component of components) {
                if (component.storage && !hasComponent(component.storage, eid & INDEX_MASK)) {
                    hasAll = false;
                    break;
                }
            }
            if (hasAll) {
                result.push(eid);
            }
        }

        // Sort by eid for deterministic order
        result.sort((a, b) => a - b);

        return new QueryIterator<T>(result, this.getEntity, this.isDestroyed);
    }

    /**
     * Query by type or component.
     */
    query<T extends QueryableEntity>(
        typeOrComponent: string | ComponentType,
        ...moreComponents: ComponentType[]
    ): QueryIterator<T> {
        if (typeof typeOrComponent === 'string') {
            // Query by type
            if (moreComponents.length > 0) {
                // Type + components: filter type results by components
                const typeSet = this.typeIndex.get(typeOrComponent);
                if (!typeSet || typeSet.size === 0) {
                    return new QueryIterator<T>([], this.getEntity, this.isDestroyed);
                }

                const result: number[] = [];
                for (const eid of typeSet) {
                    let hasAll = true;
                    for (const component of moreComponents) {
                        if (component.storage && !hasComponent(component.storage, eid & INDEX_MASK)) {
                            hasAll = false;
                            break;
                        }
                    }
                    if (hasAll) {
                        result.push(eid);
                    }
                }

                result.sort((a, b) => a - b);
                return new QueryIterator<T>(result, this.getEntity, this.isDestroyed);
            }

            return this.byType<T>(typeOrComponent);
        }

        // Query by component(s)
        return this.byComponents<T>(typeOrComponent, ...moreComponents);
    }

    /**
     * O(1) lookup by clientId.
     */
    getByClientId(clientId: number): number | undefined {
        return this.clientIdIndex.get(clientId);
    }

    /**
     * Get all entity IDs (sorted for determinism).
     */
    getAllEids(): number[] {
        const allEids = new Set<number>();

        for (const typeSet of this.typeIndex.values()) {
            for (const eid of typeSet) {
                allEids.add(eid);
            }
        }

        return Array.from(allEids).sort((a, b) => a - b);
    }

    /**
     * Clear all indices (for reset).
     */
    clear(): void {
        this.typeIndex.clear();
        this.componentIndex.clear();
        this.clientIdIndex.clear();
    }

    /**
     * Get sorted eids from a set (for deterministic iteration).
     */
    private sortedEids(set: Set<number>): number[] {
        return Array.from(set).sort((a, b) => a - b);
    }
}
