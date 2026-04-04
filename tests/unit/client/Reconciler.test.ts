import { describe, it, expect } from 'vitest';
import { Reconciler } from '../../../engine/client/network/Reconciler';

describe('Reconciler', () => {
  it('no correction when prediction matches server', () => {
    const r = new Reconciler(0.1);
    const result = r.reconcile(
      { tick: 5, x: 100, y: 200, angle: 0 },
      { tick: 5, x: 100, y: 200, angle: 0 },
      100, 200,
    );
    expect(result.corrected).toBe(false);
  });

  it('corrects when prediction diverges', () => {
    const r = new Reconciler(0.1, 0.5);
    const result = r.reconcile(
      { tick: 5, x: 110, y: 200, angle: 0 },
      { tick: 5, x: 100, y: 200, angle: 0 },
      100, 200,
    );
    expect(result.corrected).toBe(true);
    expect(result.errorX).toBeCloseTo(10);
    expect(result.correctedX).toBeCloseTo(105); // smoothed
  });

  it('snaps to server if no predicted state', () => {
    const r = new Reconciler();
    const result = r.reconcile(
      { tick: 5, x: 50, y: 60, angle: 0 },
      undefined,
      0, 0,
    );
    expect(result.corrected).toBe(true);
    expect(result.correctedX).toBe(50);
    expect(result.correctedY).toBe(60);
  });

  it('ignores small errors below threshold', () => {
    const r = new Reconciler(1.0);
    const result = r.reconcile(
      { tick: 1, x: 100.05, y: 200, angle: 0 },
      { tick: 1, x: 100, y: 200, angle: 0 },
      100, 200,
    );
    expect(result.corrected).toBe(false);
  });
});
