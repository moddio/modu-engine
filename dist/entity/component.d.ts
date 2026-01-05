/**
 * Entity System - Base Component
 *
 * Components add data and behavior to entities.
 * All component state must be serializable for rollback.
 */
import type { Entity } from './entity';
export interface Component {
    /** Component type identifier (e.g., 'attributes', 'physics', 'buffs') */
    readonly type: string;
    /** The entity this component is attached to */
    entity: Entity | null;
    /** Called when component is attached to an entity */
    onAttach?(): void;
    /** Called when component is detached from an entity */
    onDetach?(): void;
    /** Called each simulation frame */
    onUpdate?(frame: number): void;
    /** Serialize component state for rollback */
    saveState?(): any;
    /** Restore component state from rollback */
    loadState?(state: any): void;
    /**
     * Sync component state from entity.sync after snapshot restore.
     * Called when entity is restored and sync values are applied.
     */
    syncFromEntity?(): void;
}
export declare abstract class BaseComponent implements Component {
    abstract readonly type: string;
    entity: Entity | null;
    onAttach?(): void;
    onDetach?(): void;
    onUpdate?(frame: number): void;
    saveState?(): any;
    loadState?(state: any): void;
    syncFromEntity?(): void;
}
