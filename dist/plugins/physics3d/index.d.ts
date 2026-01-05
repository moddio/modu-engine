/**
 * Physics Module
 *
 * Deterministic 3D physics engine with fixed-point math.
 * All components use 16.16 fixed-point integers for 100% determinism.
 */
export { ShapeType, BoxShape, SphereShape, Shape, createBox, createSphere, AABB, aabbOverlap } from './shapes';
export { CollisionFilter, Layers, DEFAULT_FILTER, createFilter, shouldCollide, filterCollidingWith, filterExcluding } from './layers';
export { BodyType, RigidBody, resetBodyIdCounter, getBodyIdCounter, setBodyIdCounter, createBody, setBodyMass, setBodyVelocity, applyImpulse, applyForce } from './rigid-body';
export { ContactPoint, Contact, computeAABB, detectCollision, resolveCollision } from './collision';
export { World, createWorld, addBody, removeBody, isGrounded, stepWorld } from './world';
export { RayHit, raycast } from './raycast';
export { BodyState, WorldState, saveWorldState, loadWorldState } from './state';
export { TriggerEvent, TriggerState, makeTrigger } from './trigger';
