import { describe, it, expect } from 'vitest';
import { Sprite } from '../../engine/client/renderer/sprites/Sprite';
import { AnimatedSprite } from '../../engine/client/renderer/sprites/AnimatedSprite';

describe('Sprite billboard mode', () => {
  it('defaults billboard to false', () => {
    const sprite = new Sprite();
    expect(sprite.billboard).toBe(false);
  });

  it('can set billboard flag to true', () => {
    const sprite = new Sprite();
    sprite.billboard = true;
    expect(sprite.billboard).toBe(true);
  });

  it('faceCamera is a no-op when billboard is false', () => {
    const sprite = new Sprite();
    const mockCamera = { quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 } } as any;
    const origX = sprite.mesh.quaternion.x;
    const origY = sprite.mesh.quaternion.y;
    sprite.faceCamera(mockCamera);
    // Quaternion should not have changed
    expect(sprite.mesh.quaternion.x).toBe(origX);
    expect(sprite.mesh.quaternion.y).toBe(origY);
  });

  it('faceCamera copies camera quaternion when billboard is true', () => {
    const sprite = new Sprite();
    sprite.billboard = true;
    const mockCamera = { quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 } } as any;
    sprite.faceCamera(mockCamera);
    expect(sprite.mesh.quaternion.x).toBeCloseTo(0.1);
    expect(sprite.mesh.quaternion.y).toBeCloseTo(0.2);
    expect(sprite.mesh.quaternion.z).toBeCloseTo(0.3);
    expect(sprite.mesh.quaternion.w).toBeCloseTo(0.9);
  });
});

describe('AnimatedSprite billboard mode', () => {
  it('defaults billboard to false', () => {
    const sprite = new AnimatedSprite();
    expect(sprite.billboard).toBe(false);
  });

  it('can set billboard flag to true', () => {
    const sprite = new AnimatedSprite();
    sprite.billboard = true;
    expect(sprite.billboard).toBe(true);
  });

  it('faceCamera copies camera quaternion when billboard is true', () => {
    const sprite = new AnimatedSprite();
    sprite.billboard = true;
    const mockCamera = { quaternion: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 } } as any;
    sprite.faceCamera(mockCamera);
    expect(sprite.mesh.quaternion.x).toBeCloseTo(0.5);
    expect(sprite.mesh.quaternion.w).toBeCloseTo(0.5);
  });
});
