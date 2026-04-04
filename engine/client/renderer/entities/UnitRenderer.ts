import { EntityRenderer } from './EntityRenderer';
import { AnimatedSprite } from '../sprites/AnimatedSprite';

export class UnitRenderer extends EntityRenderer {
  readonly sprite: AnimatedSprite;

  constructor() {
    super();
    this.sprite = new AnimatedSprite();
    this._sprite = this.sprite;
    this.group.add(this.sprite.mesh);
  }

  update(dt: number): void {
    this.sprite.update(dt);
  }
}
