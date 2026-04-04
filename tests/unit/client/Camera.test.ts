import { describe, it, expect } from 'vitest';
import { Camera } from '../../../engine/client/renderer/Camera';

describe('Camera', () => {
  it('defaults', () => {
    const cam = new Camera();
    expect(cam.position.z).toBe(10);
    expect(cam.zoom).toBe(1);
  });

  it('lookAt sets target', () => {
    const cam = new Camera();
    cam.lookAt(5, 10, 0);
    expect(cam.target.x).toBe(5);
    expect(cam.target.y).toBe(10);
  });

  it('setZoom clamps', () => {
    const cam = new Camera();
    cam.setZoom(0.01);
    expect(cam.zoom).toBe(0.1);
    cam.setZoom(100);
    expect(cam.zoom).toBe(10);
  });
});
