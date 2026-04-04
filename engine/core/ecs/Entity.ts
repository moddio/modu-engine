import { Vec3 } from '../math/Vec3';
import { Component } from './Component';

let _nextId = 0;
function generateId(): string {
  return `entity_${++_nextId}_${Math.random().toString(36).slice(2, 10)}`;
}

type ComponentClass<T extends Component> = { readonly id: string; new (...args: unknown[]): T; };

export class Entity {
  readonly id: string;
  alive = true;
  parent: Entity | null = null;
  children: Entity[] = [];
  position = new Vec3(0, 0, 0);
  rotation = 0;
  scale = new Vec3(1, 1, 1);
  layer = 0;
  depth = 0;
  category = '';
  private _components = new Map<string, Component>();

  constructor(id?: string) { this.id = id ?? generateId(); }

  mount(parent: Entity): this {
    if (parent === this) throw new Error('Cannot mount entity to itself');
    if (this.parent) this.unmount();
    this.parent = parent;
    parent.children.push(this);
    return this;
  }

  unmount(): this {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) this.parent.children.splice(idx, 1);
      this.parent = null;
    }
    return this;
  }

  addComponent<T extends Component>(component: T): T {
    const ctor = component.constructor as ComponentClass<T>;
    this._components.set(ctor.id, component);
    component.entity = this;
    return component;
  }

  getComponent<T extends Component>(ctor: ComponentClass<T>): T | null {
    return (this._components.get(ctor.id) as T) ?? null;
  }

  hasComponent<T extends Component>(ctor: ComponentClass<T>): boolean {
    return this._components.has(ctor.id);
  }

  removeComponent<T extends Component>(ctor: ComponentClass<T>): void {
    const comp = this._components.get(ctor.id);
    if (comp) { comp.destroy(); comp.entity = null; this._components.delete(ctor.id); }
  }

  update(dt: number): void {
    if (!this.alive) return;
    for (const comp of this._components.values()) comp.update(dt);
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    const kids = [...this.children];
    for (const child of kids) child.destroy();
    for (const comp of this._components.values()) { comp.destroy(); comp.entity = null; }
    this._components.clear();
    this.unmount();
  }
}
