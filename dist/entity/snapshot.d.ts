/**
 * Snapshot System
 *
 * Entity-based snapshots for network synchronization.
 * Physics-agnostic - works with entity.sync properties.
 */
import { RandomState } from '../math/random';
import { EntityManager, EntityManagerState } from './entity-manager';
/**
 * Entity-based game snapshot.
 * Saves all entities with their .sync properties.
 */
export interface EntitySnapshot {
    /** Simulation frame number */
    frame: number;
    /** Input sequence number - inputs with seq <= this are already reflected in snapshot */
    seq?: number;
    /** State hash for quick comparison */
    hash?: number;
    /** All entities and their sync states */
    entities: EntityManagerState;
    /** ID counters for deterministic entity creation */
    idCounters: {
        entity: number;
        [key: string]: number;
    };
    /** Random number generator state */
    rng?: RandomState;
    /** Custom game-specific data */
    custom?: any;
    /**
     * Whether this snapshot was taken AFTER tick(frame) ran.
     * - false (default): snapshot is pre-tick, catchup should run tick(frame)...tick(serverFrame)
     * - true: snapshot is post-tick, catchup should run tick(frame+1)...tick(serverFrame)
     */
    postTick?: boolean;
}
/**
 * Create an entity-based snapshot.
 * Saves all entities with their .sync properties.
 *
 * @param getIdCounters - Optional function to get additional ID counters (e.g., physics body IDs)
 */
export declare function snapshotEntities(frame: number, entityManager: EntityManager, includeRng?: boolean, custom?: any, getIdCounters?: () => Record<string, number>): EntitySnapshot;
/**
 * Restore entities from a snapshot.
 * Uses EntityManager factories to create entities with correct components.
 *
 * @param setIdCounters - Optional function to restore additional ID counters
 */
export declare function restoreEntities(snapshot: EntitySnapshot | null | undefined, entityManager: EntityManager, customRestorer?: (data: any) => void, setIdCounters?: (counters: Record<string, number>) => void): boolean;
