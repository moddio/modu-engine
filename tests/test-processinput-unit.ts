/**
 * Unit Test: processInput function behavior
 *
 * This test validates the processInput logic from engine/src/network.ts
 * WITHOUT requiring network connectivity.
 *
 * Tests the exact scenarios:
 * 1. Join input with data.type='join' and data.clientId
 * 2. Verifies spawnPlayer is called with correct clientId
 */

console.log('=== Unit Test: processInput Function ===\n');

// Simulate the NetworkInput interface from modu-network.ts
interface NetworkInput {
    seq: number;
    clientId: string;
    data: any;
    clientHash?: number;
}

// Simulate the exact processInput function from engine/src/network.ts
function createProcessInput(gameAPI: any) {
    const connectedClients: string[] = [];

    return function processInput(input: NetworkInput): void {
        if (!gameAPI) return;

        const data = input.data;
        const clientId = data?.clientId || input.clientId;
        const type = data?.type;

        console.log(`[processInput] type=${type || 'game'}, clientId=${clientId}, input.clientId=${input.clientId}`);
        console.log(`[processInput] data=`, JSON.stringify(data));

        if (type === 'join') {
            // Track client for round-robin snapshots
            if (!connectedClients.includes(clientId)) {
                connectedClients.push(clientId);
                connectedClients.sort(); // Deterministic order
            }
            const spawn = gameAPI.spawnPlayer || gameAPI.spawnSnake;
            console.log(`[processInput] Spawning player ${clientId}, spawn function exists: ${!!spawn}`);
            if (spawn) spawn.call(gameAPI, clientId);
        } else if (type === 'leave' || type === 'disconnect') {
            // Remove from tracking
            const idx = connectedClients.indexOf(clientId);
            if (idx !== -1) {
                connectedClients.splice(idx, 1);
            }
            const remove = gameAPI.removePlayer || gameAPI.removeSnake;
            if (remove) remove.call(gameAPI, clientId);
        } else if (data && !type) {
            // Game input (no type = game data)
            gameAPI.applyInput(clientId, data);
        }
    };
}

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

// Test 1: Standard join input from server
console.log('\n--- Test 1: Standard join input (server format) ---');
{
    const spawnedPlayers: string[] = [];
    const mockGameAPI = {
        spawnPlayer: (clientId: string) => {
            console.log(`[MOCK] spawnPlayer("${clientId}")`);
            spawnedPlayers.push(clientId);
        }
    };

    const processInput = createProcessInput(mockGameAPI);

    // This is exactly what the server sends (from client-handler.ts)
    // and what modu-network.ts decodes and passes to onConnect
    const joinInput: NetworkInput = {
        seq: 1,
        clientId: 'client-abc-123',  // From SDK's hash lookup
        data: {
            type: 'join',
            clientId: 'client-abc-123',
            user: { id: 'playerA' }
        }
    };

    processInput(joinInput);

    check('spawnPlayer was called', spawnedPlayers.length === 1);
    check('spawnPlayer received correct clientId', spawnedPlayers[0] === 'client-abc-123',
        `Expected: client-abc-123, Got: ${spawnedPlayers[0]}`);
}

// Test 2: Join input with clientId only in data (not at top level)
console.log('\n--- Test 2: Join input with clientId only in data ---');
{
    const spawnedPlayers: string[] = [];
    const mockGameAPI = {
        spawnPlayer: (clientId: string) => {
            console.log(`[MOCK] spawnPlayer("${clientId}")`);
            spawnedPlayers.push(clientId);
        }
    };

    const processInput = createProcessInput(mockGameAPI);

    // Sometimes the top-level clientId might be missing or different
    const joinInput: NetworkInput = {
        seq: 1,
        clientId: 'hash_abcd1234',  // Fallback hash value
        data: {
            type: 'join',
            clientId: 'client-xyz-789',  // Real clientId in data
            user: { id: 'playerB' }
        }
    };

    processInput(joinInput);

    check('spawnPlayer was called', spawnedPlayers.length === 1);
    // The code uses: data?.clientId || input.clientId
    // So data.clientId should take precedence
    check('spawnPlayer used data.clientId (not fallback)', spawnedPlayers[0] === 'client-xyz-789',
        `Expected: client-xyz-789, Got: ${spawnedPlayers[0]}`);
}

// Test 3: Input where data.type is undefined (game input, not join)
console.log('\n--- Test 3: Game input (no type) ---');
{
    const spawnedPlayers: string[] = [];
    const appliedInputs: { clientId: string; data: any }[] = [];
    const mockGameAPI = {
        spawnPlayer: (clientId: string) => {
            spawnedPlayers.push(clientId);
        },
        applyInput: (clientId: string, data: any) => {
            console.log(`[MOCK] applyInput("${clientId}", ${JSON.stringify(data)})`);
            appliedInputs.push({ clientId, data });
        }
    };

    const processInput = createProcessInput(mockGameAPI);

    const gameInput: NetworkInput = {
        seq: 2,
        clientId: 'client-abc-123',
        data: {
            moveX: 100,
            moveY: 50
            // Note: no type field
        }
    };

    processInput(gameInput);

    check('spawnPlayer was NOT called for game input', spawnedPlayers.length === 0);
    check('applyInput was called', appliedInputs.length === 1);
    check('applyInput received correct clientId', appliedInputs[0]?.clientId === 'client-abc-123');
}

// Test 4: Join input with missing data.clientId (edge case)
console.log('\n--- Test 4: Join input with missing data.clientId ---');
{
    const spawnedPlayers: string[] = [];
    const mockGameAPI = {
        spawnPlayer: (clientId: string) => {
            console.log(`[MOCK] spawnPlayer("${clientId}")`);
            spawnedPlayers.push(clientId);
        }
    };

    const processInput = createProcessInput(mockGameAPI);

    // Edge case: data has type but no clientId
    const joinInput: NetworkInput = {
        seq: 1,
        clientId: 'client-fallback',  // Should use this
        data: {
            type: 'join',
            // Note: no clientId in data!
            user: { id: 'playerC' }
        }
    };

    processInput(joinInput);

    check('spawnPlayer was called', spawnedPlayers.length === 1);
    check('spawnPlayer fell back to input.clientId', spawnedPlayers[0] === 'client-fallback',
        `Expected: client-fallback, Got: ${spawnedPlayers[0]}`);
}

// Test 5: Null/undefined data
console.log('\n--- Test 5: Null data (should not crash) ---');
{
    const spawnedPlayers: string[] = [];
    const mockGameAPI = {
        spawnPlayer: (clientId: string) => {
            spawnedPlayers.push(clientId);
        },
        applyInput: () => { }
    };

    const processInput = createProcessInput(mockGameAPI);

    const nullInput: NetworkInput = {
        seq: 1,
        clientId: 'client-null',
        data: null
    };

    try {
        processInput(nullInput);
        check('Did not crash with null data', true);
        check('spawnPlayer was NOT called for null data', spawnedPlayers.length === 0);
    } catch (e) {
        check('Did not crash with null data', false, `Error: ${e}`);
    }
}

// Test 6: Binary data (Uint8Array) - game inputs
console.log('\n--- Test 6: Binary data (Uint8Array) ---');
{
    const spawnedPlayers: string[] = [];
    const appliedInputs: any[] = [];
    const mockGameAPI = {
        spawnPlayer: (clientId: string) => {
            spawnedPlayers.push(clientId);
        },
        applyInput: (clientId: string, data: any) => {
            console.log(`[MOCK] applyInput for binary data`);
            appliedInputs.push({ clientId, data });
        }
    };

    const processInput = createProcessInput(mockGameAPI);

    // Binary game input (not JSON)
    const binaryInput: NetworkInput = {
        seq: 3,
        clientId: 'client-binary',
        data: new Uint8Array([0x01, 0x02, 0x03])  // Binary data
    };

    processInput(binaryInput);

    // Binary data has no .type property, but is truthy
    // The condition is: `else if (data && !type)`
    // Uint8Array is truthy and .type is undefined, so applyInput should be called
    check('spawnPlayer NOT called for binary', spawnedPlayers.length === 0);
    check('applyInput called for binary data', appliedInputs.length === 1);
}

// Results
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    console.log('\nISSUES FOUND in processInput logic!');
    process.exit(1);
} else {
    console.log('\nAll processInput tests passed.');
    process.exit(0);
}
