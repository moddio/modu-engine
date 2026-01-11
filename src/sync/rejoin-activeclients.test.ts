/**
 * Rejoin activeClients Test
 *
 * Reproduces the bug: after client leaves and new client joins (rejoin scenario),
 * activeClients gets out of sync.
 */
import { describe, test, expect, vi } from 'vitest';
import { Game } from '../game';
import { Transform2D, Player } from '../components';
import { encode, decode } from '../codec';
import { computePartitionCount } from './partition';

// Mock connection
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

describe('Rejoin activeClients Bug', () => {
    test('REPRODUCES BUG: activeClients after leave and rejoin', () => {
        // === AUTHORITY CLIENT (stays the whole time) ===
        const authorityConn = createMockConnection('authority-id');
        const authority = new Game({ tickRate: 60 });
        (authority as any).connection = authorityConn;
        (authority as any).localClientIdStr = 'authority-id';

        authority.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        (authority as any).callbacks = {
            onConnect: (clientId: string) => {
                const cell = authority.spawn('player', { x: 500, y: 500 });
                cell.get(Player).clientId = (authority as any).internClientId(clientId);
            },
            onDisconnect: (clientId: string) => {
                // Remove player entity on disconnect
                for (const entity of authority.query('player')) {
                    const numId = (authority as any).internClientId(clientId);
                    if (entity.get(Player).clientId === numId) {
                        entity.destroy();
                    }
                }
            }
        };

        // Authority joins
        (authority as any).processInput({
            seq: 1,
            clientId: 'authority-id',
            data: { type: 'join', clientId: 'authority-id' }
        });

        // First client joins
        (authority as any).processInput({
            seq: 2,
            clientId: 'client-b-first',
            data: { type: 'join', clientId: 'client-b-first' }
        });

        (authority as any).world.tick(0);

        console.log('=== INITIAL STATE ===');
        console.log('Authority activeClients:', (authority as any).activeClients);
        console.log('Authority activeClients:', (authority as any).activeClients);
        expect((authority as any).activeClients.length).toBe(2);

        // First client LEAVES
        console.log('\n=== CLIENT B LEAVES ===');
        (authority as any).processInput({
            seq: 3,
            clientId: 'client-b-first',
            data: { type: 'leave', clientId: 'client-b-first' }
        });

        (authority as any).world.tick(1);

        console.log('Authority activeClients after leave:', (authority as any).activeClients);
        console.log('Authority activeClients after leave:', (authority as any).activeClients);

        // Should have 1 client now
        expect((authority as any).activeClients.length).toBe(1);

        // NEW client joins (simulating rejoin with different client ID)
        console.log('\n=== NEW CLIENT JOINS (rejoin scenario) ===');
        (authority as any).processInput({
            seq: 4,
            clientId: 'client-b-second',
            data: { type: 'join', clientId: 'client-b-second' }
        });

        (authority as any).world.tick(2);

        console.log('Authority activeClients after rejoin:', (authority as any).activeClients);
        console.log('Authority activeClients after rejoin:', (authority as any).activeClients);
        expect((authority as any).activeClients.length).toBe(2);

        // Take snapshot for the new late joiner
        const snapshot = (authority as any).getNetworkSnapshot();
        console.log('\n=== SNAPSHOT FOR LATE JOINER ===');
        console.log('Snapshot entities:', snapshot.entities.length);
        console.log('Snapshot clientIdMap:', snapshot.clientIdMap);

        // Encode/decode
        const encodedSnapshot = encode({ snapshot, hash: 0 });
        const decoded = decode(encodedSnapshot) as any;
        const decodedSnapshot = decoded.snapshot;

        // === LATE JOINER (the new client) ===
        const lateJoinerConn = createMockConnection('client-b-second');
        const lateJoiner = new Game({ tickRate: 60 });
        (lateJoiner as any).connection = lateJoinerConn;
        (lateJoiner as any).localClientIdStr = 'client-b-second';

        lateJoiner.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        // Load snapshot
        (lateJoiner as any).loadNetworkSnapshot(decodedSnapshot);

        console.log('\n=== LATE JOINER STATE ===');
        console.log('Late joiner activeClients:', (lateJoiner as any).activeClients);
        console.log('Late joiner activeClients:', (lateJoiner as any).activeClients);

        // BUG CHECK
        console.log('\n=== BUG CHECK ===');
        console.log('Authority activeClients.length:', (authority as any).activeClients.length);
        console.log('Late joiner activeClients.length:', (lateJoiner as any).activeClients.length);

        if ((lateJoiner as any).activeClients.length !== (authority as any).activeClients.length) {
            console.log('!!! BUG REPRODUCED !!!');
            console.log('Authority has:', (authority as any).activeClients);
            console.log('Late joiner has:', (lateJoiner as any).activeClients);
        }

        expect((lateJoiner as any).activeClients.length).toBe((authority as any).activeClients.length);
        expect((lateJoiner as any).activeClients).toContain('authority-id');
        expect((lateJoiner as any).activeClients).toContain('client-b-second');
    });

    test('leave removes client from activeClients', () => {
        const conn = createMockConnection('client-a');
        const game = new Game({ tickRate: 60 });
        (game as any).connection = conn;
        (game as any).localClientIdStr = 'client-a';

        game.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        (game as any).callbacks = {
            onConnect: (clientId: string) => {
                const p = game.spawn('player', { x: 0, y: 0 });
                p.get(Player).clientId = (game as any).internClientId(clientId);
            },
            onDisconnect: (clientId: string) => {
                for (const entity of game.query('player')) {
                    const numId = (game as any).internClientId(clientId);
                    if (entity.get(Player).clientId === numId) {
                        entity.destroy();
                    }
                }
            }
        };

        // Three clients join
        (game as any).processInput({ seq: 1, clientId: 'client-a', data: { type: 'join', clientId: 'client-a' } });
        (game as any).processInput({ seq: 2, clientId: 'client-b', data: { type: 'join', clientId: 'client-b' } });
        (game as any).processInput({ seq: 3, clientId: 'client-c', data: { type: 'join', clientId: 'client-c' } });

        (game as any).world.tick(0);

        console.log('After 3 joins:');
        console.log('  activeClients:', (game as any).activeClients);
        expect((game as any).activeClients.length).toBe(3);

        // Client B leaves
        (game as any).processInput({ seq: 4, clientId: 'client-b', data: { type: 'leave', clientId: 'client-b' } });

        (game as any).world.tick(1);

        console.log('After client-b leaves:');
        console.log('  activeClients:', (game as any).activeClients);

        expect((game as any).activeClients.length).toBe(2);
        expect((game as any).activeClients).toContain('client-a');
        expect((game as any).activeClients).toContain('client-c');
        expect((game as any).activeClients).not.toContain('client-b');
    });
});
