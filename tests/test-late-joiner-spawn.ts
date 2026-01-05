/**
 * Integration Test: Late Joiner Player Spawn
 *
 * This test verifies the complete flow from network to game layer:
 * 1. Client A creates room and sends join input
 * 2. Client B joins and receives INITIAL_STATE with A's join input
 * 3. Client B's processInput should call spawnPlayer for Client A
 *
 * This test mocks the gameAPI to verify spawnPlayer is called correctly.
 */

import WebSocket from 'ws';

const CENTRAL_URL = process.env.CENTRAL_URL || 'http://localhost:9001';
const ROOM_ID = 'late-joiner-spawn-' + Date.now();
const APP_ID = 'dev';

console.log('=== Test: Late Joiner Player Spawn ===');
console.log('Central:', CENTRAL_URL);
console.log('Room:', ROOM_ID);
console.log('');

// Binary message types
const MSG_TICK = 0x01;
const MSG_INITIAL_STATE = 0x02;
const MSG_ROOM_JOINED = 0x03;
const MSG_ROOM_CREATED = 0x04;
const MSG_ERROR = 0x05;

interface NetworkInput {
    seq: number;
    clientId: string;
    data: any;
    clientHash?: number;
}

// Mock the GameCallbacks interface
interface GameCallbacks {
    init(): void;
    spawnPlayer?(clientId: string): any;
    removePlayer?(clientId: string): void;
    applyInput(clientId: string, input: any): void;
    simulate(): void;
    getSnapshot(): any;
    loadSnapshot(snapshot: any): void;
}

// Create the exact processInput function from network.ts
function createProcessInput(gameAPI: GameCallbacks, connectedClients: string[]) {
    return function processInput(input: NetworkInput): void {
        if (!gameAPI) return;

        const data = input.data;
        const clientId = data?.clientId || input.clientId;
        const type = data?.type;

        console.log(`[processInput] type=${type || 'game'}, clientId=${clientId}`);

        if (type === 'join') {
            if (!connectedClients.includes(clientId)) {
                connectedClients.push(clientId);
                connectedClients.sort();
            }
            const spawn = gameAPI.spawnPlayer;
            console.log(`[processInput] Spawning player ${clientId}, spawn exists: ${!!spawn}`);
            if (spawn) spawn.call(gameAPI, clientId);
        } else if (type === 'leave' || type === 'disconnect') {
            const idx = connectedClients.indexOf(clientId);
            if (idx !== -1) {
                connectedClients.splice(idx, 1);
            }
            const remove = gameAPI.removePlayer;
            if (remove) remove.call(gameAPI, clientId);
        } else if (data && !type) {
            gameAPI.applyInput(clientId, data);
        }
    };
}

// Simulate the onConnect flow from network.ts
function simulateOnConnect(
    snapshot: any,
    inputs: NetworkInput[],
    gameAPI: GameCallbacks,
    connectedClients: string[]
): void {
    console.log('\n--- Simulating onConnect ---');
    console.log(`Snapshot has physics2d: ${!!snapshot?.physics2d}`);
    console.log(`Inputs to replay: ${inputs.length}`);

    // Load snapshot or init fresh (from network.ts lines 166-174)
    if (snapshot && Object.keys(snapshot).length > 0 && snapshot.physics2d) {
        gameAPI.loadSnapshot(snapshot);
        console.log('Loaded snapshot from network');
    } else {
        gameAPI.init();
        console.log('Initialized fresh game state (no physics2d in snapshot)');
    }

    // Replay inputs to spawn existing players (from network.ts lines 177-180)
    console.log(`Replaying ${inputs.length} inputs to spawn existing players...`);
    const processInput = createProcessInput(gameAPI, connectedClients);
    for (const input of inputs) {
        processInput(input);
    }
}

// Parse INITIAL_STATE message
function parseInitialState(buf: Buffer): { frame: number; snapshot: any; inputs: NetworkInput[] } | null {
    try {
        let offset = 1;
        const frame = buf.readUInt32LE(offset); offset += 4;
        const roomIdLen = buf.readUInt16LE(offset); offset += 2;
        offset += roomIdLen;
        const snapshotLen = buf.readUInt32LE(offset); offset += 4;
        const snapshotJson = buf.subarray(offset, offset + snapshotLen).toString('utf8'); offset += snapshotLen;
        const { snapshot } = JSON.parse(snapshotJson);

        const inputCount = buf.readUInt16LE(offset); offset += 2;
        const inputs: NetworkInput[] = [];

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

            const clientId = data?.clientId || `hash_${clientHash.toString(16)}`;
            inputs.push({ clientHash, seq, data, clientId });
        }

        return { frame, snapshot, inputs };
    } catch (e) {
        console.error('Failed to parse INITIAL_STATE:', e);
        return null;
    }
}

async function getNodeConnection(roomId: string): Promise<{ url: string; token: string }> {
    const res = await fetch(`${CENTRAL_URL}/api/apps/${APP_ID}/rooms/${roomId}/connect`, {
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
            setTimeout(() => !resolved && reject(new Error('Timeout A')), 10000);
        });

        // Wait for A's join to be broadcast
        await wait(500);

        // Phase 2: Client B joins
        console.log('\n=== Phase 2: Client B joins ===');
        const connB = await getNodeConnection(ROOM_ID);
        const wsUrlB = `${connB.url}?token=${encodeURIComponent(connB.token)}`;

        const clientBData = await new Promise<{ ws: WebSocket; clientId: string; initialState: any }>((resolve, reject) => {
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
            setTimeout(() => !resolved && reject(new Error('Timeout B')), 10000);
        });

        // Phase 3: Simulate engine processing on Client B
        console.log('\n=== Phase 3: Simulate engine onConnect ===');

        // Track what gameAPI methods are called
        const spawnedPlayers: string[] = [];
        const appliedInputs: { clientId: string; data: any }[] = [];
        let initCalled = false;

        const mockGameAPI: GameCallbacks = {
            init: () => {
                console.log('[MOCK] gameAPI.init() called');
                initCalled = true;
            },
            spawnPlayer: (clientId: string) => {
                console.log(`[MOCK] gameAPI.spawnPlayer("${clientId}") called`);
                spawnedPlayers.push(clientId);
            },
            removePlayer: (clientId: string) => {
                console.log(`[MOCK] gameAPI.removePlayer("${clientId}") called`);
            },
            applyInput: (clientId: string, data: any) => {
                console.log(`[MOCK] gameAPI.applyInput("${clientId}", ...) called`);
                appliedInputs.push({ clientId, data });
            },
            simulate: () => { },
            getSnapshot: () => ({ physics2d: false }),
            loadSnapshot: (snapshot: any) => {
                console.log('[MOCK] gameAPI.loadSnapshot() called');
            }
        };

        const connectedClients: string[] = [];

        // Simulate what network.ts onConnect does
        simulateOnConnect(
            clientBData.initialState?.snapshot,
            clientBData.initialState?.inputs || [],
            mockGameAPI,
            connectedClients
        );

        // Phase 4: Verification
        console.log('\n=== Phase 4: Verification ===');

        // Log what we received
        console.log(`\nInputs received by Client B:`);
        for (const input of (clientBData.initialState?.inputs || [])) {
            console.log(`  seq=${input.seq}, type=${input.data?.type}, clientId=${input.data?.clientId}`);
        }

        console.log(`\nSpawned players: ${JSON.stringify(spawnedPlayers)}`);
        console.log(`Client A's clientId: ${clientA.clientId}`);

        // Tests
        check('gameAPI.init() was called', initCalled);

        const hasJoinInputForA = (clientBData.initialState?.inputs || []).some(
            (i: NetworkInput) => i.data?.type === 'join' && i.data?.clientId === clientA.clientId
        );
        check('INITIAL_STATE contains Client A join input', hasJoinInputForA,
            `Inputs: ${JSON.stringify((clientBData.initialState?.inputs || []).map((i: NetworkInput) => ({ type: i.data?.type, clientId: i.data?.clientId })))}`);

        check('spawnPlayer was called', spawnedPlayers.length > 0);

        const spawnedA = spawnedPlayers.includes(clientA.clientId);
        check('spawnPlayer was called with Client A clientId', spawnedA,
            `Expected: ${clientA.clientId}, Got: ${JSON.stringify(spawnedPlayers)}`);

        check('connectedClients includes Client A', connectedClients.includes(clientA.clientId),
            `connectedClients: ${JSON.stringify(connectedClients)}`);

        // Cleanup
        clientA.ws.close();
        clientBData.ws.close();
        await wait(500);

        // Results
        console.log('\n=== Results ===');
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);

        if (failed > 0) {
            console.log('\nBUG: Late joiner is not correctly spawning existing players!');
            process.exit(1);
        } else {
            console.log('\nAll tests passed - late joiner correctly spawns existing players.');
            process.exit(0);
        }

    } catch (err) {
        console.error('Test error:', err);
        process.exit(1);
    }
}

runTest();
