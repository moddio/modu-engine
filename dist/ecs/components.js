/**
 * Standard ECS Components
 *
 * Built-in components for common game functionality.
 * All numeric values use fixed-point (i32) for determinism.
 */
import { defineComponent } from './component';
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
    // Size (use width/height OR radius)
    width: 0,
    height: 0,
    radius: 0,
    // Physics properties
    mass: 1,
    restitution: 0, // Bounciness (0-1)
    friction: 0,
    // Body type: 0=dynamic, 1=static, 2=kinematic
    bodyType: 0,
    // Shape type: 0=rect, 1=circle
    shapeType: 1,
    // Is sensor (no collision response, just events)
    isSensor: false
});
/**
 * Velocity2D - Separate velocity component (alternative to Body2D).
 */
export const Velocity2D = defineComponent('Velocity2D', {
    vx: 0,
    vy: 0
});
/**
 * Player - Marks an entity as player-controlled.
 * This is the ownership component - attach to any entity a player controls.
 * clientId is stored as interned string ID (integer).
 */
export const Player = defineComponent('Player', {
    clientId: 0 // Interned clientId string
});
/**
 * Health - Entity health.
 */
export const Health = defineComponent('Health', {
    current: 100,
    max: 100
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
    shape: 1, // Default circle
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
 * InputState - Stores current input for this entity.
 * Used by movement systems to read input data.
 */
export const InputState = defineComponent('InputState', {
    // Target position (e.g., mouse position)
    targetX: 0,
    targetY: 0,
    // Movement direction
    moveX: 0,
    moveY: 0,
    // Action buttons (bit flags)
    buttons: 0
});
// Body type constants
export const BODY_DYNAMIC = 0;
export const BODY_STATIC = 1;
export const BODY_KINEMATIC = 2;
// Shape type constants
export const SHAPE_RECT = 0;
export const SHAPE_CIRCLE = 1;
