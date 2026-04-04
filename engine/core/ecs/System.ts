import type { Entity } from './Entity';

export abstract class System {
  readonly name: string = '';
  abstract update(dt: number, entities: Entity[]): void;
}
