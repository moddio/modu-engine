/**
 * Test: Same Node Refresh
 *
 * This test forces both players to be on the SAME node and tests refresh.
 * This is the simplest case - authority node only.
 *
 * The scenario:
 * 1. Player A creates room on node 1
 * 2. Player B joins on node 1 (same node)
 * 3. Player A disconnects
 * 4. Player A reconnects on node 1
 * 5. Player A should see Player B
 */

import WebSocket from 'ws';

const NODE_URL = 'ws://localhost:8001/ws';
const CENTRAL_URL = process.env.CENTRAL_URL || 'http://localhost:9001';
const ROOM_ID = 'same-node-refresh-' + Date.now();
const APP_ID = 'dev';

console.log('=== Same Node Refresh Test ===');
console.log('Node:', NODE_URL);
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
}

interface Client {
  name: string;
  ws: WebSocket | null;
  clientId: string;
  initialStateInputs: ParsedInput[];
  joinInputsReceived: ParsedInput[];
}

// Get token directly for a specific node
async function getTokenForNode(): Promise<string> {
  const connectUrl = `${CENTRAL_URL}/api/apps/${APP_ID}/rooms/${ROOM_ID}/connect`;
  const res = await fetch(connectUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (!res.ok) throw new Error('Failed to get token');
  const data = await res.json();
  return data.token;
}

function parseInitialState(buf: Buffer): { inputs: ParsedInput[] } | null {
  try {
    let offset = 1;
    const frame = buf.readUInt32LE(offset); offset += 4;
    const roomIdLen = buf.readUInt16LE(offset); offset += 2;
    offset += roomIdLen;
    const snapshotLen = buf.readUInt32LE(offset); offset += 4;
    offset += snapshotLen;

    const inputCount = buf.readUInt16LE(offset); offset += 2;
    const inputs: ParsedInput[] = [];

    for (let i = 0; i < inputCount && offset < buf.length; i++) {
      const clientHash = buf.readUInt32LE(offset); offset += 4;
      const seq = buf.readUInt32LE(offset); offset += 4;
      const dataLen = buf.readUInt16LE(offset); offset += 2;

      if (offset + dataLen > buf.length) break;

      const rawBytes = buf.subarray(offset, offset + dataLen);
      offset += dataLen;

      let data: any = null;
      try {
        data = JSON.parse(rawBytes.toString('utf8'));
      } catch (e) {}

      inputs.push({ clientHash, seq, data });
    }

    return { inputs };
  } catch (e) {
    return null;
  }
}

function connectClient(name: string, playerId: string, token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${NODE_URL}?token=${encodeURIComponent(token)}`;
    console.log(`[${name}] Connecting to node 1...`);
    const ws = new WebSocket(wsUrl);

    const client: Client = {
      name,
      ws,
      clientId: '',
      initialStateInputs: [],
      joinInputsReceived: []
    };

    const timeout = setTimeout(() => reject(new Error(`${name} timeout`)), 15000);
    let resolved = false;

    ws.on('open', () => {
      console.log(`[${name}] Connected, sending JOIN_ROOM`);
      ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } }));
    });

    ws.on('message', (data: Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const msgType = buf[0];

      if (msgType === MSG_ERROR) {
        const msgLen = buf.readUInt16LE(1);
        const errMsg = buf.subarray(3, 3 + msgLen).toString('utf8');
        console.log(`[${name}] ERROR: ${errMsg}`);
        if (errMsg === 'Room not found') {
          ws.send(JSON.stringify({ type: 'CREATE_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } }));
        }
      }

      if (msgType === MSG_ROOM_CREATED) {
        const roomIdLen = buf.readUInt16LE(1);
        let offset = 3 + roomIdLen;
        const clientIdLen = buf.readUInt16LE(offset);
        client.clientId = buf.subarray(offset + 2, offset + 2 + clientIdLen).toString('utf8');
        console.log(`[${name}] ROOM_CREATED, clientId: ${client.clientId}`);
        if (!resolved) { resolved = true; clearTimeout(timeout); resolve(client); }
      }

      if (msgType === MSG_ROOM_JOINED) {
        const roomIdLen = buf.readUInt16LE(1);
        let offset = 3 + roomIdLen;
        const clientIdLen = buf.readUInt16LE(offset);
        client.clientId = buf.subarray(offset + 2, offset + 2 + clientIdLen).toString('utf8');
        console.log(`[${name}] ROOM_JOINED, clientId: ${client.clientId}`);
      }

      if (msgType === MSG_INITIAL_STATE) {
        const parsed = parseInitialState(buf);
        if (parsed) {
          client.initialStateInputs = parsed.inputs;
          for (const inp of parsed.inputs) {
            if (inp.data?.type === 'join') {
              client.joinInputsReceived.push(inp);
              console.log(`[${name}] INITIAL_STATE join: seq=${inp.seq}, clientId=${inp.data?.clientId}, user=${inp.data?.user?.id}`);
            }
          }
        }
        if (!resolved) { resolved = true; clearTimeout(timeout); resolve(client); }
      }

      if (msgType === MSG_TICK) {
        // Parse tick for join inputs
        if (buf.length > 5) {
          const inputCount = buf[5];
          let offset = 6;
          for (let i = 0; i < inputCount && offset < buf.length; i++) {
            const clientHash = buf.readUInt32LE(offset); offset += 4;
            const seq = buf.readUInt32LE(offset); offset += 4;
            const dataLen = buf.readUInt16LE(offset); offset += 2;
            if (offset + dataLen > buf.length) break;
            const rawBytes = buf.subarray(offset, offset + dataLen);
            offset += dataLen;
            try {
              const data = JSON.parse(rawBytes.toString('utf8'));
              if (data?.type === 'join') {
                client.joinInputsReceived.push({ clientHash, seq, data });
                console.log(`[${name}] TICK join: seq=${seq}, clientId=${data?.clientId}, user=${data?.user?.id}`);
              }
            } catch (e) {}
          }
        }
      }
    });

    ws.on('error', reject);
    ws.on('close', () => console.log(`[${name}] Closed`));
  });
}

async function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function runTest() {
  try {
    // Phase 1: Player A creates room
    console.log('\n--- Phase 1: Player A creates room ---');
    const tokenA = await getTokenForNode();
    const clientA = await connectClient('A', 'playerA', tokenA);
    await wait(300);

    // Phase 2: Player B joins
    console.log('\n--- Phase 2: Player B joins ---');
    const tokenB = await getTokenForNode();
    const clientB = await connectClient('B', 'playerB', tokenB);
    await wait(300);

    // Phase 3: Player A disconnects
    console.log('\n--- Phase 3: Player A disconnects ---');
    clientA.ws?.close();
    await wait(300);

    // Phase 4: Player A reconnects
    console.log('\n--- Phase 4: Player A reconnects ---');
    const tokenA2 = await getTokenForNode();
    const clientA2 = await connectClient('A2', 'playerA', tokenA2);
    await wait(500);

    // Analysis
    console.log('\n--- Analysis ---');
    console.log(`A2 INITIAL_STATE inputs: ${clientA2.initialStateInputs.length}`);
    console.log(`A2 join inputs total: ${clientA2.joinInputsReceived.length}`);

    const hasPlayerBJoin = clientA2.joinInputsReceived.some(i => i.data?.user?.id === 'playerB');
    console.log(`\nHas Player B join: ${hasPlayerBJoin}`);

    // Cleanup
    clientA2.ws?.close();
    clientB.ws?.close();
    await wait(200);

    if (hasPlayerBJoin) {
      console.log('\nPASS: Reconnected player sees other player');
      process.exit(0);
    } else {
      console.log('\nFAIL: Reconnected player does NOT see other player');
      process.exit(1);
    }

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runTest();
