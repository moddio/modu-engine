/**
 * Physics 2D Component
 *
 * Links an entity to a 2D physics body.
 * Provides complete serialization for network snapshots.
 */
import { Fixed } from '../../math/fixed';
import { RigidBody2D, Vec2 } from './rigid-body';
import { World2D } from './world';
import { BaseComponent } from '../../entity/component';
export interface Physics2DOptions {
    type: 'static' | 'dynamic' | 'kinematic';
    shape: 'circle' | 'box';
    radius?: number;
    width?: number;
    height?: number;
    x: number;
    y: number;
    isSensor?: boolean;
    angle?: number;
    vx?: number;
    vy?: number;
}
export declare class Physics2DComponent extends BaseComponent {
    readonly type = "physics2d";
    /** The 2D physics body */
    body: RigidBody2D;
    /** Reference to the world (for removal on detach) */
    private world;
    /** Previous position for render interpolation */
    private prevX;
    private prevY;
    constructor(options: Physics2DOptions);
    /**
     * Called when component is attached to entity.
     * Links body to entity, adds to world, and initializes sync values.
     */
    onAttach(): void;
    /**
     * Save current position as previous (called by engine before tick).
     * Used for render interpolation between physics frames.
     */
    savePreviousState(): void;
    /**
     * Get previous position for interpolation (as floats).
     */
    getPreviousPosition(): {
        x: number;
        y: number;
    };
    /**
     * Copy body state to entity.sync for snapshot serialization.
     */
    syncToEntity(): void;
    /**
     * Load body state from entity.sync (after snapshot restore).
     */
    syncFromEntity(): void;
    /**
     * Add body to world (also handles removal on detach).
     */
    setWorld(world: World2D): void;
    /**
     * Called when component is detached from entity.
     * Removes the body from the physics world.
     */
    onDetach(): void;
    getPosition(): Vec2;
    getPositionFloats(): {
        x: number;
        y: number;
    };
    setPosition(x: Fixed, y: Fixed): void;
    setPositionFloats(x: number, y: number): void;
    /**
     * Get position offset by angle and distance (DETERMINISTIC).
     * Useful for spawning projectiles at a fixed offset from entity.
     * @param angle - Direction in radians (float)
     * @param distance - Offset distance (float)
     * @returns {x, y} offset position as floats
     */
    getOffsetPosition(angle: number, distance: number): {
        x: number;
        y: number;
    };
    /**
     * Get position offset by fixed-point angle and distance (DETERMINISTIC).
     * Use when you already have a fixed-point angle.
     * @param angleFP - Direction in radians (fixed-point)
     * @param distance - Offset distance (float)
     * @returns {x, y} offset position as floats
     */
    getOffsetPositionFP(angleFP: Fixed, distance: number): {
        x: number;
        y: number;
    };
    getVelocity(): Vec2;
    getVelocityFloats(): {
        x: number;
        y: number;
    };
    setVelocity(vx: Fixed, vy: Fixed): void;
    setVelocityFloats(vx: number, vy: number): void;
    /**
     * Set velocity from angle and speed (DETERMINISTIC).
     * Converts floats to fixed-point and uses deterministic trig.
     * Use this instead of Math.cos/sin for cross-platform determinism.
     * @param angle - Direction in radians (float)
     * @param speed - Speed magnitude (float)
     */
    setVelocityPolar(angle: number, speed: number): void;
    /**
     * Set velocity from angle (fixed-point) and speed (DETERMINISTIC).
     * Use when you already have a fixed-point angle.
     * @param angleFP - Direction in radians (fixed-point)
     * @param speed - Speed magnitude (float)
     */
    setVelocityPolarFP(angleFP: Fixed, speed: number): void;
    /**
     * Move toward a target position at given speed (DETERMINISTIC).
     * Calculates angle internally using fixed-point math.
     * Does nothing if already at or very close to target.
     * @param targetX - Target X position (float)
     * @param targetY - Target Y position (float)
     * @param speed - Movement speed (float)
     * @param minDistance - Minimum distance to move (float, default 0)
     * @returns true if moved, false if at target
     */
    moveToward(targetX: number, targetY: number, speed: number, minDistance?: number): boolean;
    /**
     * Set circle radius (DETERMINISTIC).
     * Quantizes to 2 decimal places for cross-platform determinism.
     * Also updates entity.sync.radius for game logic.
     * @param radius - New radius (float)
     */
    setRadius(radius: number): void;
    /**
     * Get circle radius as float.
     */
    getRadius(): number;
    getAngle(): Fixed;
    getAngleFloat(): number;
    setAngle(angle: Fixed): void;
    setAngleFloat(angle: number): void;
    /** Save state for snapshot */
    saveState(): Physics2DOptions;
    /** Load state from snapshot */
    loadState(state: Physics2DOptions): void;
}
