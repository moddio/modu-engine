import * as THREE from 'three';

export class Sprite {
  readonly mesh: THREE.Sprite;
  private _material: THREE.SpriteMaterial;
  billboard = false;

  constructor(texture?: THREE.Texture) {
    this._material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });
    this.mesh = new THREE.Sprite(this._material);
  }

  setTexture(texture: THREE.Texture): void {
    this._material.map = texture;
    this._material.needsUpdate = true;
  }

  setSize(width: number, height: number): void {
    this.mesh.scale.set(width, height, 1);
  }

  setPosition(x: number, y: number, z: number = 0): void {
    this.mesh.position.set(x, y, z);
  }

  setOpacity(opacity: number): void {
    this._material.opacity = opacity;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  setTint(color: number): void {
    this._material.color.setHex(color);
  }

  /** Make sprite face the camera each frame */
  faceCamera(camera: THREE.Camera): void {
    if (!this.billboard) return;
    this.mesh.quaternion.copy(camera.quaternion);
  }

  destroy(): void {
    this._material.dispose();
  }
}
