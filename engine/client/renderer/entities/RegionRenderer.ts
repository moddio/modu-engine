import * as THREE from 'three';
import { EntityRenderer } from './EntityRenderer';

export class RegionRenderer extends EntityRenderer {
  private _mesh: THREE.Mesh;

  constructor(width: number = 100, height: number = 100, color: number = 0x00ff00) {
    super();
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });
    this._mesh = new THREE.Mesh(geometry, material);
    this.group.add(this._mesh);
  }

  setSize(width: number, height: number): void {
    this._mesh.geometry.dispose();
    this._mesh.geometry = new THREE.PlaneGeometry(width, height);
  }

  update(_dt: number): void {}

  destroy(): void {
    this._mesh.geometry.dispose();
    (this._mesh.material as THREE.MeshBasicMaterial).dispose();
    super.destroy();
  }
}
