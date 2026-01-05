/**
 * Query Engine
 *
 * Efficient entity queries with caching and iterator support.
 * Queries return iterators with snapshot semantics for safe mutation.
 */
import { hasComponent } from './component';
import { INDEX_MASK } from './constants';
/**
 * Query iterator with snapshot semantics.
 * Captures eid list at creation time for safe iteration during mutation.
 */
export class QueryIterator {
    constructor(matchingEids, getEntity, isDestroyed) {
        this.index = 0;
        // Copy eids at creation time - safe from mutation
        this.eids = matchingEids.slice();
        this.getEntity = getEntity;
        this.isDestroyed = isDestroyed;
    }
    [Symbol.iterator]() {
        this.index = 0;
        return {
            next: () => {
                while (this.index < this.eids.length) {
                    const eid = this.eids[this.index++];
                    // Skip destroyed entities
                    if (this.isDestroyed(eid))
                        continue;
                    const entity = this.getEntity(eid);
                    if (entity) {
                        return { done: false, value: entity };
                    }
                }
                return { done: true, value: undefined };
            }
        };
    }
    /**
     * Convert to array (allocates).
     */
    toArray() {
        const result = [];
        for (const entity of this) {
            result.push(entity);
        }
        return result;
    }
    /**
     * Get first matching entity.
     */
    first() {
        for (const entity of this) {
            return entity;
        }
        return null;
    }
    /**
     * Find entity matching predicate.
     */
    find(predicate) {
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
    count() {
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
    constructor(getEntity, isDestroyed) {
        /** Type index: entity type -> set of eids */
        this.typeIndex = new Map();
        /** Component index: component -> set of eids */
        this.componentIndex = new Map();
        /** Client ID index: clientId -> eid (O(1) lookup) */
        this.clientIdIndex = new Map();
        this.getEntity = getEntity;
        this.isDestroyed = isDestroyed;
    }
    /**
     * Register an entity in the indices.
     */
    addEntity(eid, type, components, clientId) {
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
    removeEntity(eid, type, components, clientId) {
        // Remove from type index
        this.typeIndex.get(type)?.delete(eid);
        // Remove from component indices
        for (const component of components) {
            this.componentIndex.get(component)?.delete(eid);
        }
        // Remove from clientId index
        if (clientId !== undefined) {
            this.clientIdIndex.delete(clientId);
        }
    }
    /**
     * Add component to an existing entity.
     */
    addComponent(eid, component) {
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
    removeComponent(eid, component) {
        this.componentIndex.get(component)?.delete(eid);
    }
    /**
     * Update clientId mapping for an entity.
     */
    setClientId(eid, clientId) {
        this.clientIdIndex.set(clientId, eid);
    }
    /**
     * Remove clientId mapping.
     */
    removeClientId(clientId) {
        this.clientIdIndex.delete(clientId);
    }
    /**
     * Query by entity type.
     */
    byType(type) {
        const typeSet = this.typeIndex.get(type);
        const eids = typeSet ? this.sortedEids(typeSet) : [];
        return new QueryIterator(eids, this.getEntity, this.isDestroyed);
    }
    /**
     * Query by component(s) - entities must have ALL specified components.
     */
    byComponents(...components) {
        if (components.length === 0) {
            return new QueryIterator([], this.getEntity, this.isDestroyed);
        }
        // Start with the smallest set for efficiency
        let smallestSet;
        let smallestSize = Infinity;
        for (const component of components) {
            const compSet = this.componentIndex.get(component);
            if (!compSet || compSet.size === 0) {
                // One component has no entities, result is empty
                return new QueryIterator([], this.getEntity, this.isDestroyed);
            }
            if (compSet.size < smallestSize) {
                smallestSize = compSet.size;
                smallestSet = compSet;
            }
        }
        if (!smallestSet) {
            return new QueryIterator([], this.getEntity, this.isDestroyed);
        }
        // Filter to entities that have ALL components
        const result = [];
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
        return new QueryIterator(result, this.getEntity, this.isDestroyed);
    }
    /**
     * Query by type or component.
     */
    query(typeOrComponent, ...moreComponents) {
        if (typeof typeOrComponent === 'string') {
            // Query by type
            if (moreComponents.length > 0) {
                // Type + components: filter type results by components
                const typeSet = this.typeIndex.get(typeOrComponent);
                if (!typeSet || typeSet.size === 0) {
                    return new QueryIterator([], this.getEntity, this.isDestroyed);
                }
                const result = [];
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
                return new QueryIterator(result, this.getEntity, this.isDestroyed);
            }
            return this.byType(typeOrComponent);
        }
        // Query by component(s)
        return this.byComponents(typeOrComponent, ...moreComponents);
    }
    /**
     * O(1) lookup by clientId.
     */
    getByClientId(clientId) {
        return this.clientIdIndex.get(clientId);
    }
    /**
     * Get all entity IDs (sorted for determinism).
     */
    getAllEids() {
        const allEids = new Set();
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
    clear() {
        this.typeIndex.clear();
        this.componentIndex.clear();
        this.clientIdIndex.clear();
    }
    /**
     * Get sorted eids from a set (for deterministic iteration).
     */
    sortedEids(set) {
        return Array.from(set).sort((a, b) => a - b);
    }
}
