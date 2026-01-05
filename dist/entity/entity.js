/**
 * Entity System - Base Entity
 *
 * Entities are game objects with unique identifiers and components.
 * All entity operations are deterministic for network synchronization.
 */
import { toFixed, toFloat, fpMul, fpDiv, fpSqrt } from '../math/fixed';
// ============================================
// Base Entity Implementation
// ============================================
// Deterministic entity ID counter for network sync
let entityIdCounter = 0;
export function resetEntityIdCounter() {
    entityIdCounter = 0;
}
export function getEntityIdCounter() {
    return entityIdCounter;
}
export function setEntityIdCounter(value) {
    entityIdCounter = value;
}
export function generateEntityId() {
    // Use deterministic counter-based IDs, not random
    // This ensures entity IDs are the same on all clients
    const id = entityIdCounter++;
    // Convert to 8-char hex string
    return id.toString(16).padStart(8, '0');
}
// Restore context - used when recreating entities from snapshot
// This allows constructors to be written without config parameter
let restoreContext = null;
export function setRestoreContext(ctx) {
    restoreContext = ctx;
}
export function getRestoreContext() {
    return restoreContext;
}
export class BaseEntity {
    constructor(config = {}) {
        this.type = '';
        this.manager = null;
        /** Synced state - serialized in snapshots */
        this.sync = {};
        // Use restore context id if available (for snapshot restore)
        const ctx = restoreContext;
        this.id = config.id ?? ctx?.id ?? generateEntityId();
        this.label = config.label ?? this.id;
        this.active = config.active ?? true;
        this.components = new Map();
    }
    /**
     * Set entity type. Updates manager's byType index if registered.
     * Also auto-registers this class as factory for the type (for snapshot restore).
     */
    setType(type) {
        if (this.type === type)
            return this;
        // Remove from old type array
        if (this.manager && this.type) {
            const oldArr = this.manager.byType[this.type];
            if (oldArr) {
                const idx = oldArr.indexOf(this);
                if (idx !== -1)
                    oldArr.splice(idx, 1);
            }
        }
        this.type = type;
        // Add to new type array (sorted by id)
        if (this.manager && type) {
            if (!this.manager.byType[type])
                this.manager.byType[type] = [];
            const arr = this.manager.byType[type];
            let lo = 0, hi = arr.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (arr[mid].id < this.id)
                    lo = mid + 1;
                else
                    hi = mid;
            }
            arr.splice(lo, 0, this);
            // Auto-register this class as factory for this type (for snapshot restore)
            // Only register if not already registered
            if (!this.manager.factories.has(type)) {
                const EntityClass = this.constructor;
                this.manager.factories.set(type, (config) => {
                    return new EntityClass(config?.sync?.clientId);
                });
            }
        }
        return this;
    }
    addComponent(component) {
        if (this.components.has(component.type)) {
            throw new Error(`Entity ${this.id} already has component of type ${component.type}`);
        }
        component.entity = this;
        this.components.set(component.type, component);
        if (component.onAttach) {
            component.onAttach();
        }
        return component;
    }
    getComponent(type) {
        return this.components.get(type) ?? null;
    }
    hasComponent(type) {
        return this.components.has(type);
    }
    removeComponent(type) {
        const component = this.components.get(type);
        if (component) {
            if (component.onDetach) {
                component.onDetach();
            }
            component.entity = null;
            this.components.delete(type);
            return true;
        }
        return false;
    }
    /**
     * Per-frame update. Override for custom logic.
     * No need to call super - components are updated by EntityManager.
     */
    tick(frame) {
        // Empty by default - override in subclass
    }
    /** Physics2D component (null if no physics component) */
    get physics() {
        return this.components.get('physics2d') ?? null;
    }
    /** Raw physics body (null if no physics component) */
    get body() {
        const phys = this.components.get('physics2d');
        return phys ? phys.body : null;
    }
    /** Input component proxy (null if no input component) */
    get input() {
        const inputComp = this.components.get('input');
        return inputComp ? inputComp.proxy : null;
    }
    /** X position (float) */
    get x() {
        const phys = this.components.get('physics2d');
        return phys ? toFloat(phys.body.position.x) : 0;
    }
    /** Y position (float) */
    get y() {
        const phys = this.components.get('physics2d');
        return phys ? toFloat(phys.body.position.y) : 0;
    }
    /**
     * Set position with deterministic fixed-point conversion
     */
    moveTo(x, y) {
        const phys = this.components.get('physics2d');
        if (phys) {
            phys.body.position.x = toFixed(x);
            phys.body.position.y = toFixed(y);
            phys.body.isSleeping = false;
        }
    }
    /**
     * Move by offset with deterministic fixed-point conversion
     */
    moveBy(dx, dy) {
        const phys = this.components.get('physics2d');
        if (phys) {
            phys.body.position.x += toFixed(dx);
            phys.body.position.y += toFixed(dy);
            phys.body.isSleeping = false;
        }
    }
    /**
     * Move toward target position at given speed (DETERMINISTIC).
     * All calculations use fixed-point math internally.
     * @returns true if moved, false if at/near target
     */
    moveToward(targetX, targetY, speed, minDistance = 0) {
        const phys = this.components.get('physics2d');
        if (!phys)
            return false;
        const pxFP = phys.body.position.x;
        const pyFP = phys.body.position.y;
        const txFP = toFixed(targetX);
        const tyFP = toFixed(targetY);
        const dxFP = (txFP - pxFP);
        const dyFP = (tyFP - pyFP);
        const distSqFP = (fpMul(dxFP, dxFP) + fpMul(dyFP, dyFP));
        const minDistFP = toFixed(minDistance);
        const minDistSqFP = fpMul(minDistFP, minDistFP);
        if (distSqFP <= minDistSqFP)
            return false;
        const distFP = fpSqrt(distSqFP);
        const speedFP = toFixed(speed);
        const moveXFP = fpMul(fpDiv(dxFP, distFP), speedFP);
        const moveYFP = fpMul(fpDiv(dyFP, distFP), speedFP);
        phys.body.position.x = (pxFP + moveXFP);
        phys.body.position.y = (pyFP + moveYFP);
        phys.body.isSleeping = false;
        return true;
    }
    /**
     * Destroy this entity and remove from EntityManager.
     */
    destroy() {
        if (this.manager) {
            this.manager.destroy(this);
        }
    }
}
