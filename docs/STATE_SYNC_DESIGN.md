# Distributed State Sync Design

## Overview

A bandwidth-efficient, Byzantine-fault-tolerant state synchronization system for 100+ player deterministic multiplayer games.

### Design Principles

1. **Inputs are truth** - Deterministic simulation means same inputs → same state
2. **Consensus over trust** - No single client is trusted; majority defines correctness
3. **Minimal bandwidth** - Only send what's necessary; leverage redundancy for verification
4. **Self-healing** - System adapts to unreliable clients automatically

---

## Current Implementation Status

The following model is currently implemented:

### What's Implemented ✅

| Feature | Status | Description |
|---------|--------|-------------|
| State hashing | ✅ | xxHash32 of full world state each tick |
| Hash broadcasting | ✅ | Clients send 9-byte STATE_HASH messages |
| Majority hash | ✅ | Server computes and broadcasts majority hash |
| Desync detection | ✅ | Client compares local hash to majority |
| Hard recovery | ✅ | Full snapshot request + apply on desync |
| Detailed diagnostics | ✅ | Field-by-field diff logging on desync |
| Rolling sync stats | ✅ | Track % of hash checks that pass |
| Debug UI integration | ✅ | Shows sync %, desynced/resyncing status |
| **Structural-only delta** | ✅ | Delta tracks created/deleted only (deterministic simulation) |
| **Solo client optimization** | ✅ | Skip delta computation when alone |

### Current Flow (Simplified)

```
Every tick:
  ALL CLIENTS:
    1. Apply inputs from server
    2. Run deterministic simulation (all clients compute identical state)
    3. Compute stateHash (4 bytes)
    4. Send STATE_HASH to server

  SERVER:
    1. Collect stateHashes from all clients
    2. Compute majority hash
    3. Broadcast majorityHash in TICK message
    4. Track which clients match/mismatch

  IF CLIENT HASH != MAJORITY:
    1. Client logs DESYNC DETECTED with hashes
    2. Client calls connection.requestResync()
    3. Server sends full snapshot to client
    4. Client logs detailed field-by-field diff
    5. Client applies snapshot (hard recovery)
    6. Client verifies hash now matches
```

### Delta Sync (Structural Changes Only)

Because simulation is **deterministic**, all clients compute identical field values (positions, velocities, etc.) from the same inputs. The delta system only needs to track **structural changes**:

- **Created entities**: New entities spawned this frame (with full component data)
- **Deleted entities**: Entity IDs destroyed this frame

Field updates (position changes, velocity changes) are **NOT** transmitted - all clients already have the correct values from local simulation.

**Bandwidth impact**: Delta is typically **16 bytes** (header only) when no entities are created/deleted. Creating an entity adds ~50-100 bytes for its component data.

### Not Yet Implemented ❌

| Feature | Status | Notes |
|---------|--------|-------|
| Distributed partition sending | ❌ | All data from authority, not distributed |
| Merkle tree divergence detection | ❌ | Uses full snapshot comparison instead |
| Compression | ❌ | Raw binary for now |

### Bandwidth (Current Implementation)

| Direction | Per Client | Notes |
|-----------|------------|-------|
| Upload | ~180 bytes/sec | 9 bytes × 20 fps (STATE_HASH only) |
| Download | ~320-500 bytes/sec | TICK messages (16 byte delta header when no creates/deletes) |

**Key insight**: Because field updates are NOT transmitted (deterministic simulation), bandwidth is minimal and scales with entity spawn/despawn rate, not entity count or movement frequency.

---

## Protocol Summary

### Key Insight: Zero-Coordination Assignment

**Server never tells clients what to send.** All clients independently compute identical assignments because they share:

| Shared Knowledge | Source |
|-----------------|--------|
| Frame number | Current tick (everyone knows) |
| Client list | Server broadcasts joins/leaves |
| Reliability scores | Server broadcasts ~1/second |
| Delta size | Deterministic simulation (everyone computes same delta) |

Every client runs the same assignment algorithm with the same inputs → same output.

```
Every tick:
┌─────────────────────────────────────────────────────────────────┐
│  SERVER                                                         │
│    │                                                            │
│    ├─► Broadcast inputs to all clients                         │
│    │                                                            │
│  CLIENTS (all, independently - no coordination needed)          │
│    │                                                            │
│    ├─► Simulate deterministically                               │
│    ├─► Compute stateDelta (identical across all clients)       │
│    ├─► Compute assignment: "Am I sender for a partition?"      │
│    │                                                            │
│    ├─► ALL send: { stateHash: 4 bytes }                        │
│    ├─► SENDERS send: { partitionId, partitionData }            │
│    │                                                            │
│  SERVER (passive - just collects and verifies)                  │
│    │                                                            │
│    ├─► Collect stateHashes → majority = correct                │
│    ├─► Collect partitions (only from clients with correct hash)│
│    ├─► Assemble complete delta from trusted partitions         │
│    ├─► Verify: hash(assembledState) == majorityStateHash       │
│    ├─► Broadcast assembled delta to all clients                │
│    └─► Update reliability scores                               │
│                                                                 │
│  If partition missing (sender had wrong hash or timed out):    │
│    └─► Request from ANY client with correct stateHash          │
└─────────────────────────────────────────────────────────────────┘

Periodic (every ~20 ticks / 1 second):
┌─────────────────────────────────────────────────────────────────┐
│  SERVER                                                         │
│    └─► Broadcast: { clientId → reliabilityScore } to all       │
│                                                                 │
│  CLIENTS                                                        │
│    └─► Cache scores locally for use in assignment algorithm    │
└─────────────────────────────────────────────────────────────────┘
```

### Why No Verifiers?

**The stateHash IS the verification.** If a client's stateHash matches the majority:
- They have the correct full state
- Therefore their partition data is correct
- Any client with correct stateHash can provide ANY partition on demand

**Redundancy is implicit:** Instead of pre-assigning backup verifiers, any of the ~95% of clients with correct stateHash can fill in for a missing partition.

---

## 1. Hash Specification

### State Hash
- **Size:** 4 bytes (32-bit xxHash)
- **Scope:** Full world state
- **Purpose:** Consensus verification + implicit partition verification

### Why 4 bytes is sufficient
- Collision probability: 1 in 2^32 (~4 billion)
- Attack window: ~50ms per tick
- Finding collision in 50ms while producing valid game state: impractical

---

## 2. Partition Assignment Algorithm

### Simplified Model: One Sender Per Partition

Since stateHash provides implicit verification, we only need ONE sender per partition.
Any client with correct stateHash can fill in if the assigned sender fails.

```javascript
function computeSenderAssignments(entityCount, clientIds, frame, reliability) {
  const numClients = clientIds.length;

  // Partitions by entity ID ranges
  // Fewer partitions = less coordination, more data per sender
  // More partitions = more parallelism, less data per sender
  const numPartitions = Math.min(
    Math.ceil(entityCount / 50),  // ~50 entities per partition
    Math.max(3, Math.floor(numClients / 2))  // At least 3, at most half of clients
  );

  // Select senders: one per partition, weighted by reliability
  const senders = weightedRandomPick(clientIds, numPartitions, frame, reliability);

  // Build assignments
  const assignments = new Map();  // partitionId -> senderId
  for (let p = 0; p < numPartitions; p++) {
    assignments.set(p, senders[p % senders.length]);
  }

  return { numPartitions, assignments };
}

// Each client checks: "Am I the sender for any partition?"
function getMyPartitions(myClientId, assignments) {
  const myPartitions = [];
  for (const [partitionId, senderId] of assignments) {
    if (senderId === myClientId) {
      myPartitions.push(partitionId);
    }
  }
  return myPartitions;
}

// Partition contents: all entities where entityId % numPartitions == partitionId
function getEntitiesForPartition(allEntities, partitionId, numPartitions) {
  return allEntities.filter(e => e.entityId % numPartitions === partitionId);
}
```

### Weighted Random Selection

```javascript
function weightedRandomPick(clientIds, count, frame, reliability) {
  // Seed RNG with frame for determinism
  const rng = xorshift128(frame);

  // Sort for stable ordering across all clients
  const sorted = [...clientIds].sort();

  // Get weights (default 1.0 for unknown clients)
  const weights = sorted.map(id => reliability.get(id) ?? 1.0);

  // Weighted Fisher-Yates shuffle
  const result = [];
  const remaining = sorted.map((id, i) => ({ id, weight: weights[i] }));

  for (let i = 0; i < count && remaining.length > 0; i++) {
    const totalWeight = remaining.reduce((sum, c) => sum + c.weight, 0);
    let random = rng.nextFloat() * totalWeight;

    let selected = 0;
    for (let j = 0; j < remaining.length; j++) {
      random -= remaining[j].weight;
      if (random <= 0) {
        selected = j;
        break;
      }
    }

    result.push(remaining[selected].id);
    remaining.splice(selected, 1);
  }

  return result;
}
```

---

## 3. Reliability Scoring

### Server-Side Tracking

```javascript
class ReliabilityTracker {
  scores = new Map();           // clientId -> score (0.0 to 2.0)
  latencies = new Map();        // clientId -> EMA latency

  readonly DECAY_ON_FAILURE = 0.7;
  readonly SMOOTHING = 0.1;
  readonly EXPECTED_LATENCY_MS = 50;

  update(clientId, responded, latencyMs) {
    const current = this.scores.get(clientId) ?? 1.0;

    if (!responded) {
      // Timeout: decay score
      this.scores.set(clientId, current * this.DECAY_ON_FAILURE);
    } else {
      // Success: reward, bonus for speed
      const speedScore = Math.max(0, 1 - latencyMs / (2 * this.EXPECTED_LATENCY_MS));
      const newScore = current * (1 - this.SMOOTHING) + (1 + speedScore) * this.SMOOTHING;
      this.scores.set(clientId, Math.min(2.0, newScore));

      // Track latency EMA
      const prevLatency = this.latencies.get(clientId) ?? latencyMs;
      this.latencies.set(clientId, prevLatency * 0.8 + latencyMs * 0.2);
    }
  }

  getScores() {
    return Object.fromEntries(this.scores);
  }

  // Remove departed clients
  remove(clientId) {
    this.scores.delete(clientId);
    this.latencies.delete(clientId);
  }
}
```

### Broadcasting Reliability Scores

```javascript
// Server broadcasts every N ticks (e.g., every 20 ticks = 1 second at 20Hz)
if (frame % 20 === 0) {
  broadcast({
    type: 'RELIABILITY_UPDATE',
    scores: reliabilityTracker.getScores()
  });
}
```

All clients receive the same scores and compute identical sender assignments.

---

## 4. Redundancy & Failover

### Why Missing a Tick is OK

Since all clients simulate deterministically, they already have the correct state locally.
The server's assembled delta serves only:
1. **Verification** - sanity check that everyone agrees
2. **Late joiners** - they need state to catch up
3. **Desync recovery** - fix clients who diverged

**If server can't assemble delta for one tick → in-sync clients are unaffected.**

### Client State Machine

```
NEW ──► SYNCING ──► ACTIVE ──► DISCONNECTED
            │                       │
            └───────────────────────┘
                   (reconnect)

NEW:      Just connected, no state yet
SYNCING:  Receiving full state, excluded from sender pool
ACTIVE:   Fully synced, eligible for sender selection
```

**Rule: Only ACTIVE clients are included in sender assignment calculations.**

### Mass Join Handling

```javascript
function onClientJoin(clientId) {
  // Mark as SYNCING - excluded from sender pool
  clientStates.set(clientId, 'SYNCING');

  // Assemble full state from existing ACTIVE clients
  const fullState = await assembleFullState();
  sendFullState(clientId, fullState, currentFrame);

  // After client confirms receipt, promote to ACTIVE
  clientStates.set(clientId, 'ACTIVE');

  // Broadcast updated client list
  broadcastClientList();
}
```

New clients don't disrupt assignments because they're excluded until synced.

### Mass Leave Handling

```javascript
function onMassDisconnect(departedClientIds) {
  // Remove from tracking immediately
  for (const id of departedClientIds) {
    clientStates.delete(id);
    reliabilityTracker.remove(id);
  }

  // Current tick's assignments may reference departed clients
  // Fallback chain handles it:
  //   1. Primary missing → promote verifier to primary
  //   2. All assigned senders missing → request from any ACTIVE client
  //   3. Not enough clients → skip verification (clients have local state)

  // Broadcast updated client list for next tick's assignments
  broadcastClientList();
}
```

### Adaptive Redundancy

Increase redundancy when client count is volatile:

```javascript
function computeRedundancy(numClients, recentChurn) {
  const BASE_REDUNDANCY = 3;
  const MAX_REDUNDANCY = 5;

  // If >10% churn in last 5 seconds, increase redundancy
  const churnRate = recentChurn / numClients;
  if (churnRate > 0.1) {
    return Math.min(MAX_REDUNDANCY, BASE_REDUNDANCY + 2);
  }

  return BASE_REDUNDANCY;
}
```

### Graceful Degradation Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│ Tier 1 - NORMAL                                                 │
│   All partitions received from assigned senders                 │
│   All verifier hashes match                                     │
│   Assembled hash matches majority stateHash                     │
│   → Full verification ✓                                         │
├─────────────────────────────────────────────────────────────────┤
│ Tier 2 - DEGRADED                                               │
│   Some partitions from fallback (verifier promoted to primary)  │
│   Assembled hash still matches majority                         │
│   → Verification OK, reliability scores updated                 │
├─────────────────────────────────────────────────────────────────┤
│ Tier 3 - MINIMAL                                                │
│   Some partitions requested from non-assigned ACTIVE clients    │
│   Assembled hash matches majority                               │
│   → Verification OK, but slower                                 │
├─────────────────────────────────────────────────────────────────┤
│ Tier 4 - SKIP                                                   │
│   Cannot assemble enough partitions                             │
│   Skip verification this tick                                   │
│   → Clients unaffected (they have correct local state)          │
│   → Late joiners wait one more tick                             │
└─────────────────────────────────────────────────────────────────┘
```

### Timeout Handling

```javascript
const PARTITION_TIMEOUT_MS = 100;  // Wait max 100ms for partition data

async function collectPartitions(assignments, timeout) {
  const results = new Map();
  const pending = new Set(assignments.map(a => a.partitionId));

  const deadline = Date.now() + timeout;

  while (pending.size > 0 && Date.now() < deadline) {
    // Wait for incoming partition data
    const { partitionId, clientId, data, hash } = await receiveNext();

    const assignment = assignments.find(a => a.partitionId === partitionId);
    if (!assignment) continue;

    if (clientId === assignment.primary) {
      // Primary sent data
      results.set(partitionId, { data, from: clientId });
      pending.delete(partitionId);
    } else if (assignment.verifiers.includes(clientId)) {
      // Verifier sent hash - store for verification
      if (!results.has(partitionId)) {
        results.set(partitionId, { verifierHashes: [] });
      }
      results.get(partitionId).verifierHashes.push({ clientId, hash });
    }
  }

  // For any missing partitions, request from verifiers
  for (const partitionId of pending) {
    const assignment = assignments.find(a => a.partitionId === partitionId);
    const fallback = assignment.verifiers[0];
    if (fallback) {
      requestFullPartition(fallback, partitionId);
      // Mark primary as unreliable
      reliabilityTracker.update(assignment.primary, false, 0);
    }
  }

  return results;
}
```

### Verification Flow

```javascript
function verifyPartitions(results, assignments) {
  const errors = [];

  for (const assignment of assignments) {
    const result = results.get(assignment.partitionId);
    if (!result?.data) {
      errors.push({ partitionId: assignment.partitionId, error: 'missing' });
      continue;
    }

    const dataHash = xxhash32(result.data);

    // Check against verifier hashes
    for (const { clientId, hash } of (result.verifierHashes || [])) {
      if (hash !== dataHash) {
        errors.push({
          partitionId: assignment.partitionId,
          error: 'hash_mismatch',
          primary: result.from,
          verifier: clientId,
          expectedHash: hash,
          actualHash: dataHash
        });
      }
    }
  }

  return errors;
}
```

---

## 5. Message Formats

### Client → Server

#### STATE_HASH (every tick, all clients)
```
[type: 1 byte = 0x30]
[frame: 4 bytes]
[stateHash: 4 bytes]
```
**Total: 9 bytes**

#### PARTITION_DATA (assigned senders only)
```
[type: 1 byte = 0x31]
[frame: 4 bytes]
[partitionId: 1 byte]
[dataLength: 2 bytes]
[data: N bytes]
```
**Total: 8 + N bytes**

#### PARTITION_REQUEST (server requesting missing partition)
```
[type: 1 byte = 0x32]
[frame: 4 bytes]
[partitionId: 1 byte]
```
**Total: 6 bytes**

### Server → Client

#### TICK (every tick)
```
[type: 1 byte = 0x01]
[frame: 4 bytes]
[inputCount: 2 bytes]
[inputs: ...]
[deltaLength: 4 bytes]
[delta: N bytes]           // Assembled state delta
[assembledHash: 4 bytes]   // For client verification
```

#### RELIABILITY_UPDATE (periodic)
```
[type: 1 byte = 0x33]
[count: 2 bytes]
[entries: count × (clientIdHash: 4 bytes, score: 2 bytes)]  // score as fixed-point
```

---

## 6. Bandwidth Analysis

### Per-Client Upload Bandwidth

| Client Role | Per Tick | Per Second (20Hz) |
|-------------|----------|-------------------|
| Non-sender (90% of ticks) | 4 bytes (stateHash only) | 80 bytes/sec |
| Sender (10% of ticks) | ~154 bytes (hash + partition) | 3,080 bytes/sec |
| **Average per client** | ~19 bytes | **~380 bytes/sec** |

### Total Upload to Server (100 clients, 10 partitions)

```
Per tick:
  100 × 4 bytes (STATE_HASH)           = 400 bytes
  10 × ~150 bytes (PARTITION_DATA)     = 1,500 bytes
  ─────────────────────────────────────────────────
  Total: ~1.9KB per tick = 38KB/sec to server
```

### Per-Client Download Bandwidth

```
TICK message (server → each client):
  - frame + header:     8 bytes
  - inputs (100 players × 20 bytes): ~2KB
  - majorityHash:       4 bytes
  ─────────────────────────────────────────────────
  Total: ~2KB per tick = ~40KB/sec per client

Note: Assembled delta NOT sent to in-sync clients.
They already computed it locally via deterministic simulation.
Delta only sent on-demand for late joiners or desync recovery.
```

### Summary

| Direction | Per Client | Total (100 clients) |
|-----------|------------|---------------------|
| Upload | ~380 bytes/sec | ~38KB/sec |
| Download | ~40KB/sec | N/A (broadcast) |
| Server egress | N/A | ~4MB/sec |

**Upload is well under 10KB/sec target.**

---

## 7. Desync Detection & Recovery

### Detection

```javascript
function detectDesync(stateHashes) {
  // Count occurrences of each hash
  const counts = new Map();
  for (const [clientId, hash] of stateHashes) {
    counts.set(hash, (counts.get(hash) ?? []).concat(clientId));
  }

  // Find majority hash
  let majorityHash = null;
  let majorityCount = 0;
  for (const [hash, clients] of counts) {
    if (clients.length > majorityCount) {
      majorityHash = hash;
      majorityCount = clients.length;
    }
  }

  // Identify desynced clients
  const desynced = [];
  for (const [hash, clients] of counts) {
    if (hash !== majorityHash) {
      desynced.push(...clients);
    }
  }

  return { majorityHash, majorityCount, desynced };
}
```

### Recovery

```javascript
async function recoverDesyncedClient(clientId, currentFrame) {
  // Request merkle tree from majority client
  const trustedClient = pickTrustedClient();
  const merkleRoot = await requestMerkleRoot(trustedClient);

  // Binary search to find divergence point
  const divergencePartition = await findDivergence(clientId, trustedClient);

  // Send only the divergent partition
  const partitionData = await requestPartition(trustedClient, divergencePartition);

  sendToClient(clientId, {
    type: 'PARTITION_CORRECTION',
    frame: currentFrame,
    partitionId: divergencePartition,
    data: partitionData
  });
}
```

---

## 8. Late Joiner Sync

### Protocol

```
1. New client connects
2. Server identifies N most reliable clients
3. Each assigned a partition of full state (not delta)
4. Collect + assemble full state
5. Send to late joiner with current frame number
6. Late joiner applies state, begins normal sync
```

### Optimization: Parallel Collection

```javascript
async function assembleStateForLateJoiner() {
  const fullStateSize = getCurrentStateSize();
  const numPartitions = Math.ceil(fullStateSize / MAX_PARTITION_SIZE);

  // Pick reliable clients for each partition
  const assignments = computeFullStateAssignments(numPartitions);

  // Request all partitions in parallel
  const partitions = await Promise.all(
    assignments.map(a => requestFullStatePartition(a.primary, a.partitionId))
  );

  // Assemble and verify
  const fullState = assemblePartitions(partitions);
  const hash = xxhash32(fullState);

  // Verify against majority
  if (hash !== getMajorityStateHash()) {
    throw new Error('Assembled state hash mismatch');
  }

  return fullState;
}
```

---

## 9. Implementation Phases

### Phase 1: Core Protocol (modu-engine)
- [ ] Implement xxhash32 for state/partition hashing
- [ ] Add `computeStateDelta()` - diff between frames
- [ ] Add `computeStateHash()` - hash full state
- [ ] Add partition serialization/deserialization
- [ ] Remove rollback system (cleanup)

### Phase 2: Network Protocol (modu-network)
- [ ] Add new message types (STATE_HASH, PARTITION_DATA, PARTITION_HASH)
- [ ] Implement sender assignment algorithm
- [ ] Add reliability tracking on server
- [ ] Add reliability broadcast
- [ ] Modify TICK to include assembled delta

### Phase 3: Verification System
- [ ] Implement partition collection with timeouts
- [ ] Add verification (primary vs verifier hashes)
- [ ] Add desync detection
- [ ] Add partition-level recovery

### Phase 4: Late Joiner Optimization
- [ ] Implement parallel full-state collection
- [ ] Add merkle tree for efficient divergence detection
- [ ] Optimize partition sizes based on measured performance

### Phase 5: Hardening
- [ ] Add metrics/monitoring for sync health
- [ ] Tune timeouts and reliability scoring
- [ ] Load testing with 100+ simulated clients
- [ ] Edge case handling (mass disconnect, network partition)

---

## 10. Engine/Network Interface

### Engine Exports (modu-engine)

```typescript
interface StateSyncEngine {
  // Compute delta from previous frame
  computeStateDelta(prevFrame: number, currentFrame: number): Uint8Array;

  // Hash the full state
  computeStateHash(): number;  // 4-byte xxhash

  // Get partition of delta
  getPartition(delta: Uint8Array, partitionId: number, numPartitions: number): Uint8Array;

  // Apply assembled delta
  applyStateDelta(delta: Uint8Array): void;

  // Apply full state (for late joiners)
  applyFullState(state: Uint8Array): void;

  // Get full state (for late joiner source)
  getFullState(): Uint8Array;

  // Get partition of full state
  getFullStatePartition(partitionId: number, numPartitions: number): Uint8Array;
}
```

### Network Exports (modu-network)

```typescript
interface StateSyncNetwork {
  // Called by engine after simulation
  sendStateHash(hash: number): void;
  sendPartitionData(partitionId: number, data: Uint8Array): void;
  sendPartitionHash(partitionId: number, hash: number): void;

  // Callbacks from network to engine
  onSenderAssignment(assignments: PartitionAssignment[]): void;
  onAssembledDelta(delta: Uint8Array, hash: number): void;
  onReliabilityUpdate(scores: Map<string, number>): void;
  onPartitionCorrection(partitionId: number, data: Uint8Array): void;
}
```

---

## 11. Critical Analysis - Design Gaps & Required Fixes

### CRITICAL: Floating-Point in Assignment Algorithm

**Problem:** `weightedRandomPick` uses `rng.nextFloat() * totalWeight` - floating-point arithmetic is NOT deterministic across platforms/browsers.

**Fix:**
```javascript
// Use fixed-point arithmetic for weight selection
function weightedRandomPickFixed(clientIds, count, frame, reliability) {
  const rng = xorshift128(frame);
  const sorted = [...clientIds].sort();

  // Convert weights to fixed-point (16.16)
  const FP_SHIFT = 16;
  const weightsFixed = sorted.map(id => {
    const w = reliability.get(id) ?? 1.0;
    return Math.round(w * (1 << FP_SHIFT));
  });

  const result = [];
  const remaining = sorted.map((id, i) => ({ id, weight: weightsFixed[i] }));

  for (let i = 0; i < count && remaining.length > 0; i++) {
    const totalWeight = remaining.reduce((sum, c) => sum + c.weight, 0);
    // Use integer modulo, not float
    let random = Math.abs(rng.nextInt()) % totalWeight;

    let selected = 0;
    for (let j = 0; j < remaining.length; j++) {
      random -= remaining[j].weight;
      if (random < 0) {
        selected = j;
        break;
      }
    }

    result.push(remaining[selected].id);
    remaining.splice(selected, 1);
  }

  return result;
}
```

---

### CRITICAL: Client List Version Mismatch

**Problem:** Clients compute assignments based on their local client list. If client A sees `[1,2,3,4,5]` but client B hasn't received the "client 5 joined" broadcast yet, they compute different assignments.

**Fix:** Version the client list and include version in assignment computation.

```javascript
// Server broadcasts versioned client list
{
  type: 'CLIENT_LIST_UPDATE',
  version: 42,
  activeClients: ['a', 'b', 'c']  // Only ACTIVE ones for assignments
}

// Assignment computation includes version in seed
function computeSenderAssignments(deltaSize, clientListVersion, clientIds, frame, reliability) {
  // Seed combines frame AND client list version
  const seed = hashCombine(frame, clientListVersion);
  const rng = xorshift128(seed);
  // ...
}

// Messages include client list version
// Server rejects submissions with wrong version
```

---

### CRITICAL: Reliability Score Synchronization

**Problem:** Reliability scores are broadcast every ~20 ticks. If a client misses the broadcast (packet loss), they have stale scores and compute wrong assignments.

**Fix:** Version reliability scores, include version in TICK, clients request if behind.

```javascript
// Every TICK includes current reliability version
{
  type: 'TICK',
  frame: 100,
  reliabilityVersion: 17,  // Current version
  // ...
}

// Client checks on every tick
function onTick(tick) {
  if (tick.reliabilityVersion > myReliabilityVersion) {
    // I'm behind - request current scores
    requestReliabilityScores();
    // Don't participate in sending until synced
  }
}
```

---

### CRITICAL: Partition Boundary Splits Entities

**Problem:** `byteStart/byteEnd` slices at arbitrary byte boundaries. If delta is serialized as `[entityId, fields...]`, cutting at byte 256 might split an entity in half.

**Fix:** Partition by entity ID, not by bytes.

```javascript
// Partition assignment is by entityId, not byte range
function getEntityPartition(entityId, numPartitions) {
  return entityId % numPartitions;
}

// Delta format: grouped by partition
interface PartitionDelta {
  partitionId: number;
  entities: EntityDelta[];  // All entities where entityId % numPartitions == partitionId
}

// Each client computes which entities belong to their partition
function getMyPartitionDelta(allChanges, myPartitionId, numPartitions) {
  return allChanges.filter(e => e.entityId % numPartitions === myPartitionId);
}
```

This ensures:
- Same entity always in same partition (deterministic)
- No entity is split across partitions
- Clients independently compute partition membership

---

### CRITICAL: Frame Synchronization

**Problem:** Client A finishes frame 100 and sends delta. Client B is still on frame 99. Server receives submissions for different frames.

**Fix:** Server-driven frame advancement.

```javascript
// Server controls frame timing
class ServerTickManager {
  currentFrame = 0;
  submissions = new Map();  // frame -> { stateHashes, partitions }

  // Server broadcasts TICK which advances clients
  broadcastTick() {
    broadcast({
      type: 'TICK',
      frame: this.currentFrame,
      inputs: getInputsForFrame(this.currentFrame),
      deadline: Date.now() + SUBMISSION_WINDOW_MS
    });

    // Wait for submissions
    setTimeout(() => this.collectAndVerify(), SUBMISSION_WINDOW_MS);
  }

  onSubmission(clientId, frame, data) {
    if (frame !== this.currentFrame) {
      // Wrong frame - reject
      return;
    }
    this.submissions.get(frame).add({ clientId, data });
  }

  collectAndVerify() {
    const submissions = this.submissions.get(this.currentFrame);
    // ... verify and assemble ...

    this.currentFrame++;
    this.broadcastTick();
  }
}
```

---

### HIGH: Partition Trust Model (Replaces Verifiers)

**Problem:** How do we trust partition data without verifiers?

**Solution:** Use stateHash as the trust signal.

```javascript
function collectPartitions(frame, submissions, majorityHash) {
  const trustedPartitions = new Map();

  for (const { clientId, stateHash, partitionId, data } of submissions) {
    // Only accept partitions from clients with correct stateHash
    if (stateHash === majorityHash) {
      trustedPartitions.set(partitionId, { clientId, data });
    } else {
      // This client is desynced - mark for potential resync
      markForResync(clientId);
    }
  }

  return trustedPartitions;
}

// If a partition is missing (assigned sender was desynced or timed out)
function fillMissingPartition(partitionId, frame, majorityHash) {
  // Any client with correct stateHash can provide any partition
  const trustedClients = getClientsWithHash(majorityHash);
  const fallback = pickRandom(trustedClients);

  return requestPartition(fallback, partitionId, frame);
}
```

**Why this works:**
- If sender's stateHash matches majority → they have correct state → their partition is correct
- If sender's stateHash doesn't match → reject their partition, use fallback
- Any correct client can provide any partition on demand

---

### Delta Format Specification (IMPLEMENTED ✅)

The delta format is designed for **deterministic simulation** where all clients compute identical field values. Only structural changes need to be transmitted.

```typescript
// Delta Format - Structural Changes Only
interface StateDelta {
  frame: number;
  baseHash: number;              // Hash of state BEFORE this delta
  resultHash: number;            // Hash of state AFTER this delta

  created: CreatedEntity[];      // New entities this frame
  deleted: number[];             // Deleted entity IDs
  // NOTE: No 'updated' field - deterministic simulation means all clients
  // compute identical field values from the same inputs
}

interface CreatedEntity {
  eid: number;
  type: string;
  clientId?: number;
  components: Record<string, Record<string, number>>;  // All component data
}

// Serialization: JSON (can optimize to binary later)
// Typical size: 16 bytes when no creates/deletes (just header)
// Created entity: ~50-100 bytes (includes all component data)
// Deleted entity: ~4 bytes (just the eid)
```

**Why no field updates?**

In deterministic lockstep, all clients run identical simulation code with identical inputs. This means:
- Position changes are computed locally, not transmitted
- Velocity changes are computed locally, not transmitted
- All field values are identical across clients by definition

Only **structural changes** (entity creation/deletion) require transmission because they involve non-deterministic allocation (entity IDs, timing of spawns).

---

### HIGH: Input Latency Strategy

**Problem:** Rollback is removed but no replacement for handling input latency. Pure lockstep at 20Hz = 50ms+ input lag minimum.

**Fix:** Define input prediction model.

```javascript
// Local player prediction (client-side)
const INPUT_DELAY_FRAMES = 2;  // Send input for frame N+2

function onLocalInput(input) {
  const targetFrame = currentFrame + INPUT_DELAY_FRAMES;

  // Apply to local player immediately (prediction)
  predictLocalPlayer(input, targetFrame);

  // Send to server for target frame
  sendInput({ frame: targetFrame, input });

  // Store for reconciliation
  predictions.set(targetFrame, input);
}

// On receiving authoritative delta
function onDelta(delta) {
  // Check prediction accuracy
  const predicted = predictions.get(delta.frame);
  const actual = delta.getPlayerState(localPlayerId);

  if (!statesMatch(predicted, actual)) {
    // Misprediction - smoothly correct
    smoothCorrect(actual, CORRECTION_FRAMES);
  }

  predictions.delete(delta.frame);
}
```

---

### HIGH: State Accumulation / Periodic Full Verification

**Problem:** Incremental deltas could accumulate errors. A single corrupted delta causes permanent divergence.

**Fix:** Periodic full-state verification.

```javascript
const FULL_STATE_CHECK_INTERVAL = 100;  // Every 5 seconds at 20Hz

function onTick(frame) {
  const isFullCheckFrame = (frame % FULL_STATE_CHECK_INTERVAL === 0);

  if (isFullCheckFrame) {
    // Full state verification
    sendFullStateHash(computeFullStateHash());
  } else {
    // Normal delta verification
    sendStateHash(computeDeltaHash());
  }
}

// Server on full check frame
function verifyFullState(frame, clientHashes) {
  const majority = getMajority(clientHashes);

  // Anyone not matching majority needs full resync
  for (const [clientId, hash] of clientHashes) {
    if (hash !== majority.hash) {
      triggerFullResync(clientId);
    }
  }
}
```

---

### HIGH: First Client Bootstrap

**Problem:** First client joins empty room. No one to sync from.

**Fix:**

```javascript
function onClientJoin(clientId, roomId) {
  const room = rooms.get(roomId);

  if (!room || room.clients.size === 0) {
    // First client - bootstrap
    const initialState = createEmptyWorldState();

    room = {
      clients: new Set([clientId]),
      state: initialState,
      stateHash: xxhash32(initialState),
      frame: 0,
      clientListVersion: 1,
      reliabilityVersion: 1
    };
    rooms.set(roomId, room);

    clientStates.set(clientId, 'ACTIVE');  // Immediately active

    sendToClient(clientId, {
      type: 'ROOM_CREATED',
      frame: 0,
      state: initialState,
      clientListVersion: 1,
      reliabilityScores: {}
    });
  } else {
    // Late joiner - normal sync
    clientStates.set(clientId, 'SYNCING');
    // ... existing late joiner flow ...
  }
}
```

---

### MEDIUM: Network Partition Detection

**Problem:** Network splits room into two groups. Each has internal "majority."

**Fix:**

```javascript
const MIN_QUORUM = 0.6;  // Need 60% of peak clients

class PartitionDetector {
  peakClients = 0;
  lastFullQuorum = Date.now();

  onClientCountChange(count) {
    this.peakClients = Math.max(this.peakClients, count);

    const ratio = count / this.peakClients;

    if (ratio >= MIN_QUORUM) {
      this.lastFullQuorum = Date.now();
    }
  }

  isPartitioned() {
    const currentRatio = activeClients.size / this.peakClients;
    const timeSinceQuorum = Date.now() - this.lastFullQuorum;

    // Partitioned if: low ratio AND sustained for > 5 seconds
    return currentRatio < MIN_QUORUM && timeSinceQuorum > 5000;
  }
}

// On partition detection
if (partitionDetector.isPartitioned()) {
  // Enter read-only mode: simulate locally but don't send deltas
  // Prevents split-brain state divergence
  enterPartitionMode();
}
```

---

### MEDIUM: Memory / History Pruning

**Fix:**

```javascript
const HISTORY_LIMITS = {
  deltaFrames: 60,        // ~3 seconds at 20Hz
  fullSnapshots: 3,       // Keep 3 periodic snapshots
  inputFrames: 120,       // ~6 seconds of inputs
  reliabilityHistory: 10  // Last 10 reliability broadcasts
};

function pruneHistory(currentFrame) {
  // Prune deltas
  const minDeltaFrame = currentFrame - HISTORY_LIMITS.deltaFrames;
  for (const [frame] of deltaHistory) {
    if (frame < minDeltaFrame) deltaHistory.delete(frame);
  }

  // Prune inputs
  const minInputFrame = currentFrame - HISTORY_LIMITS.inputFrames;
  for (const [frame] of inputHistory) {
    if (frame < minInputFrame) inputHistory.delete(frame);
  }

  // Prune snapshots (keep most recent N)
  while (snapshotHistory.length > HISTORY_LIMITS.fullSnapshots) {
    snapshotHistory.shift();
  }
}
```

---

### MEDIUM: Merkle Tree Specification

**Fix:**

```typescript
// Merkle tree for O(log n) divergence detection
const MERKLE_LEAF_SIZE = 16;  // Max entities per leaf

interface MerkleNode {
  hash: number;
  isLeaf: boolean;
  left?: MerkleNode;
  right?: MerkleNode;
  entityIds?: number[];  // Only for leaves
}

function buildMerkleTree(entities: Map<number, EntityState>): MerkleNode {
  const sorted = [...entities.entries()].sort((a, b) => a[0] - b[0]);
  return buildNode(sorted, 0, sorted.length);
}

function buildNode(entries: [number, EntityState][], start: number, end: number): MerkleNode {
  if (end - start <= MERKLE_LEAF_SIZE) {
    const slice = entries.slice(start, end);
    const hash = hashEntities(slice.map(e => e[1]));
    return { hash, isLeaf: true, entityIds: slice.map(e => e[0]) };
  }

  const mid = Math.floor((start + end) / 2);
  const left = buildNode(entries, start, mid);
  const right = buildNode(entries, mid, end);

  return {
    hash: xxhash32(new Uint8Array([...toBytes(left.hash), ...toBytes(right.hash)])),
    isLeaf: false,
    left,
    right
  };
}

// Find divergent entities in O(log n)
function findDivergentEntities(local: MerkleNode, remote: MerkleNode): number[] {
  if (local.hash === remote.hash) return [];
  if (local.isLeaf) return local.entityIds!;

  return [
    ...findDivergentEntities(local.left!, remote.left!),
    ...findDivergentEntities(local.right!, remote.right!)
  ];
}
```

---

### LOW: Compression

**Fix:**

```javascript
const COMPRESSION_THRESHOLD = 512;  // Compress if > 512 bytes

function encodePartitionData(data: Uint8Array): Uint8Array {
  if (data.length <= COMPRESSION_THRESHOLD) {
    // Small - send raw with uncompressed flag
    return new Uint8Array([0x00, ...data]);
  }

  const compressed = lz4.compress(data);
  if (compressed.length < data.length * 0.85) {
    // Good compression - send compressed
    return new Uint8Array([0x01, ...compressed]);
  }

  // Compression not worth it
  return new Uint8Array([0x00, ...data]);
}
```

---

## 12. Remaining Open Questions

1. **Cheat detection thresholds** - How many desyncs before kick?
2. **Partition healing strategy** - Automatic or require admin intervention?
3. **Input prediction tuning** - How many frames of local prediction? (2-4?)
4. **Compression algorithm** - lz4 vs zstd vs none?
5. **Max concurrent late joiners** - Limit to prevent overwhelming ACTIVE clients?
