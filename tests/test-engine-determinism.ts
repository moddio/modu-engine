/**
 * Test 1: Engine determinism in isolation (no network)
 * Two engines, same inputs - hashes must match
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

const A = createEngine('A');
const B = createEngine('B');

// Run 100 frames with identical inputs
for (let i = 0; i < 100; i++) {
    const input = { w: i % 20 < 10, s: false, a: i % 15 < 7, d: false };
    A.setLocalInput(input);
    B.setLocalInput(input);
    A.tick();
    B.tick();
}

const hashA = (A.getChecksum() >>> 0).toString(16).toUpperCase();
const hashB = (B.getChecksum() >>> 0).toString(16).toUpperCase();

console.log(`Engine A: frame=${A.frame}, hash=${hashA}`);
console.log(`Engine B: frame=${B.frame}, hash=${hashB}`);
console.log(hashA === hashB ? '✅ PASS: Engines are deterministic' : '❌ FAIL: Engines diverged');
process.exit(hashA === hashB ? 0 : 1);
