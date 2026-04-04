import type { Entity } from './Entity';

export abstract class Component {
  static readonly id: string;
  entity: Entity | null = null;
  update(_dt: number): void {}
  destroy(): void {}
}
