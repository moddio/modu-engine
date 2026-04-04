import * as THREE from 'three';
import { Sprite } from '../sprites/Sprite';

export abstract class EntityRenderer {
  readonly group = new THREE.Group();
  protected _sprite: Sprite | null = null;

  setPosition(x: number, y: number, z: number = 0): void {
    this.group.position.set(x, y, z);
  }

  setRotation(angle: number): void {
    this.group.rotation.z = angle;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  abstract update(dt: number): void;

  destroy(): void {
    this._sprite?.destroy();
    this.group.removeFromParent();
  }
}
