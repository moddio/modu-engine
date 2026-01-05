/**
 * Modu Engine - Deterministic Multiplayer Sync Engine
 *
 * Features:
 * - Fixed-point math for 100% cross-platform determinism
 * - 2D/3D physics with ECS architecture
 * - Entity-Component-System with typed components
 * - Ordered input processing from modu-network
 */
export * from './math';
export { World, EntityBuilder, Entity, EntityPool, EntityIdAllocator, defineComponent, FieldType, QueryEngine, QueryIterator, SystemScheduler, RollbackBuffer, SparseSnapshotCodec, MAX_ENTITIES, SYSTEM_PHASES, SystemPhase, INDEX_MASK } from './core';
export type { WorldState, EntityState, NetworkInput, ComponentSchema, ComponentType, SystemFn, SystemOptions, QueryableEntity, SparseSnapshot, EntityMeta } from './core';
export { Transform2D, Body2D, Player, Sprite, BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC, SHAPE_RECT, SHAPE_CIRCLE, SPRITE_IMAGE } from './components';
export { Game, createGame, Prefab } from './game';
export type { GameCallbacks } from './game';
export { Simple2DRenderer, Simple2DRendererOptions } from './plugins/simple-2d-renderer';
export { InputPlugin } from './plugins/input-plugin';
export { enableDebugUI, DebugUITarget } from './plugins/debug-ui';
export { enableDeterminismGuard, disableDeterminismGuard } from './plugins/determinism-guard';
export { Physics2DSystem, createPhysics2DSystem } from './plugins/physics2d/system';
export type { Physics2DSystemConfig } from './plugins/physics2d/system';
export * as physics2d from './plugins/physics2d';
export * as physics3d from './plugins/physics3d';
export * from './sync';
export * as codec from './codec';
