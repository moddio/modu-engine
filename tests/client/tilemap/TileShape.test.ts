import { describe, it, expect } from 'vitest';
import { TileShape } from '../../../engine/client/renderer/tilemap/TileShape';

describe('TileShape.calcSample', () => {
  it('returns empty sample for empty input', () => {
    const ts = new TileShape();
    const r = ts.calcSample({}, { x: 3, y: 3 }, 'rectangle');
    expect(Object.keys(r.sample).length).toBe(0);
    expect(r.xLength).toBe(0);
    expect(r.yLength).toBe(0);
  });

  it('tiles a single source across a rectangle brush', () => {
    const ts = new TileShape();
    const src = { 5: { 7: 42 } };
    const r = ts.calcSample(src, { x: 3, y: 2 }, 'rectangle');
    // All 6 cells of the brush get gid 42 (single-tile source tiled)
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 2; y++) {
        expect(r.sample[x]?.[y]).toBe(42);
      }
    }
  });

  it('fitContent returns the bounding box re-anchored at (0,0)', () => {
    const ts = new TileShape();
    const src = { 10: { 20: 1, 21: 2 }, 11: { 20: 3 } };
    const r = ts.calcSample(src, 'fitContent', 'rectangle');
    expect(r.minX).toBe(10);
    expect(r.minY).toBe(20);
    expect(r.xLength).toBe(2);
    expect(r.yLength).toBe(2);
    expect(r.sample[0]?.[0]).toBe(1);
    expect(r.sample[0]?.[1]).toBe(2);
    expect(r.sample[1]?.[0]).toBe(3);
  });
});
