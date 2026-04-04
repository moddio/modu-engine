import { Entity } from '../ecs/Entity';

export class Sensor extends Entity {
  constructor(id?: string) {
    super(id);
    this.category = 'sensor';
  }
}
