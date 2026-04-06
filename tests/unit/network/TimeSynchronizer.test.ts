import { describe, it, expect } from 'vitest';
import { TimeSynchronizer } from '../../../engine/core/network/TimeSynchronizer';

describe('TimeSynchronizer', () => {
  it('computes RTT from a single sample', () => {
    const sync = new TimeSynchronizer();
    // client sends at 100, server time is 200, client receives at 120
    // RTT = 120 - 100 = 20
    sync.addSample(100, 200, 120);
    expect(sync.rtt).toBe(20);
  });

  it('computes offset from a single sample', () => {
    const sync = new TimeSynchronizer();
    // client sends at 100, server time is 200, client receives at 120
    // halfRtt = 10, offset = 200 - (100 + 10) = 90
    const offset = sync.addSample(100, 200, 120);
    expect(offset).toBe(90);
    expect(sync.offset).toBe(90);
  });

  it('uses median of samples for offset', () => {
    const sync = new TimeSynchronizer(5);

    // Add three samples with different offsets
    // Sample 1: offset = 200 - (100 + 10) = 90
    sync.addSample(100, 200, 120);
    // Sample 2: offset = 300 - (200 + 15) = 85
    sync.addSample(200, 300, 230);
    // Sample 3: offset = 400 - (300 + 5) = 95
    sync.addSample(300, 400, 310);

    // Sorted offsets: [85, 90, 95], median index = floor(3/2) = 1 => 90
    expect(sync.offset).toBe(90);
    expect(sync.sampleCount).toBe(3);
  });

  it('handles even number of samples (uses lower-median)', () => {
    const sync = new TimeSynchronizer(5);

    // offset = 90
    sync.addSample(100, 200, 120);
    // offset = 85
    sync.addSample(200, 300, 230);
    // offset = 95
    sync.addSample(300, 400, 310);
    // offset = 80
    sync.addSample(400, 490, 420);

    // Sorted offsets: [80, 85, 90, 95], median index = floor(4/2) = 2 => 90
    expect(sync.offset).toBe(90);
    expect(sync.sampleCount).toBe(4);
  });

  it('evicts oldest sample when maxSamples exceeded', () => {
    const sync = new TimeSynchronizer(3);

    sync.addSample(100, 200, 120); // offset 90
    sync.addSample(200, 300, 230); // offset 85
    sync.addSample(300, 400, 310); // offset 95
    expect(sync.sampleCount).toBe(3);

    // Adding 4th sample evicts 1st (90)
    sync.addSample(400, 490, 420); // offset 80
    expect(sync.sampleCount).toBe(3);

    // Samples: [85, 95, 80], sorted: [80, 85, 95], median index=1 => 85
    expect(sync.offset).toBe(85);
  });

  it('toServerTime converts local to server time', () => {
    const sync = new TimeSynchronizer();
    sync.addSample(100, 200, 120); // offset = 90
    // serverTime = localTime + offset = 500 + 90 = 590
    expect(sync.toServerTime(500)).toBe(590);
  });

  it('toLocalTime converts server to local time', () => {
    const sync = new TimeSynchronizer();
    sync.addSample(100, 200, 120); // offset = 90
    // localTime = serverTime - offset = 590 - 90 = 500
    expect(sync.toLocalTime(590)).toBe(500);
  });

  it('toServerTime and toLocalTime are inverse operations', () => {
    const sync = new TimeSynchronizer();
    sync.addSample(100, 200, 120);
    const local = 1000;
    expect(sync.toLocalTime(sync.toServerTime(local))).toBe(local);
  });

  it('reset clears all state', () => {
    const sync = new TimeSynchronizer();
    sync.addSample(100, 200, 120);
    expect(sync.sampleCount).toBe(1);
    expect(sync.offset).not.toBe(0);

    sync.reset();
    expect(sync.sampleCount).toBe(0);
    expect(sync.offset).toBe(0);
    expect(sync.rtt).toBe(0);
  });
});
