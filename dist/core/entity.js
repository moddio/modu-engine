/**
 * Entity Wrapper
 *
 * Provides an ergonomic API for entity access while using SoA storage internally.
 * Entity wrappers are pooled and reused to minimize allocations.
 */
import { hasComponent, addComponentToEntity, removeComponentFromEntity, initializeComponentDefaults } from './component';
import { INDEX_MASK } from './constants';
import { toFixed, toFloat, fpMul, fpDiv, fpSqrt } from '../math';
import { Transform2D, Body2D } from '../components';
/**
 * Entity wrapper - provides ergonomic access to SoA-stored entity data.
 */
export class Entity {
    constructor() {
        /** Entity ID (includes generation) */
        this.eid = -1;
        /** Entity type name */
        this.type = '';
        /** Whether entity is destroyed */
        this.destroyed = false;
        /** Render-only state (client-only, never serialized) */
        this.render = {
            prevX: 0,
            prevY: 0,
            interpX: 0,
            interpY: 0,
            screenX: 0,
            screenY: 0,
            visible: true
        };
        /** Component types this entity has */
        this._components = [];
        /** Cached accessor instances */
        this._accessors = new Map();
        /** Reference to world for operations */
        this._world = null;
        /** Current frame's input data (set during tick) */
        this._inputData = null;
    }
    /**
     * Get component accessor.
     * Returns typed accessor for reading/writing component data.
     */
    get(component) {
        const index = this.eid & INDEX_MASK;
        // Check if entity has this component
        if (!hasComponent(component.storage, index)) {
            throw new Error(`Entity ${this.eid} (type: ${this.type}) does not have component '${component.name}'`);
        }
        // Get or create accessor
        let accessor = this._accessors.get(component);
        if (!accessor) {
            accessor = new component.AccessorClass(index);
            this._accessors.set(component, accessor);
        }
        else {
            // Update index in case wrapper was reused
            accessor._index = index;
        }
        return accessor;
    }
    /**
     * Check if entity has a component.
     */
    has(component) {
        return hasComponent(component.storage, this.eid & INDEX_MASK);
    }
    /**
     * Add a component to this entity at runtime.
     */
    addComponent(component, data) {
        const index = this.eid & INDEX_MASK;
        if (hasComponent(component.storage, index)) {
            throw new Error(`Entity ${this.eid} already has component '${component.name}'`);
        }
        // Add to storage
        addComponentToEntity(component.storage, index);
        initializeComponentDefaults(component.storage, index);
        // Track component
        this._components.push(component);
        // Update query indices
        if (this._world) {
            this._world.queryEngine.addComponent(this.eid, component);
        }
        // Get accessor and apply data
        const accessor = this.get(component);
        if (data) {
            for (const [key, value] of Object.entries(data)) {
                accessor[key] = value;
            }
        }
        return accessor;
    }
    /**
     * Remove a component from this entity at runtime.
     */
    removeComponent(component) {
        const index = this.eid & INDEX_MASK;
        if (!hasComponent(component.storage, index)) {
            throw new Error(`Entity ${this.eid} does not have component '${component.name}'`);
        }
        // Remove from storage
        removeComponentFromEntity(component.storage, index);
        // Remove from tracking
        const idx = this._components.indexOf(component);
        if (idx !== -1) {
            this._components.splice(idx, 1);
        }
        // Update query indices
        if (this._world) {
            this._world.queryEngine.removeComponent(this.eid, component);
        }
        // Clear cached accessor
        this._accessors.delete(component);
    }
    /**
     * Destroy this entity.
     */
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        if (this._world) {
            this._world.destroyEntity(this);
        }
    }
    /**
     * Get all components on this entity.
     */
    getComponents() {
        return [...this._components];
    }
    /**
     * Get current frame's input data.
     * Returns null if no input was received this tick.
     */
    get input() {
        return this._inputData;
    }
    /**
     * Set input data for this tick (called by World).
     */
    _setInputData(data) {
        this._inputData = data;
    }
    /**
     * Save current position to render.prev* for interpolation.
     * Should be called in prePhysics phase before physics updates position.
     */
    _savePreviousState() {
        // Look for common position components (Body2D, Transform, etc.)
        // Store current position as previous for interpolation
        for (const component of this._components) {
            const index = this.eid & INDEX_MASK;
            // Check for x/y fields in component
            if ('x' in component.storage.fields && 'y' in component.storage.fields) {
                const xArr = component.storage.fields['x'];
                const yArr = component.storage.fields['y'];
                // Convert from fixed-point to float for render state
                this.render.prevX = toFloat(xArr[index]);
                this.render.prevY = toFloat(yArr[index]);
                return; // Found position component, done
            }
        }
    }
    /**
     * Calculate interpolated position for rendering.
     * @param alpha Interpolation factor (0-1) between previous and current state
     */
    interpolate(alpha) {
        // Get current position
        for (const component of this._components) {
            const index = this.eid & INDEX_MASK;
            if ('x' in component.storage.fields && 'y' in component.storage.fields) {
                const currentX = toFloat(component.storage.fields['x'][index]);
                const currentY = toFloat(component.storage.fields['y'][index]);
                // Linear interpolation between previous and current
                this.render.interpX = this.render.prevX + (currentX - this.render.prevX) * alpha;
                this.render.interpY = this.render.prevY + (currentY - this.render.prevY) * alpha;
                return;
            }
        }
    }
    /**
     * Initialize entity (called by world).
     */
    _init(eid, type, components, world) {
        this.eid = eid;
        this.type = type;
        this.destroyed = false;
        this._components = components;
        this._world = world;
        this._accessors.clear();
        // Reset render state
        this.render.prevX = 0;
        this.render.prevY = 0;
        this.render.interpX = 0;
        this.render.interpY = 0;
        this.render.screenX = 0;
        this.render.screenY = 0;
        this.render.visible = true;
        // Clear input data
        this._inputData = null;
    }
    /**
     * Clean up entity (called when returned to pool).
     */
    _cleanup() {
        this._world = null;
        this._components = [];
        this._accessors.clear();
        this._inputData = null;
    }
    // ==========================================
    // Movement Helpers (Deterministic)
    // ==========================================
    /**
     * Set velocity toward a target point.
     * Uses fixed-point math internally for determinism.
     *
     * @param target Target position {x, y}
     * @param speed Speed in units per second
     */
    moveTowards(target, speed) {
        if (!this.has(Transform2D) || !this.has(Body2D))
            return;
        const transform = this.get(Transform2D);
        const body = this.get(Body2D);
        // All math in fixed-point for determinism
        const dx = toFixed(target.x) - toFixed(transform.x);
        const dy = toFixed(target.y) - toFixed(transform.y);
        // Distance squared (avoid sqrt if possible)
        const distSq = fpMul(dx, dx) + fpMul(dy, dy);
        if (distSq === 0) {
            body.vx = 0;
            body.vy = 0;
            return;
        }
        // Distance
        const dist = fpSqrt(distSq);
        // Normalize and scale by speed (speed is in units/sec, physics expects units/sec)
        const speedFp = toFixed(speed * 60); // Convert to units per tick at 60fps base
        body.vx = toFloat(fpDiv(fpMul(dx, speedFp), dist));
        body.vy = toFloat(fpDiv(fpMul(dy, speedFp), dist));
    }
    /**
     * Set velocity toward a target, but stop if within radius.
     *
     * @param target Target position {x, y}
     * @param speed Speed in units per second
     * @param stopRadius Stop moving when within this distance (default: 0)
     */
    moveTowardsWithStop(target, speed, stopRadius = 0) {
        if (!this.has(Transform2D) || !this.has(Body2D))
            return;
        const transform = this.get(Transform2D);
        const body = this.get(Body2D);
        // All math in fixed-point for determinism
        const dx = toFixed(target.x) - toFixed(transform.x);
        const dy = toFixed(target.y) - toFixed(transform.y);
        const distSq = fpMul(dx, dx) + fpMul(dy, dy);
        const stopRadiusFp = toFixed(stopRadius);
        const stopRadiusSq = fpMul(stopRadiusFp, stopRadiusFp);
        // Stop if within radius
        if (distSq <= stopRadiusSq) {
            body.vx = 0;
            body.vy = 0;
            return;
        }
        const dist = fpSqrt(distSq);
        const speedFp = toFixed(speed * 60);
        body.vx = toFloat(fpDiv(fpMul(dx, speedFp), dist));
        body.vy = toFloat(fpDiv(fpMul(dy, speedFp), dist));
    }
    /**
     * Stop all movement.
     */
    stop() {
        if (!this.has(Body2D))
            return;
        const body = this.get(Body2D);
        body.vx = 0;
        body.vy = 0;
    }
    /**
     * Set velocity directly.
     *
     * @param vx X velocity
     * @param vy Y velocity
     */
    setVelocity(vx, vy) {
        if (!this.has(Body2D))
            return;
        const body = this.get(Body2D);
        body.vx = vx;
        body.vy = vy;
    }
    /**
     * Get distance to a point (deterministic).
     */
    distanceTo(target) {
        if (!this.has(Transform2D))
            return 0;
        const transform = this.get(Transform2D);
        const dx = toFixed(target.x) - toFixed(transform.x);
        const dy = toFixed(target.y) - toFixed(transform.y);
        const distSq = fpMul(dx, dx) + fpMul(dy, dy);
        return toFloat(fpSqrt(distSq));
    }
    /**
     * Check if within distance of a point (deterministic).
     */
    isWithin(target, distance) {
        if (!this.has(Transform2D))
            return false;
        const transform = this.get(Transform2D);
        const dx = toFixed(target.x) - toFixed(transform.x);
        const dy = toFixed(target.y) - toFixed(transform.y);
        const distSq = fpMul(dx, dx) + fpMul(dy, dy);
        const distFp = toFixed(distance);
        const distSqThreshold = fpMul(distFp, distFp);
        return distSq <= distSqThreshold;
    }
}
/**
 * Entity pool for reusing entity wrappers.
 */
export class EntityPool {
    constructor() {
        this.pool = [];
        this.active = new Map();
    }
    /**
     * Get or create an entity wrapper.
     */
    acquire(eid) {
        // Check if already have wrapper for this eid
        let entity = this.active.get(eid);
        if (entity) {
            return entity;
        }
        // Get from pool or create new
        entity = this.pool.pop() || new Entity();
        this.active.set(eid, entity);
        return entity;
    }
    /**
     * Return entity wrapper to pool.
     */
    release(eid) {
        const entity = this.active.get(eid);
        if (entity) {
            entity._cleanup();
            this.active.delete(eid);
            this.pool.push(entity);
        }
    }
    /**
     * Get entity by eid if it exists.
     */
    get(eid) {
        return this.active.get(eid);
    }
    /**
     * Check if entity exists.
     */
    has(eid) {
        return this.active.has(eid);
    }
    /**
     * Clear all entities.
     */
    clear() {
        for (const entity of this.active.values()) {
            entity._cleanup();
            this.pool.push(entity);
        }
        this.active.clear();
    }
    /**
     * Get count of active entities.
     */
    get size() {
        return this.active.size;
    }
}
