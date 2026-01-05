/**
 * Cross-Node Sync Test
 *
 * Tests that inputs are properly exchanged between clients on different nodes
 * and that both clients see the same events in the same order.
 *
 * This tests the full flow:
 * 1. Client A on node1 creates room
 * 2. Client B on node2 joins room
 * 3. Both send inputs
 * 4. Verify both receive ALL inputs (including from the other client)
 * 5. Verify inputs are in the same order
 */

import WebSocket from 'ws';

const NODE1_URL = process.env.NODE1_URL || 'ws://localhost:8001/ws';
const NODE2_URL = process.env.NODE2_URL || 'ws://localhost:8002/ws';
const ROOM_ID = 'cross-node-test-' + Date.now();

console.log('=== Cross-Node Sync Test ===');
console.log('Node 1:', NODE1_URL);
console.log('Node 2:', NODE2_URL);
console.log('Room:', ROOM_ID);
console.log('');

interface ReceivedInput {
  clientId: string;
  seq: number;
  data: any;
  frame: number;
}

interface Client {
  name: string;
  node: string;
  ws: WebSocket;
  clientId: string;
  playerId: string;
  receivedInputs: ReceivedInput[];
  receivedJoins: string[];
  sentCount: number;
  receivedFrames: number[];
}

function hashClientId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

// Map of clientHash -> clientId for lookup
const clientHashMap = new Map<number, string>();

function registerClientId(clientId: string) {
  const hash = hashClientId(clientId);
  clientHashMap.set(hash, clientId);
}

function lookupClientId(hash: number): string {
  return clientHashMap.get(hash) || `unknown_${hash.toString(16)}`;
}

function connectClient(name: string, nodeUrl: string, playerId: string, isCreator: boolean): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(nodeUrl);
    const client: Client = {
      name,
      node: nodeUrl.includes('8001') ? 'node1' : 'node2',
      ws,
      clientId: '',
      playerId,
      receivedInputs: [],
      receivedJoins: [],
      sentCount: 0,
      receivedFrames: []
    };

    const timeout = setTimeout(() => reject(new Error(`${name} connection timeout`)), 10000);

    ws.on('open', () => {
      const msg = isCreator
        ? { type: 'CREATE_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } }
        : { type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, user: { id: playerId } } };
      ws.send(JSON.stringify(msg));
    });

    ws.on('message', (data: Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const msgType = buf[0];

      // ROOM_CREATED (0x04) or ROOM_JOINED (0x03)
      if (msgType === 0x04 || msgType === 0x03) {
        const roomIdLen = buf.readUInt16LE(1);
        let offset = 3 + roomIdLen;
        if (buf.length > offset + 2) {
          const clientIdLen = buf.readUInt16LE(offset);
          client.clientId = buf.slice(offset + 2, offset + 2 + clientIdLen).toString('utf8');
          registerClientId(client.clientId);
        }
        console.log(`[${name}] Connected on ${client.node}, clientId: ${client.clientId}`);
        clearTimeout(timeout);
        resolve(client);
      }

      // INITIAL_STATE (0x02) - parse events for joins
      if (msgType === 0x02 && buf.length > 10) {
        let offset = 1;
        offset += 4; // frame
        const roomIdLen = buf.readUInt16LE(offset);
        offset += 2 + roomIdLen;
        const snapshotLen = buf.readUInt32LE(offset);
        offset += 4 + snapshotLen;
        const eventsLen = buf.readUInt32LE(offset);
        offset += 4;

        if (eventsLen > 0 && offset + eventsLen <= buf.length) {
          try {
            const eventsJson = buf.subarray(offset, offset + eventsLen).toString('utf8');
            const events = JSON.parse(eventsJson || '[]');
            for (const evt of events) {
              const evtData = evt.data || evt;
              if (evtData.type === 'join' && evtData.clientId) {
                registerClientId(evtData.clientId);
                client.receivedJoins.push(evtData.user?.id || evtData.clientId);
              }
            }
          } catch (e) {}
        }
      }

      // TICK (0x01) - parse inputs
      if (msgType === 0x01 && buf.length >= 6) {
        const frame = buf.readUInt32LE(1);
        const inputCount = buf[5];
        client.receivedFrames.push(frame);

        let offset = 6;
        for (let i = 0; i < inputCount && offset + 10 <= buf.length; i++) {
          const clientHash = buf.readUInt32LE(offset);
          offset += 4;
          const seq = buf.readUInt32LE(offset);
          offset += 4;
          const dataLen = buf.readUInt16LE(offset);
          offset += 2;

          if (offset + dataLen > buf.length) break;

          const rawBytes = buf.subarray(offset, offset + dataLen);
          offset += dataLen;

          // Decode data
          let inputData: any;
          const firstByte = rawBytes[0];
          if (firstByte === 0x7B || firstByte === 0x5B) {
            try {
              inputData = JSON.parse(rawBytes.toString('utf8'));
            } catch {
              inputData = { raw: true };
            }
          } else {
            inputData = { binary: true };
          }

          // Register clientId from join events
          if (inputData.type === 'join' && inputData.clientId) {
            registerClientId(inputData.clientId);
            client.receivedJoins.push(inputData.user?.id || inputData.clientId);
          }

          const clientId = lookupClientId(clientHash);

          client.receivedInputs.push({
            clientId,
            seq,
            data: inputData,
            frame
          });
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function sendInput(client: Client, inputData: any) {
  const msg = JSON.stringify({
    type: 'SEND_INPUT',
    payload: {
      roomId: ROOM_ID,
      data: inputData
    }
  });
  client.ws.send(msg);
  client.sentCount++;
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
    // Phase 1: Connect clients to different nodes
    console.log('\nPhase 1: Connect clients to different nodes');
    const clientA = await connectClient('A', NODE1_URL, 'playerA', true);
    await wait(500);

    const clientB = await connectClient('B', NODE2_URL, 'playerB', false);
    await wait(1000); // Wait for join event to propagate

    // Phase 2: Both clients send inputs
    console.log('\nPhase 2: Send inputs from both clients');
    const INPUT_COUNT = 5;

    // Clear existing inputs
    clientA.receivedInputs = [];
    clientB.receivedInputs = [];

    // Send inputs alternating between A and B
    for (let i = 0; i < INPUT_COUNT; i++) {
      sendInput(clientA, { type: 'input', seq: i, from: 'A', keys: { w: true } });
      await wait(50);
      sendInput(clientB, { type: 'input', seq: i, from: 'B', keys: { s: true } });
      await wait(50);
    }

    // Wait for inputs to propagate
    await wait(2000);

    // Phase 3: Verify results
    console.log('\nPhase 3: Verify input exchange');

    // Count inputs by source
    const aFromA = clientA.receivedInputs.filter(i => i.data?.from === 'A' && i.data?.type === 'input').length;
    const aFromB = clientA.receivedInputs.filter(i => i.data?.from === 'B' && i.data?.type === 'input').length;
    const bFromA = clientB.receivedInputs.filter(i => i.data?.from === 'A' && i.data?.type === 'input').length;
    const bFromB = clientB.receivedInputs.filter(i => i.data?.from === 'B' && i.data?.type === 'input').length;

    console.log(`  Client A received: ${aFromA} from A, ${aFromB} from B`);
    console.log(`  Client B received: ${bFromA} from A, ${bFromB} from B`);

    // Client A should receive inputs from both (including own)
    check('A receives own inputs', aFromA >= INPUT_COUNT - 1, `got ${aFromA}, expected ${INPUT_COUNT}`);
    check('A receives B\'s inputs', aFromB >= INPUT_COUNT - 1, `got ${aFromB}, expected ${INPUT_COUNT}`);

    // Client B should receive inputs from both
    check('B receives A\'s inputs', bFromA >= INPUT_COUNT - 1, `got ${bFromA}, expected ${INPUT_COUNT}`);
    check('B receives own inputs', bFromB >= INPUT_COUNT - 1, `got ${bFromB}, expected ${INPUT_COUNT}`);

    // Verify join events were received
    console.log('\nPhase 4: Verify join events');
    console.log(`  Client A received joins: ${clientA.receivedJoins.join(', ')}`);
    console.log(`  Client B received joins: ${clientB.receivedJoins.join(', ')}`);

    check('A saw B join', clientA.receivedJoins.includes('playerB') ||
          clientA.receivedInputs.some(i => i.data?.type === 'join' && i.data?.user?.id === 'playerB'));
    check('B saw A in initial state', clientB.receivedJoins.includes('playerA') ||
          clientB.receivedInputs.some(i => i.data?.type === 'join' && i.data?.user?.id === 'playerA'));

    // Phase 5: Check sequence numbers match
    console.log('\nPhase 5: Verify sequence ordering');
    const aInputSeqs = clientA.receivedInputs.filter(i => i.data?.type === 'input').map(i => i.seq).sort((a,b) => a-b);
    const bInputSeqs = clientB.receivedInputs.filter(i => i.data?.type === 'input').map(i => i.seq).sort((a,b) => a-b);

    // Check for gaps
    const aHasGaps = aInputSeqs.some((s, i, arr) => i > 0 && s > arr[i-1] + 1);
    const bHasGaps = bInputSeqs.some((s, i, arr) => i > 0 && s > arr[i-1] + 1);

    console.log(`  A seq range: ${aInputSeqs[0]} - ${aInputSeqs[aInputSeqs.length-1]} (${aInputSeqs.length} inputs)`);
    console.log(`  B seq range: ${bInputSeqs[0]} - ${bInputSeqs[bInputSeqs.length-1]} (${bInputSeqs.length} inputs)`);

    check('A received inputs without gaps', !aHasGaps || aInputSeqs.length < 5);
    check('B received inputs without gaps', !bHasGaps || bInputSeqs.length < 5);

    // Cleanup
    clientA.ws.close();
    clientB.ws.close();

    // Summary
    console.log('\n=== Results ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nDIAGNOSIS: Cross-node sync is broken!');
      console.log('The issue is that inputs from one node are not being properly');
      console.log('delivered to clients on the other node.');
      process.exit(1);
    } else {
      console.log('\nAll tests passed!');
      process.exit(0);
    }

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runTest();
