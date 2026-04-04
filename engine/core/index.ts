export const VERSION = '0.1.0';

export { Engine } from './Engine';
export { Vec2, Vec3, Matrix2d, Rect, Polygon } from './math/index';
export { EventEmitter } from './events/index';
export { Entity, Component, System } from './ecs/index';
export { Unit, Player, Item, Projectile, Prop, Region, Sensor } from './game/index';
export { Clock } from './time/index';
export { PhysicsWorld, RigidBody } from './physics/index';
export type { BodyDef, ColliderDef } from './physics/index';
export { Map2d, TileMap, Pathfinding } from './map/index';
export type { TileData } from './map/index';
export { ScriptEngine, ScriptAPI } from './scripting/index';
