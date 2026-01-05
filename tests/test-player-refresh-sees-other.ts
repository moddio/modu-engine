/**
 * Test: Player Refresh Sees Other Players
 *
 * This test reproduces the bug: "When Player 1 refreshes, they see nothing (only their own cell)"
 *
 * The scenario:
 * 1. Player A creates room
 * 2. Player B joins -> sees Player A (this works after previous fix)
 * 3. Player A DISCONNECTS (simulates browser refresh)
 * 4. Player A RECONNECTS with new clientId
 * 5. Player A should receive Player B's join input in INITIAL_STATE
 * 6. Player A should see Player B's character
 *
 * This test verifies that room state is preserved when a player refreshes,
 * and that the reconnecting player receives all necessary lifecycle inputs.
 */

import WebSocket from 'ws';

const CENTRAL_URL = process.env.CENTRAL_URL || 'http://localhost:9001';
const ROOM_ID = 'refresh-test-' + Date.now();
const APP_ID = 'dev';

console.log('=== Player Refresh Sees Other Players Test ===');
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

interface Client {
  name: string;
  ws: WebSocket | null;
  clientId: string;
  nodeUrl: string;
  token: string;
  receivedMessages: any[];
  joinInputsReceived: ParsedInput[];
  disconnectInputsReceived: ParsedInput[];
  reconnectInputsReceived: ParsedInput[];
  initialStateSnapshot: any;
  initialStateInputs: ParsedInput[];
  initialStateFrame: number;
}

// Get connection info from central service
async function getNodeConnection(roomId: string): Promise<{ url: string; token: string; fps: number }> {
  const connectUrl = `${CENTRAL_URL}/api/apps/${APP_ID}/rooms/${roomId}/connect`;
  console.log(`Fetching connection from: ${connectUrl}`);

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
  console.log(`Got node assignment: ${data.url}`);
  return { url: data.url, token: data.token, fps: data.fps || 20 };
}

// Parse INITIAL_STATE message to extract snapshot and inputs
function parseInitialState(buf: Buffer): { frame: number; roomId: string; snapshot: any; snapshotHash: string; inputs: ParsedInput[] } | null {
  try {
    let offset = 1; // Skip message type
    const frame = buf.readUInt32LE(offset); offset += 4;
    const roomIdLen = buf.readUInt16LE(offset); offset += 2;
    const roomId = buf.subarray(offset, offset + roomIdLen).toString('utf8'); offset += roomIdLen;
    const snapshotLen = buf.readUInt32LE(offset); offset += 4;
    const snapshotJson = buf.subarray(offset, offset + snapshotLen).toString('utf8'); offset += snapshotLen;
    const { snapshot, snapshotHash } = JSON.parse(snapshotJson);

    // Parse binary inputs
    const inputCount = buf.readUInt16LE(offset); offset += 2;
    const inputs: ParsedInput[] = [];

    for (let i = 0; i < inputCount && offset < buf.length; i++) {
      const clientHash = buf.readUInt32LE(offset); offset += 4;
      const seq = buf.readUInt32LE(offset); offset += 4;
      const dataLen = buf.readUInt16LE(offset); offset += 2;

      if (offset + dataLen > buf.length) break;

      const rawBytes = Buffer.from(buf.subarray(offset, offset + dataLen));
      offset += dataLen;

      // Try to parse as JSON if it looks like JSON
      let data: any = rawBytes;
      const firstByte = rawBytes[0];
      if (firstByte === 0x7B || firstByte === 0x5B) { // '{' or '['
        try {
          data = JSON.parse(rawBytes.toString('utf8'));
        } catch (e) {
          // Keep as raw bytes
        }
      }

      inputs.push({ clientHash, seq, data, rawBytes });
    }

    return { frame, roomId, snapshot, snapshotHash, inputs };
  } catch (e) {
    console.error('Failed to parse INITIAL_STATE:', e);
    return null;
  }
}

// Parse TICK message to extract inputs
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
        } catch (e) {
          // Keep as raw bytes
        }
      }

      inputs.push({ clientHash, seq, data, rawBytes });
    }

    return { frame, inputs };
  } catch (e) {
    console.error('Failed to parse TICK:', e);
    return null;
  }
}

function connectClient(name: string, playerId: string, nodeUrl: string, token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${nodeUrl}?token=${encodeURIComponent(token)}`;
    console.log(`[${name}] Connecting to: ${nodeUrl}`);
    const ws = new WebSocket(wsUrl);

    const client: Client = {
      name,
      ws,
      clientId: '',
      nodeUrl,
      token,
      receivedMessages: [],
      joinInputsReceived: [],
      disconnectInputsReceived: [],
      reconnectInputsReceived: [],
      initialStateSnapshot: null,
      initialStateInputs: [],
      initialStateFrame: -1
    };

    const timeout = setTimeout(() => {
      console.log(`[${name}] Timeout - messages received: ${client.receivedMessages.length}`);
      reject(new Error(`${name} timeout`));
    }, 15000);
    let resolved = false;

    ws.on('open', () => {
      console.log(`[${name}] WebSocket connected`);
      // Central service already handles room creation/joining
      // Just send JOIN_ROOM to finalize
      const msg = { type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } };
      console.log(`[${name}] Sending: JOIN_ROOM`);
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

        // If room not found, create it
        if (errMsg === 'Room not found') {
          console.log(`[${name}] Room not found, creating...`);
          const createMsg = { type: 'CREATE_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } };
          ws.send(JSON.stringify(createMsg));
        }
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
          console.log(`  - Input count: ${parsed.inputs.length}`);

          for (const input of parsed.inputs) {
            console.log(`    - Input seq=${input.seq}, type=${input.data?.type}, clientId=${input.data?.clientId}`);
            if (input.data?.type === 'join') {
              client.joinInputsReceived.push(input);
            } else if (input.data?.type === 'disconnect') {
              client.disconnectInputsReceived.push(input);
            } else if (input.data?.type === 'reconnect') {
              client.reconnectInputsReceived.push(input);
            }
          }

          console.log(`  - Join inputs: ${client.joinInputsReceived.length}`);
          console.log(`  - Disconnect inputs: ${client.disconnectInputsReceived.length}`);
        }

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(client);
        }
      }

      // TICK (0x01)
      if (msgType === MSG_TICK) {
        const parsed = parseTick(buf);
        if (parsed && parsed.inputs.length > 0) {
          for (const input of parsed.inputs) {
            if (input.data?.type === 'join') {
              client.joinInputsReceived.push(input);
              console.log(`[${name}] TICK: join input seq=${input.seq}, clientId=${input.data?.clientId}`);
            } else if (input.data?.type === 'disconnect') {
              client.disconnectInputsReceived.push(input);
              console.log(`[${name}] TICK: disconnect input seq=${input.seq}, clientId=${input.data?.clientId}`);
            } else if (input.data?.type === 'reconnect') {
              client.reconnectInputsReceived.push(input);
              console.log(`[${name}] TICK: reconnect input seq=${input.seq}, clientId=${input.data?.clientId}`);
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
      console.log(`[${name}] WebSocket closed: code=${code}, reason=${reason}`);
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
    // Phase 1: Player A creates room
    console.log('\n=== Phase 1: Player A creates room ===');
    const connA = await getNodeConnection(ROOM_ID);
    const clientA = await connectClient('A', 'playerA', connA.url, connA.token);
    console.log(`[A] Connected, clientId: ${clientA.clientId}`);
    const originalClientIdA = clientA.clientId;

    // Wait a bit for room to stabilize
    await wait(200);

    // Phase 2: Player B joins
    console.log('\n=== Phase 2: Player B joins ===');
    const connB = await getNodeConnection(ROOM_ID);
    const clientB = await connectClient('B', 'playerB', connB.url, connB.token);
    console.log(`[B] Connected, clientId: ${clientB.clientId}`);

    // Wait for tick with B's join to reach A
    await wait(500);

    // Phase 3: Player A disconnects (simulates browser refresh)
    console.log('\n=== Phase 3: Player A disconnects (simulates refresh) ===');
    if (clientA.ws) {
      clientA.ws.close();
      console.log('[A] WebSocket closed (simulating browser refresh)');
    }

    // Wait for disconnect to be processed
    await wait(500);

    // Phase 4: Player A reconnects with new connection
    console.log('\n=== Phase 4: Player A reconnects (simulates page reload) ===');
    const connA2 = await getNodeConnection(ROOM_ID);
    const clientA2 = await connectClient('A2', 'playerA', connA2.url, connA2.token);
    console.log(`[A2] Reconnected, new clientId: ${clientA2.clientId}`);

    // Wait for more data
    await wait(1000);

    // Phase 5: Analysis
    console.log('\n=== Phase 5: Analysis ===');

    console.log('\nPlayer A (after reconnect) INITIAL_STATE analysis:');
    console.log(`  Frame: ${clientA2.initialStateFrame}`);
    console.log(`  Snapshot seq: ${clientA2.initialStateSnapshot?.seq}`);
    console.log(`  Total inputs in INITIAL_STATE: ${clientA2.initialStateInputs.length}`);
    console.log(`  Join inputs received: ${clientA2.joinInputsReceived.length}`);
    console.log(`  Disconnect inputs received: ${clientA2.disconnectInputsReceived.length}`);

    // List all lifecycle inputs
    console.log('\nAll lifecycle inputs received by Player A (reconnected):');
    for (const input of clientA2.initialStateInputs) {
      const type = input.data?.type;
      if (type === 'join' || type === 'disconnect' || type === 'reconnect') {
        console.log(`  seq=${input.seq}: type=${type}, user.id=${input.data?.user?.id}, clientId=${input.data?.clientId}`);
      }
    }

    // Verification
    console.log('\n=== Verification ===');

    // Test 1: Player A (reconnected) should have received Player B's join
    const hasPlayerBJoin = clientA2.joinInputsReceived.some(input =>
      input.data?.user?.id === 'playerB' || input.data?.clientId === clientB.clientId
    );
    check('Reconnected Player A received Player B join input', hasPlayerBJoin,
      `Got ${clientA2.joinInputsReceived.length} join inputs: ${JSON.stringify(clientA2.joinInputsReceived.map(i => i.data?.user?.id || i.data?.clientId))}`);

    // Test 2: The join input should be in INITIAL_STATE
    const hasPlayerBJoinInInitialState = clientA2.initialStateInputs.some(input =>
      input.data?.type === 'join' &&
      (input.data?.user?.id === 'playerB' || input.data?.clientId === clientB.clientId)
    );
    check('Player B join input was in INITIAL_STATE', hasPlayerBJoinInInitialState,
      `INITIAL_STATE had ${clientA2.initialStateInputs.length} inputs`);

    // Test 3: Player A should NOT see their own OLD join (they disconnected)
    // But they SHOULD see their own disconnect and possibly reconnect
    const hasOwnDisconnect = clientA2.disconnectInputsReceived.some(input =>
      input.data?.user?.id === 'playerA' || input.data?.clientId === originalClientIdA
    );
    console.log(`\n  INFO: Player A's own disconnect in inputs: ${hasOwnDisconnect}`);

    // Test 4: Total join inputs should include at least Player B
    // (Player A's original join might be there too, or their reconnect)
    const activeJoinsCount = clientA2.joinInputsReceived.filter(input => {
      const userId = input.data?.user?.id;
      // Player B is definitely active
      if (userId === 'playerB') return true;
      // Player A's join is still relevant if they reconnected
      return false;
    }).length;
    check('At least one active player join in inputs', activeJoinsCount >= 1,
      `Active joins: ${activeJoinsCount}`);

    // Cleanup
    console.log('\n=== Cleanup ===');
    if (clientA2.ws) clientA2.ws.close();
    if (clientB.ws) clientB.ws.close();
    await wait(500);

    // Results
    console.log('\n=== Results ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\n!!! BUG REPRODUCED !!!');
      console.log('When Player A refreshes, they do NOT see Player B.');
      console.log('The INITIAL_STATE is missing Player B join input.');
      process.exit(1);
    } else {
      console.log('\nTest passed - player refresh correctly sees other players.');
      process.exit(0);
    }

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runTest();
