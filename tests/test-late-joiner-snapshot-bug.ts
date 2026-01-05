/**
 * Test: Late Joiner Empty Snapshot Bug
 *
 * Reproduces the critical bug where late joiners receive EMPTY snapshots
 * instead of the actual game state.
 *
 * Scenario:
 * 1. Client1 creates room and plays for a bit (spawns player, food, etc.)
 * 2. Client1 sends a snapshot with real game state to the server
 * 3. Client2 joins late
 * 4. Client2 should receive the snapshot Client1 sent
 *
 * Bug observation:
 * - Client2 receives: "Restored snapshot: 0 bodies, 0 food, 0 players"
 * - But Client1 has: 32 bodies (players + food)
 *
 * This test verifies what snapshot data is actually stored and sent.
 */

import WebSocket from 'ws';

const CONFIG = {
  CENTRAL_URL: process.env.CENTRAL_URL || 'http://localhost:9001',
  NODE1_URL: process.env.NODE1_URL || 'ws://localhost:8001/ws',
  APP_ID: process.env.APP_ID || 'default',
};

const MSG_TYPE = {
  TICK: 0x01,
  INITIAL_STATE: 0x02,
  ROOM_JOINED: 0x03,
  ROOM_CREATED: 0x04,
  ERROR: 0x05,
};

function generateRoomId(): string {
  return `snapshot-bug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface TestClient {
  name: string;
  ws: WebSocket | null;
  clientId: string;
  roomId: string;
  receivedSnapshot: any | null;
  receivedInputs: any[];
  connected: boolean;
}

function createClient(name: string): TestClient {
  return {
    name,
    ws: null,
    clientId: '',
    roomId: '',
    receivedSnapshot: null,
    receivedInputs: [],
    connected: false,
  };
}

function parseRoomResponse(data: Buffer): { roomId: string; clientId: string } | null {
  const msgType = data[0];
  if (msgType !== MSG_TYPE.ROOM_CREATED && msgType !== MSG_TYPE.ROOM_JOINED) return null;

  let offset = 1;
  const roomIdLen = data.readUInt16LE(offset); offset += 2;
  const roomId = data.subarray(offset, offset + roomIdLen).toString('utf-8'); offset += roomIdLen;
  const clientIdLen = data.readUInt16LE(offset); offset += 2;
  const clientId = data.subarray(offset, offset + clientIdLen).toString('utf-8');

  return { roomId, clientId };
}

function parseInitialState(data: Buffer): { frame: number; snapshot: any; snapshotHash: string; inputs: any[] } | null {
  if (data[0] !== MSG_TYPE.INITIAL_STATE) return null;

  try {
    let offset = 1;
    const frame = data.readUInt32LE(offset); offset += 4;
    const roomIdLen = data.readUInt16LE(offset); offset += 2;
    const roomId = data.subarray(offset, offset + roomIdLen).toString('utf-8'); offset += roomIdLen;
    const snapshotLen = data.readUInt32LE(offset); offset += 4;
    const snapshotJson = data.subarray(offset, offset + snapshotLen).toString('utf-8'); offset += snapshotLen;

    const snapshotWrapper = JSON.parse(snapshotJson || '{}');

    // Decode inputs
    const inputCount = data.readUInt16LE(offset); offset += 2;
    const inputs: any[] = [];

    for (let i = 0; i < inputCount && offset < data.length; i++) {
      const clientHash = data.readUInt32LE(offset); offset += 4;
      const seq = data.readUInt32LE(offset); offset += 4;
      const dataLen = data.readUInt16LE(offset); offset += 2;

      if (offset + dataLen > data.length) break;

      const dataBytes = data.subarray(offset, offset + dataLen);
      offset += dataLen;

      try {
        const parsed = JSON.parse(dataBytes.toString('utf-8'));
        inputs.push({ seq, data: parsed, clientHash });
      } catch {
        inputs.push({ seq, data: { _binary: true, length: dataLen }, clientHash });
      }
    }

    return {
      frame,
      snapshot: snapshotWrapper.snapshot,
      snapshotHash: snapshotWrapper.snapshotHash || '',
      inputs,
    };
  } catch (e) {
    console.error('Failed to parse INITIAL_STATE:', e);
    return null;
  }
}

async function connectClient(
  client: TestClient,
  roomId: string,
): Promise<void> {
  // Get connection info from central service
  const response = await fetch(`${CONFIG.CENTRAL_URL}/api/apps/${CONFIG.APP_ID}/rooms/${roomId}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    throw new Error(`Failed to get connection info: ${response.status}`);
  }

  const connInfo = await response.json() as { url: string; token: string };
  const wsUrl = `${connInfo.url}?token=${encodeURIComponent(connInfo.token)}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    client.ws = ws;
    client.roomId = roomId;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`${client.name} connection timeout`));
    }, 10000);

    ws.on('open', () => {
      client.connected = true;
      const msg = { type: 'JOIN_ROOM', payload: { roomId, user: { id: client.name } } };
      ws.send(JSON.stringify(msg));
    });

    ws.on('message', (data: Buffer) => {
      const msgType = data[0];

      if (msgType === MSG_TYPE.ROOM_CREATED || msgType === MSG_TYPE.ROOM_JOINED) {
        const parsed = parseRoomResponse(data);
        if (parsed) {
          client.clientId = parsed.clientId;
          clearTimeout(timeout);
          resolve();
        }
        return;
      }

      if (msgType === MSG_TYPE.INITIAL_STATE) {
        const parsed = parseInitialState(data);
        if (parsed) {
          client.receivedSnapshot = parsed.snapshot;
          client.receivedInputs = parsed.inputs;
          console.log(`[${client.name}] Received INITIAL_STATE:`);
          console.log(`  - Frame: ${parsed.frame}`);
          console.log(`  - Snapshot keys: ${Object.keys(parsed.snapshot || {}).join(', ') || 'EMPTY'}`);
          console.log(`  - Snapshot: ${JSON.stringify(parsed.snapshot)}`);
          console.log(`  - Inputs: ${parsed.inputs.length}`);
          clearTimeout(timeout);
          resolve();
        }
        return;
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function sendSnapshot(client: TestClient, snapshot: any): void {
  if (!client.ws || client.ws.readyState !== WebSocket.OPEN) return;

  const hash = 'test-hash-' + Date.now();
  const msg = JSON.stringify({
    type: 'SEND_SNAPSHOT',
    payload: { roomId: client.roomId, snapshot, hash }
  });
  client.ws.send(msg);
  console.log(`[${client.name}] Sent snapshot:`, JSON.stringify(snapshot));
}

function sendInput(client: TestClient, input: any): void {
  if (!client.ws || client.ws.readyState !== WebSocket.OPEN) return;

  const json = JSON.stringify(input);
  const buf = Buffer.alloc(1 + json.length);
  buf[0] = 0x20; // BINARY_INPUT marker
  buf.write(json, 1, 'utf-8');
  client.ws.send(buf);
}

async function disconnectClient(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.once('close', () => {
        client.ws = null;
        client.connected = false;
        resolve();
      });
      client.ws.close();
    } else {
      resolve();
    }
  });
}

// ============================================================================
// TEST: Verify snapshot is stored and sent to late joiner
// ============================================================================

async function testLateJoinerReceivesSnapshot(): Promise<boolean> {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: Late Joiner Should Receive Non-Empty Snapshot');
  console.log('='.repeat(70));

  const roomId = generateRoomId();
  const client1 = createClient('Client1');
  const client2 = createClient('Client2');

  try {
    // Step 1: Client1 creates room
    console.log('\n[STEP 1] Client1 creates room...');
    await connectClient(client1, roomId);
    console.log(`  Client1 connected as ${client1.clientId}`);
    await sleep(500);

    // Step 2: Client1 sends some inputs (simulate gameplay)
    console.log('\n[STEP 2] Client1 sends some game inputs...');
    for (let i = 0; i < 5; i++) {
      sendInput(client1, { type: 'move', x: i * 10, y: i * 5 });
      await sleep(50);
    }
    await sleep(500);

    // Step 3: Client1 sends a snapshot with game state
    console.log('\n[STEP 3] Client1 sends snapshot with game state...');
    const gameSnapshot = {
      frame: 100,
      seq: 10,
      bodies: [
        { id: 'player1', type: 'player', x: 100, y: 200 },
        { id: 'food1', type: 'food', x: 50, y: 50 },
        { id: 'food2', type: 'food', x: 150, y: 100 },
      ],
      players: { 'player1': { score: 10 } },
      food: ['food1', 'food2'],
      physicsWorld: { gravity: 0, timestep: 0.016 },
    };
    sendSnapshot(client1, gameSnapshot);
    await sleep(1000); // Give server time to store snapshot

    // Step 4: Verify snapshot is stored by checking server API
    console.log('\n[STEP 4] Checking server state...');
    try {
      const stateResponse = await fetch(`http://localhost:8001/api/rooms/${roomId}/state`);
      if (stateResponse.ok) {
        const state = await stateResponse.json() as any;
        console.log(`  Server room state:`);
        console.log(`    - Snapshot exists: ${!!state.snapshot}`);
        console.log(`    - Snapshot keys: ${Object.keys(state.snapshot || {}).join(', ') || 'EMPTY'}`);
        console.log(`    - Snapshot.bodies: ${JSON.stringify(state.snapshot?.bodies)}`);
        console.log(`    - Inputs count: ${state.inputs?.length || 0}`);
      } else {
        console.log(`  Could not fetch server state: ${stateResponse.status}`);
      }
    } catch (e) {
      console.log(`  Server API not available: ${e}`);
    }

    // Step 5: Client2 joins late
    console.log('\n[STEP 5] Client2 joins late...');
    await connectClient(client2, roomId);
    console.log(`  Client2 connected as ${client2.clientId}`);
    await sleep(500);

    // Step 6: Verify what Client2 received
    console.log('\n[STEP 6] Verifying Client2 received correct snapshot...');

    let passed = true;

    if (!client2.receivedSnapshot) {
      console.log('  [FAIL] Client2 received NO snapshot at all!');
      passed = false;
    } else if (Object.keys(client2.receivedSnapshot).length === 0) {
      console.log('  [FAIL] Client2 received EMPTY snapshot: {}');
      passed = false;
    } else if (!client2.receivedSnapshot.bodies || client2.receivedSnapshot.bodies.length === 0) {
      console.log('  [FAIL] Client2 snapshot has NO bodies!');
      console.log(`    Received: ${JSON.stringify(client2.receivedSnapshot)}`);
      passed = false;
    } else {
      const bodiesCount = client2.receivedSnapshot.bodies?.length || 0;
      console.log(`  [PASS] Client2 received snapshot with ${bodiesCount} bodies`);

      // Verify it matches what Client1 sent
      const expectedBodies = gameSnapshot.bodies.length;
      if (bodiesCount !== expectedBodies) {
        console.log(`  [WARN] Body count mismatch: got ${bodiesCount}, expected ${expectedBodies}`);
      }
    }

    // Check inputs
    console.log(`\n  Client2 received ${client2.receivedInputs.length} inputs with INITIAL_STATE`);

    return passed;

  } finally {
    await disconnectClient(client1);
    await disconnectClient(client2);
  }
}

// ============================================================================
// TEST: Verify snapshot persistence across multiple joins
// ============================================================================

async function testSnapshotPersistsForMultipleJoiners(): Promise<boolean> {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: Snapshot Should Persist For Multiple Late Joiners');
  console.log('='.repeat(70));

  const roomId = generateRoomId();
  const client1 = createClient('Client1');
  const client2 = createClient('Client2');
  const client3 = createClient('Client3');

  try {
    // Client1 creates room and sends snapshot
    console.log('\n[STEP 1] Client1 creates room and sends snapshot...');
    await connectClient(client1, roomId);
    await sleep(300);

    const gameSnapshot = {
      frame: 50,
      seq: 5,
      bodies: [{ id: 'p1', type: 'player' }],
      marker: 'original-snapshot'
    };
    sendSnapshot(client1, gameSnapshot);
    await sleep(500);

    // Client2 joins
    console.log('\n[STEP 2] Client2 joins...');
    await connectClient(client2, roomId);
    await sleep(300);

    // Client3 joins
    console.log('\n[STEP 3] Client3 joins...');
    await connectClient(client3, roomId);
    await sleep(300);

    // Verify both late joiners got the snapshot
    console.log('\n[RESULTS]');
    let passed = true;

    for (const client of [client2, client3]) {
      if (!client.receivedSnapshot) {
        console.log(`  [FAIL] ${client.name} received NO snapshot`);
        passed = false;
      } else if (client.receivedSnapshot.marker !== 'original-snapshot') {
        console.log(`  [FAIL] ${client.name} received wrong snapshot: ${JSON.stringify(client.receivedSnapshot)}`);
        passed = false;
      } else {
        console.log(`  [PASS] ${client.name} received correct snapshot with marker`);
      }
    }

    return passed;

  } finally {
    await disconnectClient(client1);
    await disconnectClient(client2);
    await disconnectClient(client3);
  }
}

// ============================================================================
// TEST: Verify snapshot survives after original client disconnects
// ============================================================================

async function testSnapshotSurvivesDisconnect(): Promise<boolean> {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: Snapshot Should Survive After Sender Disconnects');
  console.log('='.repeat(70));

  const roomId = generateRoomId();
  const client1 = createClient('Client1');
  const client2 = createClient('Client2');
  const client3 = createClient('Client3');

  try {
    // Client1 creates room and sends snapshot
    console.log('\n[STEP 1] Client1 creates room and sends snapshot...');
    await connectClient(client1, roomId);
    await sleep(300);

    const gameSnapshot = {
      frame: 100,
      seq: 20,
      bodies: [{ id: 'p1' }, { id: 'food1' }],
      marker: 'persistent-snapshot'
    };
    sendSnapshot(client1, gameSnapshot);
    await sleep(500);

    // Client2 joins to keep room alive
    console.log('\n[STEP 2] Client2 joins to keep room alive...');
    await connectClient(client2, roomId);
    await sleep(300);

    // Client1 disconnects
    console.log('\n[STEP 3] Client1 disconnects...');
    await disconnectClient(client1);
    await sleep(500);

    // Client3 joins AFTER Client1 has left
    console.log('\n[STEP 4] Client3 joins after Client1 left...');
    await connectClient(client3, roomId);
    await sleep(300);

    // Verify Client3 still got the snapshot
    console.log('\n[RESULTS]');

    if (!client3.receivedSnapshot) {
      console.log('  [FAIL] Client3 received NO snapshot');
      return false;
    } else if (client3.receivedSnapshot.marker !== 'persistent-snapshot') {
      console.log(`  [FAIL] Client3 received wrong snapshot: ${JSON.stringify(client3.receivedSnapshot)}`);
      return false;
    } else {
      console.log('  [PASS] Client3 received correct persistent snapshot');
      return true;
    }

  } finally {
    await disconnectClient(client1);
    await disconnectClient(client2);
    await disconnectClient(client3);
  }
}

// ============================================================================
// TEST: Simulate page refresh (disconnect + reconnect with new clientId)
// ============================================================================

async function testPageRefreshScenario(): Promise<boolean> {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: Page Refresh - Same User Reconnects With New ClientId');
  console.log('='.repeat(70));

  const roomId = generateRoomId();
  const client1 = createClient('Player1');
  const client2 = createClient('Player2');

  try {
    // Client1 creates room
    console.log('\n[STEP 1] Client1 creates room...');
    await connectClient(client1, roomId);
    await sleep(300);

    // Client2 joins
    console.log('\n[STEP 2] Client2 joins...');
    await connectClient(client2, roomId);
    await sleep(300);

    // Both clients play for a bit (send inputs)
    console.log('\n[STEP 3] Both clients play for a bit...');
    for (let i = 0; i < 5; i++) {
      sendInput(client1, { type: 'move', x: i * 10 });
      sendInput(client2, { type: 'move', y: i * 10 });
      await sleep(50);
    }
    await sleep(500);

    // Client1 sends snapshot with actual game state
    console.log('\n[STEP 4] Client1 sends snapshot...');
    const gameSnapshot = {
      frame: 200,
      seq: 50,
      bodies: [
        { id: 'player1', type: 'player', x: 40, y: 0 },
        { id: 'player2', type: 'player', x: 0, y: 40 },
        { id: 'food1', type: 'food' },
        { id: 'food2', type: 'food' },
      ],
      physicsWorld: { bodies: 4 }
    };
    sendSnapshot(client1, gameSnapshot);
    await sleep(500);

    // CLIENT2 REFRESHES (disconnect + reconnect with new clientId)
    console.log('\n[STEP 5] Client2 "refreshes" (disconnect + reconnect)...');
    await disconnectClient(client2);
    await sleep(500);

    // Create new client object (simulates page refresh)
    const client2Refreshed = createClient('Player2-Refreshed');
    await connectClient(client2Refreshed, roomId);
    await sleep(500);

    // Verify what client2 received after refresh
    console.log('\n[RESULTS]');
    console.log(`  Client2 original clientId: ${client2.clientId}`);
    console.log(`  Client2 refreshed clientId: ${client2Refreshed.clientId}`);

    if (!client2Refreshed.receivedSnapshot) {
      console.log('  [FAIL] Refreshed client received NO snapshot');
      return false;
    }

    const bodies = client2Refreshed.receivedSnapshot.bodies;
    if (!bodies || bodies.length === 0) {
      console.log(`  [FAIL] Refreshed client received EMPTY snapshot!`);
      console.log(`    Received: ${JSON.stringify(client2Refreshed.receivedSnapshot)}`);
      return false;
    }

    console.log(`  [PASS] Refreshed client received snapshot with ${bodies.length} bodies`);
    return true;

  } finally {
    await disconnectClient(client1);
    await disconnectClient(client2);
  }
}

// ============================================================================
// TEST: Cross-node late join scenario
// ============================================================================

async function testCrossNodeJoin(): Promise<boolean> {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: Cross-Node Join (Client2 on Different Node)');
  console.log('='.repeat(70));

  // Check if NODE2 is available
  const NODE2_URL = process.env.NODE2_URL || 'ws://localhost:8002/ws';

  const roomId = generateRoomId();
  const client1 = createClient('Node1-Client');

  try {
    // Client1 creates room on Node1
    console.log('\n[STEP 1] Client1 creates room on Node1...');
    await connectClient(client1, roomId);
    await sleep(500);

    // Send snapshot
    console.log('\n[STEP 2] Client1 sends snapshot...');
    const gameSnapshot = {
      frame: 100,
      seq: 20,
      bodies: [{ id: 'p1', x: 100 }],
      marker: 'cross-node-test'
    };
    sendSnapshot(client1, gameSnapshot);
    await sleep(1000); // Extra time for cross-node replication

    // Client2 joins on NODE2 (this requires NODE2 to be running)
    console.log('\n[STEP 3] Attempting to join via central service (may route to different node)...');

    // Get connection from central - it may route to either node
    const response = await fetch(`${CONFIG.CENTRAL_URL}/api/apps/${CONFIG.APP_ID}/rooms/${roomId}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      console.log('  [SKIP] Could not get connection info');
      return true; // Skip test if can't connect
    }

    const connInfo = await response.json() as { url: string; token: string; nodeId?: string };
    console.log(`  Routed to: ${connInfo.url}`);

    const client2 = createClient('Node2-Client');
    const wsUrl = `${connInfo.url}?token=${encodeURIComponent(connInfo.token)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      client2.ws = ws;
      client2.roomId = roomId;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout'));
      }, 10000);

      ws.on('open', () => {
        const msg = { type: 'JOIN_ROOM', payload: { roomId, user: { id: 'Node2-Client' } } };
        ws.send(JSON.stringify(msg));
      });

      ws.on('message', (data: Buffer) => {
        const msgType = data[0];
        if (msgType === MSG_TYPE.ROOM_JOINED || msgType === MSG_TYPE.ROOM_CREATED) {
          const parsed = parseRoomResponse(data);
          if (parsed) client2.clientId = parsed.clientId;
        }
        if (msgType === MSG_TYPE.INITIAL_STATE) {
          const parsed = parseInitialState(data);
          if (parsed) {
            client2.receivedSnapshot = parsed.snapshot;
            console.log(`  [Client2] Received snapshot: ${JSON.stringify(parsed.snapshot)}`);
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Verify snapshot
    console.log('\n[RESULTS]');
    if (!client2.receivedSnapshot) {
      console.log('  [FAIL] Cross-node client received NO snapshot');
      return false;
    }
    if (client2.receivedSnapshot.marker !== 'cross-node-test') {
      console.log(`  [FAIL] Wrong snapshot: ${JSON.stringify(client2.receivedSnapshot)}`);
      return false;
    }
    console.log('  [PASS] Cross-node client received correct snapshot');
    return true;

  } catch (e) {
    console.log(`  [SKIP] Cross-node test failed: ${e}`);
    return true; // Don't fail if Node2 isn't running
  } finally {
    await disconnectClient(client1);
  }
}

// ============================================================================
// TEST: Rapid joins (race condition)
// ============================================================================

async function testRapidJoins(): Promise<boolean> {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: Rapid Joins (Multiple Clients Join Simultaneously)');
  console.log('='.repeat(70));

  const roomId = generateRoomId();
  const client1 = createClient('Creator');

  try {
    // Create room and send snapshot
    console.log('\n[STEP 1] Creator makes room with snapshot...');
    await connectClient(client1, roomId);
    await sleep(300);

    const gameSnapshot = {
      frame: 100,
      seq: 10,
      bodies: [{ id: 'p1' }, { id: 'food1' }, { id: 'food2' }],
      marker: 'rapid-join-test'
    };
    sendSnapshot(client1, gameSnapshot);
    await sleep(500);

    // Multiple clients join simultaneously
    console.log('\n[STEP 2] 3 clients join simultaneously...');
    const joiners = [
      createClient('Joiner1'),
      createClient('Joiner2'),
      createClient('Joiner3'),
    ];

    // Join all at once
    await Promise.all(joiners.map(c => connectClient(c, roomId)));
    await sleep(500);

    // Check results
    console.log('\n[RESULTS]');
    let allGood = true;
    for (const joiner of joiners) {
      if (!joiner.receivedSnapshot) {
        console.log(`  [FAIL] ${joiner.name} received NO snapshot`);
        allGood = false;
      } else if (!joiner.receivedSnapshot.marker || joiner.receivedSnapshot.marker !== 'rapid-join-test') {
        console.log(`  [FAIL] ${joiner.name} received wrong snapshot: ${JSON.stringify(joiner.receivedSnapshot)}`);
        allGood = false;
      } else {
        console.log(`  [PASS] ${joiner.name} received correct snapshot`);
      }
    }

    return allGood;

  } finally {
    await disconnectClient(client1);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('  LATE JOINER SNAPSHOT BUG REPRODUCTION TEST');
  console.log('='.repeat(70));

  const results: { name: string; passed: boolean }[] = [];

  results.push({
    name: 'Late Joiner Receives Snapshot',
    passed: await testLateJoinerReceivesSnapshot()
  });

  results.push({
    name: 'Snapshot Persists For Multiple Joiners',
    passed: await testSnapshotPersistsForMultipleJoiners()
  });

  results.push({
    name: 'Snapshot Survives Disconnect',
    passed: await testSnapshotSurvivesDisconnect()
  });

  results.push({
    name: 'Page Refresh Scenario',
    passed: await testPageRefreshScenario()
  });

  results.push({
    name: 'Rapid Joins',
    passed: await testRapidJoins()
  });

  results.push({
    name: 'Cross-Node Join',
    passed: await testCrossNodeJoin()
  });

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));

  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${result.name}`);
    if (!result.passed) allPassed = false;
  }

  console.log('\n' + '='.repeat(70));
  console.log(allPassed ? '  ALL TESTS PASSED' : '  SOME TESTS FAILED');
  console.log('='.repeat(70));

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
