/**
 * Modu Engine - Deterministic Multiplayer Sync Engine
 *
 * Features:
 * - Fixed-point math for 100% cross-platform determinism
 * - 2D/3D physics with ECS architecture
 * - Entity-Component-System with typed components
 * - Ordered input processing from modu-network
 */
// ============================================
// Math (Fixed-Point)
// ============================================
export * from './math';
// ============================================
// Core ECS (Low-level primitives)
// ============================================
export { World, EntityBuilder, Entity, EntityPool, EntityIdAllocator, defineComponent, QueryEngine, QueryIterator, SystemScheduler, RollbackBuffer, SparseSnapshotCodec, MAX_ENTITIES, SYSTEM_PHASES, INDEX_MASK } from './core';
// ============================================
// Components (Built-in ECS Components)
// ============================================
export { Transform2D, Body2D, Player, Sprite, 
// Body type constants
BODY_DYNAMIC, BODY_STATIC, BODY_KINEMATIC, 
// Shape type constants
SHAPE_RECT, SHAPE_CIRCLE, SPRITE_IMAGE } from './components';
// ============================================
// Game (High-level API)
// ============================================
export { Game, createGame, Prefab } from './game';
// ============================================
// Plugins
// ============================================
export { Simple2DRenderer } from './plugins/simple-2d-renderer';
export { InputPlugin } from './plugins/input-plugin';
export { enableDebugUI } from './plugins/debug-ui';
export { enableDeterminismGuard, disableDeterminismGuard } from './plugins/determinism-guard';
export { Physics2DSystem, createPhysics2DSystem } from './plugins/physics2d/system';
// Physics engines (low-level)
export * as physics2d from './plugins/physics2d';
export * as physics3d from './plugins/physics3d';
// ============================================
// Sync (Rollback Networking)
// ============================================
export * from './sync';
// ============================================
// Codec (Binary Encoding)
// ============================================
export * as codec from './codec';
