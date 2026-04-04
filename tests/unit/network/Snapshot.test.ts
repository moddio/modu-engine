import { describe, it, expect } from 'vitest';
import { WorldSnapshot } from '../../../engine/core/network/Snapshot';

describe('WorldSnapshot', () => {
  it('creates with tick', () => {
    const snap = new WorldSnapshot(42);
    expect(snap.tick).toBe(42);
    expect(snap.entityCount).toBe(0);
  });

  it('set and get entity', () => {
    const snap = new WorldSnapshot(1);
    snap.setEntity('e1', { id: 'e1', category: 'unit', x: 10, y: 20, z: 0, angle: 0 });
    const e = snap.getEntity('e1');
    expect(e?.x).toBe(10);
  });

  it('remove entity', () => {
    const snap = new WorldSnapshot(1);
    snap.setEntity('e1', { id: 'e1', category: 'unit', x: 0, y: 0, z: 0, angle: 0 });
    snap.removeEntity('e1');
    expect(snap.getEntity('e1')).toBeUndefined();
  });

  it('clone creates independent copy', () => {
    const snap = new WorldSnapshot(1);
    snap.setEntity('e1', { id: 'e1', category: 'unit', x: 10, y: 0, z: 0, angle: 0 });
    const clone = snap.clone();
    clone.setEntity('e1', { id: 'e1', category: 'unit', x: 99, y: 0, z: 0, angle: 0 });
    expect(snap.getEntity('e1')?.x).toBe(10); // Original unchanged
    expect(clone.getEntity('e1')?.x).toBe(99);
  });
});
