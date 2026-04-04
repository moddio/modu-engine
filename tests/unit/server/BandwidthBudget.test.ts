import { describe, it, expect } from 'vitest';
import { BandwidthBudget } from '../../../engine/server/network/BandwidthBudget';

describe('BandwidthBudget', () => {
  it('allows within budget', () => {
    const bb = new BandwidthBudget(1000);
    expect(bb.canSend('p1', 500)).toBe(true);
    bb.record('p1', 500);
    expect(bb.canSend('p1', 400)).toBe(true);
  });

  it('blocks over budget', () => {
    const bb = new BandwidthBudget(1000);
    bb.record('p1', 800);
    expect(bb.canSend('p1', 300)).toBe(false);
  });

  it('tracks per player', () => {
    const bb = new BandwidthBudget(1000);
    bb.record('p1', 900);
    expect(bb.canSend('p1', 200)).toBe(false);
    expect(bb.canSend('p2', 200)).toBe(true);
  });

  it('resetAll clears all budgets', () => {
    const bb = new BandwidthBudget(1000);
    bb.record('p1', 900);
    bb.resetAll();
    expect(bb.canSend('p1', 500)).toBe(true);
  });

  it('getUsed returns bytes used', () => {
    const bb = new BandwidthBudget(1000);
    bb.record('p1', 300);
    bb.record('p1', 200);
    expect(bb.getUsed('p1')).toBe(500);
    expect(bb.getUsed('p2')).toBe(0);
  });
});
