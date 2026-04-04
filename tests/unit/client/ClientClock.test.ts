import { describe, it, expect } from 'vitest';
import { ClientClock } from '../../../engine/client/network/ClientClock';

describe('ClientClock', () => {
  it('starts at tick 0', () => {
    const clock = new ClientClock();
    expect(clock.clientTick).toBe(0);
    expect(clock.serverTick).toBe(0);
  });

  it('step increments clientTick', () => {
    const clock = new ClientClock();
    clock.step();
    clock.step();
    expect(clock.clientTick).toBe(2);
  });

  it('interpolationTick is behind clientTick', () => {
    const clock = new ClientClock();
    clock.step(); clock.step(); clock.step(); clock.step(); clock.step();
    expect(clock.interpolationTick).toBe(3); // 5 - 2
  });

  it('recordPong updates RTT', () => {
    const clock = new ClientClock();
    const sendTime = Date.now() - 50; // Simulate 50ms ago
    clock.recordPong(sendTime, 100);
    expect(clock.rtt).toBeGreaterThan(0);
    expect(clock.serverTick).toBe(100);
  });
});
