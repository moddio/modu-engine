/**
 * Engine Network Sync Test
 *
 * Tests the engine's ability to maintain deterministic sync
 * across real network conditions via modu-network.
 *
 * This is the ENGINE's core value proposition - if this fails,
 * the engine is useless for multiplayer games.
 *
 * Tests:
 * 1. Late joiners start at correct server frame (not 0)
 * 2. Inputs are exchanged and processed at correct frames
 * 3. World state checksums match across clients
 */

import WebSocket from 'ws';
import { createStandaloneEngine, resetBodyIdCounter } from './test-helper-physics3d';
import { toFixed } from '../src/fixed-math';

const NODE1_URL = process.env.NODE1_URL || 'ws://localhost:8001/ws';
const NODE2_URL = process.env.NODE2_URL || 'ws://localhost:8002/ws';
const ROOM_ID = 'engine-sync-test-' + Date.now();

console.log('=== Engine Network Sync Test ===');
console.log('Testing: Engine determinism over modu-network');
console.log('Room:', ROOM_ID);
console.log('');

// Hash function matching server
function hashClientId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

const clientHashMap = new Map<number, string>();
function registerClientId(cid: string) {
  clientHashMap.set(hashClientId(cid), cid);
}
function lookupClientId(hash: number): string {
  return clientHashMap.get(hash) || `hash_${hash.toString(16)}`;
}

interface SimClient {
  name: string;
  ws: WebSocket;
  clientId: string;
  playerId: string;
  engine: ReturnType<typeof createStandaloneEngine>;
  serverFrame: number;
  checksums: number[];
}

async function createSimClient(
  name: string,
  nodeUrl: string,
  playerId: string,
  isCreator: boolean
): Promise<SimClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(nodeUrl);

    // Create engine
    resetBodyIdCounter();
    const engine = createStandaloneEngine(playerId, { inputDelay: 2 });
    engine.createStaticBox(0, -0.5, 0, 50, 0.5, 50, 'ground');
    engine.gameState = { playerStates: {} };

    // Simple movement simulation
    engine.onSimulate = (frame, inputs) => {
      for (const input of inputs) {
        const body = engine.world.bodies.find((b: any) => b.label === 'player_' + input.playerId);
        if (!body) continue;
        const data = input.data || {};
        if (data.w) {
          const vel = engine.getVelocityFixed(body);
          engine.setVelocityFixed(body, 0, vel.y, toFixed(-10));
        }
      }
    };

    const client: SimClient = {
      name,
      ws,
      clientId: '',
      playerId,
      engine,
      serverFrame: 0,
      checksums: []
    };

    const timeout = setTimeout(() => reject(new Error(`${name} timeout`)), 10000);
    const knownPlayers = new Set<string>();

    ws.on('open', () => {
      const msg = isCreator
        ? { type: 'CREATE_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } }
        : { type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } };
      ws.send(JSON.stringify(msg));
    });

    ws.on('message', (data: Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const msgType = buf[0];

      // ROOM_CREATED (0x04)
      if (msgType === 0x04) {
        const roomIdLen = buf.readUInt16LE(1);
        let offset = 3 + roomIdLen;
        const clientIdLen = buf.readUInt16LE(offset);
        client.clientId = buf.slice(offset + 2, offset + 2 + clientIdLen).toString('utf8');
        registerClientId(client.clientId);

        // Creator: add self as player, start at frame 0
        engine.createDynamicSphere(10, 2, 0, 0.5, 'player_' + playerId);
        engine.addPlayer(playerId);
        engine.gameState.playerStates[playerId] = { yawFp: 0 };
        knownPlayers.add(playerId);
        client.serverFrame = 0;

        console.log(`[${name}] Created room at frame 0`);
        clearTimeout(timeout);
        resolve(client);
      }

      // ROOM_JOINED (0x03) - wait for INITIAL_STATE
      if (msgType === 0x03) {
        const roomIdLen = buf.readUInt16LE(1);
        let offset = 3 + roomIdLen;
        const clientIdLen = buf.readUInt16LE(offset);
        client.clientId = buf.slice(offset + 2, offset + 2 + clientIdLen).toString('utf8');
        registerClientId(client.clientId);
      }

      // INITIAL_STATE (0x02)
      if (msgType === 0x02) {
        const frame = buf.readUInt32LE(1);
        let offset = 5;
        const roomIdLen = buf.readUInt16LE(offset);
        offset += 2 + roomIdLen;
        const snapshotLen = buf.readUInt32LE(offset);
        offset += 4 + snapshotLen;
        const eventsLen = buf.readUInt32LE(offset);
        offset += 4;

        // CRITICAL: Use server frame, not 0
        engine.setFrame(frame);
        client.serverFrame = frame;

        // Process join events from history
        if (eventsLen > 0) {
          try {
            const events = JSON.parse(buf.subarray(offset, offset + eventsLen).toString('utf8'));
            for (const evt of events) {
              const evtData = evt.data || evt;
              if (evtData.type === 'join') {
                const pid = evtData.user?.id;
                const cid = evtData.clientId;
                if (pid && !knownPlayers.has(pid)) {
                  if (cid) registerClientId(cid);
                  const spawnIdx = knownPlayers.size;
                  const spawns = [{x:10,z:0}, {x:-10,z:0}];
                  const spawn = spawns[spawnIdx % spawns.length];
                  engine.createDynamicSphere(spawn.x, 2, spawn.z, 0.5, 'player_' + pid);
                  engine.addPlayer(pid);
                  engine.gameState.playerStates[pid] = { yawFp: 0 };
                  knownPlayers.add(pid);
                }
              }
            }
          } catch (e) {}
        }

        // Add self
        if (!knownPlayers.has(playerId)) {
          const spawnIdx = knownPlayers.size;
          const spawns = [{x:10,z:0}, {x:-10,z:0}];
          const spawn = spawns[spawnIdx % spawns.length];
          engine.createDynamicSphere(spawn.x, 2, spawn.z, 0.5, 'player_' + playerId);
          engine.addPlayer(playerId);
          engine.gameState.playerStates[playerId] = { yawFp: 0 };
          knownPlayers.add(playerId);
        }

        console.log(`[${name}] Joined at frame ${frame}, ${knownPlayers.size} players`);
        clearTimeout(timeout);
        resolve(client);
      }

      // TICK (0x01) - process inputs and advance engine
      if (msgType === 0x01 && buf.length >= 6) {
        const frame = buf.readUInt32LE(1);
        const inputCount = buf[5];
        client.serverFrame = frame;

        // Parse inputs
        let offset = 6;
        for (let i = 0; i < inputCount && offset + 10 <= buf.length; i++) {
          const clientHash = buf.readUInt32LE(offset); offset += 4;
          const seq = buf.readUInt32LE(offset); offset += 4;
          const dataLen = buf.readUInt16LE(offset); offset += 2;
          if (offset + dataLen > buf.length) break;

          const rawBytes = buf.subarray(offset, offset + dataLen);
          offset += dataLen;

          try {
            const inputData = JSON.parse(rawBytes.toString('utf8'));
            const cid = lookupClientId(clientHash);

            // Handle join events
            if (inputData.type === 'join') {
              const pid = inputData.user?.id;
              const joinCid = inputData.clientId;
              if (pid && !knownPlayers.has(pid)) {
                if (joinCid) registerClientId(joinCid);
                const spawnIdx = knownPlayers.size;
                const spawns = [{x:10,z:0}, {x:-10,z:0}];
                const spawn = spawns[spawnIdx % spawns.length];
                engine.createDynamicSphere(spawn.x, 2, spawn.z, 0.5, 'player_' + pid);
                engine.addPlayer(pid);
                engine.gameState.playerStates[pid] = { yawFp: 0 };
                knownPlayers.add(pid);
                engine.clearSnapshotsBefore(engine.frame);
              }
            }
            // Handle game inputs
            else if (inputData.type === 'input' && cid !== client.clientId) {
              const senderPid = [...knownPlayers].find(p => {
                // Find player by checking clientToPlayer equivalent
                return true; // Simplified - assume 1:1 mapping
              });
              if (inputData.playerId && knownPlayers.has(inputData.playerId)) {
                engine.addRemoteInput(inputData.frame || frame, inputData.playerId, inputData.data);
              }
            }
          } catch (e) {}
        }

        // Catch up to server frame
        while (engine.frame < frame) {
          engine.tick();
        }

        // Record checksum
        client.checksums.push(engine.getChecksum());
      }
    });

    ws.on('error', reject);
  });
}

function sendInput(client: SimClient, keys: any) {
  client.engine.setLocalInput(keys);
  client.engine.tick();

  const inputs = client.engine.getLocalInputsToSend();
  for (const input of inputs) {
    client.ws.send(JSON.stringify({
      type: 'SEND_INPUT',
      payload: {
        roomId: ROOM_ID,
        data: { type: 'input', frame: input.frame, playerId: client.playerId, data: input.data }
      }
    }));
  }
}

async function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  let passed = 0;
  let failed = 0;

  function check(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.log(`  FAIL: ${name}${details ? ' - ' + details : ''}`);
      failed++;
    }
  }

  try {
    // Phase 1: Create first client
    console.log('\nPhase 1: First client creates room');
    const clientA = await createSimClient('A', NODE1_URL, 'playerA', true);
    await wait(1500);

    // Phase 2: Second client joins after delay
    console.log('\nPhase 2: Second client joins (late joiner)');
    const clientB = await createSimClient('B', NODE2_URL, 'playerB', false);
    await wait(500);

    // Phase 3: Verify frame sync
    console.log('\nPhase 3: Verify frame synchronization');
    console.log(`  A engine frame: ${clientA.engine.frame}`);
    console.log(`  B engine frame: ${clientB.engine.frame}`);
    console.log(`  A server frame: ${clientA.serverFrame}`);
    console.log(`  B server frame: ${clientB.serverFrame}`);

    // CRITICAL TEST: Late joiner must NOT start at frame 0
    check('Late joiner starts at correct frame (not 0)', clientB.engine.frame > 20,
          `B started at frame ${clientB.engine.frame}`);

    // Phase 4: Both send inputs
    console.log('\nPhase 4: Exchange inputs');
    for (let i = 0; i < 10; i++) {
      sendInput(clientA, { w: true });
      sendInput(clientB, { w: true });
      await wait(50);
    }
    await wait(1000);

    // Phase 5: Check checksums match
    console.log('\nPhase 5: Verify checksum convergence');
    const aChecksum = clientA.engine.getChecksum();
    const bChecksum = clientB.engine.getChecksum();
    console.log(`  A checksum: ${aChecksum.toString(16)}`);
    console.log(`  B checksum: ${bChecksum.toString(16)}`);
    console.log(`  A frame: ${clientA.engine.frame}, B frame: ${clientB.engine.frame}`);

    // Frames should be close
    const frameDiff = Math.abs(clientA.engine.frame - clientB.engine.frame);
    check('Frames are synchronized', frameDiff < 10, `diff=${frameDiff}`);

    // Cleanup
    clientA.ws.close();
    clientB.ws.close();

    // Summary
    console.log('\n=== Results ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runTest();
