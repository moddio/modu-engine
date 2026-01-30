/**
 * Standard ECS Components
 *
 * Built-in components for common game functionality.
 * All numeric values use fixed-point (i32) for determinism.
 */

import { defineComponent, ComponentType } from '../core/component';

/**
 * Transform2D - Position and rotation.
 */
export const Transform2D = defineComponent('Transform2D', {
    x: 0,
    y: 0,
    angle: 0
});

/**
 * Body2D - Physics body properties.
 */
export const Body2D = defineComponent('Body2D', {
    // Velocity
    vx: 0,
    vy: 0,

    // Angular velocity
    angularVelocity: 0,

    // Force accumulator (added to velocity each frame, then cleared)
    forceX: 0,
    forceY: 0,

    // Impulse accumulator (added to velocity once, then cleared)
    impulseX: 0,
    impulseY: 0,

    // Size (use width/height OR radius)
    width: 0,
    height: 0,
    radius: 0,

    // Physics properties
    mass: 1,
    restitution: 0,    // Bounciness (0-1)
    friction: 0,

    // Body type: 0=dynamic, 1=static, 2=kinematic
    bodyType: 0,

    // Shape type: 0=rect, 1=circle
    shapeType: 1,

    // Is sensor (no collision response, just events)
    damping: 0,
    isSensor: false,

    // Lock rotation (game controls angle, physics doesn't affect it)
    lockRotation: false
});

/**
 * Player - Marks an entity as player-controlled.
 * This is the ownership component - attach to any entity a player controls.
 * clientId is stored as interned string ID (integer).
 */
export const Player = defineComponent('Player', {
    clientId: 0    // Interned clientId string
});

/**
 * Sprite - Visual rendering component.
 *
 * Can render either:
 * - Simple shapes (circle, rect) with color
 * - Image sprites (via spriteId)
 */
export const Sprite = defineComponent('Sprite', {
    // Shape type: 0=rect, 1=circle, 2=image
    shape: 1,  // Default circle

    // Size (for shapes)
    width: 0,
    height: 0,
    radius: 10,

    // Color (interned string ID, e.g., '#ff0000')
    color: 0,

    // Image sprite ID (interned string, for shape=SPRITE_IMAGE)
    spriteId: 0,

    // Render offset from transform position
    offsetX: 0,
    offsetY: 0,

    // Scale
    scaleX: 1,
    scaleY: 1,

    // Layer for z-ordering (higher = in front)
    layer: 0,

    // Visibility
    visible: true
});

// Sprite shape constants (reuse SHAPE_RECT, SHAPE_CIRCLE, add SPRITE_IMAGE)
export const SPRITE_IMAGE = 2;

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
export const Camera2D = defineComponent('Camera2D', {
    // Position (world coordinates the camera is centered on)
    x: 0,
    y: 0,

    // Zoom level (1 = normal, >1 = zoomed in, <1 = zoomed out)
    zoom: 1,

    // Target zoom for smooth transitions
    targetZoom: 1,

    // Smoothing factor for position interpolation (0-1, higher = snappier)
    smoothing: 0.1,

    // Optional: follow entity ID (0 = no target)
    followEntity: 0,

    // Viewport bounds (set by renderer)
    viewportWidth: 0,
    viewportHeight: 0
}, { sync: false });

// Re-export types for convenience
export type Transform2DData = {
    x: number;
    y: number;
    angle: number;
};

export type Body2DData = {
    vx: number;
    vy: number;
    angularVelocity: number;
    forceX: number;
    forceY: number;
    impulseX: number;
    impulseY: number;
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

// Body type constants
export const BODY_DYNAMIC = 0;
export const BODY_STATIC = 1;
export const BODY_KINEMATIC = 2;

// Shape type constants
export const SHAPE_RECT = 0;
export const SHAPE_CIRCLE = 1;

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
