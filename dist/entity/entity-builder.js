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
import { BaseEntity } from './entity';
import { Physics2DComponent } from '../components/physics2d/component';
import { InputComponent } from '../components/input';
// Built-in component definitions
export const Body2D = {
    type: 'body2d',
    create: (entity, options) => {
        const comp = new Physics2DComponent(options);
        entity.addComponent(comp);
        return comp;
    }
};
export const Input = {
    type: 'input',
    create: (entity, options) => {
        // Set joining context so InputComponent captures clientId
        const { setJoiningClientContext } = require('../components/input');
        if (options?.clientId) {
            setJoiningClientContext(options.clientId);
        }
        const comp = new InputComponent();
        entity.addComponent(comp);
        // Clear context after component is attached
        if (options?.clientId) {
            setJoiningClientContext(null);
        }
        // Set commands after component is attached (so it can register with entity type)
        if (options?.commands) {
            comp.setCommands(options.commands);
        }
        return comp;
    }
};
/**
 * Prefab - spawns entities from a definition
 */
export class Prefab {
    constructor(engine, type, componentConfigs, syncSchema, tickHandler, collisionHandlers, inputCommands, drawHandler = null) {
        this.engine = engine;
        this.type = type;
        this.componentConfigs = componentConfigs;
        this.syncSchema = syncSchema;
        this.tickHandler = tickHandler;
        this.collisionHandlers = collisionHandlers;
        this.inputCommands = inputCommands;
        this.drawHandler = drawHandler;
        // Register factory for snapshot restore
        this.registerFactory();
        // Register tick handler as type-based system
        if (tickHandler) {
            this.engine.entityManager.tickHandlers.set(type, tickHandler);
        }
        // Register collision handlers
        if (this.engine.physics && collisionHandlers.size > 0) {
            for (const [otherType, handler] of collisionHandlers) {
                this.engine.physics.onCollision(type, otherType, handler);
            }
        }
    }
    registerFactory() {
        const self = this;
        this.engine.entityManager.factories.set(this.type, (config) => {
            // Create entity in restore mode
            return self.createEntity(config?.sync || {}, true);
        });
    }
    /**
     * Spawn a new entity from this prefab
     */
    spawn(overrides = {}) {
        return this.createEntity(overrides, false);
    }
    createEntity(values, isRestore) {
        const engine = this.engine;
        const em = engine.entityManager;
        // Create base entity
        const entity = new BaseEntity();
        entity.manager = em;
        em.entities[entity.id] = entity;
        // Set type (updates byType index)
        entity.setType(this.type);
        // Apply sync schema defaults first (if any defined)
        for (const [key, defaultValue] of Object.entries(this.syncSchema)) {
            entity.sync[key] = defaultValue;
        }
        // Apply all spawn values to entity.sync (except reserved keys)
        const reservedKeys = new Set(['x', 'y', 'vx', 'vy', 'angle', 'width', 'height', 'radius']);
        for (const [key, value] of Object.entries(values)) {
            if (!reservedKeys.has(key)) {
                entity.sync[key] = value;
            }
        }
        // Create components
        for (const { def, options } of this.componentConfigs) {
            // Merge position/velocity/size from spawn overrides into body options
            let finalOptions = { ...options };
            if (def.type === 'body2d') {
                if (values.x !== undefined)
                    finalOptions.x = values.x;
                if (values.y !== undefined)
                    finalOptions.y = values.y;
                if (values.vx !== undefined)
                    finalOptions.vx = values.vx;
                if (values.vy !== undefined)
                    finalOptions.vy = values.vy;
                if (values.angle !== undefined)
                    finalOptions.angle = values.angle;
                if (values.width !== undefined)
                    finalOptions.width = values.width;
                if (values.height !== undefined)
                    finalOptions.height = values.height;
                if (values.radius !== undefined)
                    finalOptions.radius = values.radius;
            }
            // For input component, pass clientId and commands
            if (def.type === 'input') {
                if (values.clientId !== undefined)
                    finalOptions.clientId = values.clientId;
                if (this.inputCommands)
                    finalOptions.commands = this.inputCommands;
            }
            def.create(entity, finalOptions);
        }
        // Sync radius if body2d exists and sync.radius is set
        if (entity.sync.radius !== undefined && entity.body) {
            entity.body.setRadius(entity.sync.radius);
        }
        // Apply draw handler if defined
        if (this.drawHandler) {
            const handler = this.drawHandler;
            entity.draw = function (ctx, pos) {
                handler(entity, ctx, pos);
            };
        }
        return entity;
    }
}
/**
 * EntityBuilder - fluent API for defining entities
 */
export class EntityBuilder {
    constructor(engine, type) {
        this.engine = engine;
        this.type = type;
        this.componentConfigs = [];
        this.syncSchema = {};
        this.tickHandler = null;
        this.collisionHandlers = new Map();
        this.inputCommands = null;
        this.drawHandler = null;
    }
    /**
     * Add a component to entities created from this definition
     */
    with(componentDef, options = {}) {
        this.componentConfigs.push({ def: componentDef, options });
        return this;
    }
    /**
     * Define the sync schema (synced state properties)
     */
    sync(schema) {
        this.syncSchema = { ...this.syncSchema, ...schema };
        return this;
    }
    /**
     * Set input commands (for entities with Input component)
     */
    commands(commandDef) {
        this.inputCommands = commandDef;
        return this;
    }
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
    tick(_handler) {
        throw new Error('DEPRECATED: .tick() has been removed.\n\n' +
            'Use game.addSystem() instead:\n\n' +
            '  // OLD:\n' +
            '  game.defineEntity("cell").tick((entity) => { ... });\n\n' +
            '  // NEW:\n' +
            '  game.addSystem(() => {\n' +
            '      for (const entity of game.query("cell")) { ... }\n' +
            '  });\n');
    }
    /**
     * Set collision handler for specific entity type
     */
    onCollision(otherType, handler) {
        this.collisionHandlers.set(otherType, handler);
        return this;
    }
    /**
     * @deprecated Use game.addSystem(..., { phase: 'render' }) instead of .draw()
     */
    draw(_handler) {
        throw new Error('DEPRECATED: .draw() has been removed.\n\n' +
            'Use game.addSystem() with render phase instead:\n\n' +
            '  // OLD:\n' +
            '  game.defineEntity("cell").draw((entity, ctx, pos) => { ... });\n\n' +
            '  // NEW:\n' +
            '  game.addSystem(() => {\n' +
            '      for (const entity of game.query("cell")) {\n' +
            '          // Draw using entity.render.interpX, entity.render.interpY\n' +
            '      }\n' +
            '  }, { phase: "render" });\n');
    }
    /**
     * Build and register the prefab.
     * Note: This is called automatically, you don't need to call .build()
     */
    build() {
        return new Prefab(this.engine, this.type, this.componentConfigs, this.syncSchema, this.tickHandler, this.collisionHandlers, this.inputCommands, this.drawHandler);
    }
    /**
     * Finalize the entity definition and register it.
     * Called automatically when chaining ends.
     */
    register() {
        return this.build();
    }
}
