import { Component } from '../ecs/Component';

export interface AttributeDef {
  name: string;
  value: number;
  min: number;
  max: number;
  regeneration: number; // per second
}

export class AttributeManager extends Component {
  static readonly id = 'attribute';
  private _attributes = new Map<string, AttributeDef>();

  define(def: AttributeDef): void {
    this._attributes.set(def.name, { ...def });
  }

  get(name: string): number | undefined {
    return this._attributes.get(name)?.value;
  }

  set(name: string, value: number): void {
    const attr = this._attributes.get(name);
    if (!attr) return;
    attr.value = Math.max(attr.min, Math.min(attr.max, value));
  }

  modify(name: string, delta: number): void {
    const attr = this._attributes.get(name);
    if (!attr) return;
    attr.value = Math.max(attr.min, Math.min(attr.max, attr.value + delta));
  }

  getMax(name: string): number | undefined {
    return this._attributes.get(name)?.max;
  }

  update(dt: number): void {
    const seconds = dt / 1000;
    for (const attr of this._attributes.values()) {
      if (attr.regeneration !== 0 && attr.value < attr.max) {
        attr.value = Math.min(attr.max, attr.value + attr.regeneration * seconds);
      }
    }
  }
}
