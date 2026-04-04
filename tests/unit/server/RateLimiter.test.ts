import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../../engine/server/network/RateLimiter';

describe('RateLimiter', () => {
  it('allows within limit', () => {
    const rl = new RateLimiter();
    rl.setRule('chat', { maxPerSecond: 3 });
    expect(rl.check('p1', 'chat')).toBe(true);
    expect(rl.check('p1', 'chat')).toBe(true);
    expect(rl.check('p1', 'chat')).toBe(true);
  });

  it('blocks over limit', () => {
    const rl = new RateLimiter();
    rl.setRule('pickup', { maxPerSecond: 2 });
    expect(rl.check('p1', 'pickup')).toBe(true);
    expect(rl.check('p1', 'pickup')).toBe(true);
    expect(rl.check('p1', 'pickup')).toBe(false);
  });

  it('different players have separate limits', () => {
    const rl = new RateLimiter();
    rl.setRule('chat', { maxPerSecond: 1 });
    expect(rl.check('p1', 'chat')).toBe(true);
    expect(rl.check('p2', 'chat')).toBe(true);
    expect(rl.check('p1', 'chat')).toBe(false);
  });

  it('allows if no rule defined', () => {
    const rl = new RateLimiter();
    expect(rl.check('p1', 'anything')).toBe(true);
  });

  it('different actions have separate limits', () => {
    const rl = new RateLimiter();
    rl.setRule('chat', { maxPerSecond: 1 });
    rl.setRule('move', { maxPerSecond: 60 });
    expect(rl.check('p1', 'chat')).toBe(true);
    expect(rl.check('p1', 'chat')).toBe(false);
    expect(rl.check('p1', 'move')).toBe(true);
  });
});
