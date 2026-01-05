/**
 * Standard ECS Components
 *
 * Built-in components for common game functionality.
 * All numeric values use fixed-point (i32) for determinism.
 */
import { ComponentType } from './component';
/**
 * Transform2D - Position and rotation.
 */
export declare const Transform2D: ComponentType<{
    x: number;
    y: number;
    angle: number;
}>;
/**
 * Body2D - Physics body properties.
 */
export declare const Body2D: ComponentType<{
    vx: number;
    vy: number;
    angularVelocity: number;
    width: number;
    height: number;
    radius: number;
    mass: number;
    restitution: number;
    friction: number;
    bodyType: number;
    shapeType: number;
    isSensor: boolean;
}>;
/**
 * Velocity2D - Separate velocity component (alternative to Body2D).
 */
export declare const Velocity2D: ComponentType<{
    vx: number;
    vy: number;
}>;
/**
 * Player - Marks an entity as player-controlled.
 * This is the ownership component - attach to any entity a player controls.
 * clientId is stored as interned string ID (integer).
 */
export declare const Player: ComponentType<{
    clientId: number;
}>;
/**
 * Health - Entity health.
 */
export declare const Health: ComponentType<{
    current: number;
    max: number;
}>;
/**
 * Sprite - Visual rendering component.
 *
 * Can render either:
 * - Simple shapes (circle, rect) with color
 * - Image sprites (via spriteId)
 */
export declare const Sprite: ComponentType<{
    shape: number;
    width: number;
    height: number;
    radius: number;
    color: number;
    spriteId: number;
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
    layer: number;
    visible: boolean;
}>;
export declare const SPRITE_IMAGE = 2;
/**
 * InputState - Stores current input for this entity.
 * Used by movement systems to read input data.
 */
export declare const InputState: ComponentType<{
    targetX: number;
    targetY: number;
    moveX: number;
    moveY: number;
    buttons: number;
}>;
export type Transform2DData = {
    x: number;
    y: number;
    angle: number;
};
export type Body2DData = {
    vx: number;
    vy: number;
    angularVelocity: number;
    width: number;
    height: number;
    radius: number;
    mass: number;
    restitution: number;
    friction: number;
    bodyType: number;
    shapeType: number;
    isSensor: boolean;
};
export type PlayerType = {
    clientId: number;
};
export declare const BODY_DYNAMIC = 0;
export declare const BODY_STATIC = 1;
export declare const BODY_KINEMATIC = 2;
export declare const SHAPE_RECT = 0;
export declare const SHAPE_CIRCLE = 1;
