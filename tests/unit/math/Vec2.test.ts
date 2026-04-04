import { describe, it, expect } from 'vitest';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Vec2', () => {
  describe('construction', () => {
    it('defaults to (0, 0)', () => {
      const v = new Vec2();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });
    it('accepts x and y', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('arithmetic (immutable)', () => {
    it('add returns new vector', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.add(b);
      expect(c.x).toBe(4);
      expect(c.y).toBe(6);
      expect(a.x).toBe(1);
    });
    it('sub returns new vector', () => {
      const c = new Vec2(5, 7).sub(new Vec2(2, 3));
      expect(c.x).toBe(3);
      expect(c.y).toBe(4);
    });
    it('mul returns new vector (scalar)', () => {
      const r = new Vec2(3, 4).mul(2);
      expect(r.x).toBe(6);
      expect(r.y).toBe(8);
    });
    it('mul returns new vector (per-axis)', () => {
      const r = new Vec2(3, 4).mul(new Vec2(2, 3));
      expect(r.x).toBe(6);
      expect(r.y).toBe(12);
    });
    it('div returns new vector (scalar)', () => {
      const r = new Vec2(6, 8).div(2);
      expect(r.x).toBe(3);
      expect(r.y).toBe(4);
    });
    it('div returns new vector (per-axis)', () => {
      const r = new Vec2(6, 8).div(new Vec2(2, 4));
      expect(r.x).toBe(3);
      expect(r.y).toBe(2);
    });
  });

  describe('operations', () => {
    it('length computes magnitude', () => { expect(new Vec2(3, 4).length()).toBe(5); });
    it('lengthSquared avoids sqrt', () => { expect(new Vec2(3, 4).lengthSquared()).toBe(25); });
    it('normalize returns unit vector', () => {
      const v = new Vec2(3, 4).normalize();
      expect(v.x).toBeCloseTo(0.6);
      expect(v.y).toBeCloseTo(0.8);
      expect(v.length()).toBeCloseTo(1);
    });
    it('normalize zero vector returns zero', () => {
      const v = new Vec2(0, 0).normalize();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });
    it('dot product', () => { expect(new Vec2(1, 2).dot(new Vec2(3, 4))).toBe(11); });
    it('cross product (2D scalar)', () => { expect(new Vec2(1, 0).cross(new Vec2(0, 1))).toBe(1); });
    it('distance between two vectors', () => { expect(new Vec2(0, 0).distanceTo(new Vec2(3, 4))).toBe(5); });
    it('rotate by radians', () => {
      const r = new Vec2(1, 0).rotate(Math.PI / 2);
      expect(r.x).toBeCloseTo(0);
      expect(r.y).toBeCloseTo(1);
    });
    it('lerp interpolates', () => {
      const r = new Vec2(0, 0).lerp(new Vec2(10, 20), 0.5);
      expect(r.x).toBe(5);
      expect(r.y).toBe(10);
    });
    it('clone returns independent copy', () => {
      const a = new Vec2(1, 2);
      const b = a.clone();
      expect(b.x).toBe(1);
      expect(b).not.toBe(a);
    });
    it('equals compares values', () => {
      expect(new Vec2(1, 2).equals(new Vec2(1, 2))).toBe(true);
      expect(new Vec2(1, 2).equals(new Vec2(1, 3))).toBe(false);
    });
  });

  describe('mutation', () => {
    it('set mutates in place', () => {
      const v = new Vec2(1, 2);
      v.set(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
    it('copy mutates from another vec', () => {
      const a = new Vec2(1, 2);
      a.copy(new Vec2(3, 4));
      expect(a.x).toBe(3);
      expect(a.y).toBe(4);
    });
  });

  describe('toString', () => {
    it('formats with default precision', () => {
      expect(new Vec2(1.23456, 7.89012).toString()).toBe('(1.23, 7.89)');
    });
  });

  describe('static factories', () => {
    it('Vec2.zero()', () => { const v = Vec2.zero(); expect(v.x).toBe(0); expect(v.y).toBe(0); });
    it('Vec2.one()', () => { const v = Vec2.one(); expect(v.x).toBe(1); expect(v.y).toBe(1); });
  });
});
