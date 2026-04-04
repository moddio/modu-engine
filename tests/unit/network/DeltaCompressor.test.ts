import { describe, it, expect } from 'vitest';
import { DeltaCompressor } from '../../../engine/core/network/DeltaCompressor';

describe('DeltaCompressor', () => {
  it('returns null for identical objects', () => {
    const obj = { x: 1, y: 2 };
    expect(DeltaCompressor.diff(obj, { ...obj })).toBeNull();
  });

  it('detects changed values', () => {
    const prev = { x: 1, y: 2, z: 3 };
    const curr = { x: 1, y: 5, z: 3 };
    const delta = DeltaCompressor.diff(prev, curr);
    expect(delta).toEqual({ y: 5 });
  });

  it('detects added keys', () => {
    const prev = { x: 1 };
    const curr = { x: 1, y: 2 };
    const delta = DeltaCompressor.diff(prev, curr);
    expect(delta).toEqual({ y: 2 });
  });

  it('detects removed keys', () => {
    const prev = { x: 1, y: 2 };
    const curr = { x: 1 };
    const delta = DeltaCompressor.diff(prev, curr);
    expect(delta).toEqual({ y: undefined });
  });

  it('apply merges delta onto base', () => {
    const base = { x: 1, y: 2, z: 3 };
    const delta = { y: 10, w: 4 };
    const result = DeltaCompressor.apply(base, delta);
    expect(result).toEqual({ x: 1, y: 10, z: 3, w: 4 });
  });

  it('apply removes undefined keys', () => {
    const base = { x: 1, y: 2 };
    const delta = { y: undefined };
    const result = DeltaCompressor.apply(base, delta as any);
    expect('y' in result).toBe(false);
  });
});
