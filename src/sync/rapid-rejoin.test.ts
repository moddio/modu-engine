/**
 * Rapid Rejoin Test
 *
 * Simulates the exact scenario:
 * 1. Two clients running
 * 2. One client refreshes (leaves and immediately rejoins with new client ID)
 * 3. Check if state is consistent
 */
import { describe, test, expect, vi } from 'vitest';
import { Game } from '../game';
import { Transform2D, Player } from '../components';
import { encode, decode } from '../codec';
import { computePartitionCount } from './partition';
import { computeStateDelta, getDeltaSize } from './state-delta';

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

describe('Rapid Rejoin Bug', () => {
    test('REPRODUCE: multiple rapid rejoins cause desync', () => {
        // === PERSISTENT AUTHORITY ===
        const authorityConn = createMockConnection('authority-id');
        const authority = new Game({ tickRate: 60 });
        (authority as any).connection = authorityConn;
        (authority as any).localClientIdStr = 'authority-id';

        authority.defineEntity('food')
            .with(Transform2D);

        authority.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        (authority as any).callbacks = {
            onConnect: (clientId: string) => {
                console.log(`[authority] onConnect: ${clientId}`);
                const cell = authority.spawn('player', { x: Math.random() * 1000, y: Math.random() * 1000 });
                cell.get(Player).clientId = (authority as any).internClientId(clientId);
            },
            onDisconnect: (clientId: string) => {
                console.log(`[authority] onDisconnect: ${clientId}`);
                const numId = (authority as any).internClientId(clientId);
                for (const entity of authority.query('player')) {
                    if (entity.get(Player).clientId === numId) {
                        entity.destroy();
                    }
                }
            }
        };

        // Create food entities
        for (let i = 0; i < 100; i++) {
            authority.spawn('food', { x: i * 50, y: i * 30 });
        }

        // Authority joins
        (authority as any).processInput({
            seq: 1,
            clientId: 'authority-id',
            data: { type: 'join', clientId: 'authority-id' }
        });
        (authority as any).world.tick(0);

        console.log('\n=== INITIAL: Authority alone ===');
        console.log('activeClients:', (authority as any).activeClients);
        console.log('entities:', (authority as any).world.entityCount);

        let seq = 2;
        let frame = 1;
        let lastLateJoiner: Game | null = null;

        // Simulate 3 rapid rejoins
        for (let rejoin = 1; rejoin <= 3; rejoin++) {
            const clientId = `client-rejoin-${rejoin}`;
            const prevClientId = rejoin > 1 ? `client-rejoin-${rejoin - 1}` : null;

            console.log(`\n=== REJOIN ${rejoin}: ${clientId} joins ===`);

            // Previous client leaves (if any)
            if (prevClientId) {
                (authority as any).processInput({
                    seq: seq++,
                    clientId: prevClientId,
                    data: { type: 'leave', clientId: prevClientId }
                });
                (authority as any).world.tick(frame++);
                console.log('After leave - activeClients:', (authority as any).activeClients);
            }

            // New client joins
            (authority as any).processInput({
                seq: seq++,
                clientId: clientId,
                data: { type: 'join', clientId: clientId }
            });
            (authority as any).world.tick(frame++);
            console.log('After join - activeClients:', (authority as any).activeClients);

            // Take snapshot for late joiner
            const snapshot = (authority as any).getNetworkSnapshot();
            const encoded = encode({ snapshot, hash: 0 });
            const decoded = decode(encoded) as any;

            // Create late joiner game
            const lateJoinerConn = createMockConnection(clientId);
            const lateJoiner = new Game({ tickRate: 60 });
            (lateJoiner as any).connection = lateJoinerConn;
            (lateJoiner as any).localClientIdStr = clientId;

            lateJoiner.defineEntity('food').with(Transform2D);
            lateJoiner.defineEntity('player').with(Transform2D).with(Player);

            // Load snapshot
            (lateJoiner as any).loadNetworkSnapshot(decoded.snapshot);

            console.log('Late joiner activeClients:', (lateJoiner as any).activeClients);
            console.log('Late joiner entities:', (lateJoiner as any).world.entityCount);

            // Check for mismatch
            const authorityActive = (authority as any).activeClients.length;
            const lateJoinerActive = (lateJoiner as any).activeClients.length;

            if (authorityActive !== lateJoinerActive) {
                console.log(`!!! BUG: activeClients mismatch! authority=${authorityActive} lateJoiner=${lateJoinerActive}`);
            }

            // Run a few ticks on both
            for (let i = 0; i < 5; i++) {
                (authority as any).world.tick(frame);
                (lateJoiner as any).world.tick(frame);
                frame++;
            }

            // Compare hashes
            const authorityHash = (authority as any).world.getStateHash();
            const lateJoinerHash = (lateJoiner as any).world.getStateHash();

            console.log(`Hashes: authority=${authorityHash.toString(16)} lateJoiner=${lateJoinerHash.toString(16)}`);

            if (authorityHash !== lateJoinerHash) {
                console.log('!!! BUG: Hash mismatch - DESYNCED!');

                // Compare snapshots
                const authSnap = (authority as any).world.getSparseSnapshot();
                const lateSnap = (lateJoiner as any).world.getSparseSnapshot();

                const delta = computeStateDelta(authSnap, lateSnap);
                console.log(`Delta: created=${delta.created.length} deleted=${delta.deleted.length}`);
            }

            lastLateJoiner = lateJoiner;

            // Verify
            expect(lateJoinerActive).toBe(authorityActive);
        }

        // Final check
        console.log('\n=== FINAL STATE ===');
        console.log('Authority activeClients:', (authority as any).activeClients);
        if (lastLateJoiner) {
            console.log('Last late joiner activeClients:', (lastLateJoiner as any).activeClients);
        }
    });

    test('snapshot after leave should NOT include left client', () => {
        const conn = createMockConnection('client-a');
        const game = new Game({ tickRate: 60 });
        (game as any).connection = conn;
        (game as any).localClientIdStr = 'client-a';

        game.defineEntity('player').with(Transform2D).with(Player);

        (game as any).callbacks = {
            onConnect: (clientId: string) => {
                const p = game.spawn('player', { x: 0, y: 0 });
                p.get(Player).clientId = (game as any).internClientId(clientId);
            },
            onDisconnect: (clientId: string) => {
                const numId = (game as any).internClientId(clientId);
                for (const entity of game.query('player')) {
                    if (entity.get(Player).clientId === numId) {
                        entity.destroy();
                    }
                }
            }
        };

        // A and B join
        (game as any).processInput({ seq: 1, clientId: 'client-a', data: { type: 'join', clientId: 'client-a' } });
        (game as any).processInput({ seq: 2, clientId: 'client-b', data: { type: 'join', clientId: 'client-b' } });
        (game as any).world.tick(0);

        console.log('After joins:');
        console.log('  activeClients:', (game as any).activeClients);
        console.log('  player count:', [...game.query('player')].length);

        // B leaves
        (game as any).processInput({ seq: 3, clientId: 'client-b', data: { type: 'leave', clientId: 'client-b' } });
        (game as any).world.tick(1);

        console.log('After B leaves:');
        console.log('  activeClients:', (game as any).activeClients);
        console.log('  player count:', [...game.query('player')].length);

        // Take snapshot
        const snapshot = (game as any).getNetworkSnapshot();

        console.log('Snapshot:');
        console.log('  entities:', snapshot.entities.length);
        console.log('  clientIdMap:', JSON.stringify(snapshot.clientIdMap));

        // Load snapshot into new game
        const conn2 = createMockConnection('client-c');
        const game2 = new Game({ tickRate: 60 });
        (game2 as any).connection = conn2;
        (game2 as any).localClientIdStr = 'client-c';
        game2.defineEntity('player').with(Transform2D).with(Player);

        const encoded = encode({ snapshot, hash: 0 });
        const decoded = decode(encoded) as any;
        (game2 as any).loadNetworkSnapshot(decoded.snapshot);

        console.log('Game2 after loading snapshot:');
        console.log('  activeClients:', (game2 as any).activeClients);
        console.log('  player count:', [...game2.query('player')].length);

        // Should only have client-a
        expect((game2 as any).activeClients.length).toBe(1);
        expect((game2 as any).activeClients).toContain('client-a');
        expect((game2 as any).activeClients).not.toContain('client-b');
    });
});
