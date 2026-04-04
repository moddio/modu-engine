import { describe, it, expect } from 'vitest';
import { Rect } from '../../../engine/core/math/Rect';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Rect', () => {
  describe('construction', () => {
    it('defaults to zero', () => {
      const r = new Rect();
      expect(r.x).toBe(0); expect(r.y).toBe(0); expect(r.width).toBe(0); expect(r.height).toBe(0);
    });
    it('accepts x, y, width, height', () => {
      const r = new Rect(1, 2, 3, 4);
      expect(r.x).toBe(1); expect(r.y).toBe(2); expect(r.width).toBe(3); expect(r.height).toBe(4);
    });
  });

  describe('containsPoint', () => {
    it('returns true for point inside', () => { expect(new Rect(0,0,10,10).containsPoint(new Vec2(5,5))).toBe(true); });
    it('returns false for point outside', () => { expect(new Rect(0,0,10,10).containsPoint(new Vec2(15,5))).toBe(false); });
    it('returns true for point on edge', () => {
      expect(new Rect(0,0,10,10).containsPoint(new Vec2(0,0))).toBe(true);
      expect(new Rect(0,0,10,10).containsPoint(new Vec2(10,10))).toBe(true);
    });
  });

  describe('containsXY', () => {
    it('checks raw coordinates', () => {
      expect(new Rect(5,5,10,10).containsXY(10,10)).toBe(true);
      expect(new Rect(5,5,10,10).containsXY(0,0)).toBe(false);
    });
  });

  describe('intersects', () => {
    it('true for overlapping', () => { expect(new Rect(0,0,10,10).intersects(new Rect(5,5,10,10))).toBe(true); });
    it('false for non-overlapping', () => { expect(new Rect(0,0,10,10).intersects(new Rect(20,20,10,10))).toBe(false); });
    it('true for touching', () => { expect(new Rect(0,0,10,10).intersects(new Rect(10,0,10,10))).toBe(true); });
  });

  describe('combine', () => {
    it('returns bounding rect', () => {
      const c = new Rect(0,0,10,10).combine(new Rect(5,5,20,20));
      expect(c.x).toBe(0); expect(c.y).toBe(0); expect(c.width).toBe(25); expect(c.height).toBe(25);
    });
  });

  describe('clone', () => {
    it('returns independent copy', () => {
      const a = new Rect(1,2,3,4); const b = a.clone();
      expect(b.x).toBe(1); expect(b.width).toBe(3); expect(b).not.toBe(a);
    });
  });

  describe('equals', () => {
    it('compares all fields', () => {
      expect(new Rect(1,2,3,4).equals(new Rect(1,2,3,4))).toBe(true);
      expect(new Rect(1,2,3,4).equals(new Rect(1,2,3,5))).toBe(false);
    });
  });

  describe('toString', () => {
    it('formats rect', () => { expect(new Rect(1,2,3,4).toString()).toBe('Rect(1, 2, 3, 4)'); });
  });
});
