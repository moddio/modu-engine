/**
 * Physics Module
 *
 * Deterministic 3D physics engine with fixed-point math.
 * All components use 16.16 fixed-point integers for 100% determinism.
 */
// Shapes and AABB
export { ShapeType, createBox, createSphere, aabbOverlap } from './shapes';
// Collision Layers
export { Layers, DEFAULT_FILTER, createFilter, shouldCollide, filterCollidingWith, filterExcluding } from './layers';
// Rigid Body
export { BodyType, resetBodyIdCounter, getBodyIdCounter, setBodyIdCounter, createBody, setBodyMass, setBodyVelocity, applyImpulse, applyForce } from './rigid-body';
// Collision Detection and Response
export { computeAABB, detectCollision, resolveCollision } from './collision';
// Physics World
export { createWorld, addBody, removeBody, isGrounded, stepWorld } from './world';
// Raycasting
export { raycast } from './raycast';
// State Serialization
export { saveWorldState, loadWorldState } from './state';
// Triggers/Sensors
export { TriggerState, makeTrigger } from './trigger';
