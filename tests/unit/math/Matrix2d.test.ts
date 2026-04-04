import { describe, it, expect } from 'vitest';
import { Matrix2d } from '../../../engine/core/math/Matrix2d';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Matrix2d', () => {
  describe('construction', () => {
    it('defaults to identity', () => {
      const m = new Matrix2d();
      expect(m.values).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });
  });

  describe('identity', () => {
    it('resets to identity', () => {
      const m = new Matrix2d();
      m.translateBy(10, 20);
      m.identity();
      expect(m.values).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });
  });

  describe('translation', () => {
    it('translateBy applies translation', () => {
      const m = new Matrix2d();
      m.translateBy(10, 20);
      const p = m.transformPoint(new Vec2(0, 0));
      expect(p.x).toBeCloseTo(10);
      expect(p.y).toBeCloseTo(20);
    });
    it('translateTo sets translation directly', () => {
      const m = new Matrix2d();
      m.translateBy(100, 200);
      m.translateTo(5, 10);
      const p = m.transformPoint(new Vec2(0, 0));
      expect(p.x).toBeCloseTo(5);
      expect(p.y).toBeCloseTo(10);
    });
  });

  describe('rotation', () => {
    it('rotateBy rotates a point', () => {
      const m = new Matrix2d();
      m.rotateBy(Math.PI / 2);
      const p = m.transformPoint(new Vec2(1, 0));
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1);
    });
    it('rotateTo sets rotation directly', () => {
      const m = new Matrix2d();
      m.rotateTo(Math.PI / 2);
      const p = m.transformPoint(new Vec2(1, 0));
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1);
    });
  });

  describe('scaling', () => {
    it('scaleBy scales a point', () => {
      const m = new Matrix2d();
      m.scaleBy(2, 3);
      const p = m.transformPoint(new Vec2(4, 5));
      expect(p.x).toBeCloseTo(8);
      expect(p.y).toBeCloseTo(15);
    });
    it('scaleTo sets scale directly', () => {
      const m = new Matrix2d();
      m.scaleTo(2, 3);
      const p = m.transformPoint(new Vec2(4, 5));
      expect(p.x).toBeCloseTo(8);
      expect(p.y).toBeCloseTo(15);
    });
  });

  describe('multiply', () => {
    it('multiplies two matrices', () => {
      const a = new Matrix2d();
      a.translateBy(10, 0);
      const b = new Matrix2d();
      b.translateBy(0, 20);
      a.multiply(b);
      const p = a.transformPoint(new Vec2(0, 0));
      expect(p.x).toBeCloseTo(10);
      expect(p.y).toBeCloseTo(20);
    });
  });

  describe('inverse', () => {
    it('returns inverse matrix', () => {
      const m = new Matrix2d();
      m.translateBy(10, 20);
      m.rotateBy(Math.PI / 4);
      const inv = m.getInverse();
      expect(inv).not.toBeNull();
      const p = new Vec2(5, 7);
      const transformed = m.transformPoint(p);
      const back = inv!.transformPoint(transformed);
      expect(back.x).toBeCloseTo(5);
      expect(back.y).toBeCloseTo(7);
    });
    it('returns null for singular matrix', () => {
      const m = new Matrix2d();
      m.scaleTo(0, 0);
      expect(m.getInverse()).toBeNull();
    });
  });

  describe('copy and compare', () => {
    it('copy duplicates matrix', () => {
      const a = new Matrix2d();
      a.translateBy(5, 10);
      const b = new Matrix2d();
      b.copy(a);
      expect(b.values).toEqual(a.values);
    });
    it('compare checks equality', () => {
      const a = new Matrix2d();
      const b = new Matrix2d();
      expect(a.compare(b)).toBe(true);
      a.translateBy(1, 0);
      expect(a.compare(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('returns independent copy', () => {
      const a = new Matrix2d();
      a.translateBy(5, 10);
      const b = a.clone();
      expect(b.values).toEqual(a.values);
      expect(b).not.toBe(a);
    });
  });
});
