/**
 * Math Module
 *
 * Fixed-point math utilities for deterministic physics.
 */
export { FP_SHIFT, FP_ONE, FP_HALF, FP_PI, FP_2PI, FP_HALF_PI, Fixed, toFixed, toFloat, fpMul, fpDiv, fpAbs, fpSign, fpMin, fpMax, fpClamp, fpFloor, fpCeil, fpSqrt, dSqrt, fpSin, fpCos, fpAtan2 } from './fixed';
export { Vec2, vec2, vec2Zero, vec2FromFixed, vec2Clone, vec2Add, vec2Sub, vec2Scale, vec2Neg, vec2Dot, vec2Cross, vec2LengthSq, vec2Length, vec2Normalize, vec2Lerp, vec2Distance, vec2DistanceSq } from './vec';
export { Vec3, vec3, vec3Zero, vec3FromFloats, vec3ToFloats, vec3Clone, vec3Add, vec3Sub, vec3Scale, vec3Neg, vec3Dot, vec3Cross, vec3LengthSq, vec3Length, vec3Normalize, vec3Lerp, vec3Distance, vec3DistanceSq } from './vec';
export { Quat, quatIdentity, quatFromAxisAngle, quatFromEulerY, quatMul, quatRotateVec3, quatNormalize, quatConjugate, quatClone } from './quat';
export { RandomState, dRandom, saveRandomState, loadRandomState } from './random';
