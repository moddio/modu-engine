import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Clock } from '../../../engine/core/time/Clock';

describe('Clock', () => {
  let clock: Clock;
  beforeEach(() => { clock = new Clock(60); });

  describe('construction', () => {
    it('initializes with tick rate', () => { expect(clock.tickRate).toBe(60); });
    it('starts at time 0', () => { expect(clock.elapsed).toBe(0); });
    it('starts with 0 delta', () => { expect(clock.dt).toBe(0); });
    it('starts at tick 0', () => { expect(clock.tick).toBe(0); });
  });

  describe('step', () => {
    it('advances elapsed time', () => { clock.step(16.67); expect(clock.elapsed).toBeCloseTo(16.67); });
    it('sets delta time', () => { clock.step(16.67); expect(clock.dt).toBeCloseTo(16.67); });
    it('increments tick counter', () => { clock.step(16.67); expect(clock.tick).toBe(1); });
    it('accumulates', () => { clock.step(10); clock.step(20); expect(clock.elapsed).toBeCloseTo(30); expect(clock.dt).toBeCloseTo(20); expect(clock.tick).toBe(2); });
  });

  describe('timers', () => {
    it('fires after delay', () => { const fn = vi.fn(); clock.addTimer('t', 100, fn); clock.step(50); expect(fn).not.toHaveBeenCalled(); clock.step(60); expect(fn).toHaveBeenCalledOnce(); });
    it('auto-removes one-shot', () => { const fn = vi.fn(); clock.addTimer('t', 100, fn); clock.step(110); fn.mockClear(); clock.step(110); expect(fn).not.toHaveBeenCalled(); });
    it('removeTimer prevents callback', () => { const fn = vi.fn(); clock.addTimer('t', 100, fn); clock.removeTimer('t'); clock.step(200); expect(fn).not.toHaveBeenCalled(); });
  });

  describe('intervals', () => {
    it('fires repeatedly', () => { const fn = vi.fn(); clock.addInterval('t', 100, fn); clock.step(100); expect(fn).toHaveBeenCalledTimes(1); clock.step(100); expect(fn).toHaveBeenCalledTimes(2); clock.step(100); expect(fn).toHaveBeenCalledTimes(3); });
    it('removeInterval stops', () => { const fn = vi.fn(); clock.addInterval('t', 100, fn); clock.step(100); expect(fn).toHaveBeenCalledTimes(1); clock.removeInterval('t'); clock.step(100); expect(fn).toHaveBeenCalledTimes(1); });
  });

  describe('targetDt', () => {
    it('computes from tick rate', () => { expect(clock.targetDt).toBeCloseTo(1000/60); });
    it('updates when tick rate changes', () => { clock.tickRate = 30; expect(clock.targetDt).toBeCloseTo(1000/30); });
  });
});
