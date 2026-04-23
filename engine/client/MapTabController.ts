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

/**
 * Subscribes to `DevMode`'s `'tabChange'` event and toggles map-tab side-effects:
 *  - on enter: snapshot follow target, unfollow, enable pan, hide runtime entities
 *  - on leave: restore follow target, disable pan, show runtime entities
 * Regions stay visible throughout (handled by EntityManager's group split).
 */
export class MapTabController {
  private _savedFollowTarget: THREE.Vector3 | null = null;
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
    this._savedFollowTarget = this.deps.camera.followTarget;
    this.deps.camera.unfollow();
    this.deps.camera.setControls({ pannable: true });
    this.deps.entityManager.setRuntimeEntitiesVisible(false);
  }

  private _leave(): void {
    this._inMapTab = false;
    if (this._savedFollowTarget) {
      const t = this._savedFollowTarget;
      this.deps.camera.follow(t.x, t.y, t.z);
      this._savedFollowTarget = null;
    }
    this.deps.camera.setControls({ pannable: false });
    this.deps.entityManager.setRuntimeEntitiesVisible(true);
  }

  dispose(): void {
    this.deps.devMode.events.off('tabChange', this._handle);
  }
}
