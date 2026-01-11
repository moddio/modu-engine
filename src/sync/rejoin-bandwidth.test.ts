/**
 * Rejoin Bandwidth Spike Test
 *
 * GOAL: Reproduce the exact bug where authority's delta bandwidth spikes to >10 kB/s
 * after a client reconnects (rapid rejoin).
 *
 * The bug scenario:
 * 1. Authority + Client B running with active gameplay (entities moving)
 * 2. Client B refreshes (disconnects, then reconnects with new client ID)
 * 3. Authority's delta bandwidth spikes because of some state mismatch
 *
 * Key insight: The bandwidth spike is measured at the AUTHORITY, not the rejoining client.
 * The authority computes deltas and sends them to other clients.
 *
 * What we need to measure:
 * - Delta size at authority BEFORE rejoin (should be ~100-500 B/s with 2 cells moving)
 * - Delta size at authority AFTER rejoin (should stay ~100-500 B/s, NOT spike to 10+ kB/s)
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from '../game';
import { Transform2D, Body2D, Sprite, Player, SHAPE_CIRCLE, BODY_STATIC, BODY_KINEMATIC } from '../components';
import { computeStateDelta, getDeltaSize, isDeltaEmpty } from './state-delta';
import { Physics2DSystem } from '../plugins/physics2d/system';
import { encode, decode } from '../codec';

function createMockConnection(clientId: string) {
    return {
        clientId,
        send: vi.fn(),
        sendSnapshot: vi.fn(),
        sendStateHash: vi.fn(),
        sendPartitionData: vi.fn(),
        onMessage: vi.fn(),
        onInput: vi.fn(),
        close: vi.fn()
    };
}

describe('Rejoin Bandwidth Spike Bug', () => {
    let authority: Game;
    let physics: Physics2DSystem;
    let frameCounter: number;

    // Track delta sizes at each frame
    const deltaSizes: number[] = [];
    const deltaUpdates: number[] = [];

    beforeEach(() => {
        authority = new Game({ tickRate: 60 });
        const authorityConn = createMockConnection('authority-id');
        (authority as any).connection = authorityConn;
        (authority as any).localClientIdStr = 'authority-id';

        // Add physics for realistic movement
        physics = new Physics2DSystem({ gravity: { x: 0, y: 0 } });
        physics.attach(authority.world);

        // Define entity types like cell-eater
        authority.defineEntity('food')
            .with(Transform2D)
            .with(Sprite, { shape: SHAPE_CIRCLE, radius: 8 })
            .with(Body2D, { bodyType: BODY_STATIC, shapeType: SHAPE_CIRCLE, radius: 8 });

        authority.defineEntity('cell')
            .with(Transform2D)
            .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
            .with(Player)
            .with(Body2D, { bodyType: BODY_KINEMATIC, shapeType: SHAPE_CIRCLE, radius: 20 });

        // Setup callbacks
        (authority as any).callbacks = {
            onConnect: (clientId: string) => {
                const cell = authority.spawn('cell', { x: 500, y: 500 });
                cell.get(Player).clientId = (authority as any).internClientId(clientId);
            },
            onDisconnect: (clientId: string) => {
                const numId = (authority as any).internClientId(clientId);
                for (const entity of authority.query('cell')) {
                    if (entity.get(Player).clientId === numId) {
                        entity.destroy();
                    }
                }
            }
        };

        frameCounter = 0;
        deltaSizes.length = 0;
        deltaUpdates.length = 0;
    });

    // Simulate a game tick with movement and state sync
    function tick(cells: any[], targetX = 600, targetY = 600) {
        // Move cells toward target (simulating input-driven movement)
        for (const cell of cells) {
            if (!cell.destroyed) {
                const transform = cell.get(Transform2D);
                const dx = targetX - transform.x;
                const dy = targetY - transform.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const speed = 300;
                const vx = (dx / dist) * speed;
                const vy = (dy / dist) * speed;
                cell.setVelocity(vx, vy);
            }
        }

        // Run world tick
        (authority as any).world.tick(frameCounter++);

        // Simulate sendStateSync: compute and measure delta
        const prevSnapshot = (authority as any).prevSnapshot;
        const currentSnapshot = (authority as any).world.getSparseSnapshot();

        if (prevSnapshot && (authority as any).activeClients.length > 1) {
            const delta = computeStateDelta(prevSnapshot, currentSnapshot);
            const size = getDeltaSize(delta);
            deltaSizes.push(size);
            deltaUpdates.push(0 /* updated removed - deterministic sim */);
        }

        // Update prevSnapshot (like real sendStateSync does)
        (authority as any).prevSnapshot = currentSnapshot;
    }

    test('REPRODUCE: authority delta should NOT spike after client rejoin', () => {
        // Create 1600 static food (like cell-eater)
        for (let i = 0; i < 1600; i++) {
            authority.spawn('food', { x: (i % 40) * 150, y: Math.floor(i / 40) * 150 });
        }

        // Authority joins
        (authority as any).processInput({
            seq: 1,
            clientId: 'authority-id',
            data: { type: 'join', clientId: 'authority-id' }
        });
        (authority as any).world.tick(frameCounter++);

        // Initialize prevSnapshot
        (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

        // Client B joins
        console.log('\n=== CLIENT B JOINS ===');
        (authority as any).processInput({
            seq: 2,
            clientId: 'client-b',
            data: { type: 'join', clientId: 'client-b' }
        });
        (authority as any).world.tick(frameCounter++);

        // Get all cells for movement
        const getCells = () => [...authority.query('cell')];

        console.log('Cells:', getCells().length);
        console.log('activeClients:', (authority as any).activeClients);

        // Run 30 ticks with both clients active (baseline measurement)
        console.log('\n=== BASELINE: 30 ticks with 2 clients ===');
        for (let i = 0; i < 30; i++) {
            tick(getCells(), 700 + i * 5, 700 + i * 5);
        }

        const baselineSizes = [...deltaSizes];
        const baselineUpdates = [...deltaUpdates];
        const baselineAvg = baselineSizes.length > 0
            ? baselineSizes.reduce((a, b) => a + b, 0) / baselineSizes.length
            : 0;
        const baselineMax = baselineSizes.length > 0 ? Math.max(...baselineSizes) : 0;

        console.log(`Baseline: ${baselineSizes.length} samples, avg=${baselineAvg.toFixed(0)} B, max=${baselineMax} B`);
        console.log(`Baseline updates per frame: avg=${(baselineUpdates.reduce((a,b)=>a+b,0)/baselineUpdates.length).toFixed(1)}`);

        // Clear for rejoin measurement
        deltaSizes.length = 0;
        deltaUpdates.length = 0;

        // === REJOIN SCENARIO ===
        // Client B leaves
        console.log('\n=== CLIENT B LEAVES (disconnect) ===');
        (authority as any).processInput({
            seq: 3,
            clientId: 'client-b',
            data: { type: 'leave', clientId: 'client-b' }
        });
        (authority as any).world.tick(frameCounter++);
        (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

        console.log('Cells after leave:', getCells().length);
        console.log('activeClients after leave:', (authority as any).activeClients);

        // Client C joins (same human, different session - simulating browser refresh)
        console.log('\n=== CLIENT C JOINS (rejoin with new ID) ===');
        (authority as any).processInput({
            seq: 4,
            clientId: 'client-c',
            data: { type: 'join', clientId: 'client-c' }
        });
        (authority as any).world.tick(frameCounter++);

        // This is where the bug might manifest - check delta size immediately after rejoin
        const snapshotAfterJoin = (authority as any).world.getSparseSnapshot();
        const deltaAfterJoin = computeStateDelta((authority as any).prevSnapshot, snapshotAfterJoin);
        console.log(`Delta IMMEDIATELY after rejoin: updated=${0} created=${deltaAfterJoin.created.length} size=${getDeltaSize(deltaAfterJoin)} B`);

        // Update prevSnapshot
        (authority as any).prevSnapshot = snapshotAfterJoin;

        console.log('Cells after rejoin:', getCells().length);
        console.log('activeClients after rejoin:', (authority as any).activeClients);

        // Run 30 more ticks after rejoin
        console.log('\n=== AFTER REJOIN: 30 ticks with 2 clients ===');
        for (let i = 0; i < 30; i++) {
            tick(getCells(), 800 + i * 5, 800 + i * 5);
        }

        const afterRejoinSizes = [...deltaSizes];
        const afterRejoinUpdates = [...deltaUpdates];
        const afterRejoinAvg = afterRejoinSizes.length > 0
            ? afterRejoinSizes.reduce((a, b) => a + b, 0) / afterRejoinSizes.length
            : 0;
        const afterRejoinMax = afterRejoinSizes.length > 0 ? Math.max(...afterRejoinSizes) : 0;

        console.log(`After rejoin: ${afterRejoinSizes.length} samples, avg=${afterRejoinAvg.toFixed(0)} B, max=${afterRejoinMax} B`);
        console.log(`After rejoin updates per frame: avg=${(afterRejoinUpdates.reduce((a,b)=>a+b,0)/afterRejoinUpdates.length).toFixed(1)}`);

        // === BUG CHECK ===
        console.log('\n=== BUG CHECK ===');
        console.log(`Baseline delta: avg=${baselineAvg.toFixed(0)} B, max=${baselineMax} B`);
        console.log(`After rejoin delta: avg=${afterRejoinAvg.toFixed(0)} B, max=${afterRejoinMax} B`);

        // The bug: delta spikes to >10 kB after rejoin
        const SPIKE_THRESHOLD = 5000; // 5 kB - anything above this is suspicious

        if (afterRejoinMax > SPIKE_THRESHOLD) {
            console.log('\n!!! BUG REPRODUCED !!!');
            console.log(`Delta spiked to ${afterRejoinMax} B after rejoin!`);

            // Analyze what's in the large delta
            const currentSnap = (authority as any).world.getSparseSnapshot();
            const prevSnap = (authority as any).prevSnapshot;
            if (prevSnap) {
                const delta = computeStateDelta(prevSnap, currentSnap);
                console.log('Created:', delta.created.length, 'Deleted:', delta.deleted.length);
            }
        }

        // Assertions
        // After rejoin, delta should be similar to baseline (small variation OK)
        // But definitely NOT 10x or more
        expect(afterRejoinMax).toBeLessThan(baselineMax * 5 + 1000);
        expect(afterRejoinAvg).toBeLessThan(baselineAvg * 5 + 500);
    });

    test('STRESS: 5+ rapid rejoins should NOT cause bandwidth spike', () => {
        // Create 1600 static food (like cell-eater)
        for (let i = 0; i < 1600; i++) {
            authority.spawn('food', { x: (i % 40) * 150, y: Math.floor(i / 40) * 150 });
        }

        // Authority joins
        (authority as any).processInput({
            seq: 1,
            clientId: 'authority-id',
            data: { type: 'join', clientId: 'authority-id' }
        });
        (authority as any).world.tick(frameCounter++);
        (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

        // Client B joins initially
        console.log('\n=== INITIAL: CLIENT B JOINS ===');
        (authority as any).processInput({
            seq: 2,
            clientId: 'client-b',
            data: { type: 'join', clientId: 'client-b' }
        });
        (authority as any).world.tick(frameCounter++);
        (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

        const getCells = () => [...authority.query('cell')];

        // Run 30 ticks baseline
        console.log('\n=== BASELINE: 30 ticks ===');
        for (let i = 0; i < 30; i++) {
            tick(getCells(), 700 + i * 5, 700 + i * 5);
        }

        const baselineSizes = [...deltaSizes];
        const baselineAvg = baselineSizes.length > 0
            ? baselineSizes.reduce((a, b) => a + b, 0) / baselineSizes.length
            : 0;
        const baselineMax = baselineSizes.length > 0 ? Math.max(...baselineSizes) : 0;
        console.log(`Baseline: avg=${baselineAvg.toFixed(0)} B, max=${baselineMax} B`);

        // Clear for rejoin measurements
        deltaSizes.length = 0;
        deltaUpdates.length = 0;

        let seq = 3;
        const rejoinDeltas: number[] = [];
        const REJOIN_COUNT = 7;  // 7 rapid rejoins

        console.log(`\n=== ${REJOIN_COUNT} RAPID REJOINS ===`);

        for (let rejoin = 0; rejoin < REJOIN_COUNT; rejoin++) {
            const oldClientId = `client-${String.fromCharCode(98 + rejoin)}`;  // b, c, d, e, f, g, h
            const newClientId = `client-${String.fromCharCode(99 + rejoin)}`;  // c, d, e, f, g, h, i

            // Client leaves
            (authority as any).processInput({
                seq: seq++,
                clientId: oldClientId,
                data: { type: 'leave', clientId: oldClientId }
            });
            (authority as any).world.tick(frameCounter++);
            (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

            // 2 ticks while disconnected
            for (let t = 0; t < 2; t++) {
                tick(getCells(), 800 + rejoin * 20 + t * 5, 800);
            }

            // New client joins (simulating browser refresh with new session ID)
            (authority as any).processInput({
                seq: seq++,
                clientId: newClientId,
                data: { type: 'join', clientId: newClientId }
            });
            (authority as any).world.tick(frameCounter++);

            // Measure delta immediately after rejoin
            const snapshotAfterJoin = (authority as any).world.getSparseSnapshot();
            const deltaAfterJoin = computeStateDelta((authority as any).prevSnapshot, snapshotAfterJoin);
            const deltaSize = getDeltaSize(deltaAfterJoin);
            rejoinDeltas.push(deltaSize);
            console.log(`Rejoin ${rejoin + 1}: delta=${deltaSize} B, updated=${0}, created=${deltaAfterJoin.created.length}`);
            console.log(`  activeClients: ${JSON.stringify((authority as any).activeClients)}`);

            (authority as any).prevSnapshot = snapshotAfterJoin;

            // Run 5 ticks after each rejoin
            for (let t = 0; t < 5; t++) {
                tick(getCells(), 850 + rejoin * 20 + t * 5, 850);
            }
        }

        console.log(`\n=== AFTER ALL REJOINS: 30 more ticks ===`);
        deltaSizes.length = 0;
        for (let i = 0; i < 30; i++) {
            tick(getCells(), 900 + i * 5, 900 + i * 5);
        }

        const afterAllRejoinsAvg = deltaSizes.length > 0
            ? deltaSizes.reduce((a, b) => a + b, 0) / deltaSizes.length
            : 0;
        const afterAllRejoinsMax = deltaSizes.length > 0 ? Math.max(...deltaSizes) : 0;

        console.log(`\n=== RESULTS ===`);
        console.log(`Baseline: avg=${baselineAvg.toFixed(0)} B, max=${baselineMax} B`);
        console.log(`Rejoin deltas: ${rejoinDeltas.join(', ')} B`);
        console.log(`After all rejoins: avg=${afterAllRejoinsAvg.toFixed(0)} B, max=${afterAllRejoinsMax} B`);
        console.log(`activeClients final: ${JSON.stringify((authority as any).activeClients)}`);
        console.log(`Cells final: ${getCells().length}`);

        // Check for spikes
        const maxRejoinDelta = Math.max(...rejoinDeltas);
        const SPIKE_THRESHOLD = 5000;

        if (maxRejoinDelta > SPIKE_THRESHOLD) {
            console.log(`\n!!! BUG: Rejoin delta spiked to ${maxRejoinDelta} B !!!`);
        }

        // Assertions
        expect(maxRejoinDelta).toBeLessThan(SPIKE_THRESHOLD);
        expect(afterAllRejoinsMax).toBeLessThan(baselineMax * 5 + 1000);
    });

    test('authority delta bandwidth calculation over time', () => {
        // Create food
        for (let i = 0; i < 100; i++) {
            authority.spawn('food', { x: (i % 10) * 100, y: Math.floor(i / 10) * 100 });
        }

        // Authority joins
        (authority as any).processInput({
            seq: 1,
            clientId: 'authority-id',
            data: { type: 'join', clientId: 'authority-id' }
        });
        (authority as any).world.tick(frameCounter++);
        (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

        // Client B joins
        (authority as any).processInput({
            seq: 2,
            clientId: 'client-b',
            data: { type: 'join', clientId: 'client-b' }
        });
        (authority as any).world.tick(frameCounter++);
        (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

        const getCells = () => [...authority.query('cell')];

        // Simulate 60 frames (1 second at 60 fps)
        let totalDeltaBytes = 0;

        console.log('\n=== SIMULATING 60 FRAMES (1 second) ===');
        for (let i = 0; i < 60; i++) {
            // Move cells
            for (const cell of getCells()) {
                if (!cell.destroyed) {
                    cell.setVelocity(100 + Math.sin(i * 0.1) * 50, 100 + Math.cos(i * 0.1) * 50);
                }
            }

            // Tick
            (authority as any).world.tick(frameCounter++);

            // Compute delta
            const prevSnapshot = (authority as any).prevSnapshot;
            const currentSnapshot = (authority as any).world.getSparseSnapshot();

            if (prevSnapshot && (authority as any).activeClients.length > 1) {
                const delta = computeStateDelta(prevSnapshot, currentSnapshot);
                const size = getDeltaSize(delta);
                totalDeltaBytes += size;

                if (i % 20 === 0) {
                    console.log(`Frame ${i}: delta size=${size} B, updated=${0 /* updated removed - deterministic sim */}`);
                }
            }

            (authority as any).prevSnapshot = currentSnapshot;
        }

        const bps = totalDeltaBytes;  // bytes per second (60 frames = ~1 second)
        console.log(`\nTotal delta bytes in 60 frames: ${totalDeltaBytes} B`);
        console.log(`Effective bandwidth: ${bps} B/s (${(bps / 1024).toFixed(2)} kB/s)`);

        // With only 2 moving cells at 60fps, expect ~180 bytes/frame = ~11 kB/s
        // This is the NORMAL bandwidth for 2 cells updating every frame
        expect(bps).toBeLessThan(15000);  // Less than 15 kB/s
    });

    test('delta sizes with varying entity counts', () => {
        const results: Array<{ foodCount: number, avgDelta: number, maxDelta: number }> = [];

        for (const foodCount of [100, 500, 1000, 1600]) {
            // Reset
            authority = new Game({ tickRate: 60 });
            const authorityConn = createMockConnection('authority-id');
            (authority as any).connection = authorityConn;
            (authority as any).localClientIdStr = 'authority-id';

            physics = new Physics2DSystem({ gravity: { x: 0, y: 0 } });
            physics.attach(authority.world);

            authority.defineEntity('food')
                .with(Transform2D)
                .with(Sprite, { shape: SHAPE_CIRCLE, radius: 8 })
                .with(Body2D, { bodyType: BODY_STATIC, shapeType: SHAPE_CIRCLE, radius: 8 });

            authority.defineEntity('cell')
                .with(Transform2D)
                .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
                .with(Player)
                .with(Body2D, { bodyType: BODY_KINEMATIC, shapeType: SHAPE_CIRCLE, radius: 20 });

            (authority as any).callbacks = {
                onConnect: (clientId: string) => {
                    const cell = authority.spawn('cell', { x: 500, y: 500 });
                    cell.get(Player).clientId = (authority as any).internClientId(clientId);
                },
                onDisconnect: () => {}
            };

            // Create food
            for (let i = 0; i < foodCount; i++) {
                authority.spawn('food', { x: (i % 40) * 150, y: Math.floor(i / 40) * 150 });
            }

            // Join clients
            (authority as any).processInput({
                seq: 1, clientId: 'authority-id', data: { type: 'join', clientId: 'authority-id' }
            });
            (authority as any).processInput({
                seq: 2, clientId: 'client-b', data: { type: 'join', clientId: 'client-b' }
            });
            (authority as any).world.tick(0);
            (authority as any).prevSnapshot = (authority as any).world.getSparseSnapshot();

            // Run 20 ticks and measure
            const sizes: number[] = [];
            for (let i = 1; i <= 20; i++) {
                for (const cell of authority.query('cell')) {
                    cell.setVelocity(100, 50);
                }
                (authority as any).world.tick(i);

                const prev = (authority as any).prevSnapshot;
                const curr = (authority as any).world.getSparseSnapshot();
                if (prev) {
                    const delta = computeStateDelta(prev, curr);
                    sizes.push(getDeltaSize(delta));
                }
                (authority as any).prevSnapshot = curr;
            }

            const avgDelta = sizes.reduce((a, b) => a + b, 0) / sizes.length;
            const maxDelta = Math.max(...sizes);
            results.push({ foodCount, avgDelta, maxDelta });
        }

        console.log('\n=== DELTA SIZE VS ENTITY COUNT ===');
        for (const r of results) {
            console.log(`${r.foodCount} food: avg=${r.avgDelta.toFixed(0)} B, max=${r.maxDelta} B`);
        }

        // Key insight: delta should be CONSTANT regardless of total entity count
        // because only 2 cells are moving
        const avgDeltasVariation = Math.max(...results.map(r => r.avgDelta)) / Math.min(...results.map(r => r.avgDelta));
        console.log(`\nAvg delta variation ratio: ${avgDeltasVariation.toFixed(2)}x`);

        // If delta computation is correct, variation should be small (< 2x)
        // If buggy (including all entities), variation would be huge (10x+)
        expect(avgDeltasVariation).toBeLessThan(3);
    });
});
