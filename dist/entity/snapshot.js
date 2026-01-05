/**
 * Snapshot System
 *
 * Entity-based snapshots for network synchronization.
 * Physics-agnostic - works with entity.sync properties.
 */
import { saveRandomState, loadRandomState } from '../math/random';
import { getEntityIdCounter, setEntityIdCounter } from './entity';
/**
 * Create an entity-based snapshot.
 * Saves all entities with their .sync properties.
 *
 * @param getIdCounters - Optional function to get additional ID counters (e.g., physics body IDs)
 */
export function snapshotEntities(frame, entityManager, includeRng = true, custom, getIdCounters) {
    const idCounters = {
        entity: getEntityIdCounter(),
        ...(getIdCounters ? getIdCounters() : {})
    };
    const rng = includeRng ? saveRandomState() : undefined;
    return {
        frame,
        hash: entityManager.computeHash(),
        entities: entityManager.saveState(),
        idCounters,
        rng,
        custom
    };
}
/**
 * Restore entities from a snapshot.
 * Uses EntityManager factories to create entities with correct components.
 *
 * @param setIdCounters - Optional function to restore additional ID counters
 */
export function restoreEntities(snapshot, entityManager, customRestorer, setIdCounters) {
    if (!snapshot || typeof snapshot !== 'object') {
        return false;
    }
    if (!snapshot.entities) {
        return false;
    }
    // Restore RNG state BEFORE entity loading
    if (snapshot.rng) {
        loadRandomState(snapshot.rng);
    }
    // Restore ID counters BEFORE entity loading
    // This ensures entities and physics bodies get correct IDs during loadState()
    if (snapshot.idCounters) {
        setEntityIdCounter(snapshot.idCounters.entity);
        // Let game restore other counters (e.g., physics body IDs)
        if (setIdCounters) {
            setIdCounters(snapshot.idCounters);
        }
    }
    // Check snapshot format - OLD format has 'components', NEW format has 'sync'
    let entitiesState = snapshot.entities;
    if (entitiesState.entities && entitiesState.entities.length > 0) {
        const firstEntity = entitiesState.entities[0];
        if (firstEntity.components && !firstEntity.sync) {
            console.warn('[snapshot] Ignoring incompatible old-format snapshot. Starting fresh.');
            return false;
        }
    }
    // Restore entities via EntityManager (uses factories to create with correct components)
    entityManager.loadState(entitiesState);
    // Restore custom data
    if (snapshot.custom && customRestorer) {
        customRestorer(snapshot.custom);
    }
    return true;
}
