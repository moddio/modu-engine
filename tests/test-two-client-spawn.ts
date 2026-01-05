/**
 * Test: Two clients connecting - does the second client see the first player?
 *
 * This test reproduces the bug where:
 * 1. Client A creates room
 * 2. Client A's join input is broadcast
 * 3. Client B joins and receives snapshot + inputs
 * 4. Client B should spawn player A from the join input
 */

import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

const CENTRAL_URL = 'http://localhost:9001';
const ROOM_ID = `test-spawn-${Date.now()}`;

interface DecodedMessage {
    type: string;
    roomId?: string;
    clientId?: string;
    frame?: number;
    inputs?: any[];
    snapshot?: any;
}

// Simple binary decoder for ROOM_JOINED and INITIAL_STATE
function decodeBinaryMessage(buffer: Buffer): DecodedMessage | null {
    if (buffer.length === 0) return null;
    const type = buffer[0];

    try {
        if (type === 0x03) { // ROOM_JOINED
            let offset = 1;
            const roomIdLen = buffer.readUInt16LE(offset); offset += 2;
            const roomId = buffer.slice(offset, offset + roomIdLen).toString(); offset += roomIdLen;
            const clientIdLen = buffer.readUInt16LE(offset); offset += 2;
            const clientId = buffer.slice(offset, offset + clientIdLen).toString();
            return { type: 'ROOM_JOINED', roomId, clientId };
        }

        if (type === 0x02) { // INITIAL_STATE
            let offset = 1;
            const frame = buffer.readUInt32LE(offset); offset += 4;
            const roomIdLen = buffer.readUInt16LE(offset); offset += 2;
            const roomId = buffer.slice(offset, offset + roomIdLen).toString(); offset += roomIdLen;
            const snapshotLen = buffer.readUInt32LE(offset); offset += 4;
            const snapshotJson = buffer.slice(offset, offset + snapshotLen).toString(); offset += snapshotLen;

            const inputCount = buffer.readUInt16LE(offset); offset += 2;
            const inputs: any[] = [];

            for (let i = 0; i < inputCount && offset < buffer.length; i++) {
                const clientHash = buffer.readUInt32LE(offset); offset += 4;
                const seq = buffer.readUInt32LE(offset); offset += 4;
                const dataLen = buffer.readUInt16LE(offset); offset += 2;

                if (offset + dataLen > buffer.length) break;

                const rawBytes = buffer.slice(offset, offset + dataLen);
                offset += dataLen;

                // Try to parse as JSON
                let data: any;
                const firstByte = rawBytes[0];
                if (firstByte === 0x7B || firstByte === 0x5B) {
                    try {
                        data = JSON.parse(rawBytes.toString());
                    } catch {
                        data = rawBytes;
                    }
                } else {
                    data = rawBytes;
                }

                inputs.push({ seq, data, clientHash });
            }

            const { snapshot } = JSON.parse(snapshotJson);
            return { type: 'INITIAL_STATE', frame, roomId, snapshot, inputs };
        }

        if (type === 0x04) { // ROOM_CREATED
            let offset = 1;
            const roomIdLen = buffer.readUInt16LE(offset); offset += 2;
            const roomId = buffer.slice(offset, offset + roomIdLen).toString(); offset += roomIdLen;
            const clientIdLen = buffer.readUInt16LE(offset); offset += 2;
            const clientId = buffer.slice(offset, offset + clientIdLen).toString();
            return { type: 'ROOM_CREATED', roomId, clientId };
        }

        if (type === 0x01) { // TICK
            const frame = buffer.readUInt32LE(1);
            const inputs: any[] = [];

            if (buffer.length > 5) {
                const inputCount = buffer[5];
                let offset = 6;

                for (let i = 0; i < inputCount && offset < buffer.length; i++) {
                    const clientHash = buffer.readUInt32LE(offset); offset += 4;
                    const seq = buffer.readUInt32LE(offset); offset += 4;
                    const dataLen = buffer.readUInt16LE(offset); offset += 2;

                    if (offset + dataLen > buffer.length) break;

                    const rawBytes = buffer.slice(offset, offset + dataLen);
                    offset += dataLen;

                    let data: any;
                    const firstByte = rawBytes[0];
                    if (firstByte === 0x7B || firstByte === 0x5B) {
                        try {
                            data = JSON.parse(rawBytes.toString());
                        } catch {
                            data = rawBytes;
                        }
                    } else {
                        data = rawBytes;
                    }

                    inputs.push({ seq, data, clientHash });
                }
            }

            return { type: 'TICK', frame, inputs };
        }

        return null;
    } catch (err) {
        console.error('Decode error:', err);
        return null;
    }
}

async function getNodeConnection(roomId: string): Promise<{ url: string; token: string }> {
    const res = await fetch(`${CENTRAL_URL}/api/apps/dev/rooms/${roomId}/connect`, {
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

async function connectClient(name: string, roomId: string): Promise<{ ws: WebSocket; clientId: string; messages: DecodedMessage[] }> {
    const { url, token } = await getNodeConnection(roomId);
    const wsUrl = `${url}?token=${encodeURIComponent(token)}`;

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        const messages: DecodedMessage[] = [];
        let clientId: string = '';
        let resolved = false;

        ws.on('open', () => {
            console.log(`[${name}] Connected to ${url}`);
            ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId, user: { id: name } } }));
        });

        ws.on('message', (data: Buffer) => {
            const msg = decodeBinaryMessage(Buffer.from(data));
            if (msg) {
                messages.push(msg);
                console.log(`[${name}] Received: ${msg.type}`, msg.type === 'INITIAL_STATE' ? `(${msg.inputs?.length} inputs)` : '');

                if (msg.type === 'ROOM_JOINED' && msg.clientId) {
                    clientId = msg.clientId;
                    console.log(`[${name}] Assigned clientId: ${clientId}`);
                }

                if (msg.type === 'ROOM_CREATED' && msg.clientId) {
                    clientId = msg.clientId;
                    console.log(`[${name}] Created room, clientId: ${clientId}`);
                }

                // Log TICK inputs
                if (msg.type === 'TICK' && msg.inputs && msg.inputs.length > 0) {
                    for (const input of msg.inputs) {
                        const data = input.data;
                        console.log(`[${name}] TICK input: seq=${input.seq}, type=${data?.type || 'binary'}, clientId=${data?.clientId || 'N/A'}`);
                    }
                }

                // Resolve after receiving INITIAL_STATE or ROOM_CREATED (room is ready)
                if (!resolved && (msg.type === 'INITIAL_STATE' || msg.type === 'ROOM_CREATED')) {
                    resolved = true;
                    // Wait a bit for any additional messages
                    setTimeout(() => resolve({ ws, clientId, messages }), 500);
                }
            }
        });

        ws.on('error', reject);

        // Timeout
        setTimeout(() => {
            if (!resolved) {
                reject(new Error(`[${name}] Timeout waiting for connection`));
            }
        }, 10000);
    });
}

async function main() {
    console.log('='.repeat(60));
    console.log('TEST: Two Client Spawn Bug Reproduction');
    console.log('='.repeat(60));
    console.log(`Room ID: ${ROOM_ID}\n`);

    try {
        // Step 1: Client A creates the room
        console.log('--- Step 1: Client A creates room ---');
        const clientA = await connectClient('ClientA', ROOM_ID);
        console.log(`Client A connected with ID: ${clientA.clientId}\n`);

        // Wait for A's join input to be processed
        await new Promise(r => setTimeout(r, 1000));

        // Step 2: Client B joins the room
        console.log('--- Step 2: Client B joins room ---');
        const clientB = await connectClient('ClientB', ROOM_ID);
        console.log(`Client B connected with ID: ${clientB.clientId}\n`);

        // Step 3: Analyze what Client B received
        console.log('--- Step 3: Analyzing Client B messages ---');
        const initialState = clientB.messages.find(m => m.type === 'INITIAL_STATE');

        if (initialState) {
            console.log(`INITIAL_STATE received:`);
            console.log(`  - Frame: ${initialState.frame}`);
            console.log(`  - Inputs: ${initialState.inputs?.length || 0}`);
            console.log(`  - Snapshot has physics2d: ${!!initialState.snapshot?.physics2d}`);

            if (initialState.inputs && initialState.inputs.length > 0) {
                console.log('\n  Input details:');
                for (const input of initialState.inputs) {
                    const data = input.data;
                    console.log(`    - seq=${input.seq}, type=${data?.type || 'binary'}, clientId=${data?.clientId || 'N/A'}`);
                }

                // Check if Client A's join is included
                const joinInputs = initialState.inputs.filter((i: any) => i.data?.type === 'join');
                console.log(`\n  Join inputs found: ${joinInputs.length}`);

                const clientAJoin = joinInputs.find((i: any) => i.data?.user?.id === 'ClientA');
                if (clientAJoin) {
                    console.log(`  ✓ Client A's join input IS present in INITIAL_STATE`);
                    console.log(`    clientId from input: ${clientAJoin.data.clientId}`);
                } else {
                    console.log(`  ✗ Client A's join input is MISSING from INITIAL_STATE!`);
                    console.log(`  This is the bug - late joiner won't spawn Client A`);
                }
            } else {
                console.log('\n  ✗ No inputs in INITIAL_STATE!');
                console.log('  This means late joiner gets empty state with no player info');
            }
        } else {
            console.log('✗ No INITIAL_STATE received by Client B!');
        }

        // Cleanup
        clientA.ws.close();
        clientB.ws.close();

        console.log('\n' + '='.repeat(60));
        console.log('TEST COMPLETE');
        console.log('='.repeat(60));

    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

main().then(() => {
    setTimeout(() => process.exit(0), 1000);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
