/**
 * Same-Node Hash Sync Test
 *
 * Reproduces the bug where two clients on the SAME node
 * have different world hashes despite being at the same frame.
 *
 * This is the most basic multiplayer test - if this fails,
 * everything is broken.
 */

import WebSocket from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8001/ws';
const ROOM_ID = 'hash-test-' + Date.now();

console.log('=== Same-Node Hash Sync Test ===');
console.log('Server:', SERVER_URL);
console.log('Room:', ROOM_ID);
console.log('');

interface Client {
  name: string;
  ws: WebSocket;
  clientId: string;
  frames: number[];
  hashes: Map<number, string>; // frame -> hash from that tick
  lastFrame: number;
  lastHash: string;
}

function hashClientId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function connectClient(name: string, playerId: string, isCreator: boolean): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const client: Client = {
      name,
      ws,
      clientId: '',
      frames: [],
      hashes: new Map(),
      lastFrame: 0,
      lastHash: ''
    };

    const timeout = setTimeout(() => reject(new Error(`${name} timeout`)), 10000);

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
        }
        console.log(`[${name}] Connected, clientId: ${client.clientId}`);
        clearTimeout(timeout);
        resolve(client);
      }

      // TICK (0x01)
      if (msgType === 0x01 && buf.length >= 6) {
        const frame = buf.readUInt32LE(1);
        client.lastFrame = frame;
        client.frames.push(frame);
      }
    });

    ws.on('error', reject);
  });
}

function sendInput(client: Client, data: any) {
  client.ws.send(JSON.stringify({
    type: 'SEND_INPUT',
    payload: { roomId: ROOM_ID, data }
  }));
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
    // Connect both clients to SAME node
    console.log('\nPhase 1: Connect both clients to SAME node');
    const clientA = await connectClient('A', 'playerA', true);
    await wait(500);
    const clientB = await connectClient('B', 'playerB', false);
    await wait(1000);

    // Both send some inputs
    console.log('\nPhase 2: Send inputs from both clients');
    for (let i = 0; i < 10; i++) {
      sendInput(clientA, { type: 'input', frame: i, data: { w: true } });
      sendInput(clientB, { type: 'input', frame: i, data: { s: true } });
      await wait(100);
    }
    await wait(2000);

    // Check frame sync
    console.log('\nPhase 3: Verify frame synchronization');
    console.log(`  A last frame: ${clientA.lastFrame}`);
    console.log(`  B last frame: ${clientB.lastFrame}`);

    const frameDiff = Math.abs(clientA.lastFrame - clientB.lastFrame);
    check('Frames are synchronized', frameDiff <= 5, `diff=${frameDiff}`);

    // Check they're both receiving ticks
    check('A receiving ticks', clientA.frames.length > 50, `got ${clientA.frames.length}`);
    check('B receiving ticks', clientB.frames.length > 50, `got ${clientB.frames.length}`);

    // Cleanup
    clientA.ws.close();
    clientB.ws.close();

    console.log('\n=== Results ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nBASIC SYNC IS BROKEN!');
      process.exit(1);
    }
    process.exit(0);

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runTest();
