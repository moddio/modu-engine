/**
 * Entity2D - Entity with built-in 2D physics
 *
 * Usage:
 *   const food = new Entity2D();
 *   food.setType('food').setBody({ type: 'static', shape: 'circle', radius: 8, x: 100, y: 100 });
 */
import { BaseEntity, getRestoreContext } from '../../entity/entity';
import { Physics2DComponent } from './component';
import { registerClass } from '../../entity/entity-manager';
// Engine reference for auto-registration
let engine = null;
export function setEntity2DEngineRef(e) {
    engine = e;
}
/**
 * Entity2D - Entity with 2D physics built-in.
 * Inherits x, y, moveTo, moveBy from BaseEntity.
 */
export class Entity2D extends BaseEntity {
    constructor() {
        super();
        /** Internal collision handler storage */
        this._onCollision = null;
        // Skip registration if restoring from snapshot (uses context, not config)
        const ctx = getRestoreContext();
        if (ctx?.skipRegister)
            return;
        // Auto-register with EntityManager
        if (!engine) {
            throw new Error('Entity2D: Engine not initialized. Call Modu.init() first.');
        }
        const em = engine.entityManager;
        this.manager = em;
        em.entities[this.id] = this;
        // Auto-register class for snapshot restore
        registerClass(this.constructor);
    }
    /**
     * Collision handler - called when this entity collides with another.
     * Automatically registered by type for snapshot restore.
     */
    get onCollision() {
        return this._onCollision;
    }
    set onCollision(handler) {
        this._onCollision = handler;
        // Register by type for snapshot restore
        if (handler && this.type && this.manager) {
            this.manager.collisionHandlers.set(this.type, handler);
        }
    }
    /**
     * Set up the physics body for this entity
     */
    setBody(options) {
        if (this.components.has('physics2d')) {
            throw new Error('Entity2D already has a physics body');
        }
        const physics = new Physics2DComponent(options);
        this.addComponent(physics);
        return this;
    }
}
