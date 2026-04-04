import { EntityRenderer } from './EntityRenderer';
import { Sprite } from '../sprites/Sprite';

export class ProjectileRenderer extends EntityRenderer {
  constructor() {
    super();
    this._sprite = new Sprite();
    this.group.add(this._sprite.mesh);
  }

  update(_dt: number): void {}
}
