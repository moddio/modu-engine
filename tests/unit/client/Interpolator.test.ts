import { describe, it, expect } from 'vitest';
import { Interpolator } from '../../../engine/client/network/Interpolator';

describe('Interpolator', () => {
  it('interpolates position at midpoint', () => {
    const result = Interpolator.interpolate({
      prevX: 0, prevY: 0, prevAngle: 0,
      nextX: 10, nextY: 20, nextAngle: 0,
      prevTick: 0, nextTick: 10,
    }, 5);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(10);
  });

  it('returns next at or past nextTick', () => {
    const result = Interpolator.interpolate({
      prevX: 0, prevY: 0, prevAngle: 0,
      nextX: 10, nextY: 20, nextAngle: 0,
      prevTick: 0, nextTick: 10,
    }, 15);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
  });

  it('returns prev before prevTick', () => {
    const result = Interpolator.interpolate({
      prevX: 5, prevY: 5, prevAngle: 0,
      nextX: 10, nextY: 10, nextAngle: 0,
      prevTick: 10, nextTick: 20,
    }, 5);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(5);
  });

  it('interpolates angle through shortest path', () => {
    const result = Interpolator.interpolate({
      prevX: 0, prevY: 0, prevAngle: 3.0,
      nextX: 0, nextY: 0, nextAngle: -3.0,
      prevTick: 0, nextTick: 10,
    }, 5);
    // Should go through PI, not back through 0
    expect(Math.abs(result.angle)).toBeGreaterThan(2.5);
  });

  it('handles zero range', () => {
    const result = Interpolator.interpolate({
      prevX: 5, prevY: 5, prevAngle: 0,
      nextX: 10, nextY: 10, nextAngle: 0,
      prevTick: 5, nextTick: 5,
    }, 5);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
  });
});
