/**
 * Test 3: Late joiner catch-up simulation
 * Engine A runs 50 frames, Engine B joins late with snapshot,
 * then both receive the same "network" inputs and must stay in sync
 */
import { createStandaloneEngine, resetBodyIdCounter } from './test-helper-physics3d';

function createEngine(name: string) {
    resetBodyIdCounter();
    const engine = createStandaloneEngine(name, {
        physicsTimestep: 1 / 30,
        inputDelay: 0,
        gravity: -30
    });
    engine.gameState = { pendingJoins: {}, activatedPlayers: [] };
    engine.createStaticBox(0, -0.5, 0, 50, 0.5, 50, 'ground');
    for (let i = 0; i < 5; i++) {
        engine.createDynamicBox(i * 2 - 4, 1.5, 0, 0.8, 0.8, 0.8, `box_${i}`);
    }
    return engine;
}

// Generate deterministic inputs for testing
function getInput(frame: number) {
    return { w: frame % 20 < 10, s: false, a: frame % 15 < 7, d: false };
}

// Engine A runs 50 frames solo
const A = createEngine('A');
const inputHistory: { frame: number; input: any }[] = [];

for (let i = 0; i < 50; i++) {
    const input = getInput(i);
    inputHistory.push({ frame: i, input });
    A.setLocalInput(input);
    A.tick();
}

// Save snapshot at frame 50
const snapshot = A.getWorldSnapshot();
const gameState = JSON.parse(JSON.stringify(A.gameState));
const snapshotFrame = A.frame;
const snapshotHash = (A.getChecksum() >>> 0).toString(16).toUpperCase();
console.log(`A at frame ${snapshotFrame}: hash=${snapshotHash}`);

// Engine B joins late - loads snapshot
const B = createEngine('B');
B.loadWorldSnapshot(snapshot);
B.gameState = gameState;
B.setFrame(snapshotFrame);

const loadedHash = (B.getChecksum() >>> 0).toString(16).toUpperCase();
console.log(`B after loading snapshot at frame ${snapshotFrame}: hash=${loadedHash}`);

if (snapshotHash !== loadedHash) {
    console.log('❌ FAIL: Snapshot load produced different hash');
    process.exit(1);
}

// Now both continue running with same inputs from frame 50-100
// This simulates receiving inputs over "network"
for (let i = 50; i < 100; i++) {
    const input = getInput(i);
    inputHistory.push({ frame: i, input });

    A.setLocalInput(input);
    B.setLocalInput(input);
    A.tick();
    B.tick();

    // Check sync every 10 frames
    if (i % 10 === 9) {
        const hashA = (A.getChecksum() >>> 0).toString(16).toUpperCase();
        const hashB = (B.getChecksum() >>> 0).toString(16).toUpperCase();
        if (hashA !== hashB) {
            console.log(`❌ FAIL: Diverged at frame ${i + 1}`);
            console.log(`  A: ${hashA}`);
            console.log(`  B: ${hashB}`);
            process.exit(1);
        }
        console.log(`Frame ${i + 1}: synced (hash=${hashA})`);
    }
}

const finalHashA = (A.getChecksum() >>> 0).toString(16).toUpperCase();
const finalHashB = (B.getChecksum() >>> 0).toString(16).toUpperCase();

console.log(`\nFinal A: frame=${A.frame}, hash=${finalHashA}`);
console.log(`Final B: frame=${B.frame}, hash=${finalHashB}`);
console.log(finalHashA === finalHashB ? '✅ PASS: Late joiner catch-up is deterministic' : '❌ FAIL: Late joiner diverged');
process.exit(finalHashA === finalHashB ? 0 : 1);
