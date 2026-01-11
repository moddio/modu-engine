/**
 * Rejoin Snapshot Test
 *
 * Test what's actually in the snapshot after leave/rejoin cycles.
 */
import { describe, test, expect, vi } from 'vitest';
import { Game } from '../game';
import { Transform2D, Player } from '../components';
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

describe('Rejoin Snapshot Contents', () => {
    test('snapshot should contain all current player entities after rejoin', () => {
        const authorityConn = createMockConnection('authority-id');
        const authority = new Game({ tickRate: 60 });
        (authority as any).connection = authorityConn;
        (authority as any).localClientIdStr = 'authority-id';

        authority.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        (authority as any).callbacks = {
            onConnect: (clientId: string) => {
                console.log(`onConnect called for ${clientId}`);
                const cell = authority.spawn('player', { x: 100, y: 100 });
                cell.get(Player).clientId = (authority as any).internClientId(clientId);
                console.log(`Created player entity with clientId=${cell.get(Player).clientId}`);
            },
            onDisconnect: (clientId: string) => {
                console.log(`onDisconnect called for ${clientId}`);
                const numId = (authority as any).internClientId(clientId);
                for (const entity of authority.query('player')) {
                    if (entity.get(Player).clientId === numId) {
                        console.log(`Destroying player entity for ${clientId}`);
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
        (authority as any).world.tick(0);

        console.log('\n=== AUTHORITY ALONE ===');
        const entities1 = [...authority.query('player')];
        console.log('Player entities:', entities1.length);
        for (const e of entities1) {
            console.log(`  - eid=${e.eid}, clientId=${e.get(Player).clientId}`);
        }

        // Client B joins
        (authority as any).processInput({
            seq: 2,
            clientId: 'client-b',
            data: { type: 'join', clientId: 'client-b' }
        });
        (authority as any).world.tick(1);

        console.log('\n=== AFTER CLIENT-B JOINS ===');
        const entities2 = [...authority.query('player')];
        console.log('Player entities:', entities2.length);
        for (const e of entities2) {
            console.log(`  - eid=${e.eid}, clientId=${e.get(Player).clientId}`);
        }

        // Client B leaves
        (authority as any).processInput({
            seq: 3,
            clientId: 'client-b',
            data: { type: 'leave', clientId: 'client-b' }
        });
        (authority as any).world.tick(2);

        console.log('\n=== AFTER CLIENT-B LEAVES ===');
        const entities3 = [...authority.query('player')];
        console.log('Player entities:', entities3.length);
        for (const e of entities3) {
            console.log(`  - eid=${e.eid}, clientId=${e.get(Player).clientId}`);
        }

        // Client C joins (simulating rejoin with new ID)
        (authority as any).processInput({
            seq: 4,
            clientId: 'client-c',
            data: { type: 'join', clientId: 'client-c' }
        });
        (authority as any).world.tick(3);

        console.log('\n=== AFTER CLIENT-C JOINS (rejoin) ===');
        const entities4 = [...authority.query('player')];
        console.log('Player entities:', entities4.length);
        for (const e of entities4) {
            console.log(`  - eid=${e.eid}, clientId=${e.get(Player).clientId}`);
        }

        // Now take snapshot
        const snapshot = (authority as any).getNetworkSnapshot();

        console.log('\n=== SNAPSHOT CONTENTS ===');
        console.log('Types:', snapshot.types);
        console.log('Entities count:', snapshot.entities.length);
        console.log('clientIdMap:', JSON.stringify(snapshot.clientIdMap));

        // Check what's in the snapshot
        for (const entityData of snapshot.entities) {
            const [eid, typeIdx, values] = entityData;
            const typeName = snapshot.types[typeIdx];
            console.log(`  Entity: eid=${eid}, type=${typeName}`);

            // Get the schema for this type to decode values
            const typeSchema = snapshot.schema[typeIdx];
            let valueIdx = 0;
            for (const [compName, fields] of typeSchema) {
                const compValues: Record<string, any> = {};
                for (const field of fields) {
                    compValues[field] = values[valueIdx++];
                }
                if (compName === 'Player') {
                    console.log(`    Player: ${JSON.stringify(compValues)}`);
                }
            }
        }

        // Verify snapshot has 2 player entities
        expect(snapshot.entities.length).toBe(2);

        // Now load this snapshot into a new game (the late joiner)
        console.log('\n=== LATE JOINER LOADS SNAPSHOT ===');
        const lateJoinerConn = createMockConnection('client-c');
        const lateJoiner = new Game({ tickRate: 60 });
        (lateJoiner as any).connection = lateJoinerConn;
        (lateJoiner as any).localClientIdStr = 'client-c';

        lateJoiner.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        // Encode/decode to simulate network
        const encoded = encode({ snapshot, hash: 0 });
        const decoded = decode(encoded) as any;

        (lateJoiner as any).loadNetworkSnapshot(decoded.snapshot);

        const lateJoinerEntities = [...lateJoiner.query('player')];
        console.log('Late joiner player entities:', lateJoinerEntities.length);
        for (const e of lateJoinerEntities) {
            console.log(`  - eid=${e.eid}, clientId=${e.get(Player).clientId}`);
        }

        console.log('Late joiner activeClients:', (lateJoiner as any).activeClients);
        console.log('Late joiner activeClients:', (lateJoiner as any).activeClients);

        // Verify late joiner has same entities
        expect(lateJoinerEntities.length).toBe(2);
        expect((lateJoiner as any).activeClients.length).toBe(2);
    });
});
