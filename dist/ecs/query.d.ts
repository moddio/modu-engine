/**
 * Query Engine
 *
 * Efficient entity queries with caching and iterator support.
 * Queries return iterators with snapshot semantics for safe mutation.
 */
import { ComponentType } from './component';
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
export declare class QueryIterator<T extends QueryableEntity> implements Iterable<T> {
    private eids;
    private index;
    private getEntity;
    private isDestroyed;
    constructor(matchingEids: number[], getEntity: EntityGetter, isDestroyed: DestroyedChecker);
    [Symbol.iterator](): Iterator<T>;
    /**
     * Convert to array (allocates).
     */
    toArray(): T[];
    /**
     * Get first matching entity.
     */
    first(): T | null;
    /**
     * Find entity matching predicate.
     */
    find(predicate: (entity: T) => boolean): T | null;
    /**
     * Count entities without allocating array.
     */
    count(): number;
}
/**
 * Query engine - manages entity indices and cached queries.
 */
export declare class QueryEngine {
    /** Type index: entity type -> set of eids */
    private typeIndex;
    /** Component index: component -> set of eids */
    private componentIndex;
    /** Client ID index: clientId -> eid (O(1) lookup) */
    private clientIdIndex;
    /** Entity getter function */
    private getEntity;
    /** Destroyed checker function */
    private isDestroyed;
    constructor(getEntity: EntityGetter, isDestroyed: DestroyedChecker);
    /**
     * Register an entity in the indices.
     */
    addEntity(eid: number, type: string, components: ComponentType[], clientId?: number): void;
    /**
     * Remove an entity from all indices.
     */
    removeEntity(eid: number, type: string, components: ComponentType[], clientId?: number): void;
    /**
     * Add component to an existing entity.
     */
    addComponent(eid: number, component: ComponentType): void;
    /**
     * Remove component from an existing entity.
     */
    removeComponent(eid: number, component: ComponentType): void;
    /**
     * Update clientId mapping for an entity.
     */
    setClientId(eid: number, clientId: number): void;
    /**
     * Remove clientId mapping.
     */
    removeClientId(clientId: number): void;
    /**
     * Query by entity type.
     */
    byType<T extends QueryableEntity>(type: string): QueryIterator<T>;
    /**
     * Query by component(s) - entities must have ALL specified components.
     */
    byComponents<T extends QueryableEntity>(...components: ComponentType[]): QueryIterator<T>;
    /**
     * Query by type or component.
     */
    query<T extends QueryableEntity>(typeOrComponent: string | ComponentType, ...moreComponents: ComponentType[]): QueryIterator<T>;
    /**
     * O(1) lookup by clientId.
     */
    getByClientId(clientId: number): number | undefined;
    /**
     * Get all entity IDs (sorted for determinism).
     */
    getAllEids(): number[];
    /**
     * Clear all indices (for reset).
     */
    clear(): void;
    /**
     * Get sorted eids from a set (for deterministic iteration).
     */
    private sortedEids;
}
