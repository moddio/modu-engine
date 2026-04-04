import { describe, it, expect } from 'vitest';
import { Predictor } from '../../../engine/client/network/Predictor';

describe('Predictor', () => {
  it('predicts movement from input', () => {
    const p = new Predictor();
    const state = p.predict({ tick: 1, moveX: 1, moveY: 0, angle: 0, speed: 100 }, 1000);
    expect(state.x).toBeCloseTo(100);
    expect(state.y).toBeCloseTo(0);
    expect(state.tick).toBe(1);
  });

  it('accumulates over multiple predictions', () => {
    const p = new Predictor();
    p.predict({ tick: 1, moveX: 1, moveY: 0, angle: 0, speed: 100 }, 1000);
    const s2 = p.predict({ tick: 2, moveX: 1, moveY: 0, angle: 0, speed: 100 }, 1000);
    expect(s2.x).toBeCloseTo(200);
  });

  it('getState by tick', () => {
    const p = new Predictor();
    p.predict({ tick: 5, moveX: 0, moveY: 1, angle: 0, speed: 50 }, 1000);
    expect(p.getState(5)?.y).toBeCloseTo(50);
    expect(p.getState(99)).toBeUndefined();
  });

  it('latestState', () => {
    const p = new Predictor();
    p.predict({ tick: 1, moveX: 0, moveY: 0, angle: 1.5, speed: 0 }, 16);
    expect(p.latestState?.angle).toBeCloseTo(1.5);
  });

  it('respects maxHistory', () => {
    const p = new Predictor(3);
    for (let i = 1; i <= 5; i++) p.predict({ tick: i, moveX: 0, moveY: 0, angle: 0, speed: 0 }, 16);
    expect(p.historySize).toBe(3);
    expect(p.getState(1)).toBeUndefined();
    expect(p.getState(3)).toBeDefined();
  });

  it('clearBefore removes old states', () => {
    const p = new Predictor();
    for (let i = 1; i <= 5; i++) p.predict({ tick: i, moveX: 0, moveY: 0, angle: 0, speed: 0 }, 16);
    p.clearBefore(3);
    expect(p.getState(2)).toBeUndefined();
    expect(p.getState(3)).toBeDefined();
  });

  it('reset clears all', () => {
    const p = new Predictor();
    p.predict({ tick: 1, moveX: 0, moveY: 0, angle: 0, speed: 0 }, 16);
    p.reset();
    expect(p.historySize).toBe(0);
  });
});
