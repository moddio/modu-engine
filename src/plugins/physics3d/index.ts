/**
 * Physics Module
 *
 * Deterministic 3D physics engine with fixed-point math.
 * All components use 16.16 fixed-point integers for 100% determinism.
 */

// Shapes and AABB
export { ShapeType, BoxShape, SphereShape, Shape, createBox, createSphere, AABB, aabbOverlap } from './shapes';

// Collision Layers
export { CollisionFilter, Layers, DEFAULT_FILTER, createFilter, shouldCollide, filterCollidingWith, filterExcluding } from './layers';

// Rigid Body
export { BodyType, RigidBody, resetBodyIdCounter, getBodyIdCounter, setBodyIdCounter, createBody, setBodyMass, setBodyVelocity, applyImpulse, applyForce } from './rigid-body';

// Collision Detection and Response
export { ContactPoint, Contact, computeAABB, detectCollision, resolveCollision } from './collision';

// Physics World
export { World, createWorld, addBody, removeBody, isGrounded, stepWorld } from './world';

// Raycasting
export { RayHit, raycast } from './raycast';

// State Serialization
export { BodyState, WorldState, saveWorldState, loadWorldState } from './state';

// Triggers/Sensors
export { TriggerEvent, TriggerState, makeTrigger } from './trigger';
