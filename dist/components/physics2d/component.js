/**
 * Physics 2D Component
 *
 * Links an entity to a 2D physics body.
 * Provides complete serialization for network snapshots.
 */
import { toFixed, toFloat, fpMul, fpCos, fpSin, fpAtan2 } from '../../math/fixed';
import { BodyType2D, createBody2D } from './rigid-body';
import { createCircle, createBox2DFromSize, Shape2DType } from './shapes';
import { addBody2D, removeBody2D } from './world';
import { BaseComponent } from '../../entity/component';
import { registerComponentFactory } from '../../entity/entity-manager';
const BODY_TYPES = {
    static: BodyType2D.Static,
    dynamic: BodyType2D.Dynamic,
    kinematic: BodyType2D.Kinematic
};
export class Physics2DComponent extends BaseComponent {
    constructor(options) {
        super();
        this.type = 'physics2d';
        /** Reference to the world (for removal on detach) */
        this.world = null;
        /** Previous position for render interpolation */
        this.prevX = 0;
        this.prevY = 0;
        const bodyType = BODY_TYPES[options.type];
        const shape = options.shape === 'circle'
            ? createCircle(options.radius)
            : createBox2DFromSize(options.width, options.height);
        this.body = createBody2D(bodyType, shape, options.x, options.y);
        // Apply optional state
        if (options.isSensor) {
            this.body.isSensor = true; // Internal uses isSensor
        }
        if (options.angle !== undefined) {
            this.body.angle = toFixed(options.angle);
        }
        if (options.vx !== undefined || options.vy !== undefined) {
            this.body.linearVelocity = {
                x: toFixed(options.vx || 0),
                y: toFixed(options.vy || 0)
            };
        }
    }
    /**
     * Called when component is attached to entity.
     * Links body to entity, adds to world, and initializes sync values.
     */
    onAttach() {
        if (!this.entity)
            return;
        // Link body -> entity for collision callbacks
        this.body.userData = this.entity;
        // Set body label to entity ID for deterministic collision ordering
        this.body.label = this.entity.id;
        // Auto-add to physics world if available
        const managerWorld = this.entity.manager?.world;
        if (managerWorld && !this.world) {
            this.world = managerWorld;
            addBody2D(managerWorld, this.body);
        }
        // Initialize sync values from body (if not already set from snapshot)
        this.syncToEntity();
        // Initialize previous position for interpolation
        this.prevX = this.body.position.x;
        this.prevY = this.body.position.y;
    }
    /**
     * Save current position as previous (called by engine before tick).
     * Used for render interpolation between physics frames.
     */
    savePreviousState() {
        this.prevX = this.body.position.x;
        this.prevY = this.body.position.y;
    }
    /**
     * Get previous position for interpolation (as floats).
     */
    getPreviousPosition() {
        return {
            x: toFloat(this.prevX),
            y: toFloat(this.prevY)
        };
    }
    /**
     * Copy body state to entity.sync for snapshot serialization.
     */
    syncToEntity() {
        if (!this.entity)
            return;
        const body = this.body;
        const sync = this.entity.sync;
        // Position and velocity
        sync.x = body.position.x;
        sync.y = body.position.y;
        sync.vx = body.linearVelocity.x;
        sync.vy = body.linearVelocity.y;
        sync.angle = body.angle;
        // Shape info for recreation (use shapeRadius/shapeWidth to avoid conflicts with game's sync values)
        sync.bodyType = body.type;
        sync.shapeType = body.shape.type;
        if (body.shape.type === Shape2DType.Circle) {
            sync.shapeRadius = body.shape.radius;
        }
        else if (body.shape.type === Shape2DType.Box) {
            // Store full dimensions (not half) for cleaner serialization
            sync.shapeWidth = (body.shape.halfWidth << 1);
            sync.shapeHeight = (body.shape.halfHeight << 1);
        }
        // Body flags (critical for collision behavior)
        sync.isSensor = body.isSensor;
    }
    /**
     * Load body state from entity.sync (after snapshot restore).
     */
    syncFromEntity() {
        if (!this.entity)
            return;
        const sync = this.entity.sync;
        if (sync.x !== undefined)
            this.body.position.x = sync.x;
        if (sync.y !== undefined)
            this.body.position.y = sync.y;
        if (sync.vx !== undefined)
            this.body.linearVelocity.x = sync.vx;
        if (sync.vy !== undefined)
            this.body.linearVelocity.y = sync.vy;
        if (sync.angle !== undefined)
            this.body.angle = sync.angle;
        if (sync.isSensor !== undefined)
            this.body.isSensor = sync.isSensor;
        // Restore shape dimensions (critical for collision detection)
        if (this.body.shape.type === Shape2DType.Circle) {
            if (sync.shapeRadius !== undefined) {
                this.body.shape.radius = sync.shapeRadius;
            }
        }
        else if (this.body.shape.type === Shape2DType.Box) {
            if (sync.shapeWidth !== undefined) {
                this.body.shape.halfWidth = (sync.shapeWidth >> 1);
            }
            if (sync.shapeHeight !== undefined) {
                this.body.shape.halfHeight = (sync.shapeHeight >> 1);
            }
        }
        this.body.isSleeping = false;
    }
    /**
     * Add body to world (also handles removal on detach).
     */
    setWorld(world) {
        if (this.world) {
            removeBody2D(this.world, this.body);
        }
        this.world = world;
        addBody2D(world, this.body);
    }
    /**
     * Called when component is detached from entity.
     * Removes the body from the physics world.
     */
    onDetach() {
        if (this.world) {
            removeBody2D(this.world, this.body);
            this.world = null;
        }
    }
    // ============================================
    // Position
    // ============================================
    getPosition() {
        return { x: this.body.position.x, y: this.body.position.y };
    }
    getPositionFloats() {
        return {
            x: toFloat(this.body.position.x),
            y: toFloat(this.body.position.y)
        };
    }
    setPosition(x, y) {
        this.body.position = { x, y };
        this.body.isSleeping = false;
    }
    setPositionFloats(x, y) {
        this.body.position = { x: toFixed(x), y: toFixed(y) };
        this.body.isSleeping = false;
    }
    /**
     * Get position offset by angle and distance (DETERMINISTIC).
     * Useful for spawning projectiles at a fixed offset from entity.
     * @param angle - Direction in radians (float)
     * @param distance - Offset distance (float)
     * @returns {x, y} offset position as floats
     */
    getOffsetPosition(angle, distance) {
        const angleFP = toFixed(angle);
        const distFP = toFixed(distance);
        const pos = this.getPositionFloats();
        return {
            x: pos.x + toFloat(fpMul(fpCos(angleFP), distFP)),
            y: pos.y + toFloat(fpMul(fpSin(angleFP), distFP))
        };
    }
    /**
     * Get position offset by fixed-point angle and distance (DETERMINISTIC).
     * Use when you already have a fixed-point angle.
     * @param angleFP - Direction in radians (fixed-point)
     * @param distance - Offset distance (float)
     * @returns {x, y} offset position as floats
     */
    getOffsetPositionFP(angleFP, distance) {
        const distFP = toFixed(distance);
        const pos = this.getPositionFloats();
        return {
            x: pos.x + toFloat(fpMul(fpCos(angleFP), distFP)),
            y: pos.y + toFloat(fpMul(fpSin(angleFP), distFP))
        };
    }
    // ============================================
    // Velocity
    // ============================================
    getVelocity() {
        return { x: this.body.linearVelocity.x, y: this.body.linearVelocity.y };
    }
    getVelocityFloats() {
        return {
            x: toFloat(this.body.linearVelocity.x),
            y: toFloat(this.body.linearVelocity.y)
        };
    }
    setVelocity(vx, vy) {
        this.body.linearVelocity = { x: vx, y: vy };
        this.body.isSleeping = false;
    }
    setVelocityFloats(vx, vy) {
        this.body.linearVelocity = { x: toFixed(vx), y: toFixed(vy) };
        this.body.isSleeping = false;
    }
    /**
     * Set velocity from angle and speed (DETERMINISTIC).
     * Converts floats to fixed-point and uses deterministic trig.
     * Use this instead of Math.cos/sin for cross-platform determinism.
     * @param angle - Direction in radians (float)
     * @param speed - Speed magnitude (float)
     */
    setVelocityPolar(angle, speed) {
        const angleFP = toFixed(angle);
        const speedFP = toFixed(speed);
        this.body.linearVelocity = {
            x: fpMul(fpCos(angleFP), speedFP),
            y: fpMul(fpSin(angleFP), speedFP)
        };
        this.body.isSleeping = false;
    }
    /**
     * Set velocity from angle (fixed-point) and speed (DETERMINISTIC).
     * Use when you already have a fixed-point angle.
     * @param angleFP - Direction in radians (fixed-point)
     * @param speed - Speed magnitude (float)
     */
    setVelocityPolarFP(angleFP, speed) {
        const speedFP = toFixed(speed);
        this.body.linearVelocity = {
            x: fpMul(fpCos(angleFP), speedFP),
            y: fpMul(fpSin(angleFP), speedFP)
        };
        this.body.isSleeping = false;
    }
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
    moveToward(targetX, targetY, speed, minDistance = 0) {
        const txFP = toFixed(targetX);
        const tyFP = toFixed(targetY);
        const pxFP = this.body.position.x;
        const pyFP = this.body.position.y;
        const dxFP = (txFP - pxFP);
        const dyFP = (tyFP - pyFP);
        const distSqFP = (fpMul(dxFP, dxFP) + fpMul(dyFP, dyFP));
        const minDistFP = toFixed(minDistance);
        const minDistSqFP = fpMul(minDistFP, minDistFP);
        if (distSqFP <= minDistSqFP) {
            return false; // Already at target
        }
        const angleFP = fpAtan2(dyFP, dxFP);
        const speedFP = toFixed(speed);
        this.body.position.x = (pxFP + fpMul(fpCos(angleFP), speedFP));
        this.body.position.y = (pyFP + fpMul(fpSin(angleFP), speedFP));
        this.body.isSleeping = false;
        return true;
    }
    // ============================================
    // Shape
    // ============================================
    /**
     * Set circle radius (DETERMINISTIC).
     * Quantizes to 2 decimal places for cross-platform determinism.
     * Also updates entity.sync.radius for game logic.
     * @param radius - New radius (float)
     */
    setRadius(radius) {
        if (this.body.shape.type !== Shape2DType.Circle) {
            throw new Error('setRadius() only works on circle shapes');
        }
        // Quantize to 2 decimal places for determinism
        const quantized = Math.round(radius * 100) / 100;
        this.body.shape.radius = toFixed(quantized);
        // Also update entity.sync.radius for game logic
        if (this.entity) {
            this.entity.sync.radius = quantized;
        }
    }
    /**
     * Get circle radius as float.
     */
    getRadius() {
        if (this.body.shape.type !== Shape2DType.Circle) {
            throw new Error('getRadius() only works on circle shapes');
        }
        return toFloat(this.body.shape.radius);
    }
    // ============================================
    // Angle
    // ============================================
    getAngle() {
        return this.body.angle;
    }
    getAngleFloat() {
        return toFloat(this.body.angle);
    }
    setAngle(angle) {
        this.body.angle = angle;
        this.body.isSleeping = false;
    }
    setAngleFloat(angle) {
        this.body.angle = toFixed(angle);
        this.body.isSleeping = false;
    }
    // ============================================
    // Serialization
    // ============================================
    /** Save state for snapshot */
    saveState() {
        const b = this.body;
        const pos = this.getPositionFloats();
        const vel = this.getVelocityFloats();
        const isCircle = b.shape.type === Shape2DType.Circle;
        const state = {
            type: b.type === BodyType2D.Static ? 'static'
                : b.type === BodyType2D.Dynamic ? 'dynamic' : 'kinematic',
            shape: isCircle ? 'circle' : 'box',
            x: pos.x,
            y: pos.y
        };
        if (isCircle) {
            state.radius = toFloat(b.shape.radius);
        }
        else {
            // Save full dimensions: shift left in fixed-point before converting
            state.width = toFloat((b.shape.halfWidth << 1));
            state.height = toFloat((b.shape.halfHeight << 1));
        }
        const angle = toFloat(b.angle);
        if (angle !== 0)
            state.angle = angle;
        if (vel.x !== 0 || vel.y !== 0) {
            state.vx = vel.x;
            state.vy = vel.y;
        }
        return state;
    }
    /** Load state from snapshot */
    loadState(state) {
        this.setPositionFloats(state.x, state.y);
        if (state.angle !== undefined)
            this.setAngleFloat(state.angle);
        if (state.vx !== undefined || state.vy !== undefined) {
            this.setVelocityFloats(state.vx || 0, state.vy || 0);
        }
    }
}
// Register factory for snapshot deserialization
registerComponentFactory('physics2d', (state) => new Physics2DComponent(state));
