/**
 * ECS Module - Entity Component System
 *
 * High-performance ECS with SoA storage for deterministic multiplayer games.
 */
// Constants
export { MAX_ENTITIES, GENERATION_BITS, INDEX_BITS, INDEX_MASK, MAX_GENERATION, SYSTEM_PHASES, SystemPhase } from './constants';
// Entity ID Allocator
export { EntityIdAllocator, EntityIdAllocatorState } from './entity-id';
// Components
export { FieldType, FieldDefinition, ComponentSchema, ComponentStorage, ComponentType, defineComponent, getComponentType, hasComponent, addComponentToEntity, removeComponentFromEntity, initializeComponentDefaults, clearComponentRegistry, getAllComponents } from './component';
// Query Engine
export { QueryableEntity, QueryIterator, QueryEngine } from './query';
// System Scheduler
export { SystemOptions, SystemFn, SystemScheduler } from './system';
// Entity
export { RenderState, EntityDefinition, Entity, EntityPool } from './entity';
// World
export { EntityBuilder, World, WorldState, EntityState, NetworkInput, PredictionEntry } from './world';
// Snapshot
export { SparseSnapshot, EntityMeta, SparseSnapshotCodec, RollbackBuffer } from './snapshot';
// String Registry
export { StringRegistry, StringRegistryState } from './string-registry';
// Input History (for rollback resimulation)
export { InputHistory, FrameInput, InputHistoryState } from './input-history';
// Standard Components
export { Transform2D, Body2D, Velocity2D, Player, Health, Sprite, InputState, BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC, SHAPE_RECT, SHAPE_CIRCLE, SPRITE_IMAGE } from './components';
// Game (High-level API)
export { Game, GameEntityBuilder, GameCallbacks, Prefab, createGame } from './game';
// Physics2D System
export { Physics2DSystem, Physics2DSystemConfig, createPhysics2DSystem, CollisionHandler as ECSCollisionHandler } from './physics2d-system';
// Auto Renderer
export { AutoRenderer, AutoRendererOptions } from './auto-renderer';
// Input Plugin
export { InputPlugin, ActionType, ActionDef, BindingSource } from './input-plugin';
