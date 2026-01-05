/**
 * Entity2D - Entity with built-in 2D physics
 *
 * Usage:
 *   const food = new Entity2D();
 *   food.setType('food').setBody({ type: 'static', shape: 'circle', radius: 8, x: 100, y: 100 });
 */
import { BaseEntity, Entity } from '../../entity/entity';
import { Physics2DOptions } from './component';
export declare function setEntity2DEngineRef(e: any): void;
/**
 * Entity2D - Entity with 2D physics built-in.
 * Inherits x, y, moveTo, moveBy from BaseEntity.
 */
export declare class Entity2D extends BaseEntity {
    /** Internal collision handler storage */
    _onCollision: ((other: Entity) => void) | null;
    constructor();
    /**
     * Collision handler - called when this entity collides with another.
     * Automatically registered by type for snapshot restore.
     */
    get onCollision(): ((other: Entity) => void) | null;
    set onCollision(handler: ((other: Entity) => void) | null);
    /**
     * Set up the physics body for this entity
     */
    setBody(options: Physics2DOptions): this;
}
