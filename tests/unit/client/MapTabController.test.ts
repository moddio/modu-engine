import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DevMode } from '../../../editor/DevMode';
import { CameraController } from '../../../engine/client/renderer/CameraController';
import { EntityManager } from '../../../engine/client/renderer/EntityManager';
import { MapTabController } from '../../../engine/client/MapTabController';

describe('MapTabController', () => {
  let devMode: DevMode;
  let camera: CameraController;
  let entityManager: EntityManager;
  let controller: MapTabController;

  beforeEach(() => {
    devMode = new DevMode();
    camera = new CameraController();
    entityManager = new EntityManager();
    controller = new MapTabController({ devMode, camera, entityManager });
  });

  describe('enter map tab', () => {
    it('snapshots followTarget and unfollows the camera', () => {
      camera.follow(5, 0, 7);
      devMode.changeTab('map');
      expect(camera.followTarget).toBeNull();
    });

    it('enables pannable and hides runtime entities', () => {
      const setControlsSpy = vi.spyOn(camera, 'setControls');
      const visSpy = vi.spyOn(entityManager, 'setRuntimeEntitiesVisible');
      devMode.changeTab('map');
      expect(setControlsSpy).toHaveBeenCalledWith({ pannable: true });
      expect(visSpy).toHaveBeenCalledWith(false);
      expect(entityManager.runtimeGroup.visible).toBe(false);
    });

    it('handles enter when nothing was being followed', () => {
      devMode.changeTab('map');
      expect(entityManager.runtimeGroup.visible).toBe(false);
    });

    it('does not double-enter on a second changeTab to map', () => {
      devMode.changeTab('map');
      const visSpy = vi.spyOn(entityManager, 'setRuntimeEntitiesVisible');
      // DevMode short-circuits same-tab, but defend against it firing somehow
      devMode.events.emit('tabChange', { from: 'map', to: 'map' });
      expect(visSpy).not.toHaveBeenCalled();
    });
  });

  describe('leave map tab', () => {
    it('restores follow target if one was snapshotted', () => {
      camera.follow(3, 0, 9);
      devMode.changeTab('map');
      devMode.changeTab('entities');
      const t = camera.followTarget;
      expect(t).not.toBeNull();
      expect(t!.x).toBe(3);
      expect(t!.z).toBe(9);
    });

    it('does not call follow() when nothing was snapshotted', () => {
      devMode.changeTab('map');
      const followSpy = vi.spyOn(camera, 'follow');
      devMode.changeTab('entities');
      expect(followSpy).not.toHaveBeenCalled();
    });

    it('disables pannable and shows runtime entities', () => {
      devMode.changeTab('map');
      const setControlsSpy = vi.spyOn(camera, 'setControls');
      devMode.changeTab('entities');
      expect(setControlsSpy).toHaveBeenCalledWith({ pannable: false });
      expect(entityManager.runtimeGroup.visible).toBe(true);
    });

    it('restores camera rotation/zoom changed while in map tab', () => {
      camera.azimuth = 0.1;
      camera.elevation = 1.2;
      camera.distance = 1.5;
      devMode.changeTab('map');
      // user rotates + zooms inside map tab
      camera.azimuth = 0.9;
      camera.elevation = 0.5;
      camera.distance = 4;
      devMode.changeTab('entities');
      expect(camera.azimuth).toBeCloseTo(0.1);
      expect(camera.elevation).toBeCloseTo(1.2);
      expect(camera.distance).toBeCloseTo(1.5);
    });

    it('restores camera target panned in map tab when not following', () => {
      camera.target.set(2, 0, 3);
      devMode.changeTab('map');
      camera.applyPan(50, -30); // pans target while in map
      devMode.changeTab('entities');
      expect(camera.target.x).toBeCloseTo(2);
      expect(camera.target.z).toBeCloseTo(3);
    });
  });

  describe('tab transitions that don\'t involve map', () => {
    it('entities → props is a no-op', () => {
      devMode.changeTab('entities');
      const setControlsSpy = vi.spyOn(camera, 'setControls');
      const visSpy = vi.spyOn(entityManager, 'setRuntimeEntitiesVisible');
      devMode.changeTab('props');
      expect(setControlsSpy).not.toHaveBeenCalled();
      expect(visSpy).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('unsubscribes from tabChange events', () => {
      controller.dispose();
      const visSpy = vi.spyOn(entityManager, 'setRuntimeEntitiesVisible');
      devMode.changeTab('map');
      expect(visSpy).not.toHaveBeenCalled();
    });
  });
});
