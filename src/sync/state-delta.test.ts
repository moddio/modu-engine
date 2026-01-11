import { describe, test, expect, beforeEach } from 'vitest';
import {
  computeStateDelta,
  computeSnapshotHash,
  serializeDelta,
  deserializeDelta,
  getPartition,
  getEntityPartition,
  deserializePartition,
  assemblePartitions,
  isDeltaEmpty,
  getDeltaSize,
  StateDelta,
  CreatedEntity
} from './state-delta';
import { SparseSnapshot, EntityMeta } from '../core/snapshot';

// Helper to create mock snapshots for testing
function createMockSnapshot(
  entities: Array<{ eid: number; type: string; clientId?: number; data: Record<string, Record<string, number>> }>,
  frame: number = 0
): SparseSnapshot {
  const entityMeta: EntityMeta[] = entities.map(e => ({
    eid: e.eid,
    type: e.type,
    clientId: e.clientId
  }));

  // Note: For full tests with componentData, we would need to properly set up
  // the component registry. For unit tests, we focus on the delta logic itself.
  return {
    frame,
    seq: 0,
    entityMeta,
    componentData: new Map(),
    entityCount: entities.length,
    allocator: { nextIndex: entities.length, generations: [], freeList: [] },
    strings: { tables: {}, nextIds: {} }
  };
}

describe('computeStateDelta', () => {
  test('detects newly created entities', () => {
    const prev = createMockSnapshot([]);
    const curr = createMockSnapshot([
      { eid: 1, type: 'Player', data: {} }
    ], 1);

    const delta = computeStateDelta(prev, curr);

    expect(delta.created).toHaveLength(1);
    expect(delta.created[0].eid).toBe(1);
    expect(delta.created[0].type).toBe('Player');
    expect(delta.deleted).toHaveLength(0);
  });

  test('detects deleted entities', () => {
    const prev = createMockSnapshot([
      { eid: 1, type: 'Player', data: {} }
    ], 0);
    const curr = createMockSnapshot([], 1);

    const delta = computeStateDelta(prev, curr);

    expect(delta.created).toHaveLength(0);
    expect(delta.deleted).toHaveLength(1);
    expect(delta.deleted[0]).toBe(1);
  });

  test('handles simultaneous creates, updates, deletes', () => {
    const prev = createMockSnapshot([
      { eid: 1, type: 'Player', data: {} },
      { eid: 2, type: 'Enemy', data: {} }
    ], 0);

    const curr = createMockSnapshot([
      { eid: 1, type: 'Player', data: {} },
      { eid: 3, type: 'Bullet', data: {} }
    ], 1);

    const delta = computeStateDelta(prev, curr);

    // Entity 3 created
    expect(delta.created).toHaveLength(1);
    expect(delta.created[0].eid).toBe(3);

    // Entity 2 deleted
    expect(delta.deleted).toHaveLength(1);
    expect(delta.deleted[0]).toBe(2);
  });

  test('produces empty delta for identical snapshots', () => {
    const snapshot = createMockSnapshot([
      { eid: 1, type: 'Player', data: {} }
    ]);

    const delta = computeStateDelta(snapshot, snapshot);

    expect(delta.created).toHaveLength(0);
    expect(delta.deleted).toHaveLength(0);
    expect(isDeltaEmpty(delta)).toBe(true);
  });

  test('handles null previous snapshot (initial state)', () => {
    const curr = createMockSnapshot([
      { eid: 1, type: 'Player', data: {} },
      { eid: 2, type: 'Enemy', data: {} }
    ]);

    const delta = computeStateDelta(null, curr);

    expect(delta.baseHash).toBe(0);
    expect(delta.created).toHaveLength(2);
    expect(delta.deleted).toHaveLength(0);
  });

  test('creates entities in sorted order by eid', () => {
    const curr = createMockSnapshot([
      { eid: 5, type: 'A', data: {} },
      { eid: 2, type: 'B', data: {} },
      { eid: 8, type: 'C', data: {} },
      { eid: 1, type: 'D', data: {} }
    ]);

    const delta = computeStateDelta(null, curr);

    const eids = delta.created.map(e => e.eid);
    expect(eids).toEqual([1, 2, 5, 8]);
  });

  test('deletes entities in sorted order', () => {
    const prev = createMockSnapshot([
      { eid: 5, type: 'A', data: {} },
      { eid: 2, type: 'B', data: {} },
      { eid: 8, type: 'C', data: {} }
    ]);
    const curr = createMockSnapshot([]);

    const delta = computeStateDelta(prev, curr);

    expect(delta.deleted).toEqual([2, 5, 8]);
  });
});

describe('serializeDelta / deserializeDelta', () => {
  test('roundtrip preserves all data', () => {
    const delta: StateDelta = {
      frame: 42,
      baseHash: 0xDEADBEEF,
      resultHash: 0xCAFEBABE,
      created: [
        { eid: 1, type: 'Player', clientId: 5, components: { Transform2D: { x: 100, y: 200 } } }
      ],
      deleted: [3, 4, 5]
    };

    const bytes = serializeDelta(delta);
    const restored = deserializeDelta(bytes);

    expect(restored.frame).toBe(42);
    expect(restored.baseHash).toBe(0xDEADBEEF);
    expect(restored.resultHash).toBe(0xCAFEBABE);
    expect(restored.created).toEqual(delta.created);
    expect(restored.deleted).toEqual([3, 4, 5]);
  });

  test('handles empty delta', () => {
    const delta: StateDelta = {
      frame: 0,
      baseHash: 0,
      resultHash: 0,
      created: [],
      deleted: []
    };

    const bytes = serializeDelta(delta);
    const restored = deserializeDelta(bytes);

    expect(isDeltaEmpty(restored)).toBe(true);
  });
});

describe('getEntityPartition', () => {
  test('distributes entities evenly', () => {
    const partitions = [0, 0, 0];
    for (let eid = 0; eid < 300; eid++) {
      partitions[getEntityPartition(eid, 3)]++;
    }

    expect(partitions[0]).toBe(100);
    expect(partitions[1]).toBe(100);
    expect(partitions[2]).toBe(100);
  });

  test('is deterministic', () => {
    for (let eid = 0; eid < 100; eid++) {
      const p1 = getEntityPartition(eid, 5);
      const p2 = getEntityPartition(eid, 5);
      expect(p1).toBe(p2);
    }
  });

  test('maps to correct partition', () => {
    expect(getEntityPartition(0, 3)).toBe(0);
    expect(getEntityPartition(1, 3)).toBe(1);
    expect(getEntityPartition(2, 3)).toBe(2);
    expect(getEntityPartition(3, 3)).toBe(0);
    expect(getEntityPartition(4, 3)).toBe(1);
  });
});

describe('getPartition', () => {
  test('returns only entities for specified partition', () => {
    const delta: StateDelta = {
      frame: 1,
      baseHash: 0,
      resultHash: 0,
      created: [
        { eid: 0, type: 'A', components: {} }, // partition 0 (0 % 3 = 0)
        { eid: 1, type: 'B', components: {} }, // partition 1 (1 % 3 = 1)
        { eid: 2, type: 'C', components: {} }, // partition 2 (2 % 3 = 2)
        { eid: 3, type: 'D', components: {} }, // partition 0 (3 % 3 = 0)
        { eid: 4, type: 'E', components: {} }, // partition 1 (4 % 3 = 1)
        { eid: 5, type: 'F', components: {} }  // partition 2 (5 % 3 = 2)
      ],
      deleted: []
    };

    const p0 = deserializePartition(getPartition(delta, 0, 3));
    const p1 = deserializePartition(getPartition(delta, 1, 3));
    const p2 = deserializePartition(getPartition(delta, 2, 3));

    expect(p0.created.map(e => e.eid)).toEqual([0, 3]);
    expect(p1.created.map(e => e.eid)).toEqual([1, 4]);
    expect(p2.created.map(e => e.eid)).toEqual([2, 5]);
  });

  test('includes correct partition metadata', () => {
    const delta: StateDelta = {
      frame: 42,
      baseHash: 0,
      resultHash: 0,
      created: [{ eid: 0, type: 'A', components: {} }],
      deleted: []
    };

    const partition = deserializePartition(getPartition(delta, 0, 5));

    expect(partition.partitionId).toBe(0);
    expect(partition.numPartitions).toBe(5);
    expect(partition.frame).toBe(42);
  });

  test('partitions deleted entities correctly', () => {
    const delta: StateDelta = {
      frame: 1,
      baseHash: 0,
      resultHash: 0,
      created: [],
      deleted: [0, 1, 2, 3, 4, 5]
    };

    const p0 = deserializePartition(getPartition(delta, 0, 3));
    const p1 = deserializePartition(getPartition(delta, 1, 3));
    const p2 = deserializePartition(getPartition(delta, 2, 3));

    expect(p0.deleted).toEqual([0, 3]);
    expect(p1.deleted).toEqual([1, 4]);
    expect(p2.deleted).toEqual([2, 5]);
  });
});

describe('assemblePartitions', () => {
  test('reassembles full delta from partitions', () => {
    const delta: StateDelta = {
      frame: 1,
      baseHash: 0,
      resultHash: 0,
      created: [
        { eid: 0, type: 'A', components: {} },
        { eid: 1, type: 'B', components: {} },
        { eid: 2, type: 'C', components: {} }
      ],
      deleted: [3, 4, 5]
    };

    const p0 = deserializePartition(getPartition(delta, 0, 3));
    const p1 = deserializePartition(getPartition(delta, 1, 3));
    const p2 = deserializePartition(getPartition(delta, 2, 3));

    const assembled = assemblePartitions([p0, p1, p2]);

    expect(assembled).not.toBeNull();
    expect(assembled!.frame).toBe(1);
    expect(assembled!.created.map(e => e.eid)).toEqual([0, 1, 2]);
    expect(assembled!.deleted).toEqual([3, 4, 5]);
  });

  test('returns null for empty partitions array', () => {
    const result = assemblePartitions([]);
    expect(result).toBeNull();
  });

  test('returns null for frame mismatch', () => {
    const p1 = { partitionId: 0, numPartitions: 2, frame: 1, created: [], deleted: [] };
    const p2 = { partitionId: 1, numPartitions: 2, frame: 2, created: [], deleted: [] };

    const result = assemblePartitions([p1, p2]);
    expect(result).toBeNull();
  });

  test('handles out-of-order partition assembly', () => {
    const delta: StateDelta = {
      frame: 1,
      baseHash: 0,
      resultHash: 0,
      created: [
        { eid: 0, type: 'A', components: {} },
        { eid: 1, type: 'B', components: {} },
        { eid: 2, type: 'C', components: {} }
      ],
      deleted: []
    };

    const p0 = deserializePartition(getPartition(delta, 0, 3));
    const p1 = deserializePartition(getPartition(delta, 1, 3));
    const p2 = deserializePartition(getPartition(delta, 2, 3));

    // Assemble in reverse order
    const assembled = assemblePartitions([p2, p0, p1]);

    // Should still produce sorted output
    expect(assembled!.created.map(e => e.eid)).toEqual([0, 1, 2]);
  });
});

describe('computeSnapshotHash', () => {
  test('produces consistent hash for same snapshot', () => {
    const snapshot = createMockSnapshot([
      { eid: 1, type: 'Player', data: {} }
    ]);

    const hash1 = computeSnapshotHash(snapshot);
    const hash2 = computeSnapshotHash(snapshot);

    expect(hash1).toBe(hash2);
  });

  test('different frames produce different hashes', () => {
    const s1 = createMockSnapshot([{ eid: 1, type: 'A', data: {} }], 1);
    const s2 = createMockSnapshot([{ eid: 1, type: 'A', data: {} }], 2);

    expect(computeSnapshotHash(s1)).not.toBe(computeSnapshotHash(s2));
  });

  test('different entities produce different hashes', () => {
    const s1 = createMockSnapshot([{ eid: 1, type: 'A', data: {} }]);
    const s2 = createMockSnapshot([{ eid: 2, type: 'A', data: {} }]);

    expect(computeSnapshotHash(s1)).not.toBe(computeSnapshotHash(s2));
  });

  test('returns uint32', () => {
    const snapshot = createMockSnapshot([{ eid: 1, type: 'A', data: {} }]);
    const hash = computeSnapshotHash(snapshot);

    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});

describe('isDeltaEmpty', () => {
  test('returns true for empty delta', () => {
    const delta: StateDelta = {
      frame: 0,
      baseHash: 0,
      resultHash: 0,
      created: [],
      deleted: []
    };
    expect(isDeltaEmpty(delta)).toBe(true);
  });

  test('returns false with created entities', () => {
    const delta: StateDelta = {
      frame: 0,
      baseHash: 0,
      resultHash: 0,
      created: [{ eid: 1, type: 'A', components: {} }],
      deleted: []
    };
    expect(isDeltaEmpty(delta)).toBe(false);
  });

  test('returns false with deleted entities', () => {
    const delta: StateDelta = {
      frame: 0,
      baseHash: 0,
      resultHash: 0,
      created: [],
      deleted: [1]
    };
    expect(isDeltaEmpty(delta)).toBe(false);
  });
});

describe('getDeltaSize', () => {
  test('returns reasonable size estimate', () => {
    const delta: StateDelta = {
      frame: 0,
      baseHash: 0,
      resultHash: 0,
      created: [
        { eid: 1, type: 'Player', components: { Transform2D: { x: 100, y: 200 } } }
      ],
      deleted: [2, 3, 4]
    };

    const size = getDeltaSize(delta);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(1000); // Reasonable for this small delta
  });

  test('empty delta has minimal size', () => {
    const delta: StateDelta = {
      frame: 0,
      baseHash: 0,
      resultHash: 0,
      created: [],
      deleted: []
    };

    const size = getDeltaSize(delta);
    expect(size).toBe(16); // Just the header
  });
});
