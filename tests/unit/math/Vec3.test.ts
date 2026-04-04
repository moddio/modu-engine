import { describe, it, expect } from 'vitest';
import { Vec3 } from '../../../engine/core/math/Vec3';

describe('Vec3', () => {
  describe('construction', () => {
    it('defaults to (0, 0, 0)', () => {
      const v = new Vec3();
      expect(v.x).toBe(0); expect(v.y).toBe(0); expect(v.z).toBe(0);
    });
    it('accepts x, y, z', () => {
      const v = new Vec3(1, 2, 3);
      expect(v.x).toBe(1); expect(v.y).toBe(2); expect(v.z).toBe(3);
    });
  });

  describe('arithmetic (immutable)', () => {
    it('add returns new vector', () => {
      const c = new Vec3(1, 2, 3).add(new Vec3(4, 5, 6));
      expect(c.x).toBe(5); expect(c.y).toBe(7); expect(c.z).toBe(9);
    });
    it('sub returns new vector', () => {
      const c = new Vec3(5, 7, 9).sub(new Vec3(1, 2, 3));
      expect(c.x).toBe(4); expect(c.y).toBe(5); expect(c.z).toBe(6);
    });
    it('mul scalar', () => {
      const r = new Vec3(1, 2, 3).mul(2);
      expect(r.x).toBe(2); expect(r.y).toBe(4); expect(r.z).toBe(6);
    });
    it('mul per-axis', () => {
      const r = new Vec3(1, 2, 3).mul(new Vec3(2, 3, 4));
      expect(r.x).toBe(2); expect(r.y).toBe(6); expect(r.z).toBe(12);
    });
    it('div scalar', () => {
      const r = new Vec3(2, 4, 6).div(2);
      expect(r.x).toBe(1); expect(r.y).toBe(2); expect(r.z).toBe(3);
    });
    it('div per-axis', () => {
      const r = new Vec3(6, 8, 10).div(new Vec3(2, 4, 5));
      expect(r.x).toBe(3); expect(r.y).toBe(2); expect(r.z).toBe(2);
    });
  });

  describe('operations', () => {
    it('length', () => { expect(new Vec3(2, 3, 6).length()).toBe(7); });
    it('lengthSquared', () => { expect(new Vec3(2, 3, 6).lengthSquared()).toBe(49); });
    it('normalize', () => {
      const v = new Vec3(0, 0, 5).normalize();
      expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(0); expect(v.z).toBeCloseTo(1);
    });
    it('normalize zero returns zero', () => {
      const v = new Vec3(0, 0, 0).normalize();
      expect(v.x).toBe(0); expect(v.y).toBe(0); expect(v.z).toBe(0);
    });
    it('dot product', () => { expect(new Vec3(1, 2, 3).dot(new Vec3(4, 5, 6))).toBe(32); });
    it('cross product', () => {
      const c = new Vec3(1, 0, 0).cross(new Vec3(0, 1, 0));
      expect(c.x).toBe(0); expect(c.y).toBe(0); expect(c.z).toBe(1);
    });
    it('distanceTo', () => { expect(new Vec3(0, 0, 0).distanceTo(new Vec3(2, 3, 6))).toBe(7); });
    it('lerp', () => {
      const r = new Vec3(0, 0, 0).lerp(new Vec3(10, 20, 30), 0.5);
      expect(r.x).toBe(5); expect(r.y).toBe(10); expect(r.z).toBe(15);
    });
    it('rotateZ', () => {
      const r = new Vec3(1, 0, 5).rotateZ(Math.PI / 2);
      expect(r.x).toBeCloseTo(0); expect(r.y).toBeCloseTo(1); expect(r.z).toBe(5);
    });
    it('clone', () => {
      const a = new Vec3(1, 2, 3); const b = a.clone();
      expect(b.equals(a)).toBe(true); expect(b).not.toBe(a);
    });
    it('equals', () => {
      expect(new Vec3(1, 2, 3).equals(new Vec3(1, 2, 3))).toBe(true);
      expect(new Vec3(1, 2, 3).equals(new Vec3(1, 2, 4))).toBe(false);
    });
  });

  describe('mutation', () => {
    it('set', () => { const v = new Vec3(); v.set(1, 2, 3); expect(v.x).toBe(1); expect(v.y).toBe(2); expect(v.z).toBe(3); });
    it('copy', () => { const a = new Vec3(); a.copy(new Vec3(4, 5, 6)); expect(a.x).toBe(4); expect(a.y).toBe(5); expect(a.z).toBe(6); });
  });

  describe('static factories', () => {
    it('Vec3.zero()', () => { expect(Vec3.zero().equals(new Vec3(0, 0, 0))).toBe(true); });
    it('Vec3.one()', () => { expect(Vec3.one().equals(new Vec3(1, 1, 1))).toBe(true); });
    it('Vec3.up()', () => { expect(Vec3.up().equals(new Vec3(0, 1, 0))).toBe(true); });
  });

  describe('toString', () => {
    it('formats', () => { expect(new Vec3(1.5, 2.5, 3.5).toString()).toBe('(1.50, 2.50, 3.50)'); });
  });
});
