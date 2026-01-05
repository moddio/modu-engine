/**
 * Physics 2D Module
 *
 * Deterministic 2D physics engine with fixed-point math.
 * All components use 16.16 fixed-point integers for 100% determinism.
 */
// Shapes and AABB
export { Shape2DType, aabb2DOverlap, aabb2DUnion, aabb2DArea, createCircle, createBox2D, createBox2DFromSize } from './shapes';
// Collision Layers
export { Layers, DEFAULT_FILTER, createFilter, shouldCollide, filterCollidingWith, filterExcluding } from './layers';
// Rigid Body
export { BodyType2D, vec2, vec2Zero, vec2Clone, vec2Add, vec2Sub, vec2Scale, vec2Dot, vec2LengthSq, vec2Cross, resetBody2DIdCounter, getBody2DIdCounter, setBody2DIdCounter, createBody2D, setBody2DMass, setBody2DVelocity, applyImpulse2D, applyForce2D } from './rigid-body';
// Collision Detection and Response
export { computeAABB2D, detectCollision2D, resolveCollision2D } from './collision';
// Physics World
export { createWorld2D, addBody2D, removeBody2D, stepWorld2D, saveWorldState2D, loadWorldState2D } from './world';
// Triggers/Sensors
export { TriggerState, makeTrigger } from './trigger';
