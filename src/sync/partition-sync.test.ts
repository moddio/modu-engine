/**
 * Multi-Client Partition Sync Integration Tests
 *
 * Simulates multiple clients independently computing deltas and partition assignments
 * to validate the distributed sync protocol works correctly.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  computeStateDelta,
  getPartition,
  deserializePartition,
  assemblePartitions,
  isDeltaEmpty,
  getDeltaSize,
  StateDelta,
  PartitionDelta
} from './state-delta';
import {
  computePartitionAssignment,
  computePartitionCount,
  getClientPartitions,
  PartitionAssignment
} from './partition';
import { SparseSnapshot, EntityMeta } from '../core/snapshot';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Simulated client that independently computes delta and partition assignments.
 */
class SimulatedClient {
  id: string;
  prevSnapshot: SparseSnapshot | null = null;
  currentSnapshot: SparseSnapshot | null = null;

  constructor(id: string) {
    this.id = id;
  }

  /**
   * Update the client's view of the world state.
   */
  setState(snapshot: SparseSnapshot): void {
    this.prevSnapshot = this.currentSnapshot;
    this.currentSnapshot = snapshot;
  }

  /**
   * Compute delta between previous and current state.
   */
  computeDelta(): StateDelta {
    if (!this.currentSnapshot) {
      throw new Error('No current snapshot');
    }
    return computeStateDelta(this.prevSnapshot, this.currentSnapshot);
  }

  /**
   * Compute partition assignment independently.
   */
  computeAssignment(
    clientIds: string[],
    frame: number,
    reliability: Record<string, number>
  ): PartitionAssignment {
    const entityCount = this.currentSnapshot?.entityCount ?? 0;
    return computePartitionAssignment(entityCount, clientIds, frame, reliability);
  }

  /**
   * Get partitions this client is responsible for sending.
   */
  getMyPartitions(assignment: PartitionAssignment): number[] {
    return getClientPartitions(assignment, this.id);
  }

  /**
   * Generate partition data for assigned partitions.
   */
  generatePartitionData(
    delta: StateDelta,
    partitionIds: number[],
    numPartitions: number
  ): PartitionDelta[] {
    return partitionIds.map(pid => {
      const bytes = getPartition(delta, pid, numPartitions);
      return deserializePartition(bytes);
    });
  }
}

/**
 * Create a mock snapshot with entities.
 */
function createSnapshot(
  entities: Array<{ eid: number; type: string; clientId?: number }>,
  frame: number = 0
): SparseSnapshot {
  const entityMeta: EntityMeta[] = entities.map(e => ({
    eid: e.eid,
    type: e.type,
    clientId: e.clientId
  }));

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

// ============================================================================
// Integration Tests
// ============================================================================

describe('Multi-Client Partition Sync', () => {
  describe('Delta Computation Consistency', () => {
    test('all clients compute identical delta for same state transition', () => {
      // Create 5 simulated clients
      const clients = ['alice', 'bob', 'charlie', 'david', 'eve'].map(id => new SimulatedClient(id));

      // Initial state: 100 entities
      const initialEntities = Array.from({ length: 100 }, (_, i) => ({
        eid: i,
        type: i < 10 ? 'Player' : 'Food'
      }));
      const initialSnapshot = createSnapshot(initialEntities, 0);

      // All clients receive initial state
      for (const client of clients) {
        client.setState(initialSnapshot);
      }

      // State change: remove some food, add a bullet
      const newEntities = [
        ...initialEntities.slice(0, 50), // Keep first 50
        { eid: 100, type: 'Bullet' }     // Add new entity
      ];
      const newSnapshot = createSnapshot(newEntities, 1);

      // All clients receive new state
      for (const client of clients) {
        client.setState(newSnapshot);
      }

      // All clients compute delta independently
      const deltas = clients.map(c => c.computeDelta());

      // All deltas must be identical
      const baseline = deltas[0];
      for (let i = 1; i < deltas.length; i++) {
        expect(deltas[i].frame).toBe(baseline.frame);
        expect(deltas[i].created).toEqual(baseline.created);
        expect(deltas[i].deleted).toEqual(baseline.deleted);
      }

      // Verify delta is correct
      expect(baseline.created).toHaveLength(1);
      expect(baseline.created[0].eid).toBe(100);
      expect(baseline.created[0].type).toBe('Bullet');
      expect(baseline.deleted).toHaveLength(50); // Entities 50-99 deleted
      expect(baseline.deleted).toEqual(Array.from({ length: 50 }, (_, i) => i + 50));
    });

    test('delta only includes changed entities, not entire state', () => {
      const client = new SimulatedClient('test');

      // Initial state: 1000 entities
      const initialEntities = Array.from({ length: 1000 }, (_, i) => ({
        eid: i,
        type: 'Food'
      }));
      const initialSnapshot = createSnapshot(initialEntities, 0);
      client.setState(initialSnapshot);

      // Only 2 entities change: delete one, add one
      const newEntities = [
        ...initialEntities.slice(0, 999), // Remove last entity
        { eid: 1000, type: 'Bullet' }     // Add new entity
      ];
      const newSnapshot = createSnapshot(newEntities, 1);
      client.setState(newSnapshot);

      const delta = client.computeDelta();

      // Delta should only have 2 changes, not 1000 entities
      expect(delta.created).toHaveLength(1);
      expect(delta.deleted).toHaveLength(1);

      // Verify size is small
      const size = getDeltaSize(delta);
      expect(size).toBeLessThan(200); // Much smaller than full state
    });

    test('empty delta when nothing changes', () => {
      const client = new SimulatedClient('test');

      const entities = Array.from({ length: 100 }, (_, i) => ({
        eid: i,
        type: 'Food'
      }));

      // Same state twice
      const snapshot1 = createSnapshot(entities, 0);
      const snapshot2 = createSnapshot(entities, 1);

      client.setState(snapshot1);
      client.setState(snapshot2);

      const delta = client.computeDelta();

      expect(isDeltaEmpty(delta)).toBe(true);
      expect(delta.created).toHaveLength(0);
      expect(delta.deleted).toHaveLength(0);
    });
  });

  describe('Partition Assignment Consistency', () => {
    test('all clients compute identical partition assignments', () => {
      const clientIds = ['alice', 'bob', 'charlie', 'david', 'eve'];
      const reliability = { alice: 95, bob: 88, charlie: 72, david: 65, eve: 40 };
      const entityCount = 200;
      const frame = 12345;

      // Each client computes assignment independently
      const assignments: PartitionAssignment[] = [];
      for (const id of clientIds) {
        const client = new SimulatedClient(id);
        client.setState(createSnapshot(
          Array.from({ length: entityCount }, (_, i) => ({ eid: i, type: 'Entity' })),
          frame
        ));
        assignments.push(client.computeAssignment(clientIds, frame, reliability));
      }

      // All assignments must be identical
      const baseline = assignments[0];
      for (let i = 1; i < assignments.length; i++) {
        expect(assignments[i].numPartitions).toBe(baseline.numPartitions);
        expect(assignments[i].frame).toBe(baseline.frame);

        for (let p = 0; p < baseline.numPartitions; p++) {
          expect(assignments[i].partitionSenders.get(p)).toEqual(
            baseline.partitionSenders.get(p)
          );
        }
      }
    });

    test('each partition is assigned to at least one client', () => {
      const clientIds = ['alice', 'bob', 'charlie', 'david', 'eve'];
      const reliability = { alice: 80, bob: 80, charlie: 80, david: 80, eve: 80 };

      const assignment = computePartitionAssignment(200, clientIds, 42, reliability);

      for (let p = 0; p < assignment.numPartitions; p++) {
        const senders = assignment.partitionSenders.get(p);
        expect(senders).toBeDefined();
        expect(senders!.length).toBeGreaterThanOrEqual(1);
      }
    });

    test('all partitions are covered by assigned clients', () => {
      const clientIds = ['alice', 'bob', 'charlie'];
      const reliability = { alice: 100, bob: 100, charlie: 100 };

      const assignment = computePartitionAssignment(100, clientIds, 42, reliability);

      // Collect all partitions assigned to any client
      const coveredPartitions = new Set<number>();
      for (const clientId of clientIds) {
        const partitions = getClientPartitions(assignment, clientId);
        for (const p of partitions) {
          coveredPartitions.add(p);
        }
      }

      // All partitions should be covered
      for (let p = 0; p < assignment.numPartitions; p++) {
        expect(coveredPartitions.has(p)).toBe(true);
      }
    });
  });

  describe('Partition Assembly', () => {
    test('assembled partitions produce identical delta to original', () => {
      // Setup: 5 clients, 150 entities
      const clientIds = ['alice', 'bob', 'charlie', 'david', 'eve'];
      const clients = clientIds.map(id => new SimulatedClient(id));
      const reliability = { alice: 90, bob: 85, charlie: 80, david: 75, eve: 70 };

      // Initial state
      const initialEntities = Array.from({ length: 150 }, (_, i) => ({
        eid: i,
        type: i < 10 ? 'Player' : 'Food'
      }));
      const initialSnapshot = createSnapshot(initialEntities, 0);

      for (const client of clients) {
        client.setState(initialSnapshot);
      }

      // State change
      const newEntities = [
        ...initialEntities.slice(0, 100),           // Keep first 100
        { eid: 150, type: 'Bullet' },               // Add bullets
        { eid: 151, type: 'Bullet' },
        { eid: 152, type: 'Bullet' }
      ];
      const newSnapshot = createSnapshot(newEntities, 1);

      for (const client of clients) {
        client.setState(newSnapshot);
      }

      // All clients compute delta
      const baseline = clients[0];
      const originalDelta = baseline.computeDelta();

      // Compute assignment
      const assignment = baseline.computeAssignment(clientIds, 1, reliability);

      // Each client generates their assigned partition data
      const allPartitions: PartitionDelta[] = [];
      for (const client of clients) {
        const myPartitions = client.getMyPartitions(assignment);
        const partitionData = client.generatePartitionData(
          client.computeDelta(),
          myPartitions,
          assignment.numPartitions
        );
        allPartitions.push(...partitionData);
      }

      // Deduplicate partitions (multiple clients may send same partition)
      const uniquePartitions = new Map<number, PartitionDelta>();
      for (const p of allPartitions) {
        if (!uniquePartitions.has(p.partitionId)) {
          uniquePartitions.set(p.partitionId, p);
        }
      }

      // Assemble back into full delta
      const assembledDelta = assemblePartitions([...uniquePartitions.values()]);

      expect(assembledDelta).not.toBeNull();
      expect(assembledDelta!.frame).toBe(originalDelta.frame);
      expect(assembledDelta!.created.map(e => e.eid)).toEqual(
        originalDelta.created.map(e => e.eid)
      );
      expect(assembledDelta!.deleted).toEqual(originalDelta.deleted);
    });

    test('partitions are distributed by entity ID correctly', () => {
      const client = new SimulatedClient('test');

      // Create entities with specific IDs
      const entities = [
        { eid: 0, type: 'A' },   // partition 0 (0 % 3)
        { eid: 1, type: 'B' },   // partition 1 (1 % 3)
        { eid: 2, type: 'C' },   // partition 2 (2 % 3)
        { eid: 3, type: 'D' },   // partition 0 (3 % 3)
        { eid: 4, type: 'E' },   // partition 1 (4 % 3)
        { eid: 5, type: 'F' },   // partition 2 (5 % 3)
        { eid: 6, type: 'G' },   // partition 0 (6 % 3)
        { eid: 7, type: 'H' },   // partition 1 (7 % 3)
        { eid: 8, type: 'I' }    // partition 2 (8 % 3)
      ];

      client.setState(createSnapshot(entities, 0));

      const delta = client.computeDelta();
      const numPartitions = 3;

      const p0 = deserializePartition(getPartition(delta, 0, numPartitions));
      const p1 = deserializePartition(getPartition(delta, 1, numPartitions));
      const p2 = deserializePartition(getPartition(delta, 2, numPartitions));

      expect(p0.created.map(e => e.eid)).toEqual([0, 3, 6]);
      expect(p1.created.map(e => e.eid)).toEqual([1, 4, 7]);
      expect(p2.created.map(e => e.eid)).toEqual([2, 5, 8]);
    });
  });

  describe('Bandwidth Estimation', () => {
    test('delta size scales with changes, not total entity count', () => {
      const client = new SimulatedClient('test');

      // Large initial state
      const entities = Array.from({ length: 1000 }, (_, i) => ({
        eid: i,
        type: 'Food'
      }));
      const initial = createSnapshot(entities, 0);
      client.setState(initial);

      // Test 1: No changes
      client.setState(createSnapshot(entities, 1));
      const emptyDelta = client.computeDelta();
      expect(getDeltaSize(emptyDelta)).toBe(16); // Just header

      // Test 2: 1 entity changed
      client.setState(initial); // Reset
      const oneChange = [...entities.slice(0, 999), { eid: 1000, type: 'Bullet' }];
      client.setState(createSnapshot(oneChange, 2));
      const smallDelta = client.computeDelta();
      expect(getDeltaSize(smallDelta)).toBeLessThan(100);

      // Test 3: 100 entities changed
      client.setState(initial); // Reset
      const manyChanges = [
        ...entities.slice(0, 900),
        ...Array.from({ length: 100 }, (_, i) => ({ eid: 1000 + i, type: 'Bullet' }))
      ];
      client.setState(createSnapshot(manyChanges, 3));
      const largeDelta = client.computeDelta();

      // Large delta should be bigger than small delta
      expect(getDeltaSize(largeDelta)).toBeGreaterThan(getDeltaSize(smallDelta));
      // But still much smaller than full state serialization would be
      expect(getDeltaSize(largeDelta)).toBeLessThan(5000);
    });

    test('partition distribution keeps individual messages small', () => {
      const client = new SimulatedClient('test');

      // 300 entities total
      const entities = Array.from({ length: 300 }, (_, i) => ({
        eid: i,
        type: 'Entity'
      }));
      client.setState(createSnapshot(entities, 0));

      const delta = client.computeDelta();
      const numPartitions = 6; // 50 entities per partition

      // Each partition should be roughly 1/6 of the total
      let totalPartitionSize = 0;
      for (let p = 0; p < numPartitions; p++) {
        const partitionBytes = getPartition(delta, p, numPartitions);
        totalPartitionSize += partitionBytes.length;

        // Each partition should have ~50 entities
        const partition = deserializePartition(partitionBytes);
        expect(partition.created.length).toBeGreaterThanOrEqual(45);
        expect(partition.created.length).toBeLessThanOrEqual(55);
      }
    });
  });

  describe('Edge Cases', () => {
    test('handles empty initial state', () => {
      const client = new SimulatedClient('test');

      client.setState(createSnapshot([], 0));
      client.setState(createSnapshot([{ eid: 1, type: 'Player' }], 1));

      const delta = client.computeDelta();
      expect(delta.created).toHaveLength(1);
      expect(delta.deleted).toHaveLength(0);
    });

    test('handles transition to empty state', () => {
      const client = new SimulatedClient('test');

      client.setState(createSnapshot([
        { eid: 1, type: 'Player' },
        { eid: 2, type: 'Enemy' }
      ], 0));
      client.setState(createSnapshot([], 1));

      const delta = client.computeDelta();
      expect(delta.created).toHaveLength(0);
      expect(delta.deleted).toHaveLength(2);
    });

    test('handles single client assignment', () => {
      const client = new SimulatedClient('solo');
      client.setState(createSnapshot(
        Array.from({ length: 100 }, (_, i) => ({ eid: i, type: 'Entity' })),
        0
      ));

      const assignment = client.computeAssignment(['solo'], 0, { solo: 100 });

      // Single client should be assigned to all partitions
      const myPartitions = client.getMyPartitions(assignment);
      expect(myPartitions).toHaveLength(assignment.numPartitions);
    });

    test('handles very large entity counts', () => {
      const client = new SimulatedClient('test');

      // 10,000 entities
      const entities = Array.from({ length: 10000 }, (_, i) => ({
        eid: i,
        type: 'Entity'
      }));
      client.setState(createSnapshot(entities, 0));

      // Only 10 changes
      const newEntities = [
        ...entities.slice(0, 9990),
        ...Array.from({ length: 10 }, (_, i) => ({ eid: 10000 + i, type: 'New' }))
      ];
      client.setState(createSnapshot(newEntities, 1));

      const delta = client.computeDelta();

      // Should only have 20 changes (10 deleted, 10 created)
      expect(delta.created).toHaveLength(10);
      expect(delta.deleted).toHaveLength(10);
    });
  });

  describe('Determinism Validation', () => {
    test('delta computation is deterministic across multiple runs', () => {
      const results: string[] = [];

      for (let run = 0; run < 10; run++) {
        const client = new SimulatedClient(`run${run}`);

        const entities1 = Array.from({ length: 100 }, (_, i) => ({
          eid: i,
          type: i < 10 ? 'Player' : 'Food'
        }));
        const entities2 = [
          ...entities1.slice(0, 80),
          { eid: 100, type: 'Bullet' }
        ];

        client.setState(createSnapshot(entities1, 0));
        client.setState(createSnapshot(entities2, 1));

        const delta = client.computeDelta();
        results.push(JSON.stringify({
          created: delta.created,
          deleted: delta.deleted
        }));
      }

      // All runs should produce identical results
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBe(results[0]);
      }
    });

    test('partition assignment is deterministic across multiple clients', () => {
      const clientIds = ['a', 'b', 'c', 'd', 'e'];
      const reliability = { a: 90, b: 80, c: 70, d: 60, e: 50 };

      // Run 100 times with same inputs
      const results: string[] = [];
      for (let run = 0; run < 100; run++) {
        const assignment = computePartitionAssignment(200, clientIds, 12345, reliability);
        const serialized: Record<number, string[]> = {};
        for (const [pid, senders] of assignment.partitionSenders) {
          serialized[pid] = senders;
        }
        results.push(JSON.stringify(serialized));
      }

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBe(results[0]);
      }
    });
  });
});
