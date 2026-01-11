/**
 * Delta Performance Test
 *
 * Tests that delta computation correctly identifies only structural changes (creates/deletes).
 * Field changes are NOT tracked because simulation is deterministic - all clients compute
 * identical field values from the same inputs.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { World } from '../core/world';
import { Transform2D, Body2D, Sprite, SHAPE_CIRCLE, BODY_STATIC, BODY_DYNAMIC } from '../components';
import { computeStateDelta, isDeltaEmpty, getDeltaSize } from './state-delta';
import { INDEX_MASK } from '../core/constants';

describe('Delta Performance', () => {
    let world: World;

    beforeEach(() => {
        world = new World();
    });

    afterEach(() => {
        world.reset();
    });

    test('field changes do not affect delta (deterministic simulation)', () => {
        // Define entity types
        world.defineEntity('food')
            .with(Transform2D)
            .with(Sprite, { shape: SHAPE_CIRCLE, radius: 8 })
            .with(Body2D, { bodyType: BODY_STATIC });

        world.defineEntity('cell')
            .with(Transform2D)
            .with(Sprite, { shape: SHAPE_CIRCLE, radius: 20 })
            .with(Body2D, { bodyType: BODY_DYNAMIC });

        // Create 100 static food entities
        for (let i = 0; i < 100; i++) {
            world.spawn('food', { x: i * 10, y: i * 10 });
        }

        // Create 2 moving cell entities
        const cell1 = world.spawn('cell', { x: 100, y: 100 });
        const cell2 = world.spawn('cell', { x: 200, y: 200 });

        // Take first snapshot
        world.frame = 1;
        const snapshot1 = world.getSparseSnapshot();

        console.log('Snapshot 1:');
        console.log('  entityCount:', snapshot1.entityCount);
        console.log('  componentData keys:', Array.from(snapshot1.componentData.keys()));

        // Move only the cells - modify the raw storage directly
        const index1 = cell1.eid & INDEX_MASK;
        const index2 = cell2.eid & INDEX_MASK;
        Transform2D.storage.fields['x'][index1] = 110 * 65536;
        Transform2D.storage.fields['y'][index1] = 110 * 65536;
        Transform2D.storage.fields['x'][index2] = 210 * 65536;
        Transform2D.storage.fields['y'][index2] = 210 * 65536;

        // Take second snapshot
        world.frame = 2;
        const snapshot2 = world.getSparseSnapshot();

        // Compute delta
        const delta = computeStateDelta(snapshot1, snapshot2);

        console.log('Delta stats:');
        console.log('  Created:', delta.created.length);
        console.log('  Deleted:', delta.deleted.length);
        console.log('  Delta size:', getDeltaSize(delta), 'bytes');

        // Field changes should NOT appear in delta (deterministic simulation)
        expect(delta.created.length).toBe(0);
        expect(delta.deleted.length).toBe(0);
        expect(isDeltaEmpty(delta)).toBe(true);
    });

    test('identical snapshots produce empty delta', () => {
        // Define entity type
        world.defineEntity('staticFood')
            .with(Transform2D)
            .with(Sprite);

        // Create some entities
        for (let i = 0; i < 50; i++) {
            world.spawn('staticFood', { x: i, y: i });
        }

        // Take two snapshots without changing anything
        world.frame = 1;
        const snapshot1 = world.getSparseSnapshot();

        world.frame = 2;
        const snapshot2 = world.getSparseSnapshot();

        const delta = computeStateDelta(snapshot1, snapshot2);

        expect(isDeltaEmpty(delta)).toBe(true);
        expect(delta.created.length).toBe(0);
        expect(delta.deleted.length).toBe(0);
    });

    test('delta tracks entity creation', () => {
        world.defineEntity('entity')
            .with(Transform2D)
            .with(Sprite);

        // Initial state: 10 entities
        for (let i = 0; i < 10; i++) {
            world.spawn('entity', { x: i * 10, y: i * 10 });
        }

        world.frame = 1;
        const snapshot1 = world.getSparseSnapshot();

        // Add 5 more entities
        for (let i = 0; i < 5; i++) {
            world.spawn('entity', { x: 100 + i * 10, y: 100 + i * 10 });
        }

        world.frame = 2;
        const snapshot2 = world.getSparseSnapshot();

        const delta = computeStateDelta(snapshot1, snapshot2);

        // Should detect 5 new entities
        expect(delta.created.length).toBe(5);
        expect(delta.deleted.length).toBe(0);
    });

    test('large world with field changes has minimal delta (deterministic)', () => {
        // This simulates the cell-eater scenario: 1604 entities, only 2 moving
        world.defineEntity('staticPellet')
            .with(Transform2D)
            .with(Sprite, { shape: SHAPE_CIRCLE })
            .with(Body2D, { bodyType: BODY_STATIC });

        world.defineEntity('movingCell')
            .with(Transform2D)
            .with(Sprite, { shape: SHAPE_CIRCLE })
            .with(Body2D, { bodyType: BODY_DYNAMIC });

        // Create ~1600 static food entities (like in cell-eater)
        for (let i = 0; i < 1600; i++) {
            world.spawn('staticPellet', { x: (i % 100) * 10, y: Math.floor(i / 100) * 10 });
        }

        // Create 4 moving cells (like 2 players)
        const cells: any[] = [];
        for (let i = 0; i < 4; i++) {
            cells.push(world.spawn('movingCell', { x: 500 + i * 50, y: 500 + i * 50 }));
        }

        // Take first snapshot
        world.frame = 1;
        const snapshot1 = world.getSparseSnapshot();

        // Move only the cells (directly modify storage)
        for (const cell of cells) {
            const index = cell.eid & INDEX_MASK;
            Transform2D.storage.fields['x'][index] += 10 * 65536;
            Transform2D.storage.fields['y'][index] += 5 * 65536;
        }

        // Take second snapshot
        world.frame = 2;
        const snapshot2 = world.getSparseSnapshot();

        // Compute delta
        const delta = computeStateDelta(snapshot1, snapshot2);

        console.log('Large world delta stats:');
        console.log('  Total entities:', world.entityCount);
        console.log('  Created:', delta.created.length);
        console.log('  Deleted:', delta.deleted.length);
        console.log('  Delta size:', getDeltaSize(delta), 'bytes');

        // Field changes don't affect delta (deterministic simulation)
        // Delta should be empty since no entities were created or deleted
        expect(delta.created.length).toBe(0);
        expect(delta.deleted.length).toBe(0);
        expect(isDeltaEmpty(delta)).toBe(true);

        // Delta should be minimal (just header, 16 bytes)
        const deltaSize = getDeltaSize(delta);
        expect(deltaSize).toBe(16);
    });
});
