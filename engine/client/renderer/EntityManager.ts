import * as THREE from 'three';
import { EntityRenderer } from './entities/EntityRenderer';
import { RegionRenderer } from './entities/RegionRenderer';

/**
 * EntityManager — tracks all rendered entities, updates them each frame,
 * and handles billboard sprite facing toward the camera.
 *
 * Scene topology: `group` is a parent THREE.Group that contains two children:
 *   - `runtimeGroup`: units, items, projectiles (the gameplay-facing entities)
 *   - `regionGroup`:  regions (editor-facing zones)
 * Toggling `runtimeGroup.visible` is how the editor's map-tab hides gameplay
 * entities while keeping regions visible for editing.
 */
export class EntityManager {
  readonly group = new THREE.Group();
  readonly runtimeGroup = new THREE.Group();
  readonly regionGroup = new THREE.Group();
  private _entities = new Map<string, EntityRenderer>();

  constructor() {
    this.group.add(this.runtimeGroup);
    this.group.add(this.regionGroup);
  }

  add(id: string, renderer: EntityRenderer): void {
    this._entities.set(id, renderer);
    const target = renderer instanceof RegionRenderer ? this.regionGroup : this.runtimeGroup;
    target.add(renderer.group);
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
      if (camera && (renderer as any).sprite?.billboard) {
        (renderer as any).sprite.faceCamera(camera);
      }
    }
  }

  get count(): number {
    return this._entities.size;
  }

  /** Toggle visibility of the runtime entities (units/items/projectiles). Regions unaffected. */
  setRuntimeEntitiesVisible(visible: boolean): void {
    this.runtimeGroup.visible = visible;
  }

  clear(): void {
    for (const r of this._entities.values()) r.destroy();
    this._entities.clear();
  }
}
