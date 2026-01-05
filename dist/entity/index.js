/**
 * Entity Module
 *
 * Entity-Component system for game objects.
 */
// Entity
export { BaseEntity, resetEntityIdCounter, getEntityIdCounter, setEntityIdCounter, generateEntityId } from './entity';
// Component
export { BaseComponent } from './component';
// Entity Manager
export { EntityManager, registerComponentFactory, getComponentFactory, registerEntityFactory, getEntityFactory } from './entity-manager';
// Snapshot System
export { snapshotEntities, restoreEntities } from './snapshot';
// Entity Builder (declarative entity definition)
export { EntityBuilder, Prefab, Body2D, Input } from './entity-builder';
