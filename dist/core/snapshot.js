/**
 * Sparse Snapshot System
 *
 * Efficient snapshot encoding using entity bitmaps.
 * Only active entities are stored, not MAX_ENTITIES slots.
 */
import { MAX_ENTITIES, INDEX_MASK } from './constants';
import { getAllComponents } from './component';
/**
 * Sparse snapshot encoder/decoder.
 */
export class SparseSnapshotCodec {
    /**
     * Encode world state to sparse snapshot.
     */
    encode(activeEids, getEntityType, getEntityClientId, getComponentsForEntity, allocatorState, stringsState, frame = 0, seq = 0, rng) {
        // Build entity bitmap
        const entityMask = new Uint32Array(Math.ceil(MAX_ENTITIES / 32));
        const entityMeta = [];
        // Sort eids for deterministic order
        const sortedEids = [...activeEids].sort((a, b) => a - b);
        for (const eid of sortedEids) {
            const index = eid & INDEX_MASK;
            entityMask[index >>> 5] |= (1 << (index & 31));
            entityMeta.push({
                eid,
                type: getEntityType(eid),
                clientId: getEntityClientId(eid)
            });
        }
        // Pack component data
        const componentData = new Map();
        const allComponents = getAllComponents();
        for (const [name, component] of allComponents) {
            // Skip components that are not synced (client-only state)
            if (!component.sync)
                continue;
            const fieldCount = component.fieldNames.length;
            if (fieldCount === 0)
                continue;
            // Calculate buffer size
            let totalSize = 0;
            for (const fieldName of component.fieldNames) {
                const arr = component.storage.fields[fieldName];
                totalSize += sortedEids.length * arr.BYTES_PER_ELEMENT;
            }
            const buffer = new ArrayBuffer(totalSize);
            let offset = 0;
            // Pack each field's data for active entities only
            for (const fieldName of component.fieldNames) {
                const sourceArr = component.storage.fields[fieldName];
                const bytesPerElement = sourceArr.BYTES_PER_ELEMENT;
                // Create view into packed buffer
                const packedArr = new sourceArr.constructor(buffer, offset, sortedEids.length);
                // Copy only active entity data
                for (let i = 0; i < sortedEids.length; i++) {
                    const index = sortedEids[i] & INDEX_MASK;
                    packedArr[i] = sourceArr[index];
                }
                offset += sortedEids.length * bytesPerElement;
            }
            componentData.set(name, buffer);
        }
        return {
            frame,
            seq,
            entityMask,
            entityMeta,
            componentData,
            entityCount: sortedEids.length,
            allocator: allocatorState,
            strings: stringsState,
            rng
        };
    }
    /**
     * Decode sparse snapshot back to world state.
     */
    decode(snapshot, clearWorld, setAllocatorState, setStringsState, createEntity, setRng) {
        // Clear existing state
        clearWorld();
        // Restore allocator state
        setAllocatorState(snapshot.allocator);
        // Restore strings
        setStringsState(snapshot.strings);
        // Restore RNG if provided
        if (snapshot.rng && setRng) {
            setRng(snapshot.rng);
        }
        // Get component types
        const allComponents = getAllComponents();
        // Unpack entities from metadata
        for (let i = 0; i < snapshot.entityMeta.length; i++) {
            const meta = snapshot.entityMeta[i];
            createEntity(meta.eid, meta.type, meta.clientId);
        }
        // Unpack component data
        for (const [name, buffer] of snapshot.componentData) {
            const component = allComponents.get(name);
            if (!component)
                continue;
            let offset = 0;
            for (const fieldName of component.fieldNames) {
                const targetArr = component.storage.fields[fieldName];
                const bytesPerElement = targetArr.BYTES_PER_ELEMENT;
                // Create view into packed buffer
                const packedArr = new targetArr.constructor(buffer, offset, snapshot.entityCount);
                // Unpack to entity indices
                for (let i = 0; i < snapshot.entityMeta.length; i++) {
                    const index = snapshot.entityMeta[i].eid & INDEX_MASK;
                    targetArr[index] = packedArr[i];
                }
                offset += snapshot.entityCount * bytesPerElement;
            }
        }
    }
    /**
     * Calculate snapshot size in bytes.
     */
    getSize(snapshot) {
        let size = 0;
        // Entity mask
        size += snapshot.entityMask.byteLength;
        // Entity metadata (rough estimate)
        size += snapshot.entityMeta.length * 32; // ~32 bytes per entity meta
        // Component data
        for (const buffer of snapshot.componentData.values()) {
            size += buffer.byteLength;
        }
        // Allocator state
        size += snapshot.allocator.freeList.length * 4;
        size += snapshot.allocator.generations.length * 2;
        return size;
    }
    /**
     * Serialize snapshot to binary for network transfer.
     */
    toBinary(snapshot) {
        // Calculate total size
        const metaJson = JSON.stringify({
            frame: snapshot.frame,
            seq: snapshot.seq,
            entityMeta: snapshot.entityMeta,
            allocator: snapshot.allocator,
            strings: snapshot.strings,
            rng: snapshot.rng,
            componentNames: Array.from(snapshot.componentData.keys())
        });
        const metaBytes = new TextEncoder().encode(metaJson);
        const metaLength = metaBytes.length;
        // Calculate component data size
        let componentDataSize = 0;
        const componentSizes = [];
        for (const buffer of snapshot.componentData.values()) {
            componentSizes.push(buffer.byteLength);
            componentDataSize += buffer.byteLength;
        }
        // Total: 4 (meta length) + meta + 4 (mask length) + mask + component data
        const totalSize = 4 + metaLength + 4 + snapshot.entityMask.byteLength + componentDataSize;
        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        let offset = 0;
        // Write meta length and data
        view.setUint32(offset, metaLength, true);
        offset += 4;
        new Uint8Array(buffer, offset, metaLength).set(metaBytes);
        offset += metaLength;
        // Write entity mask
        view.setUint32(offset, snapshot.entityMask.byteLength, true);
        offset += 4;
        new Uint8Array(buffer, offset, snapshot.entityMask.byteLength).set(new Uint8Array(snapshot.entityMask.buffer));
        offset += snapshot.entityMask.byteLength;
        // Write component data
        for (const compBuffer of snapshot.componentData.values()) {
            new Uint8Array(buffer, offset, compBuffer.byteLength).set(new Uint8Array(compBuffer));
            offset += compBuffer.byteLength;
        }
        return buffer;
    }
    /**
     * Deserialize snapshot from binary.
     */
    fromBinary(buffer) {
        const view = new DataView(buffer);
        let offset = 0;
        // Read meta
        const metaLength = view.getUint32(offset, true);
        offset += 4;
        const metaBytes = new Uint8Array(buffer, offset, metaLength);
        const metaJson = new TextDecoder().decode(metaBytes);
        const meta = JSON.parse(metaJson);
        offset += metaLength;
        // Read entity mask
        const maskLength = view.getUint32(offset, true);
        offset += 4;
        const entityMask = new Uint32Array(buffer.slice(offset, offset + maskLength));
        offset += maskLength;
        // Read component data
        const componentData = new Map();
        const allComponents = getAllComponents();
        for (const name of meta.componentNames) {
            const component = allComponents.get(name);
            if (!component)
                continue;
            // Calculate size for this component
            let compSize = 0;
            for (const fieldName of component.fieldNames) {
                const arr = component.storage.fields[fieldName];
                compSize += meta.entityMeta.length * arr.BYTES_PER_ELEMENT;
            }
            const compBuffer = buffer.slice(offset, offset + compSize);
            componentData.set(name, compBuffer);
            offset += compSize;
        }
        return {
            frame: meta.frame,
            seq: meta.seq,
            entityMask,
            entityMeta: meta.entityMeta,
            componentData,
            entityCount: meta.entityMeta.length,
            allocator: meta.allocator,
            strings: meta.strings,
            rng: meta.rng
        };
    }
}
/**
 * Rollback buffer - stores snapshots for rewinding state.
 */
export class RollbackBuffer {
    constructor(maxFrames = 60) {
        this.maxFrames = maxFrames;
        this.snapshots = new Map();
        this.codec = new SparseSnapshotCodec();
    }
    /**
     * Save a snapshot for a frame.
     */
    save(frame, snapshot) {
        this.snapshots.set(frame, snapshot);
        // Prune old snapshots (keep exactly maxFrames snapshots)
        const minFrame = frame - this.maxFrames + 1;
        for (const f of this.snapshots.keys()) {
            if (f < minFrame) {
                this.snapshots.delete(f);
            }
        }
    }
    /**
     * Get snapshot for a frame.
     */
    get(frame) {
        return this.snapshots.get(frame);
    }
    /**
     * Check if snapshot exists for frame.
     */
    has(frame) {
        return this.snapshots.has(frame);
    }
    /**
     * Get oldest available frame.
     */
    getOldestFrame() {
        let oldest;
        for (const frame of this.snapshots.keys()) {
            if (oldest === undefined || frame < oldest) {
                oldest = frame;
            }
        }
        return oldest;
    }
    /**
     * Get newest available frame.
     */
    getNewestFrame() {
        let newest;
        for (const frame of this.snapshots.keys()) {
            if (newest === undefined || frame > newest) {
                newest = frame;
            }
        }
        return newest;
    }
    /**
     * Clear all snapshots.
     */
    clear() {
        this.snapshots.clear();
    }
    /**
     * Get number of stored snapshots.
     */
    get size() {
        return this.snapshots.size;
    }
}
