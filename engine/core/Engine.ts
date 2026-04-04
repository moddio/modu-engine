import { Clock } from './time/Clock';
import { EventEmitter } from './events/EventEmitter';
import { Entity } from './ecs/Entity';
import { System } from './ecs/System';

export class Engine {
  private static _instance: Engine | null = null;

  readonly clock: Clock;
  readonly events: EventEmitter;
  readonly root: Entity;

  private _systems = new Map<string, System>();
  private _entityRegistry = new Map<string, Entity>();
  private _running = false;

  private constructor() {
    this.clock = new Clock(60);
    this.events = new EventEmitter();
    this.root = new Entity('root');
  }

  static instance(): Engine {
    if (!Engine._instance) Engine._instance = new Engine();
    return Engine._instance;
  }

  static reset(): void {
    if (Engine._instance) Engine._instance.stop();
    Engine._instance = null;
  }

  spawn(id?: string): Entity {
    const entity = new Entity(id);
    entity.mount(this.root);
    this._entityRegistry.set(entity.id, entity);
    return entity;
  }

  findById(id: string): Entity | null {
    return this._entityRegistry.get(id) ?? null;
  }

  addSystem(system: System): void { this._systems.set(system.name, system); }
  getSystem(name: string): System | null { return this._systems.get(name) ?? null; }
  removeSystem(name: string): void { this._systems.delete(name); }

  step(dtMs: number): void {
    this.clock.step(dtMs);
    this.events.emit('preUpdate', dtMs);
    this._updateEntity(this.root, dtMs);
    const entities = this.root.children;
    for (const system of this._systems.values()) system.update(dtMs, entities);
    this.events.emit('postUpdate', dtMs);
  }

  stop(): void { this._running = false; }

  private _updateEntity(entity: Entity, dt: number): void {
    entity.update(dt);
    for (const child of entity.children) this._updateEntity(child, dt);
  }
}
