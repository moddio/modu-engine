import * as THREE from 'three';

export abstract class HudElement {
  readonly group = new THREE.Group();
  visible = true;

  setPosition(x: number, y: number, z: number = 0.1): void {
    this.group.position.set(x, y, z);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
  }

  abstract update(dt: number): void;
  abstract destroy(): void;
}
