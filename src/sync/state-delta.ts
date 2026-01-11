/**
 * State Delta Computation
 *
 * Computes compact deltas between snapshots for efficient network sync.
 * Used by the distributed state sync protocol.
 */

import { xxhash32Combine } from '../hash/xxhash';
import { SparseSnapshot, EntityMeta } from '../core/snapshot';
import { getAllComponents } from '../core/component';


/**
 * Represents changes between two world states.
 */
export interface StateDelta {
  /** Frame number this delta applies to */
  frame: number;

  /** Hash of the base state (before applying delta) */
  baseHash: number;

  /** Hash of the resulting state (after applying delta) */
  resultHash: number;

  /** Newly created entities */
  created: CreatedEntity[];

  /** Deleted entity IDs */
  deleted: number[];
}

/**
 * A newly created entity with all its data.
 */
export interface CreatedEntity {
  eid: number;
  type: string;
  clientId?: number;
  /** Component name -> field name -> value */
  components: Record<string, Record<string, number>>;
}


/**
 * Compute state delta between two snapshots.
 */
export function computeStateDelta(
  prevSnapshot: SparseSnapshot | null,
  currentSnapshot: SparseSnapshot
): StateDelta {
  const allComponents = getAllComponents();

  // Build lookup for previous entity IDs
  const prevEntityIds = new Set<number>();
  if (prevSnapshot) {
    for (const meta of prevSnapshot.entityMeta) {
      prevEntityIds.add(meta.eid);
    }
  }

  // Find created entities (need component data for new entities)
  const created: CreatedEntity[] = [];
  const deleted: number[] = [];

  for (let i = 0; i < currentSnapshot.entityMeta.length; i++) {
    const meta = currentSnapshot.entityMeta[i];

    if (!prevEntityIds.has(meta.eid)) {
      // New entity - extract component data
      const entityData: Record<string, Record<string, number>> = {};
      for (const [compName, buffer] of currentSnapshot.componentData) {
        const component = allComponents.get(compName);
        if (!component) continue;

        const fields: Record<string, number> = {};
        let offset = 0;
        for (const fieldName of component.fieldNames) {
          const arr = component.storage.fields[fieldName];
          const bytesPerElement = arr.BYTES_PER_ELEMENT;
          const packedArr = new (arr.constructor as any)(buffer, offset, currentSnapshot.entityCount);
          fields[fieldName] = packedArr[i];
          offset += currentSnapshot.entityCount * bytesPerElement;
        }
        entityData[compName] = fields;
      }

      created.push({
        eid: meta.eid,
        type: meta.type,
        clientId: meta.clientId,
        components: entityData
      });
    }
  }

  // Find deleted entities
  if (prevSnapshot) {
    const currentEntityIds = new Set<number>();
    for (const meta of currentSnapshot.entityMeta) {
      currentEntityIds.add(meta.eid);
    }
    for (const meta of prevSnapshot.entityMeta) {
      if (!currentEntityIds.has(meta.eid)) {
        deleted.push(meta.eid);
      }
    }
  }

  // Sort for determinism
  created.sort((a, b) => a.eid - b.eid);
  deleted.sort((a, b) => a - b);

  return {
    frame: currentSnapshot.frame,
    baseHash: prevSnapshot ? computeSnapshotHash(prevSnapshot) : 0,
    resultHash: computeSnapshotHash(currentSnapshot),
    created,
    deleted
  };
}

/**
 * Compute xxhash32 of a snapshot for state verification.
 */
export function computeSnapshotHash(snapshot: SparseSnapshot): number {
  const allComponents = getAllComponents();

  let hash = 0;

  // Hash frame number
  hash = xxhash32Combine(hash, snapshot.frame);

  // Hash entity count
  hash = xxhash32Combine(hash, snapshot.entityCount);

  // Hash each entity in deterministic order (already sorted in snapshot)
  for (let i = 0; i < snapshot.entityMeta.length; i++) {
    const meta = snapshot.entityMeta[i];

    // Hash eid
    hash = xxhash32Combine(hash, meta.eid);

    // Hash component data for this entity
    for (const [compName, buffer] of snapshot.componentData) {
      const component = allComponents.get(compName);
      if (!component) continue;

      let offset = 0;
      for (const fieldName of component.fieldNames) {
        const arr = component.storage.fields[fieldName];
        const bytesPerElement = arr.BYTES_PER_ELEMENT;
        const packedArr = new (arr.constructor as any)(buffer, offset, snapshot.entityCount);
        const value = packedArr[i];
        hash = xxhash32Combine(hash, value >>> 0);
        offset += snapshot.entityCount * bytesPerElement;
      }
    }
  }

  return hash >>> 0;
}

/**
 * Serialize delta to binary format for network transfer.
 */
export function serializeDelta(delta: StateDelta): Uint8Array {
  // Use JSON for simplicity - can optimize to binary later
  const json = JSON.stringify(delta);
  const encoder = new TextEncoder();
  return encoder.encode(json);
}

/**
 * Deserialize delta from binary format.
 */
export function deserializeDelta(bytes: Uint8Array): StateDelta {
  const decoder = new TextDecoder();
  const json = decoder.decode(bytes);
  return JSON.parse(json);
}

/**
 * Get partition data for a specific partition.
 * Partitions entities by eid % numPartitions.
 *
 * @param delta Full delta
 * @param partitionId Which partition (0 to numPartitions-1)
 * @param numPartitions Total number of partitions
 * @returns Serialized partition data containing only entities for this partition
 */
export function getPartition(
  delta: StateDelta,
  partitionId: number,
  numPartitions: number
): Uint8Array {
  // Filter created entities
  const partitionCreated = delta.created.filter(
    e => getEntityPartition(e.eid, numPartitions) === partitionId
  );

  // Filter deleted entities
  const partitionDeleted = delta.deleted.filter(
    eid => getEntityPartition(eid, numPartitions) === partitionId
  );

  const partitionDelta: PartitionDelta = {
    partitionId,
    numPartitions,
    frame: delta.frame,
    created: partitionCreated,
    deleted: partitionDeleted
  };

  const json = JSON.stringify(partitionDelta);
  const encoder = new TextEncoder();
  return encoder.encode(json);
}

/**
 * Determine which partition an entity belongs to.
 */
export function getEntityPartition(eid: number, numPartitions: number): number {
  return eid % numPartitions;
}

/**
 * Partition-specific delta data.
 */
export interface PartitionDelta {
  partitionId: number;
  numPartitions: number;
  frame: number;
  created: CreatedEntity[];
  deleted: number[];
}

/**
 * Deserialize partition data.
 */
export function deserializePartition(bytes: Uint8Array): PartitionDelta {
  const decoder = new TextDecoder();
  const json = decoder.decode(bytes);
  return JSON.parse(json);
}

/**
 * Assemble full delta from partition data.
 */
export function assemblePartitions(partitions: PartitionDelta[]): StateDelta | null {
  if (partitions.length === 0) return null;

  // Verify all partitions are for the same frame
  const frame = partitions[0].frame;

  for (const p of partitions) {
    if (p.frame !== frame) {
      console.warn('Partition frame mismatch');
      return null;
    }
  }

  // Combine all partition data
  const created: CreatedEntity[] = [];
  const deleted: number[] = [];

  for (const p of partitions) {
    created.push(...p.created);
    deleted.push(...p.deleted);
  }

  // Sort for determinism
  created.sort((a, b) => a.eid - b.eid);
  deleted.sort((a, b) => a - b);

  return {
    frame,
    baseHash: 0, // Not known from partitions
    resultHash: 0, // Not known from partitions
    created,
    deleted
  };
}

/**
 * Apply delta to update snapshot/world state.
 * Returns the entity IDs that were affected.
 */
export function applyDelta(
  delta: StateDelta,
  createEntity: (eid: number, type: string, clientId?: number, components?: Record<string, Record<string, number>>) => void,
  deleteEntity: (eid: number) => void
): { created: number[]; deleted: number[] } {
  // Apply deletions first
  for (const eid of delta.deleted) {
    deleteEntity(eid);
  }

  // Apply creations
  for (const entity of delta.created) {
    createEntity(entity.eid, entity.type, entity.clientId, entity.components);
  }

  return {
    created: delta.created.map(e => e.eid),
    deleted: delta.deleted
  };
}

/**
 * Check if delta is empty (no changes).
 */
export function isDeltaEmpty(delta: StateDelta): boolean {
  return delta.created.length === 0 && delta.deleted.length === 0;
}

/**
 * Get approximate size of delta in bytes.
 */
export function getDeltaSize(delta: StateDelta): number {
  // Rough estimate
  let size = 16; // frame + hashes

  for (const entity of delta.created) {
    size += 12; // eid + type overhead
    size += JSON.stringify(entity.components).length;
  }

  size += delta.deleted.length * 4; // 4 bytes per deleted eid

  return size;
}
