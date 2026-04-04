import { describe, it, expect } from 'vitest';
import { Polygon } from '../../../engine/core/math/Polygon';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Polygon', () => {
  function makeSquare(): Polygon {
    return new Polygon([new Vec2(0,0), new Vec2(10,0), new Vec2(10,10), new Vec2(0,10)]);
  }

  describe('construction', () => {
    it('stores vertices', () => { expect(makeSquare().vertices.length).toBe(4); });
    it('creates empty polygon', () => { expect(new Polygon().vertices.length).toBe(0); });
  });

  describe('addVertex', () => {
    it('appends vertex', () => {
      const p = new Polygon();
      p.addVertex(new Vec2(1,2));
      p.addVertex(new Vec2(3,4));
      expect(p.vertices.length).toBe(2);
      expect(p.vertices[0].x).toBe(1);
    });
  });

  describe('containsPoint', () => {
    it('true for inside', () => { expect(makeSquare().containsPoint(new Vec2(5,5))).toBe(true); });
    it('false for outside', () => { expect(makeSquare().containsPoint(new Vec2(15,5))).toBe(false); });
    it('works with concave polygon', () => {
      const p = new Polygon([new Vec2(0,0), new Vec2(10,0), new Vec2(10,5), new Vec2(5,5), new Vec2(5,10), new Vec2(0,10)]);
      expect(p.containsPoint(new Vec2(2,2))).toBe(true);
      expect(p.containsPoint(new Vec2(7,7))).toBe(false);
      expect(p.containsPoint(new Vec2(7,2))).toBe(true);
    });
  });

  describe('aabb', () => {
    it('returns bounding rect', () => {
      const p = new Polygon([new Vec2(2,3), new Vec2(8,1), new Vec2(5,9)]);
      const bb = p.aabb();
      expect(bb.x).toBe(2); expect(bb.y).toBe(1); expect(bb.width).toBe(6); expect(bb.height).toBe(8);
    });
    it('returns zero rect for empty', () => {
      const bb = new Polygon().aabb();
      expect(bb.width).toBe(0); expect(bb.height).toBe(0);
    });
  });

  describe('clone', () => {
    it('returns independent copy', () => {
      const a = makeSquare(); const b = a.clone();
      expect(b.vertices.length).toBe(4);
      expect(b).not.toBe(a);
      expect(b.vertices[0]).not.toBe(a.vertices[0]);
    });
  });

  describe('vertexCount', () => {
    it('returns count', () => {
      expect(makeSquare().vertexCount()).toBe(4);
      expect(new Polygon().vertexCount()).toBe(0);
    });
  });
});
