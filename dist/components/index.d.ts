/**
 * Standard ECS Components
 *
 * Built-in components for common game functionality.
 * All numeric values use fixed-point (i32) for determinism.
 */
import { ComponentType } from '../core/component';
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
 * Player - Marks an entity as player-controlled.
 * This is the ownership component - attach to any entity a player controls.
 * clientId is stored as interned string ID (integer).
 */
export declare const Player: ComponentType<{
    clientId: number;
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
 * Camera2D - 2D camera for viewport control.
 *
 * This is a client-only component (sync: false) - each client manages
 * their own camera independently. The camera is not included in:
 * - Network snapshots
 * - State hash computation
 * - Rollback state
 *
 * @example
 * // Define camera entity
 * game.defineEntity('camera')
 *     .with(Camera2D)
 *     .register();
 *
 * // Spawn and use camera
 * const cam = game.spawn('camera');
 * const camera = cam.get(Camera2D);
 * camera.x = player.x;
 * camera.y = player.y;
 * camera.zoom = 1.5;
 */
export declare const Camera2D: ComponentType<{
    x: number;
    y: number;
    zoom: number;
    targetZoom: number;
    smoothing: number;
    followEntity: number;
    viewportWidth: number;
    viewportHeight: number;
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
export type Camera2DData = {
    x: number;
    y: number;
    zoom: number;
    targetZoom: number;
    smoothing: number;
    followEntity: number;
    viewportWidth: number;
    viewportHeight: number;
};
