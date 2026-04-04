import { describe, it, expect } from 'vitest';
import { Map2d } from '../../../engine/core/map/Map2d';

describe('Map2d', () => {
  it('creates with dimensions', () => {
    const m = new Map2d(10, 5);
    expect(m.width).toBe(10);
    expect(m.height).toBe(5);
  });

  it('get/set values', () => {
    const m = new Map2d<number>(5, 5, 0);
    m.set(2, 3, 42);
    expect(m.get(2, 3)).toBe(42);
    expect(m.get(0, 0)).toBe(0);
  });

  it('returns undefined for out of bounds', () => {
    const m = new Map2d(5, 5);
    expect(m.get(-1, 0)).toBeUndefined();
    expect(m.get(5, 0)).toBeUndefined();
  });

  it('isInBounds', () => {
    const m = new Map2d(5, 5);
    expect(m.isInBounds(0, 0)).toBe(true);
    expect(m.isInBounds(4, 4)).toBe(true);
    expect(m.isInBounds(5, 0)).toBe(false);
    expect(m.isInBounds(-1, 0)).toBe(false);
  });

  it('fill sets all cells', () => {
    const m = new Map2d<number>(3, 3, 0);
    m.fill(99);
    expect(m.get(0, 0)).toBe(99);
    expect(m.get(2, 2)).toBe(99);
  });

  it('clear sets all to undefined', () => {
    const m = new Map2d<number>(3, 3, 5);
    m.clear();
    expect(m.get(0, 0)).toBeUndefined();
  });

  it('supports default value', () => {
    const m = new Map2d<string>(2, 2, 'empty');
    expect(m.get(0, 0)).toBe('empty');
  });
});
