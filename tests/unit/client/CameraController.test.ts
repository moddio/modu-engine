import { describe, it, expect, beforeEach } from 'vitest';
import { CameraController, CameraConfig } from '../../../engine/client/renderer/CameraController';

describe('CameraController', () => {
  let camera: CameraController;

  beforeEach(() => {
    camera = new CameraController();
  });

  describe('construction', () => {
    it('defaults to orthographic projection', () => {
      expect(camera.projectionMode).toBe('orthographic');
    });

    it('accepts config', () => {
      const config: CameraConfig = {
        projectionMode: 'perspective',
        fov: 40,
        defaultPitch: 64,
        defaultYaw: 0,
        zoom: 3,
        trackingDelay: 3,
        near: 0.1,
        far: 1000,
      };
      const cam = new CameraController(config);
      expect(cam.projectionMode).toBe('perspective');
      expect(cam.elevation).toBeCloseTo(64 * Math.PI / 180, 2);
      expect(cam.distance).toBe(3);
    });
  });

  describe('projection mode', () => {
    it('switches between perspective and orthographic', () => {
      camera.setProjection('perspective');
      expect(camera.projectionMode).toBe('perspective');
      camera.setProjection('orthographic');
      expect(camera.projectionMode).toBe('orthographic');
    });
  });

  describe('elevation and azimuth', () => {
    it('sets elevation in degrees, stores in radians', () => {
      camera.setElevation(45);
      expect(camera.elevation).toBeCloseTo(45 * Math.PI / 180, 4);
    });

    it('clamps elevation between 5 and 90 degrees', () => {
      camera.setElevation(100);
      expect(camera.elevation).toBeCloseTo(90 * Math.PI / 180, 4);
      camera.setElevation(-10);
      expect(camera.elevation).toBeCloseTo(5 * Math.PI / 180, 4);
    });

    it('sets azimuth in degrees, stores in radians', () => {
      camera.setAzimuth(90);
      expect(camera.azimuth).toBeCloseTo(90 * Math.PI / 180, 4);
    });
  });

  describe('zoom/distance', () => {
    it('sets distance', () => {
      camera.setZoom(5);
      expect(camera.distance).toBe(5);
    });

    it('clamps distance to positive values', () => {
      camera.setZoom(-1);
      expect(camera.distance).toBeGreaterThan(0);
    });
  });

  describe('target tracking', () => {
    it('sets target position directly', () => {
      camera.setTarget(10, 0, 5);
      expect(camera.target.x).toBe(10);
      expect(camera.target.y).toBe(0);
      expect(camera.target.z).toBe(5);
    });

    it('provides a Three.js camera for rendering', () => {
      expect(camera.threeCamera).toBeDefined();
    });

    it('computes camera position from spherical coordinates', () => {
      camera.setElevation(90);
      camera.setZoom(10);
      camera.setTarget(0, 0, 0);
      camera.update(16);
      // At 90° elevation, camera should be directly above target
      expect(camera.position.y).toBeCloseTo(10, 1);
      expect(Math.abs(camera.position.x)).toBeLessThan(0.01);
      expect(Math.abs(camera.position.z)).toBeLessThan(0.01);
    });
  });

  describe('followTarget getter', () => {
    it('returns null when not following', () => {
      expect(camera.followTarget).toBeNull();
    });

    it('returns a clone of the follow target after follow()', () => {
      camera.follow(3, 0, 7);
      const t = camera.followTarget!;
      expect(t).not.toBeNull();
      expect(t.x).toBe(3);
      expect(t.y).toBe(0);
      expect(t.z).toBe(7);
      // Mutating the returned vector must not mutate internal state
      t.x = 999;
      expect(camera.followTarget!.x).toBe(3);
    });

    it('returns null after unfollow()', () => {
      camera.follow(1, 2, 3);
      camera.unfollow();
      expect(camera.followTarget).toBeNull();
    });
  });

  describe('pannable flag and applyPan', () => {
    it('defaults pannable to true', () => {
      // No assertion on private field; assert via behavior
      camera.setTarget(0, 0, 0);
      camera.applyPan(10, 0);
      expect(camera.target.x).not.toBe(0);
    });

    it('setControls({ pannable: false }) blocks applyPan', () => {
      camera.setTarget(0, 0, 0);
      camera.setControls({ pannable: false });
      camera.applyPan(10, 0);
      expect(camera.target.x).toBe(0);
      expect(camera.target.z).toBe(0);
    });

    it('applyPan moves target on +X for positive dx at azimuth=0 (drag world right)', () => {
      camera.setAzimuth(0);
      camera.setZoom(1);
      camera.setTarget(0, 0, 0);
      camera.applyPan(100, 0);
      // Drag-world feel: cursor right → world right → target moves -X.
      expect(camera.target.x).toBeLessThan(0);
      expect(Math.abs(camera.target.z)).toBeLessThan(1e-9);
    });

    it('applyPan moves target on +Z for positive dy at azimuth=0 (drag world down)', () => {
      camera.setAzimuth(0);
      camera.setZoom(1);
      camera.setTarget(0, 0, 0);
      camera.applyPan(0, 100);
      expect(camera.target.z).toBeLessThan(0);
      expect(Math.abs(camera.target.x)).toBeLessThan(1e-9);
    });

    it('applyPan rotates with azimuth=90 so dx pans along Z', () => {
      camera.setAzimuth(90);
      camera.setZoom(1);
      camera.setTarget(0, 0, 0);
      camera.applyPan(100, 0);
      // At az=90 camera-right is -Z world; drag-world-right means target moves +Z.
      expect(camera.target.z).toBeGreaterThan(0);
      expect(Math.abs(camera.target.x)).toBeLessThan(1e-9);
    });

    it('applyPan scales with distance (farther zoom → larger pan per pixel)', () => {
      camera.setAzimuth(0);
      camera.setTarget(0, 0, 0);
      camera.setZoom(1);
      camera.applyPan(100, 0);
      const closeDelta = Math.abs(camera.target.x);

      camera.setTarget(0, 0, 0);
      camera.setZoom(5);
      camera.applyPan(100, 0);
      const farDelta = Math.abs(camera.target.x);

      expect(farDelta).toBeCloseTo(closeDelta * 5, 5);
    });

    it('setControls({ pannable: false }) cancels an in-progress pan', () => {
      // simulate the start of a pan
      (camera as any)._isPanning = true;
      camera.setControls({ pannable: false });
      expect((camera as any)._isPanning).toBe(false);
    });
  });
});
