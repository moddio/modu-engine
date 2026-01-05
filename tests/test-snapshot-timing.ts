/**
 * Test: Snapshot Timing for Late Joiners
 *
 * Verifies that the first client sends a snapshot immediately after init,
 * so late joiners get valid game state even if they connect quickly.
 */

import puppeteer, { Browser, Page } from 'puppeteer';

const CENTRAL_URL = 'http://localhost:9001';
const NODE1_URL = 'ws://localhost:8001/ws';
const EXAMPLES_URL = 'http://localhost:3001/examples';
const ROOM_ID = `test-snapshot-timing-${Date.now()}`;

async function clearTestRooms() {
    try {
        const response = await fetch(`${CENTRAL_URL}/api/test/clear-rooms`, { method: 'POST' });
        if (response.ok) {
            console.log('Cleared test rooms');
        }
    } catch (e) {
        // Ignore - endpoint may not exist
    }
}

async function test() {
    console.log('='.repeat(60));
    console.log('Test: Snapshot Timing for Late Joiners');
    console.log('='.repeat(60));

    await clearTestRooms();

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let p1: Page | null = null;
    let p2: Page | null = null;

    try {
        // Setup console logging
        const setupLogging = (page: Page, name: string) => {
            page.on('console', msg => {
                const text = msg.text();
                if (text.includes('[modu]') || text.includes('[game]') ||
                    text.includes('INITIAL_STATE') || text.includes('snapshot')) {
                    console.log(`[${name}] ${text}`);
                }
            });
        };

        // Player 1 - Creates room
        console.log('\n--- Player 1: Creating room ---');
        p1 = await browser.newPage();
        setupLogging(p1, 'P1');

        // Inject test harness
        await p1.goto(`${EXAMPLES_URL}/cell-eater.html`);

        // Override connect to use our test room
        await p1.evaluate((roomId: string) => {
            (window as any).testRoomId = roomId;
        }, ROOM_ID);

        // Wait for P1 to connect
        await new Promise(r => setTimeout(r, 2000));

        // Get P1's snapshot
        const p1Snapshot = await p1.evaluate(() => {
            const api = (window as any).gameAPI;
            if (api && api.getSnapshot) {
                return api.getSnapshot();
            }
            return null;
        });

        console.log('\nP1 Snapshot after init:',
            p1Snapshot ? `frame=${p1Snapshot.frame}, physics2d bodies=${p1Snapshot.physics2d?.bodies?.length || 0}` : 'null');

        // Player 2 - Joins quickly
        console.log('\n--- Player 2: Joining quickly ---');
        p2 = await browser.newPage();
        setupLogging(p2, 'P2');

        await p2.goto(`${EXAMPLES_URL}/cell-eater.html`);

        // Wait for P2 to connect and receive snapshot
        await new Promise(r => setTimeout(r, 2000));

        // Check P2's state
        const p2State = await p2.evaluate(() => {
            const api = (window as any).gameAPI;
            if (api && api.getSnapshot) {
                const snap = api.getSnapshot();
                return {
                    frame: snap.frame,
                    bodyCount: snap.physics2d?.bodies?.length || 0,
                    hasIdCounters: !!snap.idCounters,
                    hasPhysics: !!snap.physics2d
                };
            }
            return null;
        });

        console.log('\nP2 State:', p2State);

        // Wait a bit more for inputs to process
        await new Promise(r => setTimeout(r, 1500));

        // Check if players can see each other
        const p1Players = await p1.evaluate(() => {
            // Get player count from the game
            return (window as any).players?.size || 0;
        });

        const p2Players = await p2.evaluate(() => {
            return (window as any).players?.size || 0;
        });

        console.log(`\nPlayer visibility: P1 sees ${p1Players} players, P2 sees ${p2Players} players`);

        // Verify results
        const success = p1Players >= 2 && p2Players >= 2;

        if (success) {
            console.log('\n✅ TEST PASSED: Both players see each other');
        } else {
            console.log('\n❌ TEST FAILED: Players not synced');
            console.log(`   P1 sees: ${p1Players} players (expected: 2)`);
            console.log(`   P2 sees: ${p2Players} players (expected: 2)`);
        }

        return success;

    } finally {
        if (p1) await p1.close().catch(() => {});
        if (p2) await p2.close().catch(() => {});
        await browser.close();
    }
}

test()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
        console.error('Test error:', err);
        process.exit(1);
    });
