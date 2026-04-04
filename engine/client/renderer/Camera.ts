import { Vec3 } from '../../core/math/Vec3';

export class Camera {
  position = new Vec3(0, 0, 10);
  target = new Vec3(0, 0, 0);
  zoom = 1;
  near = 0.1;
  far = 1000;

  lookAt(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.1, Math.min(10, zoom));
  }
}
