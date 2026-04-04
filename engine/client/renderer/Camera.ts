import * as THREE from 'three';
import { Vec3 } from '../../core/math/Vec3';

export class Camera {
  readonly threeCamera: THREE.OrthographicCamera;
  position = new Vec3(0, 0, 10);
  target = new Vec3(0, 0, 0);
  private _zoom = 1;
  near: number;
  far: number;
  private _width: number;
  private _height: number;

  constructor(width: number = 800, height: number = 600, near: number = 0.1, far: number = 1000) {
    this._width = width;
    this._height = height;
    this.near = near;
    this.far = far;
    const hw = width / 2;
    const hh = height / 2;
    this.threeCamera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, near, far);
    this.threeCamera.position.set(0, 0, 10);
    this.threeCamera.lookAt(0, 0, 0);
  }

  get zoom(): number { return this._zoom; }

  setZoom(zoom: number): void {
    this._zoom = Math.max(0.1, Math.min(10, zoom));
    this._updateProjection();
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._updateProjection();
  }

  lookAt(x: number, y: number, z: number = 0): void {
    this.target.set(x, y, z);
    this.threeCamera.position.set(x, y, this.position.z);
    this.threeCamera.lookAt(x, y, z);
  }

  update(): void {
    this.threeCamera.position.set(this.position.x, this.position.y, this.position.z);
    this.threeCamera.lookAt(this.target.x, this.target.y, this.target.z);
  }

  private _updateProjection(): void {
    const hw = (this._width / 2) / this._zoom;
    const hh = (this._height / 2) / this._zoom;
    this.threeCamera.left = -hw;
    this.threeCamera.right = hw;
    this.threeCamera.top = hh;
    this.threeCamera.bottom = -hh;
    this.threeCamera.updateProjectionMatrix();
  }
}
