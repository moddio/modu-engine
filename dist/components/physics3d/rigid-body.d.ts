/**
 * Rigid Body
 *
 * Defines rigid body types and operations for physics simulation.
 * All values use fixed-point math for determinism.
 */
import { Fixed } from '../../math/fixed';
import { Vec3 } from '../../math/vec';
import { Quat } from '../../math/quat';
import { Shape } from './shapes';
import { CollisionFilter } from './layers';
export declare enum BodyType {
    Static = 0,// Never moves
    Kinematic = 1,// Moved by user, no physics response
    Dynamic = 2
}
export interface RigidBody {
    id: number;
    type: BodyType;
    shape: Shape;
    label: string;
    position: Vec3;
    rotation: Quat;
    linearVelocity: Vec3;
    angularVelocity: Vec3;
    mass: Fixed;
    invMass: Fixed;
    inertia: Fixed;
    invInertia: Fixed;
    restitution: Fixed;
    friction: Fixed;
    isSleeping: boolean;
    sleepFrames: number;
    lockRotationX: boolean;
    lockRotationY: boolean;
    lockRotationZ: boolean;
    isTrigger: boolean;
    filter: CollisionFilter;
    userData: any;
}
export declare function resetBodyIdCounter(): void;
export declare function getBodyIdCounter(): number;
export declare function setBodyIdCounter(value: number): void;
export declare function createBody(type: BodyType, shape: Shape, x: number, y: number, z: number, label?: string): RigidBody;
export declare function setBodyMass(body: RigidBody, mass: number): void;
export declare function setBodyVelocity(body: RigidBody, vx: number, vy: number, vz: number): void;
export declare function applyImpulse(body: RigidBody, impulse: Vec3, point?: Vec3): void;
export declare function applyForce(body: RigidBody, force: Vec3, dt: Fixed): void;
