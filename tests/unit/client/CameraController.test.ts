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
});
