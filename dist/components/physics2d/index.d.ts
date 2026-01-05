/**
 * Physics 2D Module
 *
 * Deterministic 2D physics engine with fixed-point math.
 * All components use 16.16 fixed-point integers for 100% determinism.
 */
export { Shape2DType, CircleShape, BoxShape2D, Shape2D, AABB2D, aabb2DOverlap, aabb2DUnion, aabb2DArea, createCircle, createBox2D, createBox2DFromSize } from './shapes';
export { CollisionFilter, Layers, DEFAULT_FILTER, createFilter, shouldCollide, filterCollidingWith, filterExcluding } from './layers';
export { BodyType2D, Vec2, vec2, vec2Zero, vec2Clone, vec2Add, vec2Sub, vec2Scale, vec2Dot, vec2LengthSq, vec2Cross, RigidBody2D, resetBody2DIdCounter, getBody2DIdCounter, setBody2DIdCounter, createBody2D, setBody2DMass, setBody2DVelocity, applyImpulse2D, applyForce2D } from './rigid-body';
export { Contact2D, computeAABB2D, detectCollision2D, resolveCollision2D } from './collision';
export { World2D, createWorld2D, addBody2D, removeBody2D, stepWorld2D, saveWorldState2D, loadWorldState2D, BodyState2D, WorldState2D } from './world';
export { TriggerEvent, TriggerState, makeTrigger } from './trigger';
