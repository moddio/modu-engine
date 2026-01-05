/**
 * Test: Cross-Node Late Joiner Bug
 *
 * This test reproduces the bug: "Player 2 doesn't see Player 1's character"
 * in a CROSS-NODE scenario (clients on different mesh nodes).
 *
 * The scenario:
 * 1. Client 1 connects (central service assigns a node) and creates a room
 * 2. Client 2 connects (may be assigned to same or different node) and joins
 * 3. Client 2 should receive Client 1's join input
 *
 * NOTE: We can't force clients to specific nodes - the central service assigns them.
 * This test logs which nodes are used to diagnose cross-node vs same-node behavior.
 */

import WebSocket from 'ws';

const CENTRAL_URL = process.env.CENTRAL_URL || 'http://localhost:9001';
const ROOM_ID = 'cross-node-test-' + Date.now();
const APP_ID = 'dev';

console.log('=== Cross-Node Late Joiner Test ===');
console.log('Central:', CENTRAL_URL);
console.log('Room:', ROOM_ID);
console.log('');

// Binary message types
const MSG_TICK = 0x01;
const MSG_INITIAL_STATE = 0x02;
const MSG_ROOM_JOINED = 0x03;
const MSG_ROOM_CREATED = 0x04;
const MSG_ERROR = 0x05;

interface ParsedInput {
  clientHash: number;
  seq: number;
  data: any;
  rawBytes: Buffer;
}

interface NodeConnection {
  url: string;
  token: string;
  fps: number;
}

interface Client {
  name: string;
  ws: WebSocket | null;
  clientId: string;
  nodeUrl: string;
  receivedMessages: any[];
  joinInputsReceived: ParsedInput[];
  initialStateSnapshot: any;
  initialStateInputs: ParsedInput[];
  initialStateFrame: number;
  tickCount: number;
  lastFrame: number;
}

// Get connection info from central service
async function getNodeConnection(roomId: string): Promise<NodeConnection> {
  const connectUrl = `${CENTRAL_URL}/api/apps/${APP_ID}/rooms/${roomId}/connect`;

  const res = await fetch(connectUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`Failed to get node assignment: ${errorData.error || res.statusText}`);
  }

  const data = await res.json();
  return { url: data.url, token: data.token, fps: data.fps || 20 };
}

// Parse INITIAL_STATE message
function parseInitialState(buf: Buffer): { frame: number; roomId: string; snapshot: any; snapshotHash: string; inputs: ParsedInput[] } | null {
  try {
    let offset = 1;
    const frame = buf.readUInt32LE(offset); offset += 4;
    const roomIdLen = buf.readUInt16LE(offset); offset += 2;
    const roomId = buf.subarray(offset, offset + roomIdLen).toString('utf8'); offset += roomIdLen;
    const snapshotLen = buf.readUInt32LE(offset); offset += 4;
    const snapshotJson = buf.subarray(offset, offset + snapshotLen).toString('utf8'); offset += snapshotLen;
    const { snapshot, snapshotHash } = JSON.parse(snapshotJson);

    const inputCount = buf.readUInt16LE(offset); offset += 2;
    const inputs: ParsedInput[] = [];

    for (let i = 0; i < inputCount && offset < buf.length; i++) {
      const clientHash = buf.readUInt32LE(offset); offset += 4;
      const seq = buf.readUInt32LE(offset); offset += 4;
      const dataLen = buf.readUInt16LE(offset); offset += 2;

      if (offset + dataLen > buf.length) break;

      const rawBytes = Buffer.from(buf.subarray(offset, offset + dataLen));
      offset += dataLen;

      let data: any = rawBytes;
      const firstByte = rawBytes[0];
      if (firstByte === 0x7B || firstByte === 0x5B) {
        try {
          data = JSON.parse(rawBytes.toString('utf8'));
        } catch (e) {}
      }

      inputs.push({ clientHash, seq, data, rawBytes });
    }

    return { frame, roomId, snapshot, snapshotHash, inputs };
  } catch (e) {
    console.error('Failed to parse INITIAL_STATE:', e);
    return null;
  }
}

// Parse TICK message
function parseTick(buf: Buffer): { frame: number; inputs: ParsedInput[] } | null {
  try {
    const frame = buf.readUInt32LE(1);
    const inputs: ParsedInput[] = [];

    if (buf.length <= 5) {
      return { frame, inputs: [] };
    }

    const inputCount = buf[5];
    let offset = 6;

    for (let i = 0; i < inputCount && offset < buf.length; i++) {
      const clientHash = buf.readUInt32LE(offset); offset += 4;
      const seq = buf.readUInt32LE(offset); offset += 4;
      const dataLen = buf.readUInt16LE(offset); offset += 2;

      if (offset + dataLen > buf.length) break;

      const rawBytes = Buffer.from(buf.subarray(offset, offset + dataLen));
      offset += dataLen;

      let data: any = rawBytes;
      const firstByte = rawBytes[0];
      if (firstByte === 0x7B || firstByte === 0x5B) {
        try {
          data = JSON.parse(rawBytes.toString('utf8'));
        } catch (e) {}
      }

      inputs.push({ clientHash, seq, data, rawBytes });
    }

    return { frame, inputs };
  } catch (e) {
    console.error('Failed to parse TICK:', e);
    return null;
  }
}

function connectClient(name: string, playerId: string, conn: NodeConnection, isCreator: boolean): Promise<Client> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${conn.url}?token=${encodeURIComponent(conn.token)}`;
    console.log(`[${name}] Connecting to: ${conn.url}`);
    const ws = new WebSocket(wsUrl);

    const client: Client = {
      name,
      ws,
      clientId: '',
      nodeUrl: conn.url,
      receivedMessages: [],
      joinInputsReceived: [],
      initialStateSnapshot: null,
      initialStateInputs: [],
      initialStateFrame: -1,
      tickCount: 0,
      lastFrame: 0
    };

    const timeout = setTimeout(() => {
      console.log(`[${name}] Timeout - messages received: ${client.receivedMessages.length}`);
      for (const msg of client.receivedMessages) {
        console.log(`  - type=${msg.type}, length=${msg.length}`);
      }
      reject(new Error(`${name} timeout`));
    }, 15000);
    let resolved = false;

    ws.on('open', () => {
      console.log(`[${name}] WebSocket connected`);
      // Send appropriate message based on whether we're creating or joining
      const msg = isCreator
        ? { type: 'CREATE_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } }
        : { type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } };
      console.log(`[${name}] Sending: ${msg.type}`);
      ws.send(JSON.stringify(msg));
    });

    ws.on('message', (data: Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const msgType = buf[0];

      client.receivedMessages.push({ type: msgType, length: buf.length });

      // ERROR (0x05)
      if (msgType === MSG_ERROR) {
        const msgLen = buf.readUInt16LE(1);
        const errMsg = buf.subarray(3, 3 + msgLen).toString('utf8');
        console.log(`[${name}] ERROR: ${errMsg}`);
      }

      // ROOM_CREATED (0x04)
      if (msgType === MSG_ROOM_CREATED) {
        const roomIdLen = buf.readUInt16LE(1);
        let offset = 3 + roomIdLen;
        const clientIdLen = buf.readUInt16LE(offset);
        client.clientId = buf.subarray(offset + 2, offset + 2 + clientIdLen).toString('utf8');
        console.log(`[${name}] ROOM_CREATED - clientId: ${client.clientId}`);

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(client);
        }
      }

      // ROOM_JOINED (0x03)
      if (msgType === MSG_ROOM_JOINED) {
        const roomIdLen = buf.readUInt16LE(1);
        let offset = 3 + roomIdLen;
        const clientIdLen = buf.readUInt16LE(offset);
        client.clientId = buf.subarray(offset + 2, offset + 2 + clientIdLen).toString('utf8');
        console.log(`[${name}] ROOM_JOINED - clientId: ${client.clientId}`);
        // Don't resolve yet - wait for INITIAL_STATE
      }

      // INITIAL_STATE (0x02)
      if (msgType === MSG_INITIAL_STATE) {
        const parsed = parseInitialState(buf);
        if (parsed) {
          client.initialStateFrame = parsed.frame;
          client.initialStateSnapshot = parsed.snapshot;
          client.initialStateInputs = parsed.inputs;

          console.log(`[${name}] INITIAL_STATE received:`);
          console.log(`  - Frame: ${parsed.frame}`);
          console.log(`  - Snapshot seq: ${parsed.snapshot?.seq}`);
          console.log(`  - Snapshot has physics2d: ${!!parsed.snapshot?.physics2d}`);
          console.log(`  - Input count: ${parsed.inputs.length}`);

          for (const input of parsed.inputs) {
            console.log(`    - Input seq=${input.seq}, data=${JSON.stringify(input.data)}`);
            if (input.data?.type === 'join' || input.data?.type === 'reconnect') {
              client.joinInputsReceived.push(input);
            }
          }

          console.log(`  - Join inputs in INITIAL_STATE: ${client.joinInputsReceived.length}`);
        }

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(client);
        }
      }

      // TICK (0x01)
      if (msgType === MSG_TICK) {
        client.tickCount++;
        const parsed = parseTick(buf);
        if (parsed) {
          client.lastFrame = parsed.frame;
          if (parsed.inputs.length > 0) {
            for (const input of parsed.inputs) {
              if (input.data?.type === 'join' || input.data?.type === 'reconnect') {
                client.joinInputsReceived.push(input);
                console.log(`[${name}] TICK frame=${parsed.frame} contained join input: seq=${input.seq}, clientId=${input.data?.clientId}`);
              }
            }
          }
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`[${name}] WebSocket error:`, err);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      console.log(`[${name}] WebSocket closed: code=${code}`);
    });
  });
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
    // Phase 1: Client A creates room
    console.log('\n=== Phase 1: Client A creates room ===');
    const connA = await getNodeConnection(ROOM_ID);
    console.log(`[A] Assigned to node: ${connA.url}`);
    const clientA = await connectClient('A', 'playerA', connA, true);
    console.log(`[A] Connected as room creator, clientId: ${clientA.clientId}`);

    // Wait for the join input to be broadcast
    await wait(500);

    // Phase 2: Client B joins
    console.log('\n=== Phase 2: Client B joins ===');
    const connB = await getNodeConnection(ROOM_ID);
    console.log(`[B] Assigned to node: ${connB.url}`);

    const sameNode = connA.url === connB.url;
    console.log(`[INFO] Same node: ${sameNode ? 'YES' : 'NO (cross-node scenario)'}`);

    const clientB = await connectClient('B', 'playerB', connB, false);
    console.log(`[B] Connected as late joiner, clientId: ${clientB.clientId}`);

    // Wait for more ticks to arrive
    await wait(2000);

    // Phase 3: Analyze what Client B received
    console.log('\n=== Phase 3: Analysis ===');

    console.log('\nClient A status:');
    console.log(`  - Node: ${clientA.nodeUrl}`);
    console.log(`  - ClientId: ${clientA.clientId}`);
    console.log(`  - Ticks received: ${clientA.tickCount}`);
    console.log(`  - Last frame: ${clientA.lastFrame}`);
    console.log(`  - Join inputs received: ${clientA.joinInputsReceived.length}`);

    console.log('\nClient B status:');
    console.log(`  - Node: ${clientB.nodeUrl}`);
    console.log(`  - ClientId: ${clientB.clientId}`);
    console.log(`  - Ticks received: ${clientB.tickCount}`);
    console.log(`  - Last frame: ${clientB.lastFrame}`);

    console.log('\nClient B INITIAL_STATE analysis:');
    console.log(`  Frame: ${clientB.initialStateFrame}`);
    console.log(`  Snapshot seq: ${clientB.initialStateSnapshot?.seq}`);
    console.log(`  Snapshot has physics2d: ${!!clientB.initialStateSnapshot?.physics2d}`);
    console.log(`  Inputs in INITIAL_STATE: ${clientB.initialStateInputs.length}`);

    for (const input of clientB.initialStateInputs) {
      const dataType = input.data?.type || 'unknown';
      const dataClientId = input.data?.clientId || 'unknown';
      const userId = input.data?.user?.id || 'unknown';
      console.log(`    seq=${input.seq}, type=${dataType}, clientId=${dataClientId}, user.id=${userId}`);
    }

    console.log(`\nClient B total join inputs received: ${clientB.joinInputsReceived.length}`);
    for (const input of clientB.joinInputsReceived) {
      console.log(`  - seq=${input.seq}, clientId=${input.data?.clientId}, user.id=${input.data?.user?.id}`);
    }

    // Verify tests
    console.log('\n=== Verification ===');

    // Test 1: Client B should have received join input for Player A (eventually)
    const hasPlayerAJoin = clientB.joinInputsReceived.some(input =>
      input.data?.user?.id === 'playerA' || input.data?.clientId === clientA.clientId
    );
    check('Client B received Player A join input (any source)', hasPlayerAJoin,
      `Got ${clientB.joinInputsReceived.length} join inputs`);

    // Test 2: The join input should be in INITIAL_STATE (critical for late joiners)
    const hasPlayerAJoinInInitialState = clientB.initialStateInputs.some(input =>
      (input.data?.type === 'join' || input.data?.type === 'reconnect') &&
      (input.data?.user?.id === 'playerA' || input.data?.clientId === clientA.clientId)
    );
    check('Player A join input was in INITIAL_STATE', hasPlayerAJoinInInitialState,
      `INITIAL_STATE had ${clientB.initialStateInputs.length} inputs`);

    // Test 3: Client B should be receiving ticks
    check('Client B receiving ticks', clientB.tickCount > 30, `got ${clientB.tickCount} ticks`);

    // Test 4: Frames should be synchronized
    const frameDiff = Math.abs(clientA.lastFrame - clientB.lastFrame);
    check('Frames are synchronized', frameDiff < 10, `A=${clientA.lastFrame}, B=${clientB.lastFrame}, diff=${frameDiff}`);

    // Cleanup
    console.log('\n=== Cleanup ===');
    if (clientA.ws) clientA.ws.close();
    if (clientB.ws) clientB.ws.close();
    await wait(500);

    // Results
    console.log('\n=== Results ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`\nNode scenario: ${sameNode ? 'SAME NODE' : 'CROSS-NODE'}`);

    if (failed > 0) {
      console.log('\n!!! BUG REPRODUCED !!!');
      if (!hasPlayerAJoinInInitialState) {
        console.log('Player A join input is NOT in INITIAL_STATE.');
        console.log('This means Player 2 will NOT spawn Player 1 character.');
      }
      process.exit(1);
    } else {
      console.log('\nTest passed - late joiner correctly receives Player 1 join.');
      process.exit(0);
    }

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runTest();
