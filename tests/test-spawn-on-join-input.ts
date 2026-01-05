/**
 * Test: Verify spawnPlayer is called when processing join inputs
 *
 * This test specifically validates that when processInput receives a join input,
 * the gameAPI.spawnPlayer function is called with the correct clientId.
 *
 * Bug being investigated:
 * - Client 2 refreshes but doesn't see existing players
 * - Network correctly sends Client A's join input in INITIAL_STATE
 * - But the game layer doesn't spawn the player
 */

import WebSocket from 'ws';

const CENTRAL_URL = process.env.CENTRAL_URL || 'http://localhost:9001';
const ROOM_ID = 'spawn-test-' + Date.now();
const APP_ID = 'dev';

console.log('=== Test: spawnPlayer Called on Join Input ===');
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
    clientId?: string;
}

// Get connection info from central service
async function getNodeConnection(roomId: string): Promise<{ url: string; token: string }> {
    const connectUrl = `${CENTRAL_URL}/api/apps/${APP_ID}/rooms/${roomId}/connect`;
    const res = await fetch(connectUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });

    if (!res.ok) {
        throw new Error(`Failed to get node: ${res.status}`);
    }

    const data = await res.json();
    return { url: data.url, token: data.token };
}

// Parse INITIAL_STATE message
function parseInitialState(buf: Buffer): { frame: number; snapshot: any; inputs: ParsedInput[] } | null {
    try {
        let offset = 1;
        const frame = buf.readUInt32LE(offset); offset += 4;
        const roomIdLen = buf.readUInt16LE(offset); offset += 2;
        offset += roomIdLen; // Skip roomId
        const snapshotLen = buf.readUInt32LE(offset); offset += 4;
        const snapshotJson = buf.subarray(offset, offset + snapshotLen).toString('utf8'); offset += snapshotLen;
        const { snapshot } = JSON.parse(snapshotJson);

        const inputCount = buf.readUInt16LE(offset); offset += 2;
        const inputs: ParsedInput[] = [];

        for (let i = 0; i < inputCount && offset < buf.length; i++) {
            const clientHash = buf.readUInt32LE(offset); offset += 4;
            const seq = buf.readUInt32LE(offset); offset += 4;
            const dataLen = buf.readUInt16LE(offset); offset += 2;

            if (offset + dataLen > buf.length) break;

            const rawBytes = buf.subarray(offset, offset + dataLen);
            offset += dataLen;

            let data: any = rawBytes;
            const firstByte = rawBytes[0];
            if (firstByte === 0x7B || firstByte === 0x5B) {
                try {
                    data = JSON.parse(rawBytes.toString('utf8'));
                } catch (e) { }
            }

            // Extract clientId from data if present
            const clientId = data?.clientId;
            inputs.push({ clientHash, seq, data, clientId });
        }

        return { frame, snapshot, inputs };
    } catch (e) {
        console.error('Failed to parse INITIAL_STATE:', e);
        return null;
    }
}

// Simulate processInput from engine/src/network.ts
function simulateProcessInput(input: ParsedInput, gameAPI: any): { spawned: boolean; clientId: string | null } {
    const data = input.data;
    const clientId = data?.clientId || input.clientId;
    const type = data?.type;

    console.log(`  [processInput] type=${type || 'game'}, clientId=${clientId}, data=`, JSON.stringify(data));

    if (type === 'join') {
        const spawn = gameAPI.spawnPlayer || gameAPI.spawnSnake;
        console.log(`  [processInput] Spawning player ${clientId}, spawn function exists: ${!!spawn}`);
        if (spawn) {
            spawn.call(gameAPI, clientId);
            return { spawned: true, clientId };
        }
    }
    return { spawned: false, clientId: null };
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
        const wsUrlA = `${connA.url}?token=${encodeURIComponent(connA.token)}`;

        const clientA = await new Promise<{ ws: WebSocket; clientId: string }>((resolve, reject) => {
            const ws = new WebSocket(wsUrlA);
            let clientId = '';
            let resolved = false;

            ws.on('open', () => {
                ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, user: { id: 'playerA' } } }));
            });

            ws.on('message', (data: Buffer) => {
                const buf = Buffer.from(data);
                if (buf[0] === MSG_ROOM_CREATED) {
                    const roomIdLen = buf.readUInt16LE(1);
                    let offset = 3 + roomIdLen;
                    const clientIdLen = buf.readUInt16LE(offset);
                    clientId = buf.subarray(offset + 2, offset + 2 + clientIdLen).toString('utf8');
                    console.log(`[A] Room created, clientId: ${clientId}`);
                    if (!resolved) {
                        resolved = true;
                        resolve({ ws, clientId });
                    }
                }
            });

            ws.on('error', reject);
            setTimeout(() => !resolved && reject(new Error('Timeout')), 10000);
        });

        console.log(`[A] Connected with clientId: ${clientA.clientId}`);

        // Wait for join input to be broadcast
        await wait(500);

        // Phase 2: Client B joins - simulate what engine/src/network.ts does
        console.log('\n=== Phase 2: Client B joins (simulating engine behavior) ===');
        const connB = await getNodeConnection(ROOM_ID);
        const wsUrlB = `${connB.url}?token=${encodeURIComponent(connB.token)}`;

        const clientB = await new Promise<{ ws: WebSocket; clientId: string; initialState: any }>((resolve, reject) => {
            const ws = new WebSocket(wsUrlB);
            let clientId = '';
            let initialState: any = null;
            let resolved = false;

            ws.on('open', () => {
                ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, user: { id: 'playerB' } } }));
            });

            ws.on('message', (data: Buffer) => {
                const buf = Buffer.from(data);

                if (buf[0] === MSG_ROOM_JOINED) {
                    const roomIdLen = buf.readUInt16LE(1);
                    let offset = 3 + roomIdLen;
                    const clientIdLen = buf.readUInt16LE(offset);
                    clientId = buf.subarray(offset + 2, offset + 2 + clientIdLen).toString('utf8');
                    console.log(`[B] Room joined, clientId: ${clientId}`);
                }

                if (buf[0] === MSG_INITIAL_STATE) {
                    initialState = parseInitialState(buf);
                    console.log(`[B] Received INITIAL_STATE: ${initialState?.inputs?.length || 0} inputs`);
                    if (!resolved) {
                        resolved = true;
                        resolve({ ws, clientId, initialState });
                    }
                }
            });

            ws.on('error', reject);
            setTimeout(() => !resolved && reject(new Error('Timeout')), 10000);
        });

        console.log(`[B] Connected with clientId: ${clientB.clientId}`);

        // Phase 3: Simulate engine processing
        console.log('\n=== Phase 3: Simulating engine processInput ===');

        // Track what spawnPlayer is called with
        const spawnedPlayers: string[] = [];
        const mockGameAPI = {
            spawnPlayer: (clientId: string) => {
                console.log(`  [MOCK gameAPI] spawnPlayer called with: ${clientId}`);
                spawnedPlayers.push(clientId);
            }
        };

        // Process inputs like engine/src/network.ts onConnect does
        console.log('\nProcessing INITIAL_STATE inputs:');
        if (clientB.initialState?.inputs) {
            for (const input of clientB.initialState.inputs) {
                simulateProcessInput(input, mockGameAPI);
            }
        }

        // Phase 4: Verification
        console.log('\n=== Phase 4: Verification ===');

        // Check if spawnPlayer was called for Client A
        const spawnedA = spawnedPlayers.includes(clientA.clientId);
        check('spawnPlayer called for Client A', spawnedA,
            `Spawned players: ${JSON.stringify(spawnedPlayers)}, expected: ${clientA.clientId}`);

        // Check the input structure
        const joinInputs = (clientB.initialState?.inputs || []).filter((i: ParsedInput) => i.data?.type === 'join');
        check('Join inputs have correct structure', joinInputs.length > 0,
            `Found ${joinInputs.length} join inputs`);

        if (joinInputs.length > 0) {
            const firstJoin = joinInputs[0];
            check('data.type is "join"', firstJoin.data?.type === 'join',
                `Actual type: ${firstJoin.data?.type}`);
            check('data.clientId is present', !!firstJoin.data?.clientId,
                `Actual clientId: ${firstJoin.data?.clientId}`);
        }

        // Cleanup
        clientA.ws.close();
        clientB.ws.close();
        await wait(500);

        // Results
        console.log('\n=== Results ===');
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);

        if (failed > 0) {
            console.log('\nBUG FOUND: processInput is not correctly spawning players!');
            console.log('Check the input structure vs what processInput expects.');
            process.exit(1);
        } else {
            console.log('\nAll tests passed - input processing works correctly.');
            process.exit(0);
        }

    } catch (err) {
        console.error('Test error:', err);
        process.exit(1);
    }
}

runTest();
