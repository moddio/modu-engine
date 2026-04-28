import * as THREE from 'three';
import { CameraController } from './renderer/CameraController';
import { EntityManager } from './renderer/EntityManager';
import { DevMode } from '../../editor/DevMode';
import { EventHandle } from '../core/events/EventEmitter';

export interface MapTabControllerDeps {
  devMode: DevMode;
  camera: CameraController;
  entityManager: EntityManager;
}

interface TabChangePayload {
  from: string | null;
  to: string;
}

interface SavedView {
  azimuth: number;
  elevation: number;
  distance: number;
  target: THREE.Vector3;
  followTarget: THREE.Vector3 | null;
}

/**
 * Subscribes to `DevMode`'s `'tabChange'` event and toggles map-tab side-effects:
 *  - on enter: snapshot camera view (rotation/zoom/target/follow), unfollow, enable pan, hide runtime entities
 *  - on leave: restore camera view, disable pan, show runtime entities
 * Regions stay visible throughout (handled by EntityManager's group split).
 */
export class MapTabController {
  private _savedView: SavedView | null = null;
  private _inMapTab = false;
  private _handle: EventHandle;

  constructor(private deps: MapTabControllerDeps) {
    this._handle = deps.devMode.events.on('tabChange', (payload: unknown) => {
      const { from, to } = payload as TabChangePayload;
      if (to === 'map' && !this._inMapTab) this._enter();
      else if (from === 'map' && to !== 'map' && this._inMapTab) this._leave();
    });
  }

  private _enter(): void {
    this._inMapTab = true;
    const camera = this.deps.camera;
    this._savedView = {
      azimuth: camera.azimuth,
      elevation: camera.elevation,
      distance: camera.distance,
      target: camera.target.clone(),
      followTarget: camera.followTarget,
    };
    camera.unfollow();
    camera.setControls({ pannable: true });
    this.deps.entityManager.setRuntimeEntitiesVisible(false);
  }

  private _leave(): void {
    this._inMapTab = false;
    const camera = this.deps.camera;
    if (this._savedView) {
      const saved = this._savedView;
      camera.azimuth = saved.azimuth;
      camera.elevation = saved.elevation;
      camera.distance = saved.distance;
      camera.target.copy(saved.target);
      if (saved.followTarget) {
        camera.follow(saved.followTarget.x, saved.followTarget.y, saved.followTarget.z);
      }
      this._savedView = null;
    }
    camera.setControls({ pannable: false });
    this.deps.entityManager.setRuntimeEntitiesVisible(true);
  }

  dispose(): void {
    this.deps.devMode.events.off('tabChange', this._handle);
  }
}
