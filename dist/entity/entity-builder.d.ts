/**
 * EntityBuilder - Declarative entity definition
 *
 * Usage:
 *   const Cell = game.defineEntity('cell')
 *       .with(Body2D, { shape: 'circle', radius: 20 })
 *       .sync({ clientId: null, color: null })
 *       .tick((entity, frame) => { ... })
 *       .onCollision('food', (self, other) => { ... });
 *
 *   Cell.spawn({ x: 100, y: 200, clientId: 'abc' });
 */
import { BaseEntity, Entity } from './entity';
import { Component } from './component';
export interface ComponentDef {
    type: string;
    create: (entity: BaseEntity, options: any) => Component;
}
export declare const Body2D: ComponentDef;
export declare const Input: ComponentDef;
export type TickHandler = (entity: Entity, frame: number) => void;
export type CollisionHandler = (self: Entity, other: Entity) => void;
export type DrawHandler = (entity: Entity, ctx: any, pos: {
    x: number;
    y: number;
}) => void;
/**
 * Prefab - spawns entities from a definition
 */
export declare class Prefab {
    private engine;
    private type;
    private componentConfigs;
    private syncSchema;
    private tickHandler;
    private collisionHandlers;
    private inputCommands;
    private drawHandler;
    constructor(engine: any, type: string, componentConfigs: Array<{
        def: ComponentDef;
        options: any;
    }>, syncSchema: Record<string, any>, tickHandler: TickHandler | null, collisionHandlers: Map<string, CollisionHandler>, inputCommands: any, drawHandler?: DrawHandler | null);
    private registerFactory;
    /**
     * Spawn a new entity from this prefab
     */
    spawn(overrides?: Record<string, any>): Entity;
    private createEntity;
}
/**
 * EntityBuilder - fluent API for defining entities
 */
export declare class EntityBuilder {
    private engine;
    private type;
    private componentConfigs;
    private syncSchema;
    private tickHandler;
    private collisionHandlers;
    private inputCommands;
    private drawHandler;
    constructor(engine: any, type: string);
    /**
     * Add a component to entities created from this definition
     */
    with(componentDef: ComponentDef, options?: any): this;
    /**
     * Define the sync schema (synced state properties)
     */
    sync(schema: Record<string, any>): this;
    /**
     * Set input commands (for entities with Input component)
     */
    commands(commandDef: any): this;
    /**
     * @deprecated Use game.addSystem() instead of .tick()
     * @example
     * // OLD (removed):
     * game.defineEntity('cell').tick((entity) => { ... });
     *
     * // NEW:
     * game.addSystem(() => {
     *     for (const entity of game.query('cell')) { ... }
     * });
     */
    tick(_handler: TickHandler): this;
    /**
     * Set collision handler for specific entity type
     */
    onCollision(otherType: string, handler: CollisionHandler): this;
    /**
     * @deprecated Use game.addSystem(..., { phase: 'render' }) instead of .draw()
     */
    draw(_handler: DrawHandler): this;
    /**
     * Build and register the prefab.
     * Note: This is called automatically, you don't need to call .build()
     */
    build(): Prefab;
    /**
     * Finalize the entity definition and register it.
     * Called automatically when chaining ends.
     */
    register(): Prefab;
}
