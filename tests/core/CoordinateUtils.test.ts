import { describe, it, expect } from 'vitest';
import { CoordinateUtils } from '../../engine/core/CoordinateUtils';

describe('CoordinateUtils', () => {
  describe('pixelToWorld', () => {
    it('converts pixels to world units at 64px ratio', () => {
      expect(CoordinateUtils.pixelToWorld(64)).toBe(1);
      expect(CoordinateUtils.pixelToWorld(128)).toBe(2);
      expect(CoordinateUtils.pixelToWorld(0)).toBe(0);
      expect(CoordinateUtils.pixelToWorld(32)).toBe(0.5);
    });
  });

  describe('worldToPixel', () => {
    it('converts world units to pixels', () => {
      expect(CoordinateUtils.worldToPixel(1)).toBe(64);
      expect(CoordinateUtils.worldToPixel(2)).toBe(128);
      expect(CoordinateUtils.worldToPixel(0.5)).toBe(32);
    });
  });

  describe('taroToThree', () => {
    it('maps taro XY to Three.js XYZ (Y becomes Z, layer becomes Y)', () => {
      const result = CoordinateUtils.taroToThree(640, 320, 0);
      expect(result.x).toBe(10);
      expect(result.y).toBe(-1);
      expect(result.z).toBe(5);
    });

    it('applies layer offset to Y axis', () => {
      const result = CoordinateUtils.taroToThree(0, 0, 2);
      expect(result.y).toBe(1);
    });
  });

  describe('threeToTaro', () => {
    it('maps Three.js XYZ back to taro XY', () => {
      const result = CoordinateUtils.threeToTaro(10, 0, 5);
      expect(result.x).toBe(640);
      expect(result.y).toBe(320);
    });
  });

  describe('getLayerZOffset', () => {
    it('returns layer - 1 for layer offset', () => {
      expect(CoordinateUtils.getLayerZOffset(0)).toBe(-1);
      expect(CoordinateUtils.getLayerZOffset(1)).toBe(0);
      expect(CoordinateUtils.getLayerZOffset(3)).toBe(2);
    });
  });

  describe('getDepthZOffset', () => {
    it('returns depth * 0.001 for within-layer sorting', () => {
      expect(CoordinateUtils.getDepthZOffset(0)).toBe(0);
      expect(CoordinateUtils.getDepthZOffset(100)).toBeCloseTo(0.1);
      expect(CoordinateUtils.getDepthZOffset(500)).toBeCloseTo(0.5);
    });
  });

  describe('SCALE_RATIO', () => {
    it('is 64', () => {
      expect(CoordinateUtils.SCALE_RATIO).toBe(64);
    });
  });
});
