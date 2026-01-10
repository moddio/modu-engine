# Modu Engine TODO

## Distributed State Sync

### Implemented

- [x] **State hashing** - xxHash32 of full world state each tick
- [x] **Hash broadcasting** - Clients send 9-byte STATE_HASH messages (type + frame + hash)
- [x] **Majority hash computation** - Server computes and broadcasts majority hash in TICK
- [x] **Desync detection** - Client compares local hash to majority hash
- [x] **Hard recovery** - Full snapshot request + apply on desync
- [x] **Detailed diagnostics** - Field-by-field diff logging on desync
- [x] **Rolling sync stats** - Track % of hash checks that pass
- [x] **Debug UI integration** - Shows sync %, hash, desynced/resyncing status
- [x] **Delta computation** - Only includes created/updated/deleted entities
- [x] **Partition assignment algorithm** - Deterministic, reliability-weighted, frame-seeded
- [x] **Client-side partition sending** - Clients send assigned partition data

### Not Implemented

#### High Priority

- [x] **Server-side partition collection** - Server collects partition data from clients
  - Receive PARTITION_DATA messages
  - Track which partitions received per frame
  - PartitionCollector class implemented

- [x] **Majority hash in TICK** - Server broadcasts majority hash to clients
  - TICK format updated: [type:1][frame:4][snapshotFrame:4][majorityHash:4][hashLen:1][hash:N][count:1][inputs...]
  - Clients compare local hash against majorityHash for desync detection

- [ ] **Server-side partition assembly** - Assemble full delta from collected partitions
  - Combine partitions into complete delta
  - Verify assembled hash matches majority stateHash
  - Broadcast assembled delta to late joiners / desynced clients

- [ ] **Client list versioning** - Prevent assignment mismatches during joins/leaves
  - Server broadcasts versioned client list
  - Include version in assignment computation seed
  - Reject submissions with wrong version

- [ ] **Reliability score versioning** - Prevent assignment mismatches from missed broadcasts
  - Include reliability version in TICK message
  - Clients request scores if behind
  - Don't participate in sending until synced

#### Medium Priority

- [ ] **Late joiner from partitions** - Assemble full state from multiple clients
  - Currently: late joiners get full snapshot from authority
  - Goal: request partitions from multiple reliable clients in parallel
  - Reduces load on single authority client

- [ ] **Partition-level recovery** - More efficient than full snapshot
  - Use Merkle tree to identify divergent partitions
  - Only request/send divergent partitions
  - O(log n) divergence detection

- [ ] **Binary delta format** - Replace JSON serialization
  - Define compact binary format for deltas
  - Reduce serialization overhead
  - ~50% size reduction expected

- [ ] **Compression** - LZ4 for partition data
  - Only compress if > 512 bytes
  - Skip if compression ratio < 85%
  - ~30-50% additional size reduction

#### Low Priority

- [ ] **Network partition detection** - Detect split-brain scenarios
  - Track peak client count
  - Enter read-only mode if quorum lost
  - Prevent divergent state evolution

- [ ] **Adaptive redundancy** - Increase senders during high churn
  - Monitor join/leave rate
  - Increase sendersPerPartition when volatile
  - Return to normal when stable

- [ ] **Cheat detection thresholds** - Auto-kick persistent desyncs
  - Track desync frequency per client
  - Warn after N desyncs
  - Kick after M desyncs in time window

- [ ] **Metrics/monitoring** - Sync health dashboard
  - Partition collection success rate
  - Average assembly time
  - Bandwidth per client
  - Desync frequency

## Current Bandwidth

| Direction | Per Client | Notes |
|-----------|------------|-------|
| Upload (idle) | ~180 B/s | 9 bytes × 20 fps (STATE_HASH only) |
| Upload (moving) | ~200-500 B/s | STATE_HASH + partition deltas |
| Download | ~2-4 KB/s | TICK messages with inputs + majorityHash |

## Target Bandwidth (with full implementation)

| Direction | Per Client | Notes |
|-----------|------------|-------|
| Upload | ~380 B/s average | STATE_HASH + occasional partition data |
| Download | ~40 KB/s | TICK with inputs (scales with player count) |

## Files

- `src/sync/state-delta.ts` - Delta computation and serialization
- `src/sync/partition.ts` - Partition assignment algorithm
- `src/game.ts` - Game class with sendStateSync()
- `src/hash/xxhash.ts` - xxHash32 implementation
- `docs/STATE_SYNC_DESIGN.md` - Full design document

## Testing

```bash
# Run all sync tests
npm test -- src/sync/

# Run specific test file
npm test -- src/sync/partition-sync.test.ts
```

## Notes

- Partition sync requires server support for PARTITION_DATA message type (0x31)
- Current implementation sends partitions but server doesn't use them yet
- Hard recovery (full snapshot) is the fallback for all desync scenarios
- All partition assignment is deterministic - clients compute independently with same result
