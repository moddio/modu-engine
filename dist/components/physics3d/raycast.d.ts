/**
 * Raycasting
 *
 * Ray-body intersection tests for visibility checks,
 * hit detection, and other line-of-sight queries.
 */
import { Fixed } from '../../math/fixed';
import { Vec3 } from '../../math/vec';
import { RigidBody } from './rigid-body';
import { World } from './world';
export interface RayHit {
    body: RigidBody;
    point: Vec3;
    normal: Vec3;
    distance: Fixed;
}
export declare function raycast(world: World, origin: Vec3, direction: Vec3, maxDistance: Fixed): RayHit | null;
