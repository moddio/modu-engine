/**
 * Fixed-Point Quaternion Operations
 *
 * Quaternion math for 3D rotations using fixed-point arithmetic.
 */
import { Fixed } from './fixed';
import { Vec3 } from './vec';
export interface Quat {
    x: Fixed;
    y: Fixed;
    z: Fixed;
    w: Fixed;
}
export declare function quatIdentity(): Quat;
export declare function quatFromAxisAngle(axis: Vec3, angle: Fixed): Quat;
export declare function quatFromEulerY(yaw: Fixed): Quat;
export declare function quatMul(a: Quat, b: Quat): Quat;
export declare function quatRotateVec3(q: Quat, v: Vec3): Vec3;
export declare function quatNormalize(q: Quat): Quat;
/** Quaternion conjugate (inverse for unit quaternions) */
export declare function quatConjugate(q: Quat): Quat;
/** Clone a quaternion */
export declare function quatClone(q: Quat): Quat;
