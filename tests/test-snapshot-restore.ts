/**
 * Test 2: Snapshot save/restore
 * Engine A runs 50 frames, saves snapshot
 * Engine B loads snapshot, both run 50 more frames
 * Hashes must match
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

// Engine A runs 50 frames
const A = createEngine('A');
for (let i = 0; i < 50; i++) {
    A.setLocalInput({ w: i % 20 < 10 });
    A.tick();
}

// Save snapshot
const snapshot = A.getWorldSnapshot();
const gameState = JSON.parse(JSON.stringify(A.gameState));
const snapshotHash = (A.getChecksum() >>> 0).toString(16).toUpperCase();
console.log(`A after 50 frames: hash=${snapshotHash}`);

// Engine B loads snapshot
const B = createEngine('B');
B.loadWorldSnapshot(snapshot);
B.gameState = gameState;
B.setFrame(50);

const loadedHash = (B.getChecksum() >>> 0).toString(16).toUpperCase();
console.log(`B after loading snapshot: hash=${loadedHash}`);

if (snapshotHash !== loadedHash) {
    console.log('❌ FAIL: Snapshot restore produced different hash');
    process.exit(1);
}
console.log('✅ Snapshot restore matches');

// Both run 50 more frames with same inputs
for (let i = 50; i < 100; i++) {
    const input = { w: i % 20 < 10 };
    A.setLocalInput(input);
    B.setLocalInput(input);
    A.tick();
    B.tick();
}

const hashA = (A.getChecksum() >>> 0).toString(16).toUpperCase();
const hashB = (B.getChecksum() >>> 0).toString(16).toUpperCase();

console.log(`A after 100 frames: hash=${hashA}`);
console.log(`B after 100 frames: hash=${hashB}`);
console.log(hashA === hashB ? '✅ PASS: Snapshot restore is deterministic' : '❌ FAIL: Diverged after restore');
process.exit(hashA === hashB ? 0 : 1);
