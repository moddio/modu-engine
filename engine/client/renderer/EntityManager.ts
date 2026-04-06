import * as THREE from 'three';
import { EntityRenderer } from './entities/EntityRenderer';

/**
 * EntityManager — tracks all rendered entities, updates them each frame,
 * and handles billboard sprite facing toward the camera.
 */
export class EntityManager {
  readonly group = new THREE.Group();
  private _entities = new Map<string, EntityRenderer>();

  add(id: string, renderer: EntityRenderer): void {
    this._entities.set(id, renderer);
    this.group.add(renderer.group);
  }

  remove(id: string): void {
    const r = this._entities.get(id);
    if (r) {
      r.destroy();
      this._entities.delete(id);
    }
  }

  get(id: string): EntityRenderer | undefined {
    return this._entities.get(id);
  }

  update(dt: number, camera?: THREE.Camera): void {
    for (const renderer of this._entities.values()) {
      renderer.update(dt);
      // Billboard sprites face camera
      if (camera && (renderer as any).sprite?.billboard) {
        (renderer as any).sprite.faceCamera(camera);
      }
    }
  }

  get count(): number {
    return this._entities.size;
  }

  clear(): void {
    for (const r of this._entities.values()) r.destroy();
    this._entities.clear();
  }
}
