import * as THREE from 'three';
import { HudElement } from './HudElement';

export class ProgressBar extends HudElement {
  private _bgMesh: THREE.Mesh;
  private _fillMesh: THREE.Mesh;
  private _fillMaterial: THREE.MeshBasicMaterial;
  private _width: number;
  private _height: number;
  private _value = 1;

  constructor(width: number = 50, height: number = 5, fillColor: number = 0x00ff00, bgColor: number = 0x333333) {
    super();
    this._width = width;
    this._height = height;

    const bgGeo = new THREE.PlaneGeometry(width, height);
    const bgMat = new THREE.MeshBasicMaterial({ color: bgColor, transparent: true, opacity: 0.8 });
    this._bgMesh = new THREE.Mesh(bgGeo, bgMat);
    this.group.add(this._bgMesh);

    const fillGeo = new THREE.PlaneGeometry(width, height);
    this._fillMaterial = new THREE.MeshBasicMaterial({ color: fillColor });
    this._fillMesh = new THREE.Mesh(fillGeo, this._fillMaterial);
    this._fillMesh.position.z = 0.01;
    this.group.add(this._fillMesh);
  }

  get value(): number { return this._value; }

  setValue(value: number): void {
    this._value = Math.max(0, Math.min(1, value));
    this._fillMesh.scale.x = this._value;
    this._fillMesh.position.x = -(this._width * (1 - this._value)) / 2;
  }

  setColor(color: number): void {
    this._fillMaterial.color.setHex(color);
  }

  update(_dt: number): void {}

  destroy(): void {
    this._bgMesh.geometry.dispose();
    (this._bgMesh.material as THREE.MeshBasicMaterial).dispose();
    this._fillMesh.geometry.dispose();
    this._fillMaterial.dispose();
    this.group.removeFromParent();
  }
}
