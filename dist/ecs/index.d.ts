/**
 * ECS Module - Entity Component System
 *
 * High-performance ECS with SoA storage for deterministic multiplayer games.
 */
export { MAX_ENTITIES, GENERATION_BITS, INDEX_BITS, INDEX_MASK, MAX_GENERATION, SYSTEM_PHASES, SystemPhase } from './constants';
export { EntityIdAllocator, EntityIdAllocatorState } from './entity-id';
export { FieldType, FieldDefinition, ComponentSchema, ComponentStorage, ComponentType, defineComponent, getComponentType, hasComponent, addComponentToEntity, removeComponentFromEntity, initializeComponentDefaults, clearComponentRegistry, getAllComponents } from './component';
export { QueryableEntity, QueryIterator, QueryEngine } from './query';
export { SystemOptions, SystemFn, SystemScheduler } from './system';
export { RenderState, EntityDefinition, Entity, EntityPool } from './entity';
export { EntityBuilder, World, WorldState, EntityState, NetworkInput, PredictionEntry } from './world';
export { SparseSnapshot, EntityMeta, SparseSnapshotCodec, RollbackBuffer } from './snapshot';
export { StringRegistry, StringRegistryState } from './string-registry';
export { InputHistory, FrameInput, InputHistoryState } from './input-history';
export { Transform2D, Body2D, Velocity2D, Player, Health, Sprite, InputState, BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC, SHAPE_RECT, SHAPE_CIRCLE, SPRITE_IMAGE } from './components';
export { Game, GameEntityBuilder, GameCallbacks, Prefab, createGame } from './game';
export { Physics2DSystem, Physics2DSystemConfig, createPhysics2DSystem, CollisionHandler as ECSCollisionHandler } from './physics2d-system';
export { AutoRenderer, AutoRendererOptions } from './auto-renderer';
export { InputPlugin, ActionType, ActionDef, BindingSource } from './input-plugin';
